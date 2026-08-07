/**
 * Vorzai 采购供应链服务（V2 · S1-S6）
 *
 * 补齐业务链最大缺口：供应商 → 采购单 → 到货入库 → 库存联动 → 供应链协同
 *
 * 能力矩阵：
 *   S1 供应商台账      createSupplier / listSuppliers / updateSupplier / deleteSupplier
 *   S2 采购单          createPurchaseOrder / listPurchaseOrders / getPurchaseOrder / transition
 *   S3 入库质检        receivePurchaseOrder → 写 stock_transactions + 回写 products.stock
 *   S4 库存联动采购    buildReplenishSuggestions / createPOFromSuggestions
 *   S5 采购成本核算    采购加权均价回写 products.cost_price
 *   S6 供应链协同      getSupplierPerformance（交期达成率/到货率/采购额）
 *
 * 关键口径（与 cockpitService / inventoryService 保持一致，不得自行发明）：
 *   补货建议量 suggestedQty = max(0, ceil(日均销量 × 覆盖天数) − 当前库存)
 *   日均销量  dailySalesAvg = 窗口期内 sale_out 数量 / 窗口天数（无流水时回落订单明细）
 *   采购加权均价 = Σ(入库数量 × 单价) / Σ(入库数量)
 *   交期达成率 onTimeRate = 按期到货单数 / 已完成单数
 *
 * 所有 SQL 强制带 tenant_id 过滤，配合 tenantIsolation 中间件做租户隔离。
 * 涉及表：suppliers / purchase_orders / purchase_items / stock_transactions / products
 */
import { v4 as uuidv4 } from 'uuid';
import { getDatabase, transaction, paginate, PaginationParams, PaginatedResult } from '../db';
import { NotFoundError, ValidationError, ConflictError } from '../utils/errors';
import { logger } from '../utils/logger';

// ════════════════════════════════════════════════════════════
// 类型定义
// ════════════════════════════════════════════════════════════

export type SupplierGrade = 'A' | 'B' | 'C' | 'D';
export type SupplierStatus = 'active' | 'suspended' | 'archived';
export type POStatus = 'draft' | 'submitted' | 'approved' | 'receiving' | 'completed' | 'cancelled';
export type POSource = 'manual' | 'replenish_suggestion' | 'import';
export type StockTxnType =
  | 'purchase_in' | 'sale_out' | 'return_in' | 'return_out' | 'adjust' | 'transfer' | 'scrap';

export interface SupplierInput {
  name: string;
  code?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  address?: string;
  category?: string;
  grade?: SupplierGrade;
  paymentTerms?: string;
  leadTimeDays?: number;
  currency?: string;
  remark?: string;
  isSandbox?: boolean;
}

export interface PurchaseItemInput {
  productId?: string;
  productSku?: string;
  productName?: string;
  quantity: number;
  unitPrice: number;
  remark?: string;
}

export interface PurchaseOrderInput {
  supplierId?: string;
  supplierName?: string;
  items: PurchaseItemInput[];
  expectedDate?: string;
  currency?: string;
  source?: POSource;
  sourceRef?: string;
  remark?: string;
  isSandbox?: boolean;
}

export interface ReceiveItemInput {
  /** purchase_items.id */
  itemId: string;
  /** 本次到货数量 */
  receivedQuantity: number;
  /** 质检合格数量，缺省等于到货数量 */
  qualifiedQuantity?: number;
  remark?: string;
}

export interface ReplenishSuggestion {
  productId: string;
  sku: string | null;
  name: string;
  currentStock: number;
  dailySalesAvg: number;
  coverDays: number;
  suggestedQty: number;
  estimatedCost: number;
  lastPurchasePrice: number;
  supplierId: string | null;
  supplierName: string | null;
  reason: string;
}

/** 采购单状态机：只允许沿箭头方向流转 */
const PO_TRANSITIONS: Record<POStatus, POStatus[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['approved', 'draft', 'cancelled'],
  approved: ['receiving', 'cancelled'],
  receiving: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

const PO_STATUS_LABEL: Record<POStatus, string> = {
  draft: '草稿',
  submitted: '已提交',
  approved: '已审批',
  receiving: '收货中',
  completed: '已完成',
  cancelled: '已取消',
};

// ════════════════════════════════════════════════════════════
// 工具函数
// ════════════════════════════════════════════════════════════

function nowIso(): string {
  return new Date().toISOString();
}

/** 生成采购单号 PO + yyyyMMdd + 4 位序列 */
function genPoNo(tenantId: string): string {
  const db = getDatabase();
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `PO${datePart}`;
  const row = db
    .prepare('SELECT COUNT(*) AS c FROM purchase_orders WHERE tenant_id = ? AND po_no LIKE ?')
    .get(tenantId, `${prefix}%`) as { c: number } | undefined;
  const seq = String((row?.c || 0) + 1).padStart(4, '0');
  return `${prefix}${seq}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function mapSupplier(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    address: row.address,
    category: row.category,
    grade: row.grade as SupplierGrade,
    paymentTerms: row.payment_terms,
    leadTimeDays: row.lead_time_days,
    rating: row.rating,
    onTimeRate: row.on_time_rate,
    totalPurchaseAmount: row.total_purchase_amount,
    currency: row.currency,
    status: row.status as SupplierStatus,
    remark: row.remark,
    isSandbox: !!row.is_sandbox,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPurchaseOrder(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    poNo: row.po_no,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    status: row.status as POStatus,
    statusLabel: PO_STATUS_LABEL[row.status as POStatus] || row.status,
    source: row.source as POSource,
    sourceRef: row.source_ref,
    totalAmount: row.total_amount,
    receivedAmount: row.received_amount,
    currency: row.currency,
    expectedDate: row.expected_date,
    receivedDate: row.received_date,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    createdBy: row.created_by,
    remark: row.remark,
    isSandbox: !!row.is_sandbox,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPurchaseItem(row: any) {
  return {
    id: row.id,
    purchaseOrderId: row.purchase_order_id,
    productId: row.product_id,
    productSku: row.product_sku,
    productName: row.product_name,
    quantity: row.quantity,
    receivedQuantity: row.received_quantity,
    qualifiedQuantity: row.qualified_quantity,
    unitPrice: row.unit_price,
    subtotal: row.subtotal,
    remark: row.remark,
  };
}

function mapStockTxn(row: any) {
  return {
    id: row.id,
    productId: row.product_id,
    productSku: row.product_sku,
    productName: row.product_name,
    txnType: row.txn_type as StockTxnType,
    quantity: row.quantity,
    stockBefore: row.stock_before,
    stockAfter: row.stock_after,
    unitCost: row.unit_cost,
    refType: row.ref_type,
    refId: row.ref_id,
    operatorId: row.operator_id,
    remark: row.remark,
    createdAt: row.created_at,
  };
}

// ════════════════════════════════════════════════════════════
// 服务实现
// ════════════════════════════════════════════════════════════

export class ProcurementService {
  // ══════════════ S1 供应商台账 ══════════════

  createSupplier(tenantId: string, input: SupplierInput, userId?: string) {
    if (!input.name || !input.name.trim()) {
      throw new ValidationError('供应商名称不能为空');
    }
    const db = getDatabase();

    // 同租户同名去重（大小写不敏感）
    const dup = db
      .prepare('SELECT id FROM suppliers WHERE tenant_id = ? AND LOWER(name) = LOWER(?) AND status != ?')
      .get(tenantId, input.name.trim(), 'archived') as { id: string } | undefined;
    if (dup) throw new ConflictError(`供应商「${input.name}」已存在`);

    const id = uuidv4();
    db.prepare(
      `INSERT INTO suppliers (
        id, tenant_id, code, name, contact_name, contact_phone, contact_email,
        address, category, grade, payment_terms, lead_time_days, currency,
        remark, is_sandbox, created_by, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id, tenantId, input.code || null, input.name.trim(),
      input.contactName || null, input.contactPhone || null, input.contactEmail || null,
      input.address || null, input.category || null, input.grade || 'B',
      input.paymentTerms || 'net30', input.leadTimeDays ?? 7, input.currency || 'CNY',
      input.remark || null, input.isSandbox ? 1 : 0, userId || null, nowIso(), nowIso()
    );

    logger.info('procurement', `供应商创建: ${input.name}`, { tenantId, supplierId: id });
    return this.getSupplier(tenantId, id);
  }

  getSupplier(tenantId: string, id: string) {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM suppliers WHERE id = ? AND tenant_id = ?').get(id, tenantId);
    if (!row) throw new NotFoundError('供应商', id);
    return mapSupplier(row);
  }

  listSuppliers(
    tenantId: string,
    filter: { status?: string; grade?: string; keyword?: string; category?: string } & PaginationParams = {}
  ): PaginatedResult<any> {
    const conditions = ['tenant_id = @tenantId'];
    const params: Record<string, unknown> = { tenantId };

    if (filter.status) { conditions.push('status = @status'); params.status = filter.status; }
    if (filter.grade) { conditions.push('grade = @grade'); params.grade = filter.grade; }
    if (filter.category) { conditions.push('category = @category'); params.category = filter.category; }
    if (filter.keyword) {
      conditions.push('(name LIKE @kw OR code LIKE @kw OR contact_name LIKE @kw)');
      params.kw = `%${filter.keyword}%`;
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const result = paginate<any>(
      `SELECT * FROM suppliers ${where}`,
      `SELECT COUNT(*) AS total FROM suppliers ${where}`,
      params,
      { page: filter.page, limit: filter.limit, sortBy: filter.sortBy, sortOrder: filter.sortOrder }
    );
    return { data: result.data.map(mapSupplier), pagination: result.pagination };
  }

  updateSupplier(tenantId: string, id: string, updates: Partial<SupplierInput> & { status?: SupplierStatus }) {
    const db = getDatabase();
    this.getSupplier(tenantId, id); // 存在性 + 租户校验

    const fieldMap: Record<string, string> = {
      code: 'code', name: 'name', contactName: 'contact_name', contactPhone: 'contact_phone',
      contactEmail: 'contact_email', address: 'address', category: 'category', grade: 'grade',
      paymentTerms: 'payment_terms', leadTimeDays: 'lead_time_days', currency: 'currency',
      remark: 'remark', status: 'status',
    };

    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, column] of Object.entries(fieldMap)) {
      const val = (updates as any)[key];
      if (val !== undefined) { sets.push(`${column} = ?`); values.push(val); }
    }
    if (sets.length === 0) return this.getSupplier(tenantId, id);

    sets.push('updated_at = ?');
    values.push(nowIso(), id, tenantId);
    db.prepare(`UPDATE suppliers SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...values);
    return this.getSupplier(tenantId, id);
  }

  /** 软删除：置为 archived，保留历史采购单引用完整性 */
  deleteSupplier(tenantId: string, id: string): void {
    const db = getDatabase();
    this.getSupplier(tenantId, id);
    const active = db
      .prepare(
        `SELECT COUNT(*) AS c FROM purchase_orders
         WHERE supplier_id = ? AND tenant_id = ? AND status IN ('submitted','approved','receiving')`
      )
      .get(id, tenantId) as { c: number };
    if (active.c > 0) {
      throw new ConflictError(`该供应商有 ${active.c} 张进行中的采购单，无法删除`);
    }
    db.prepare('UPDATE suppliers SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
      .run('archived', nowIso(), id, tenantId);
  }

  // ══════════════ S2 采购单 ══════════════

  createPurchaseOrder(tenantId: string, input: PurchaseOrderInput, userId?: string) {
    if (!input.items || input.items.length === 0) {
      throw new ValidationError('采购单至少需要一条明细');
    }
    for (const item of input.items) {
      if (!item.quantity || item.quantity <= 0) throw new ValidationError('采购数量必须大于 0');
      if (item.unitPrice === undefined || item.unitPrice < 0) throw new ValidationError('采购单价不能为负数');
    }

    let supplierName = input.supplierName || null;
    if (input.supplierId) {
      const supplier = this.getSupplier(tenantId, input.supplierId);
      supplierName = supplier!.name;
    }

    const poId = uuidv4();
    const poNo = genPoNo(tenantId);
    const totalAmount = round2(
      input.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0)
    );

    transaction((db) => {
      db.prepare(
        `INSERT INTO purchase_orders (
          id, tenant_id, po_no, supplier_id, supplier_name, status, source, source_ref,
          total_amount, received_amount, currency, expected_date, created_by, remark,
          is_sandbox, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        poId, tenantId, poNo, input.supplierId || null, supplierName,
        'draft', input.source || 'manual', input.sourceRef || null,
        totalAmount, 0, input.currency || 'CNY', input.expectedDate || null,
        userId || null, input.remark || null, input.isSandbox ? 1 : 0, nowIso(), nowIso()
      );

      for (const item of input.items) {
        // 有 productId 时补全 SKU/名称快照，防止商品改名后历史单据失真
        let sku = item.productSku || null;
        let name = item.productName || null;
        if (item.productId) {
          const p = db
            .prepare('SELECT sku, name FROM products WHERE id = ? AND tenant_id = ?')
            .get(item.productId, tenantId) as { sku: string; name: string } | undefined;
          if (p) { sku = sku || p.sku; name = name || p.name; }
        }
        db.prepare(
          `INSERT INTO purchase_items (
            id, purchase_order_id, product_id, product_sku, product_name,
            quantity, received_quantity, qualified_quantity, unit_price, subtotal, remark, created_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
        ).run(
          uuidv4(), poId, item.productId || null, sku, name,
          item.quantity, 0, 0, item.unitPrice, round2(item.quantity * item.unitPrice),
          item.remark || null, nowIso()
        );
      }
    });

    logger.info('procurement', `采购单创建: ${poNo}`, { tenantId, poId, totalAmount });
    return this.getPurchaseOrder(tenantId, poId);
  }

  getPurchaseOrder(tenantId: string, id: string) {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND tenant_id = ?').get(id, tenantId);
    if (!row) throw new NotFoundError('采购单', id);
    const items = db
      .prepare('SELECT * FROM purchase_items WHERE purchase_order_id = ? ORDER BY created_at ASC')
      .all(id) as any[];
    return { ...mapPurchaseOrder(row)!, items: items.map(mapPurchaseItem) };
  }

  listPurchaseOrders(
    tenantId: string,
    filter: { status?: string; supplierId?: string; keyword?: string } & PaginationParams = {}
  ): PaginatedResult<any> {
    const conditions = ['tenant_id = @tenantId'];
    const params: Record<string, unknown> = { tenantId };

    if (filter.status) { conditions.push('status = @status'); params.status = filter.status; }
    if (filter.supplierId) { conditions.push('supplier_id = @supplierId'); params.supplierId = filter.supplierId; }
    if (filter.keyword) {
      conditions.push('(po_no LIKE @kw OR supplier_name LIKE @kw)');
      params.kw = `%${filter.keyword}%`;
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const result = paginate<any>(
      `SELECT * FROM purchase_orders ${where}`,
      `SELECT COUNT(*) AS total FROM purchase_orders ${where}`,
      params,
      { page: filter.page, limit: filter.limit, sortBy: filter.sortBy, sortOrder: filter.sortOrder }
    );
    return { data: result.data.map(mapPurchaseOrder), pagination: result.pagination };
  }

  /** 状态流转（含状态机校验） */
  transitionPurchaseOrder(tenantId: string, id: string, target: POStatus, userId?: string) {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
    if (!row) throw new NotFoundError('采购单', id);

    const current = row.status as POStatus;
    const allowed = PO_TRANSITIONS[current] || [];
    if (!allowed.includes(target)) {
      throw new ValidationError(
        `采购单状态不能从「${PO_STATUS_LABEL[current]}」流转到「${PO_STATUS_LABEL[target] || target}」`,
        { current, target, allowed }
      );
    }

    const sets = ['status = ?', 'updated_at = ?'];
    const values: unknown[] = [target, nowIso()];
    if (target === 'approved') {
      sets.push('approved_by = ?', 'approved_at = ?');
      values.push(userId || null, nowIso());
    }
    values.push(id, tenantId);
    db.prepare(`UPDATE purchase_orders SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...values);

    logger.info('procurement', `采购单状态流转 ${current} → ${target}`, { tenantId, poId: id });
    return this.getPurchaseOrder(tenantId, id);
  }

  // ══════════════ S3 到货入库 + 质检 ══════════════

  /**
   * 到货入库：写出入库流水 + 回写商品库存 + 采购加权均价回写 cost_price
   * 全量到齐后自动流转 completed，部分到货保持 receiving。
   */
  receivePurchaseOrder(
    tenantId: string,
    id: string,
    receipts: ReceiveItemInput[],
    userId?: string
  ) {
    if (!receipts || receipts.length === 0) throw new ValidationError('请至少填写一条到货明细');

    const db = getDatabase();
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
    if (!po) throw new NotFoundError('采购单', id);
    if (!['approved', 'receiving'].includes(po.status)) {
      throw new ValidationError(`只有「已审批」或「收货中」的采购单可以入库，当前状态：${PO_STATUS_LABEL[po.status as POStatus]}`);
    }

    const txnIds: string[] = [];
    let receivedValue = 0;

    transaction((tdb) => {
      for (const receipt of receipts) {
        if (receipt.receivedQuantity <= 0) throw new ValidationError('到货数量必须大于 0');

        const item = tdb
          .prepare('SELECT * FROM purchase_items WHERE id = ? AND purchase_order_id = ?')
          .get(receipt.itemId, id) as any;
        if (!item) throw new NotFoundError('采购明细', receipt.itemId);

        const remaining = item.quantity - item.received_quantity;
        if (receipt.receivedQuantity > remaining) {
          throw new ValidationError(
            `「${item.product_name || item.product_sku}」到货数量 ${receipt.receivedQuantity} 超过未到货数量 ${remaining}`
          );
        }

        const qualified = receipt.qualifiedQuantity ?? receipt.receivedQuantity;
        if (qualified < 0 || qualified > receipt.receivedQuantity) {
          throw new ValidationError('合格数量必须在 0 与到货数量之间');
        }

        // 更新明细累计
        tdb.prepare(
          'UPDATE purchase_items SET received_quantity = received_quantity + ?, qualified_quantity = qualified_quantity + ? WHERE id = ?'
        ).run(receipt.receivedQuantity, qualified, receipt.itemId);

        receivedValue += qualified * item.unit_price;

        // 合格品才入库
        if (qualified > 0 && item.product_id) {
          const product = tdb
            .prepare('SELECT id, sku, name, stock, cost_price FROM products WHERE id = ? AND tenant_id = ?')
            .get(item.product_id, tenantId) as any;

          if (product) {
            const stockBefore = product.stock || 0;
            const stockAfter = stockBefore + qualified;

            // S5 采购加权均价：新成本 = (原库存×原成本 + 入库量×采购价) / 新库存
            const oldCost = product.cost_price || 0;
            const newCost = stockAfter > 0
              ? round2((stockBefore * oldCost + qualified * item.unit_price) / stockAfter)
              : item.unit_price;

            tdb.prepare('UPDATE products SET stock = ?, cost_price = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
              .run(stockAfter, newCost, nowIso(), item.product_id, tenantId);

            const txnId = uuidv4();
            tdb.prepare(
              `INSERT INTO stock_transactions (
                id, tenant_id, product_id, product_sku, product_name, txn_type, quantity,
                stock_before, stock_after, unit_cost, ref_type, ref_id, operator_id, remark,
                is_sandbox, created_at
              ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
            ).run(
              txnId, tenantId, item.product_id, product.sku, product.name,
              'purchase_in', qualified, stockBefore, stockAfter, item.unit_price,
              'purchase_order', id, userId || null,
              receipt.remark || `采购单 ${po.po_no} 到货入库`, po.is_sandbox || 0, nowIso()
            );
            txnIds.push(txnId);
          }
        }
      }

      // 判断是否全部到齐
      const pending = tdb
        .prepare('SELECT COUNT(*) AS c FROM purchase_items WHERE purchase_order_id = ? AND received_quantity < quantity')
        .get(id) as { c: number };

      const nextStatus: POStatus = pending.c === 0 ? 'completed' : 'receiving';
      tdb.prepare(
        `UPDATE purchase_orders SET status = ?, received_amount = received_amount + ?,
         received_date = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`
      ).run(
        nextStatus, round2(receivedValue),
        nextStatus === 'completed' ? nowIso() : po.received_date, nowIso(), id, tenantId
      );

      // S6 供应商累计采购额
      if (po.supplier_id) {
        tdb.prepare('UPDATE suppliers SET total_purchase_amount = total_purchase_amount + ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
          .run(round2(receivedValue), nowIso(), po.supplier_id, tenantId);
      }
    });

    logger.info('procurement', `采购单入库完成`, { tenantId, poId: id, txnCount: txnIds.length });
    return { ...this.getPurchaseOrder(tenantId, id), stockTransactionIds: txnIds };
  }

  // ══════════════ 出入库流水查询 ══════════════

  listStockTransactions(
    tenantId: string,
    filter: { productId?: string; txnType?: string; startDate?: string; endDate?: string } & PaginationParams = {}
  ): PaginatedResult<any> {
    const conditions = ['tenant_id = @tenantId'];
    const params: Record<string, unknown> = { tenantId };

    if (filter.productId) { conditions.push('product_id = @productId'); params.productId = filter.productId; }
    if (filter.txnType) { conditions.push('txn_type = @txnType'); params.txnType = filter.txnType; }
    if (filter.startDate) { conditions.push('created_at >= @startDate'); params.startDate = filter.startDate; }
    if (filter.endDate) { conditions.push('created_at <= @endDate'); params.endDate = filter.endDate; }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const result = paginate<any>(
      `SELECT * FROM stock_transactions ${where}`,
      `SELECT COUNT(*) AS total FROM stock_transactions ${where}`,
      params,
      { page: filter.page, limit: filter.limit, sortBy: filter.sortBy, sortOrder: filter.sortOrder }
    );
    return { data: result.data.map(mapStockTxn), pagination: result.pagination };
  }

  /** 手工库存调整（盘盈盘亏/报损），同样落流水，保证库存变动可追溯 */
  adjustStock(
    tenantId: string,
    input: { productId: string; quantity: number; txnType?: StockTxnType; remark?: string },
    userId?: string
  ) {
    const db = getDatabase();
    if (!input.quantity || input.quantity === 0) throw new ValidationError('调整数量不能为 0');

    const product = db
      .prepare('SELECT id, sku, name, stock, cost_price FROM products WHERE id = ? AND tenant_id = ?')
      .get(input.productId, tenantId) as any;
    if (!product) throw new NotFoundError('商品', input.productId);

    const stockBefore = product.stock || 0;
    const stockAfter = stockBefore + input.quantity;
    if (stockAfter < 0) throw new ValidationError(`调整后库存为负（当前 ${stockBefore}，调整 ${input.quantity}）`);

    const txnId = uuidv4();
    transaction((tdb) => {
      tdb.prepare('UPDATE products SET stock = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
        .run(stockAfter, nowIso(), input.productId, tenantId);
      tdb.prepare(
        `INSERT INTO stock_transactions (
          id, tenant_id, product_id, product_sku, product_name, txn_type, quantity,
          stock_before, stock_after, unit_cost, ref_type, ref_id, operator_id, remark, created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        txnId, tenantId, input.productId, product.sku, product.name,
        input.txnType || 'adjust', input.quantity, stockBefore, stockAfter,
        product.cost_price || 0, 'manual', null, userId || null,
        input.remark || '手工库存调整', nowIso()
      );
    });

    return { transactionId: txnId, productId: input.productId, stockBefore, stockAfter };
  }

  // ══════════════ S4 库存联动采购建议 ══════════════

  /**
   * 补货建议：按「日均销量 × 覆盖天数 − 当前库存」计算缺口。
   * 日均销量优先取 stock_transactions 的 sale_out 流水，无流水时回落 order_items。
   */
  buildReplenishSuggestions(
    tenantId: string,
    options: { coverDays?: number; windowDays?: number; limit?: number } = {}
  ): { suggestions: ReplenishSuggestion[]; coverDays: number; windowDays: number; generatedAt: string } {
    const db = getDatabase();
    const coverDays = options.coverDays ?? 30;
    const windowDays = options.windowDays ?? 30;
    const limit = Math.min(options.limit ?? 50, 200);

    const since = new Date(Date.now() - windowDays * 86400000).toISOString();

    const products = db
      .prepare(
        `SELECT id, sku, name, stock, cost_price, supplier_name
         FROM products WHERE tenant_id = ? AND status NOT IN ('discontinued')`
      )
      .all(tenantId) as any[];

    // 回落口径：orders.items 是 JSON 数组 [{productId, quantity, unitPrice}]（与 cockpitService 一致）
    // 一次性预聚合窗口期内各 SKU 销量，避免逐商品重复解析
    const soldMap = new Map<string, number>();
    const recentOrders = db
      .prepare(
        `SELECT items FROM orders
         WHERE tenant_id = ? AND created_at >= ?
           AND order_status NOT IN ('cancelled', 'refunded', 'returned')`
      )
      .all(tenantId, since) as Array<{ items: string }>;
    for (const o of recentOrders) {
      let arr: Array<{ productId?: string; quantity?: number }> = [];
      try { arr = JSON.parse(o.items || '[]'); } catch { arr = []; }
      for (const it of arr) {
        if (!it.productId || !it.quantity) continue;
        soldMap.set(it.productId, (soldMap.get(it.productId) || 0) + Number(it.quantity));
      }
    }

    const suggestions: ReplenishSuggestion[] = [];

    for (const p of products) {
      // 出库流水优先
      const txnRow = db
        .prepare(
          `SELECT COALESCE(SUM(ABS(quantity)), 0) AS qty FROM stock_transactions
           WHERE tenant_id = ? AND product_id = ? AND txn_type = 'sale_out' AND created_at >= ?`
        )
        .get(tenantId, p.id, since) as { qty: number };

      let soldQty = txnRow?.qty || 0;

      // 回落订单明细（JSON 预聚合结果）
      if (soldQty === 0) {
        soldQty = soldMap.get(p.id) || 0;
      }

      const dailySalesAvg = round2(soldQty / windowDays);
      const currentStock = p.stock || 0;
      const target = Math.ceil(dailySalesAvg * coverDays);
      const suggestedQty = Math.max(0, target - currentStock);

      if (suggestedQty <= 0) continue;

      // 最近一次采购价，无则回落成本价
      const lastPrice = db
        .prepare(
          `SELECT pi.unit_price AS price FROM purchase_items pi
           JOIN purchase_orders po ON pi.purchase_order_id = po.id
           WHERE po.tenant_id = ? AND pi.product_id = ?
           ORDER BY po.created_at DESC LIMIT 1`
        )
        .get(tenantId, p.id) as { price: number } | undefined;

      const unitPrice = lastPrice?.price ?? (p.cost_price || 0);

      // 优先匹配同名供应商台账
      let supplierId: string | null = null;
      let supplierName: string | null = p.supplier_name || null;
      if (supplierName) {
        const s = db
          .prepare("SELECT id FROM suppliers WHERE tenant_id = ? AND name = ? AND status = 'active'")
          .get(tenantId, supplierName) as { id: string } | undefined;
        supplierId = s?.id || null;
      }

      suggestions.push({
        productId: p.id,
        sku: p.sku,
        name: p.name,
        currentStock,
        dailySalesAvg,
        coverDays,
        suggestedQty,
        estimatedCost: round2(suggestedQty * unitPrice),
        lastPurchasePrice: unitPrice,
        supplierId,
        supplierName,
        reason: currentStock === 0
          ? '已断货，需立即补货'
          : `按日均 ${dailySalesAvg} 件测算，现有库存仅够 ${Math.floor(currentStock / (dailySalesAvg || 1))} 天`,
      });
    }

    suggestions.sort((a, b) => b.estimatedCost - a.estimatedCost);

    return {
      suggestions: suggestions.slice(0, limit),
      coverDays,
      windowDays,
      generatedAt: nowIso(),
    };
  }

  /** 将补货建议一键转为采购单（按供应商分组，一供应商一单） */
  createPOFromSuggestions(
    tenantId: string,
    productIds: string[],
    options: { coverDays?: number; expectedDate?: string } = {},
    userId?: string
  ) {
    if (!productIds || productIds.length === 0) throw new ValidationError('请选择要补货的商品');

    const { suggestions } = this.buildReplenishSuggestions(tenantId, {
      coverDays: options.coverDays,
      limit: 200,
    });
    const selected = suggestions.filter((s) => productIds.includes(s.productId));
    if (selected.length === 0) throw new ValidationError('所选商品当前无补货需求');

    // 按供应商分组
    const groups = new Map<string, ReplenishSuggestion[]>();
    for (const s of selected) {
      const key = s.supplierId || '__unassigned__';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s);
    }

    const created: any[] = [];
    for (const [key, items] of groups) {
      const po = this.createPurchaseOrder(
        tenantId,
        {
          supplierId: key === '__unassigned__' ? undefined : key,
          supplierName: key === '__unassigned__' ? '待指定供应商' : items[0].supplierName || undefined,
          source: 'replenish_suggestion',
          sourceRef: `auto-${Date.now()}`,
          expectedDate: options.expectedDate,
          remark: `由补货建议自动生成（覆盖 ${options.coverDays ?? 30} 天）`,
          items: items.map((s) => ({
            productId: s.productId,
            productSku: s.sku || undefined,
            productName: s.name,
            quantity: s.suggestedQty,
            unitPrice: s.lastPurchasePrice,
            remark: s.reason,
          })),
        },
        userId
      );
      created.push(po);
    }

    return { createdCount: created.length, purchaseOrders: created };
  }

  // ══════════════ S6 供应链协同：供应商绩效 ══════════════

  getSupplierPerformance(tenantId: string, supplierId?: string) {
    const db = getDatabase();

    const supplierFilter = supplierId ? 'AND s.id = ?' : '';
    const args: unknown[] = supplierId ? [tenantId, supplierId] : [tenantId];

    const rows = db
      .prepare(
        `SELECT
           s.id, s.name, s.grade, s.lead_time_days, s.total_purchase_amount,
           COUNT(po.id) AS total_orders,
           SUM(CASE WHEN po.status = 'completed' THEN 1 ELSE 0 END) AS completed_orders,
           SUM(CASE WHEN po.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_orders,
           SUM(CASE WHEN po.status = 'completed' AND po.expected_date IS NOT NULL
                     AND po.received_date IS NOT NULL AND po.received_date <= po.expected_date
                THEN 1 ELSE 0 END) AS on_time_orders,
           SUM(CASE WHEN po.status = 'completed' AND po.expected_date IS NOT NULL
                     AND po.received_date IS NOT NULL THEN 1 ELSE 0 END) AS datable_orders,
           COALESCE(SUM(po.received_amount), 0) AS received_amount
         FROM suppliers s
         LEFT JOIN purchase_orders po ON po.supplier_id = s.id AND po.tenant_id = s.tenant_id
         WHERE s.tenant_id = ? ${supplierFilter}
         GROUP BY s.id
         ORDER BY received_amount DESC`
      )
      .all(...args) as any[];

    const performance = rows.map((r) => {
      const datable = r.datable_orders || 0;
      const onTimeRate = datable > 0 ? round2((r.on_time_orders / datable) * 100) : 0;
      const completionRate = r.total_orders > 0
        ? round2((r.completed_orders / r.total_orders) * 100)
        : 0;

      // 质检合格率
      const qc = db
        .prepare(
          `SELECT COALESCE(SUM(pi.received_quantity), 0) AS received,
                  COALESCE(SUM(pi.qualified_quantity), 0) AS qualified
           FROM purchase_items pi JOIN purchase_orders po ON pi.purchase_order_id = po.id
           WHERE po.supplier_id = ? AND po.tenant_id = ?`
        )
        .get(r.id, tenantId) as { received: number; qualified: number };
      const qualifyRate = qc.received > 0 ? round2((qc.qualified / qc.received) * 100) : 0;

      // 综合评分：交期 40% + 完成率 30% + 合格率 30%
      const score = round2(onTimeRate * 0.4 + completionRate * 0.3 + qualifyRate * 0.3);

      return {
        supplierId: r.id,
        supplierName: r.name,
        grade: r.grade,
        leadTimeDays: r.lead_time_days,
        totalOrders: r.total_orders || 0,
        completedOrders: r.completed_orders || 0,
        cancelledOrders: r.cancelled_orders || 0,
        receivedAmount: round2(r.received_amount || 0),
        onTimeRate,
        completionRate,
        qualifyRate,
        score,
        // 口径说明，满足数据专家可验证性要求
        formula: 'score = onTimeRate×0.4 + completionRate×0.3 + qualifyRate×0.3',
      };
    });

    // 回写供应商 on_time_rate，供台账列表展示
    for (const p of performance) {
      db.prepare('UPDATE suppliers SET on_time_rate = ?, rating = ? WHERE id = ? AND tenant_id = ?')
        .run(p.onTimeRate, p.score, p.supplierId, tenantId);
    }

    return supplierId ? performance[0] || null : performance;
  }

  // ══════════════ 采购总览（供监控面板聚合） ══════════════

  getProcurementOverview(tenantId: string) {
    const db = getDatabase();

    const poStats = db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft,
           SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) AS pending_approval,
           SUM(CASE WHEN status IN ('approved','receiving') THEN 1 ELSE 0 END) AS in_progress,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
           COALESCE(SUM(CASE WHEN status NOT IN ('cancelled') THEN total_amount ELSE 0 END), 0) AS total_amount
         FROM purchase_orders WHERE tenant_id = ?`
      )
      .get(tenantId) as any;

    const supplierStats = db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active
         FROM suppliers WHERE tenant_id = ?`
      )
      .get(tenantId) as any;

    // 逾期未到货：预期到货日已过但状态未完成
    const today = new Date().toISOString().slice(0, 10);
    const overdue = db
      .prepare(
        `SELECT id, po_no, supplier_name, expected_date, total_amount
         FROM purchase_orders
         WHERE tenant_id = ? AND status IN ('approved','receiving')
           AND expected_date IS NOT NULL AND expected_date < ?
         ORDER BY expected_date ASC LIMIT 20`
      )
      .all(tenantId, today) as any[];

    return {
      purchaseOrders: {
        total: poStats?.total || 0,
        draft: poStats?.draft || 0,
        pendingApproval: poStats?.pending_approval || 0,
        inProgress: poStats?.in_progress || 0,
        completed: poStats?.completed || 0,
        totalAmount: round2(poStats?.total_amount || 0),
      },
      suppliers: {
        total: supplierStats?.total || 0,
        active: supplierStats?.active || 0,
      },
      overdueOrders: overdue.map((o) => ({
        id: o.id,
        poNo: o.po_no,
        supplierName: o.supplier_name,
        expectedDate: o.expected_date,
        totalAmount: o.total_amount,
        overdueDays: Math.max(
          0,
          Math.floor((Date.now() - new Date(o.expected_date).getTime()) / 86400000)
        ),
      })),
      generatedAt: nowIso(),
    };
  }
}

export const procurementService = new ProcurementService();
