import { getDatabase, transaction, paginate, PaginationParams, PaginatedResult } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { NotFoundError, ConflictError, ValidationError } from '../utils/errors';
import { logger } from '../utils/logger';
import { parseCsv } from '../utils/csv';

// ==================== Projects (立项) ====================

export interface ProjectInput {
  name: string;
  code: string;
  description?: string;
  businessType: string;
  platform?: string;
  ownerId?: string;
  departmentId?: string;
  budget?: number;
  expectedRevenue?: number;
  startDate?: string;
  endDate?: string;
  priority?: string;
  tags?: string[];
}

export interface ProductInput {
  projectId?: string;
  sku: string;
  name: string;
  category?: string;
  brand?: string;
  description?: string;
  sourcePlatform?: string;
  sourceUrl?: string;
  costPrice?: number;
  sellingPrice?: number;
  marketPrice?: number;
  stock?: number;
  supplierName?: string;
  attributes?: Record<string, unknown>;
}

export interface OrderInput {
  projectId?: string;
  platform?: string;
  platformOrderId?: string;
  customerName?: string;
  customerPhone?: string;
  shippingAddress?: string;
  items: Array<{ productId: string; quantity: number; unitPrice: number }>;
  discount?: number;
  shippingFee?: number;
  paymentMethod?: string;
  remark?: string;
  /** 业绩归属员工。不传时按下单操作人自动解析（employees.user_id 反查） */
  ownerEmployeeId?: string;
  /** 关联直播场次，用于直播渠道 GMV 归集 */
  liveSessionId?: string;
  /** 来源平台连接，用于渠道分析与同步幂等去重 */
  sourceConnectionId?: string;
  /** 是否为跨境订单 */
  isCrossborder?: boolean;
}

export interface TicketInput {
  orderId?: string;
  customerName?: string;
  customerContact?: string;
  channel?: string;
  category?: string;
  subject: string;
  description?: string;
  priority?: string;
  assignedTo?: string;
}

export interface AssortmentProduct { productId: string; quantity: number; unitPrice: number }

export class BusinessService {
  // ==================== Projects ====================

  createProject(tenantId: string, input: ProjectInput): Record<string, unknown> {
    const db = getDatabase();
    const existing = db.prepare('SELECT id FROM projects WHERE tenant_id = ? AND code = ?').get(tenantId, input.code);
    if (existing) throw new ConflictError(`项目编号 ${input.code} 已存在`);

    const id = uuidv4();
    db.prepare(
      `INSERT INTO projects (id, tenant_id, name, code, description, business_type, platform, owner_id, department_id, budget, expected_revenue, start_date, end_date, priority, tags, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planning')`
    ).run(
      id, tenantId, input.name, input.code, input.description || null,
      input.businessType, input.platform || null,
      input.ownerId || null, input.departmentId || null,
      input.budget || null, input.expectedRevenue || null,
      input.startDate || null, input.endDate || null,
      input.priority || 'medium', JSON.stringify(input.tags || [])
    );

    logger.info('business', `Project created: ${input.name} (${input.code})`, { id, tenantId });
    return this.getProject(id, tenantId)!;
  }

  getProject(id: string, tenantId: string): Record<string, unknown> | null {
    const db = getDatabase();
    const row = db.prepare(
      `SELECT p.*, u.display_name as owner_name, d.name as department_name
       FROM projects p LEFT JOIN users u ON p.owner_id = u.id
       LEFT JOIN departments d ON p.department_id = d.id
       WHERE p.id = ? AND p.tenant_id = ?`
    ).get(id, tenantId) as any;

    if (!row) return null;
    row.tags = JSON.parse(row.tags || '[]');

    const productCount = (db.prepare('SELECT COUNT(*) as c FROM products WHERE project_id = ? AND tenant_id = ?').get(id, tenantId) as any).c;
    const orderStats = db.prepare(
      'SELECT COUNT(*) as order_count, COALESCE(SUM(total_amount), 0) as total_revenue FROM orders WHERE project_id = ? AND tenant_id = ?'
    ).get(id, tenantId) as any;

    return { ...row, productCount, orderCount: orderStats.order_count, totalRevenue: orderStats.total_revenue };
  }

  listProjects(tenantId: string, params: PaginationParams & { businessType?: string; status?: string; keyword?: string }): PaginatedResult<any> {
    let where = 'WHERE p.tenant_id = @tenantId';
    const queryParams: Record<string, unknown> = { tenantId };

    if (params.businessType) { where += ' AND p.business_type = @businessType'; queryParams.businessType = params.businessType; }
    if (params.status) { where += ' AND p.status = @status'; queryParams.status = params.status; }
    if (params.keyword) {
      where += ' AND (p.name LIKE @keyword OR p.code LIKE @keyword)';
      queryParams.keyword = `%${params.keyword}%`;
    }

    const query = `SELECT p.*, u.display_name as owner_name FROM projects p LEFT JOIN users u ON p.owner_id = u.id ${where}`;
    const countQuery = `SELECT COUNT(*) as total FROM projects p ${where}`;

    const result = paginate(query, countQuery, queryParams, params);
    result.data = result.data.map((r: any) => ({ ...r, tags: JSON.parse(r.tags || '[]') }));
    return result;
  }

  updateProject(id: string, tenantId: string, input: Partial<ProjectInput> & { status?: string; actualCost?: number }): Record<string, unknown> {
    const db = getDatabase();
    const existing = db.prepare('SELECT id FROM projects WHERE id = ? AND tenant_id = ?').get(id, tenantId);
    if (!existing) throw new NotFoundError('项目', id);

    const fields: string[] = [];
    const values: unknown[] = [];
    const mapping: Record<string, string> = {
      name: 'name', description: 'description', businessType: 'business_type',
      platform: 'platform', ownerId: 'owner_id', departmentId: 'department_id',
      budget: 'budget', actualCost: 'actual_cost', expectedRevenue: 'expected_revenue',
      startDate: 'start_date', endDate: 'end_date', priority: 'priority', status: 'status',
    };

    for (const [key, column] of Object.entries(mapping)) {
      if ((input as any)[key] !== undefined) { fields.push(`${column} = ?`); values.push((input as any)[key]); }
    }
    if (input.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(input.tags)); }
    if (fields.length === 0) return this.getProject(id, tenantId)!;

    fields.push("updated_at = datetime('now', '+0000')");
    values.push(id, tenantId);
    db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...values);
    return this.getProject(id, tenantId)!;
  }

  // ==================== Products (选品) ====================

  createProduct(tenantId: string, input: ProductInput): Record<string, unknown> {
    const db = getDatabase();
    const existing = db.prepare('SELECT id FROM products WHERE tenant_id = ? AND sku = ?').get(tenantId, input.sku);
    if (existing) throw new ConflictError(`SKU ${input.sku} 已存在`);

    const id = uuidv4();
    const marginRate = input.sellingPrice && input.costPrice
      ? Math.round(((input.sellingPrice - input.costPrice) / input.sellingPrice) * 10000) / 100
      : null;

    db.prepare(
      `INSERT INTO products (id, tenant_id, project_id, sku, name, category, brand, description, source_platform, source_url, cost_price, selling_price, market_price, margin_rate, stock, supplier_name, attributes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate')`
    ).run(
      id, tenantId, input.projectId || null, input.sku, input.name,
      input.category || null, input.brand || null, input.description || null,
      input.sourcePlatform || null, input.sourceUrl || null,
      input.costPrice || null, input.sellingPrice || null, input.marketPrice || null,
      marginRate, input.stock || 0, input.supplierName || null,
      JSON.stringify(input.attributes || {})
    );

    return db.prepare('SELECT * FROM products WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
  }

  listProducts(tenantId: string, params: PaginationParams & { projectId?: string; status?: string; category?: string; keyword?: string }): PaginatedResult<any> {
    let where = 'WHERE p.tenant_id = @tenantId';
    const queryParams: Record<string, unknown> = { tenantId };

    if (params.projectId) { where += ' AND p.project_id = @projectId'; queryParams.projectId = params.projectId; }
    if (params.status) { where += ' AND p.status = @status'; queryParams.status = params.status; }
    if (params.category) { where += ' AND p.category = @category'; queryParams.category = params.category; }
    if (params.keyword) {
      where += ' AND (p.name LIKE @keyword OR p.sku LIKE @keyword OR p.brand LIKE @keyword)';
      queryParams.keyword = `%${params.keyword}%`;
    }

    const query = `SELECT p.*, pr.name as project_name FROM products p LEFT JOIN projects pr ON p.project_id = pr.id ${where}`;
    const countQuery = `SELECT COUNT(*) as total FROM products p ${where}`;

    const result = paginate(query, countQuery, queryParams, params);
    result.data = result.data.map((r: any) => ({
      ...r,
      images: JSON.parse(r.images || '[]'),
      attributes: JSON.parse(r.attributes || '{}'),
    }));
    return result;
  }

  updateProductStatus(id: string, tenantId: string, status: string, extra?: Record<string, unknown>): Record<string, unknown> {
    const db = getDatabase();
    const existing = db.prepare('SELECT id FROM products WHERE id = ? AND tenant_id = ?').get(id, tenantId);
    if (!existing) throw new NotFoundError('商品', id);

    let sql = "UPDATE products SET status = ?, updated_at = datetime('now', '+0000')";
    const values: unknown[] = [status];

    if (extra?.selectionScore !== undefined) { sql += ', selection_score = ?'; values.push(extra.selectionScore); }
    if (extra?.selectionReason !== undefined) { sql += ', selection_reason = ?'; values.push(extra.selectionReason); }
    if (extra?.stock !== undefined) { sql += ', stock = ?'; values.push(extra.stock); }

    sql += ' WHERE id = ? AND tenant_id = ?';
    values.push(id, tenantId);
    db.prepare(sql).run(...values);

    return db.prepare('SELECT * FROM products WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
  }

  /**
   * 完整更新商品信息（所有字段）
   */
  updateProduct(id: string, tenantId: string, input: Partial<ProductInput>): Record<string, unknown> {
    const db = getDatabase();
    const existing = db.prepare('SELECT id FROM products WHERE id = ? AND tenant_id = ?').get(id, tenantId);
    if (!existing) throw new NotFoundError('商品', id);

    const fields: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) { fields.push('name = ?'); values.push(input.name); }
    if (input.category !== undefined) { fields.push('category = ?'); values.push(input.category); }
    if (input.brand !== undefined) { fields.push('brand = ?'); values.push(input.brand); }
    if (input.description !== undefined) { fields.push('description = ?'); values.push(input.description); }
    if (input.sourcePlatform !== undefined) { fields.push('source_platform = ?'); values.push(input.sourcePlatform); }
    if (input.sourceUrl !== undefined) { fields.push('source_url = ?'); values.push(input.sourceUrl); }
    if (input.costPrice !== undefined) { fields.push('cost_price = ?'); values.push(input.costPrice); }
    if (input.sellingPrice !== undefined) { fields.push('selling_price = ?'); values.push(input.sellingPrice); }
    if (input.marketPrice !== undefined) { fields.push('market_price = ?'); values.push(input.marketPrice); }
    if (input.stock !== undefined) { fields.push('stock = ?'); values.push(input.stock); }
    if (input.supplierName !== undefined) { fields.push('supplier_name = ?'); values.push(input.supplierName); }
    if (input.attributes !== undefined) { fields.push('attributes = ?'); values.push(JSON.stringify(input.attributes)); }
    if (input.projectId !== undefined) { fields.push('project_id = ?'); values.push(input.projectId); }

    // 重新计算毛利率
    if (input.sellingPrice !== undefined || input.costPrice !== undefined) {
      const sellingPrice = input.sellingPrice ?? (db.prepare('SELECT selling_price FROM products WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any)?.selling_price;
      const costPrice = input.costPrice ?? (db.prepare('SELECT cost_price FROM products WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any)?.cost_price;
      if (sellingPrice !== undefined && costPrice !== undefined && sellingPrice > 0) {
        const marginRate = Math.round(((sellingPrice - costPrice) / sellingPrice) * 10000) / 100;
        fields.push('margin_rate = ?');
        values.push(marginRate);
      }
    }

    if (fields.length === 0) return this.getProduct(id, tenantId)!;

    fields.push("updated_at = datetime('now', '+0000')");
    values.push(id, tenantId);

    db.prepare(`UPDATE products SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...values);
    return this.getProduct(id, tenantId)!;
  }

  getProduct(id: string, tenantId: string): Record<string, unknown> | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM products WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
    if (!row) return null;
    row.images = JSON.parse(row.images || '[]');
    row.attributes = JSON.parse(row.attributes || '{}');
    return row;
  }

  // ==================== Orders (订单) ====================

  /**
   * 解析订单的业绩归属员工。
   *
   * 优先级：显式传入的 ownerEmployeeId > 操作人绑定的员工档案 > null。
   * 显式传入时会校验该员工确属当前租户，防止跨租户串写业绩。
   */
  private resolveOwnerEmployeeId(
    tenantId: string,
    explicitEmployeeId?: string,
    operatorUserId?: string
  ): string | null {
    const db = getDatabase();

    if (explicitEmployeeId) {
      const emp = db.prepare('SELECT id FROM employees WHERE id = ? AND tenant_id = ?')
        .get(explicitEmployeeId, tenantId) as { id?: string } | undefined;
      if (!emp) throw new NotFoundError('员工', explicitEmployeeId);
      return explicitEmployeeId;
    }

    if (operatorUserId) {
      const emp = db.prepare(
        "SELECT id FROM employees WHERE user_id = ? AND tenant_id = ? AND status IN ('active','probation') LIMIT 1"
      ).get(operatorUserId, tenantId) as { id?: string } | undefined;
      if (emp?.id) return emp.id;
      // 操作人没有绑定员工档案属正常情况（如管理员账号），不阻断下单
      logger.debug('business', '下单操作人未绑定员工档案，订单不参与人效归因', { operatorUserId });
    }

    return null;
  }

  /**
   * 创建订单
   *
   * @param operatorUserId 下单操作人的用户 ID。当 input.ownerEmployeeId 未显式指定时，
   *                       用它反查 employees.user_id 自动确定业绩归属人，
   *                       从而让业务数据与 HR 人效归因链路自动闭环。
   */
  createOrder(tenantId: string, input: OrderInput, operatorUserId?: string): Record<string, unknown> {
    const db = getDatabase();
    const id = uuidv4();
    const orderNo = `ORD${Date.now()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    // Validate all products exist and belong to this tenant
    for (const item of input.items) {
      const product = db.prepare('SELECT id, stock FROM products WHERE id = ? AND tenant_id = ?').get(item.productId, tenantId) as any;
      if (!product) {
        throw new NotFoundError('商品', item.productId);
      }
    }

    // 解析业绩归属员工：显式指定优先，否则回落到操作人对应的员工
    const ownerEmployeeId = this.resolveOwnerEmployeeId(tenantId, input.ownerEmployeeId, operatorUserId);

    // 校验直播场次归属，避免跨租户串数据
    if (input.liveSessionId) {
      const session = db.prepare('SELECT id FROM live_sessions WHERE id = ? AND tenant_id = ?')
        .get(input.liveSessionId, tenantId);
      if (!session) throw new NotFoundError('直播场次', input.liveSessionId);
    }

    // 校验来源平台连接归属
    if (input.sourceConnectionId) {
      const conn = db.prepare('SELECT id FROM platform_connections WHERE id = ? AND tenant_id = ?')
        .get(input.sourceConnectionId, tenantId);
      if (!conn) throw new NotFoundError('平台连接', input.sourceConnectionId);
    }

    const subtotal = input.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const discount = input.discount || 0;
    const shippingFee = input.shippingFee || 0;
    const totalAmount = subtotal - discount + shippingFee;

    // SECURITY: Wrap in transaction for atomicity
    db.exec('BEGIN TRANSACTION');
    try {
      db.prepare(
        `INSERT INTO orders (id, tenant_id, project_id, order_no, platform, platform_order_id, customer_name, customer_phone, shipping_address, items, subtotal, discount, shipping_fee, total_amount, payment_method, payment_status, order_status, remark, owner_employee_id, live_session_id, source_connection_id, is_crossborder)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', 'pending', ?, ?, ?, ?, ?)`
      ).run(
        id, tenantId, input.projectId || null, orderNo,
        input.platform || null, input.platformOrderId || null,
        input.customerName || null, input.customerPhone || null,
        input.shippingAddress || null, JSON.stringify(input.items),
        subtotal, discount, shippingFee, totalAmount,
        input.paymentMethod || null, input.remark || null,
        ownerEmployeeId, input.liveSessionId || null, input.sourceConnectionId || null,
        input.isCrossborder ? 1 : 0
      );

      // Update product stock atomically
      for (const item of input.items) {
        db.prepare('UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ? AND tenant_id = ?')
          .run(item.quantity, item.productId, tenantId);
      }

      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    logger.info('business', `Order created: ${orderNo}`, { id, totalAmount });
    return db.prepare('SELECT * FROM orders WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
  }

  listOrders(tenantId: string, params: PaginationParams & { projectId?: string; status?: string; paymentStatus?: string; keyword?: string; startDate?: string; endDate?: string }): PaginatedResult<any> {
    let where = 'WHERE o.tenant_id = @tenantId';
    const queryParams: Record<string, unknown> = { tenantId };

    if (params.projectId) { where += ' AND o.project_id = @projectId'; queryParams.projectId = params.projectId; }
    if (params.status) { where += ' AND o.order_status = @status'; queryParams.status = params.status; }
    if (params.paymentStatus) { where += ' AND o.payment_status = @paymentStatus'; queryParams.paymentStatus = params.paymentStatus; }
    if (params.keyword) {
      where += ' AND (o.order_no LIKE @keyword OR o.customer_name LIKE @keyword)';
      queryParams.keyword = `%${params.keyword}%`;
    }
    if (params.startDate) { where += ' AND o.created_at >= @startDate'; queryParams.startDate = params.startDate; }
    if (params.endDate) { where += ' AND o.created_at <= @endDate'; queryParams.endDate = params.endDate; }

    const query = `SELECT o.*, p.name as project_name FROM orders o LEFT JOIN projects p ON o.project_id = p.id ${where}`;
    const countQuery = `SELECT COUNT(*) as total FROM orders o ${where}`;

    const result = paginate(query, countQuery, queryParams, params);
    result.data = result.data.map((r: any) => ({ ...r, items: JSON.parse(r.items || '[]') }));
    return result;
  }

  updateOrderStatus(id: string, tenantId: string, status: string, extra?: Record<string, unknown>): Record<string, unknown> {
    const db = getDatabase();
    const existing = db.prepare('SELECT id, order_status FROM orders WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
    if (!existing) throw new NotFoundError('订单', id);

    // Order state machine - enforce valid transitions
    const VALID_TRANSITIONS: Record<string, string[]> = {
      pending: ['confirmed', 'cancelled'],
      confirmed: ['processing', 'cancelled'],
      processing: ['shipped', 'cancelled'],
      shipped: ['delivered'],
      delivered: ['completed', 'returned'],
      completed: [],
      cancelled: [],
      returned: ['refunded'],
      refunded: [],
    };

    const allowedNext = VALID_TRANSITIONS[existing.order_status] || [];
    if (!allowedNext.includes(status)) {
      throw new ValidationError(
        `订单状态不允许从 "${existing.order_status}" 转换为 "${status}"。允许的操作: ${allowedNext.join(', ') || '无'}`
      );
    }

    let sql = "UPDATE orders SET order_status = ?, updated_at = datetime('now', '+0000')";
    const values: unknown[] = [status];

    if (status === 'shipped' && extra?.shippingNo) {
      sql += ', shipping_no = ?, shipping_company = ?, shipped_at = datetime(\'now\', \'+0000\')';
      values.push(extra.shippingNo, extra.shippingCompany || null);
    }
    if (status === 'delivered') { sql += ", delivered_at = datetime('now', '+0000')"; }
    if (status === 'completed') { sql += ", completed_at = datetime('now', '+0000')"; }
    if (status === 'cancelled') {
      sql += ", cancelled_at = datetime('now', '+0000'), cancel_reason = ?";
      values.push(extra?.cancelReason || null);
    }

    sql += ' WHERE id = ? AND tenant_id = ?';
    values.push(id, tenantId);
    db.prepare(sql).run(...values);

    return db.prepare('SELECT * FROM orders WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
  }

  /**
   * 登记订单收款 / 退款。
   *
   * 背景：此前系统缺少任何写入 orders.paid_amount / payment_status 的路径，
   * 导致所有以「已支付」为口径的指标（Analytics GMV、毛利、人效归因、经营驾驶舱）
   * 恒为 0。本方法补齐该链路。
   *
   * 语义：
   * - amount > 0 为收款（累加到 paid_amount）；amount < 0 为退款（冲减）。
   * - payment_status 由累计实收金额与订单总额自动推导，不由调用方指定，避免口径漂移。
   * - 首次实收结清时，若订单仍处于 pending，自动推进为 confirmed（符合状态机 pending→confirmed）。
   */
  recordPayment(
    id: string,
    tenantId: string,
    input: { amount: number; paymentMethod?: string; remark?: string }
  ): Record<string, unknown> {
    const db = getDatabase();
    const existing = db.prepare(
      'SELECT id, total_amount, paid_amount, payment_status, order_status FROM orders WHERE id = ? AND tenant_id = ?'
    ).get(id, tenantId) as any;
    if (!existing) throw new NotFoundError('订单', id);

    if (typeof input.amount !== 'number' || !Number.isFinite(input.amount) || input.amount === 0) {
      throw new ValidationError('收款金额必须为非零有限数字（正数为收款，负数为退款）');
    }
    if (existing.payment_status === 'cancelled') {
      throw new ValidationError('订单支付已取消，无法再登记收付款');
    }

    const total = Number(existing.total_amount) || 0;
    const prevPaid = Number(existing.paid_amount) || 0;
    // 保留两位小数，规避浮点累加误差
    const nextPaid = Math.round((prevPaid + input.amount) * 100) / 100;

    if (nextPaid < 0) {
      throw new ValidationError(`退款金额超出已收金额，当前已收 ${prevPaid}，本次 ${input.amount}`);
    }
    if (nextPaid > total) {
      throw new ValidationError(`实收金额 ${nextPaid} 超出订单总额 ${total}`);
    }
    // 容差处理：99% 以上视为全额支付
    const PAID_THRESHOLD = 0.99;
    const isFullyPaid = total > 0 && nextPaid >= total * PAID_THRESHOLD;

    // 支付状态由金额自动推导
    let paymentStatus: string;
    if (nextPaid === 0) {
      paymentStatus = prevPaid > 0 ? 'refunded' : 'unpaid';
    } else if (isFullyPaid) {
      paymentStatus = 'paid';
    } else {
      paymentStatus = 'partial';
    }

    const sql = `UPDATE orders
       SET paid_amount = ?,
           payment_status = ?,
           payment_method = COALESCE(?, payment_method),
           remark = COALESCE(?, remark),
           updated_at = datetime('now', '+0000')
       WHERE id = ? AND tenant_id = ?`;

    // 事务包裹：收款登记与状态推进必须原子执行，避免部分写入导致金额/状态不一致
    const updated = transaction(() => {
      db.prepare(sql).run(
        nextPaid,
        paymentStatus,
        input.paymentMethod ?? null,
        input.remark ?? null,
        id,
        tenantId
      );

      // 结清后自动推进订单状态（仅 pending→confirmed，其余阶段交由状态机显式流转）
      if (paymentStatus === 'paid' && existing.order_status === 'pending') {
        db.prepare(
          "UPDATE orders SET order_status = 'confirmed', updated_at = datetime('now', '+0000') WHERE id = ? AND tenant_id = ?"
        ).run(id, tenantId);
      }

      return db.prepare('SELECT * FROM orders WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
    });

    return updated;
  }

  getOrderStats(tenantId: string, period?: string): Record<string, unknown> {
    const db = getDatabase();
    let dateFilter = '';
    const params: unknown[] = [tenantId];

    if (period) {
      dateFilter = " AND created_at LIKE ?";
      params.push(`${period}%`);
    }

    const stats = db.prepare(
      `SELECT
        COUNT(*) as total_orders,
        SUM(CASE WHEN order_status = 'completed' THEN 1 ELSE 0 END) as completed_orders,
        SUM(CASE WHEN order_status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_orders,
        COALESCE(SUM(total_amount), 0) as total_order_amount,
        COALESCE(SUM(CASE WHEN payment_status NOT IN ('refunded') THEN paid_amount ELSE 0 END), 0) as net_gmv,
        COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total_amount ELSE 0 END), 0) as paid_revenue,
        COALESCE(AVG(total_amount), 0) as avg_order_value
       FROM orders WHERE tenant_id = ?${dateFilter} AND is_sandbox = 0`
    ).get(...params) as any;

    return stats;
  }

  // ==================== Assortments (组盘) ====================
  // 使用 product_bundles + bundle_items 表持久化，替代内存 Map

  private calcAssortmentStats(products: AssortmentProduct[], tenantId: string): { grossMargin: number; totalValue: number } {
    const db = getDatabase();
    let totalCost = 0;
    let totalSale = 0;
    for (const p of products) {
      totalSale += p.quantity * p.unitPrice;
      // 使用产品真实成本价，而非固定 65% 估算
      const costRow = db.prepare('SELECT cost_price FROM products WHERE id = ? AND tenant_id = ?').get(p.productId, tenantId) as any;
      const costPrice = costRow?.cost_price ?? (p.unitPrice * 0.65); // fallback 65% if no cost data
      totalCost += p.quantity * costPrice;
    }
    const grossMargin = totalSale > 0 ? Math.round(((totalSale - totalCost) / totalSale) * 100) : 0;
    return { grossMargin, totalValue: Math.round(totalSale * 100) / 100 };
  }

  private calcStockStatus(tenantId: string, products: AssortmentProduct[]): 'sufficient' | 'low' | 'insufficient' {
    const db = getDatabase();
    let totalShort = 0;
    let totalQty = 0;
    for (const p of products) {
      const row = db.prepare('SELECT stock FROM products WHERE id = ? AND tenant_id = ?').get(p.productId, tenantId) as any;
      const stock = (row?.stock ?? 0);
      totalQty += p.quantity;
      if (stock < p.quantity) totalShort += p.quantity - stock;
    }
    if (totalShort > totalQty * 0.5) return 'insufficient';
    if (totalShort > 0) return 'low';
    return 'sufficient';
  }

  createAssortment(tenantId: string, createdBy: string, input: { name: string; description?: string; category?: string; products?: AssortmentProduct[] }): any {
    const db = getDatabase();
    const id = uuidv4();
    const now = new Date().toISOString();
    const products = input.products || [];
    const { grossMargin, totalValue } = this.calcAssortmentStats(products, tenantId);
    const stockStatus = products.length ? this.calcStockStatus(tenantId, products) : 'sufficient';

    // 插入组盘记录
    db.prepare(
      `INSERT INTO product_bundles (id, tenant_id, name, description, bundle_type, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`
    ).run(id, tenantId, input.name, input.description || null, input.category === 'live' ? 'combo' : 'combo', now, now);

    // 插入商品明细
    for (const p of products) {
      db.prepare(
        `INSERT INTO bundle_items (id, bundle_id, product_id, quantity, unit_price, sort_order)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(uuidv4(), id, p.productId, p.quantity, p.unitPrice, products.indexOf(p));
    }

    logger.info('business', `Assortment created: ${input.name}`, { id, tenantId });

    return {
      id, tenantId, name: input.name, description: input.description || '',
      category: input.category || 'daily',
      products, grossMargin, totalValue, stockStatus,
      status: 'draft', createdById: createdBy, createdAt: now, updatedAt: now,
    };
  }

  getAssortmentById(id: string, tenantId: string): any | null {
    const db = getDatabase();
    const bundle = db.prepare(
      `SELECT b.*, p.name as project_name FROM product_bundles b
       LEFT JOIN projects p ON b.project_id = p.id
       WHERE b.id = ? AND b.tenant_id = ?`
    ).get(id, tenantId) as any;
    if (!bundle) return null;

    const items = db.prepare(
      `SELECT bi.product_id, bi.quantity, bi.unit_price, p.sku, p.name as product_name, p.stock
       FROM bundle_items bi
       LEFT JOIN products p ON bi.product_id = p.id
       WHERE bi.bundle_id = ? AND p.tenant_id = ?`
    ).all(id, tenantId) as any[];

    const products: AssortmentProduct[] = items.map((i: any) => ({
      productId: i.product_id, quantity: i.quantity, unitPrice: i.unit_price,
    }));

    return {
      id: bundle.id, tenantId: bundle.tenant_id, name: bundle.name,
      description: bundle.description, category: bundle.bundle_type === 'combo' ? 'live' : 'daily',
      products, grossMargin: 0, totalValue: products.reduce((s, p) => s + p.quantity * p.unitPrice, 0),
      stockStatus: 'sufficient', status: bundle.status,
      createdById: bundle.created_at, createdAt: bundle.created_at, updatedAt: bundle.updated_at,
    };
  }

  updateAssortment(id: string, tenantId: string, input: { name?: string; description?: string; category?: string; status?: string }): any {
    const db = getDatabase();
    const existing = db.prepare('SELECT id FROM product_bundles WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
    if (!existing) throw new NotFoundError('组盘', id);

    const fields: string[] = [];
    const values: unknown[] = [];
    if (input.name !== undefined) { fields.push('name = ?'); values.push(input.name); }
    if (input.description !== undefined) { fields.push('description = ?'); values.push(input.description); }
    if (input.status !== undefined && ['draft', 'active', 'archived', 'expired', 'cancelled'].includes(input.status)) {
      fields.push('status = ?'); values.push(input.status);
    }
    fields.push("updated_at = datetime('now', '+0000')");
    values.push(id, tenantId);

    if (fields.length > 1) { // 有实际更新
      db.prepare(`UPDATE product_bundles SET ${fields.slice(0, -2).join(', ')} WHERE id = ? AND tenant_id = ?`).run(...values.slice(0, -1));
    }

    return this.getAssortmentById(id, tenantId);
  }

  deleteAssortment(id: string, tenantId: string): void {
    const db = getDatabase();
    const existing = db.prepare('SELECT id FROM product_bundles WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
    if (!existing) throw new NotFoundError('组盘', id);
    // CASCADE delete 会自动删除 bundle_items
    db.prepare('DELETE FROM product_bundles WHERE id = ? AND tenant_id = ?').run(id, tenantId);
  }

  listAssortments(tenantId: string, params: PaginationParams & { status?: string; category?: string; keyword?: string }): PaginatedResult<any> {
    const db = getDatabase();
    let where = 'WHERE b.tenant_id = @tenantId';
    const queryParams: Record<string, unknown> = { tenantId };

    if (params.status) { where += ' AND b.status = @status'; queryParams.status = params.status; }
    if (params.keyword) { where += ' AND b.name LIKE @keyword'; queryParams.keyword = `%${params.keyword}%`; }

    const query = `SELECT b.*, p.name as project_name FROM product_bundles b
                   LEFT JOIN projects p ON b.project_id = p.id ${where}`;
    const countQuery = `SELECT COUNT(*) as total FROM product_bundles b ${where}`;

    const result = paginate(query, countQuery, queryParams, params);
    result.data = result.data.map((r: any) => this.getAssortmentById(r.id, tenantId));
    return result;
  }

  addProductToAssortment(id: string, tenantId: string, product: AssortmentProduct): any {
    const db = getDatabase();
    const existing = db.prepare('SELECT id FROM product_bundles WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
    if (!existing) throw new NotFoundError('组盘', id);

    // UPSERT bundle_items
    const existingItem = db.prepare(
      'SELECT quantity FROM bundle_items WHERE bundle_id = ? AND product_id = ?'
    ).get(id, product.productId) as any;

    if (existingItem) {
      db.prepare(
        'UPDATE bundle_items SET quantity = quantity + ?, unit_price = ?, sort_order = sort_order WHERE bundle_id = ? AND product_id = ?'
      ).run(product.quantity, product.unitPrice, id, product.productId);
    } else {
      db.prepare(
        'INSERT INTO bundle_items (id, bundle_id, product_id, quantity, unit_price, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(uuidv4(), id, product.productId, product.quantity, product.unitPrice, 0);
    }

    return this.getAssortmentById(id, tenantId);
  }

  removeProductFromAssortment(id: string, tenantId: string, productId: string): any {
    const db = getDatabase();
    const existing = db.prepare('SELECT id FROM product_bundles WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
    if (!existing) throw new NotFoundError('组盘', id);

    db.prepare('DELETE FROM bundle_items WHERE bundle_id = ? AND product_id = ?').run(id, productId);
    return this.getAssortmentById(id, tenantId);
  }

  previewAssortment(id: string, tenantId: string): any {
    const a = this.getAssortmentById(id, tenantId);
    if (!a) throw new NotFoundError('组盘', id);
    const db = getDatabase();
    const items = a.products.map((p: AssortmentProduct) => {
      const row = db.prepare('SELECT sku, name, stock, selling_price, cost_price FROM products WHERE id = ? AND tenant_id = ?').get(p.productId, tenantId) as any;
      return {
        productId: p.productId, sku: row?.sku, name: row?.name,
        quantity: p.quantity, unitPrice: p.unitPrice,
        stock: row?.stock ?? 0,
        sellingPrice: row?.selling_price,
        costPrice: row?.cost_price,
        lineTotal: Math.round(p.quantity * p.unitPrice * 100) / 100,
      };
    });
    return { ...a, items };
  }

  // ==================== Service Tickets (客服) ====================

  createTicket(tenantId: string, input: TicketInput): Record<string, unknown> {
    const db = getDatabase();
    const id = uuidv4();
    const ticketNo = `TKT${Date.now()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

    db.prepare(
      `INSERT INTO service_tickets (id, tenant_id, ticket_no, order_id, customer_name, customer_contact, channel, category, subject, description, priority, assigned_to, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`
    ).run(
      id, tenantId, ticketNo, input.orderId || null,
      input.customerName || null, input.customerContact || null,
      input.channel || 'online', input.category || 'inquiry',
      input.subject, input.description || null,
      input.priority || 'normal', input.assignedTo || null
    );

    return db.prepare('SELECT * FROM service_tickets WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
  }

  listTickets(tenantId: string, params: PaginationParams & { status?: string; category?: string; assignedTo?: string; priority?: string; keyword?: string }): PaginatedResult<any> {
    let where = 'WHERE t.tenant_id = @tenantId';
    const queryParams: Record<string, unknown> = { tenantId };

    if (params.keyword) {
      where += ' AND (t.subject LIKE @kw OR t.description LIKE @kw OR o.order_no LIKE @kw)';
      queryParams.kw = `%${params.keyword}%`;
    }
    if (params.status) { where += ' AND t.status = @status'; queryParams.status = params.status; }
    if (params.category) { where += ' AND t.category = @category'; queryParams.category = params.category; }
    if (params.assignedTo) { where += ' AND t.assigned_to = @assignedTo'; queryParams.assignedTo = params.assignedTo; }
    if (params.priority) { where += ' AND t.priority = @priority'; queryParams.priority = params.priority; }

    const query = `SELECT t.*, u.display_name as assigned_name, o.order_no
                   FROM service_tickets t
                   LEFT JOIN users u ON t.assigned_to = u.id
                   LEFT JOIN orders o ON t.order_id = o.id ${where}`;
    const countQuery = `SELECT COUNT(*) as total FROM service_tickets t ${where}`;

    return paginate(query, countQuery, queryParams, params);
  }

  addTicketMessage(ticketId: string, tenantId: string, senderType: string, senderId: string | null, content: string): Record<string, unknown> {
    const db = getDatabase();
    const ticket = db.prepare('SELECT id, status FROM service_tickets WHERE id = ? AND tenant_id = ?').get(ticketId, tenantId) as any;
    if (!ticket) throw new NotFoundError('工单', ticketId);

    const id = uuidv4();
    db.prepare(
      'INSERT INTO ticket_messages (id, ticket_id, sender_type, sender_id, content) VALUES (?, ?, ?, ?, ?)'
    ).run(id, ticketId, senderType, senderId, content);

    if (senderType === 'agent' && ticket.status === 'open') {
      db.prepare("UPDATE service_tickets SET status = 'in_progress', first_response_at = datetime('now', '+0000'), updated_at = datetime('now', '+0000') WHERE id = ? AND tenant_id = ?").run(ticketId, tenantId);
    }

    return db.prepare('SELECT * FROM ticket_messages WHERE id = ?').get(id) as any;
  }

  getServiceTicket(id: string, tenantId: string): Record<string, unknown> | null {
    const db = getDatabase();
    const ticket = db.prepare(
      'SELECT t.*, u.display_name as assigned_name FROM service_tickets t LEFT JOIN users u ON t.assigned_to = u.id WHERE t.id = ? AND t.tenant_id = ?'
    ).get(id, tenantId) as any;
    if (!ticket) return null;

    const messages = db.prepare(
      'SELECT tm.*, u.display_name as sender_name FROM ticket_messages tm LEFT JOIN users u ON tm.sender_id = u.id WHERE tm.ticket_id = ? ORDER BY tm.created_at ASC'
    ).all(id) as any[];

    const messageCount = messages.length;
    const lastMessage = messages.length ? messages[messages.length - 1].content : null;
    return { ...ticket, messages, messageCount, lastMessage };
  }

  updateServiceTicketStatus(id: string, tenantId: string, status: string): Record<string, unknown> {
    const db = getDatabase();
    const existing = db.prepare('SELECT id, status FROM service_tickets WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
    if (!existing) throw new NotFoundError('工单', id);

    const VALID_TRANSITIONS: Record<string, string[]> = {
      open: ['in_progress', 'closed'],
      in_progress: ['waiting_customer', 'closed', 'escalated'],
      waiting_customer: ['in_progress', 'closed'],
      escalated: ['in_progress', 'closed'],
      closed: [],
    };

    const allowedNext = VALID_TRANSITIONS[existing.status] || [];
    if (!allowedNext.includes(status)) {
      throw new ValidationError(
        `工单状态不允许从 "${existing.status}" 转换为 "${status}"。允许的操作: ${allowedNext.join(', ') || '无'}`
      );
    }

    const sql = status === 'closed'
      ? "UPDATE service_tickets SET status = ?, closed_at = datetime('now', '+0000'), updated_at = datetime('now', '+0000') WHERE id = ? AND tenant_id = ?"
      : "UPDATE service_tickets SET status = ?, updated_at = datetime('now', '+0000') WHERE id = ? AND tenant_id = ?";
    db.prepare(sql).run(status, id, tenantId);
    return db.prepare('SELECT * FROM service_tickets WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
  }

  assignTicketToAgent(id: string, tenantId: string, agentId: string): Record<string, unknown> {
    const db = getDatabase();
    const existing = db.prepare('SELECT id FROM service_tickets WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
    if (!existing) throw new NotFoundError('工单', id);
    db.prepare("UPDATE service_tickets SET assigned_to = ?, updated_at = datetime('now', '+0000') WHERE id = ? AND tenant_id = ?").run(agentId, id, tenantId);
    return db.prepare('SELECT * FROM service_tickets WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
  }

  escalateTicket(id: string, tenantId: string, reason?: string): Record<string, unknown> {
    const db = getDatabase();
    const existing = db.prepare('SELECT id, priority FROM service_tickets WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
    if (!existing) throw new NotFoundError('工单', id);
    db.prepare(
      "UPDATE service_tickets SET priority = 'urgent', status = 'escalated', escalate_reason = ?, updated_at = datetime('now', '+0000') WHERE id = ? AND tenant_id = ?"
    ).run(reason || '人工升级', id, tenantId);
    return db.prepare('SELECT * FROM service_tickets WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
  }

  // ==================== CSV Import ====================

  /**
   * 批量导入商品（从 CSV）
   * CSV 表头: sku, name, category, brand, costPrice, sellingPrice, marketPrice, stock, supplierName
   */
  batchImportProducts(tenantId: string, csvContent: string, operatorUserId?: string): {
    imported: number;
    skipped: number;
    errors: string[];
  } {
    const db = getDatabase();
    const result = parseCsv(csvContent);
    const errors: string[] = [];
    let imported = 0;
    let skipped = 0;

    for (const row of result.rows) {
      try {
        const sku = (row['sku'] || '').trim();
        const name = (row['name'] || '').trim();
        if (!sku || !name) {
          errors.push(`跳过：SKU 和名称不能为空`);
          skipped++;
          continue;
        }

        // 检查 SKU 是否已存在
        const existing = db.prepare('SELECT id FROM products WHERE tenant_id = ? AND sku = ?').get(tenantId, sku) as any;
        if (existing) {
          skipped++;
          continue;
        }

        const id = uuidv4();
        const costPrice = parseFloat(row['costPrice'] || '0') || 0;
        const sellingPrice = parseFloat(row['sellingPrice'] || '0') || 0;
        const marketPrice = parseFloat(row['marketPrice'] || '0') || 0;
        const stock = parseInt(row['stock'] || '0', 10) || 0;
        const marginRate = sellingPrice > 0 ? Math.round(((sellingPrice - costPrice) / sellingPrice) * 10000) / 100 : null;

        db.prepare(
          `INSERT INTO products (id, tenant_id, sku, name, category, brand, description, source_platform, source_url,
           cost_price, selling_price, market_price, margin_rate, stock, supplier_name, attributes, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', 'candidate')`
        ).run(
          id, tenantId, sku, name,
          row['category'] || null, row['brand'] || null, row['description'] || null,
          row['sourcePlatform'] || null, row['sourceUrl'] || null,
          costPrice, sellingPrice, marketPrice, marginRate, stock,
          row['supplierName'] || null
        );
        imported++;
      } catch (e) {
        errors.push(`行 ${result.rows.indexOf(row) + 2} 导入失败: ${String(e)}`);
      }
    }

    logger.info('business', `Batch import products: imported=${imported}, skipped=${skipped}, errors=${errors.length}`);
    return { imported, skipped, errors };
  }

  /**
   * 批量导入订单（从 CSV）
   * CSV 表头: sku, quantity, unitPrice, customerName, customerPhone, platform, orderDate
   */
  batchImportOrders(tenantId: string, csvContent: string, operatorUserId?: string): {
    imported: number;
    skipped: number;
    errors: string[];
  } {
    const db = getDatabase();
    const result = parseCsv(csvContent);
    const errors: string[] = [];
    let imported = 0;
    let skipped = 0;

    for (const row of result.rows) {
      try {
        const sku = (row['sku'] || '').trim();
        const quantity = parseInt(row['quantity'] || '1', 10) || 1;
        const unitPrice = parseFloat(row['unitPrice'] || '0') || 0;

        // 查找商品
        const product = db.prepare('SELECT id, name, cost_price FROM products WHERE tenant_id = ? AND sku = ?').get(tenantId, sku) as any;
        if (!product) {
          errors.push(`跳过：找不到商品 SKU=${sku}`);
          skipped++;
          continue;
        }

        // 创建订单
        const orderNo = `ORD${Date.now()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        const totalAmount = quantity * unitPrice;

        db.prepare(
          `INSERT INTO orders (id, tenant_id, order_no, platform, customer_name, customer_phone, items, subtotal, total_amount, payment_status, order_status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', 'pending', ?)`
        ).run(
          uuidv4(), tenantId, orderNo,
          row['platform'] || null, row['customerName'] || null, row['customerPhone'] || null,
          JSON.stringify([{ productId: product.id, quantity, unitPrice }]),
          totalAmount, totalAmount,
          row['orderDate'] || new Date().toISOString().slice(0, 10)
        );
        imported++;
      } catch (e) {
        errors.push(`行 ${result.rows.indexOf(row) + 2} 导入失败: ${String(e)}`);
      }
    }

    logger.info('business', `Batch import orders: imported=${imported}, skipped=${skipped}, errors=${errors.length}`);
    return { imported, skipped, errors };
  }

  // ==================== Settlements (结算) ====================

  createSettlement(tenantId: string, input: { projectId?: string; period: string; platform?: string }): Record<string, unknown> {
    const db = getDatabase();
    const id = uuidv4();

    // Aggregate order data for the period
    let orderWhere = 'WHERE tenant_id = ? AND created_at LIKE ?';
    const orderParams: unknown[] = [tenantId, `${input.period}%`];
    if (input.projectId) { orderWhere += ' AND project_id = ?'; orderParams.push(input.projectId); }

    const orderData = db.prepare(
      `SELECT COUNT(*) as total_orders, COALESCE(SUM(total_amount), 0) as total_amount,
              COALESCE(SUM(shipping_fee), 0) as shipping_cost,
              COALESCE(SUM(CASE WHEN payment_status = 'refunded' THEN total_amount ELSE 0 END), 0) as refund_amount
       FROM orders ${orderWhere}`
    ).get(...orderParams) as any;

    const platformFeeRate = 0.05; // 5% platform fee
    const platformFee = orderData.total_amount * platformFeeRate;
    const netAmount = orderData.total_amount - platformFee - orderData.shipping_cost - orderData.refund_amount;

    db.prepare(
      `INSERT INTO settlements (id, tenant_id, project_id, period, platform, total_orders, total_amount, platform_fee, shipping_cost, refund_amount, net_amount, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    ).run(
      id, tenantId, input.projectId || null, input.period,
      input.platform || null, orderData.total_orders,
      orderData.total_amount, platformFee, orderData.shipping_cost,
      orderData.refund_amount, netAmount
    );

    return db.prepare('SELECT * FROM settlements WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
  }

  listSettlements(tenantId: string, params: PaginationParams & { projectId?: string; status?: string }): PaginatedResult<any> {
    let where = 'WHERE s.tenant_id = @tenantId';
    const queryParams: Record<string, unknown> = { tenantId };

    if (params.projectId) { where += ' AND s.project_id = @projectId'; queryParams.projectId = params.projectId; }
    if (params.status) { where += ' AND s.status = @status'; queryParams.status = params.status; }

    return paginate(
      `SELECT s.*, p.name as project_name FROM settlements s LEFT JOIN projects p ON s.project_id = p.id ${where}`,
      `SELECT COUNT(*) as total FROM settlements s ${where}`,
      queryParams, params
    );
  }

  // ==================== Campaigns (大促活动) ====================

  createCampaign(tenantId: string, input: {
    name: string; code?: string; platform?: string; campaignType?: string;
    startDate?: string; endDate?: string; discountType?: string; discountValue?: number;
    thresholdAmount?: number; budget?: number; targetGmv?: number; targetOrders?: number;
    description?: string; conditions?: Record<string, unknown>;
  }): Record<string, unknown> {
    const db = getDatabase();
    const id = uuidv4();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO campaigns (id, tenant_id, name, code, platform, campaign_type, status,
        start_date, end_date, discount_type, discount_value, threshold_amount,
        budget, target_gmv, target_orders, description, conditions, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+0000'))`
    ).run(
      id, tenantId, input.name, input.code || null, input.platform || null,
      input.campaignType || 'promotional',
      input.startDate || null, input.endDate || null,
      input.discountType || null, input.discountValue || 0, input.thresholdAmount || 0,
      input.budget || 0, input.targetGmv || null, input.targetOrders || 0,
      input.description || null, input.conditions ? JSON.stringify(input.conditions) : '{}',
      id
    );
    const result = db.prepare('SELECT * FROM campaigns WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
    logger.info('campaign', `Campaign created: ${input.name}`, { id, tenantId });
    return result;
  }

  getCampaignById(id: string, tenantId: string): any | null {
    const db = getDatabase();
    return db.prepare('SELECT * FROM campaigns WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any | null;
  }

  updateCampaign(id: string, tenantId: string, input: Partial<{
    name: string; platform: string; campaignType: string; status: string;
    startDate: string; endDate: string; discountType: string; discountValue: number;
    budget: number; targetGmv: number; targetOrders: number; description: string;
  }>): any {
    const db = getDatabase();
    const existing = db.prepare('SELECT id FROM campaigns WHERE id = ? AND tenant_id = ?').get(id, tenantId);
    if (!existing) throw new NotFoundError('活动', id);
    const fields: string[] = ['updated_at = datetime(\'now\', \'+0000\')'];
    const values: unknown[] = [id, tenantId];
    const fieldMap: Record<string, string> = {
      name: 'name', platform: 'platform', campaignType: 'campaign_type',
      startDate: 'start_date', endDate: 'end_date', discountType: 'discount_type',
      discountValue: 'discount_value', budget: 'budget', targetGmv: 'target_gmv',
      targetOrders: 'target_orders', description: 'description',
    };
    for (const [key, col] of Object.entries(fieldMap)) {
      if (input[key as keyof typeof input] !== undefined) {
        fields.push(`${col} = ?`);
        values.push(input[key as keyof typeof input]);
      }
    }
    db.prepare(`UPDATE campaigns SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...values);
    return db.prepare('SELECT * FROM campaigns WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
  }

  deleteCampaign(id: string, tenantId: string): void {
    const db = getDatabase();
    const existing = db.prepare('SELECT id FROM campaigns WHERE id = ? AND tenant_id = ?').get(id, tenantId);
    if (!existing) throw new NotFoundError('活动', id);
    db.prepare('DELETE FROM campaign_products WHERE campaign_id = ?').run(id);
    db.prepare('DELETE FROM campaigns WHERE id = ? AND tenant_id = ?').run(id, tenantId);
  }

  listCampaigns(tenantId: string, params: PaginationParams & { status?: string; platform?: string; keyword?: string }): PaginatedResult<any> {
    const where: string[] = ['c.tenant_id = ?'];
    const queryParams: Record<string, unknown> = { tenantId };
    if (params.status) { where.push('c.status = ?'); queryParams.status = params.status; }
    if (params.platform) { where.push('c.platform = ?'); queryParams.platform = params.platform; }
    if (params.keyword) { where.push('c.name LIKE ?'); queryParams.keyword = `%${params.keyword}%`; }
    const whereClause = `WHERE ${where.join(' AND ')}`;
    return paginate(
      `SELECT c.* FROM campaigns c ${whereClause} ORDER BY c.created_at DESC`,
      `SELECT COUNT(*) as total FROM campaigns c ${whereClause}`,
      queryParams, params
    );
  }

  addProductToCampaign(campaignId: string, tenantId: string, input: { productId: string; discountType?: string; discountValue?: number }): any {
    const db = getDatabase();
    const campaign = db.prepare('SELECT id FROM campaigns WHERE id = ? AND tenant_id = ?').get(campaignId, tenantId);
    if (!campaign) throw new NotFoundError('活动', campaignId);
    const product = db.prepare('SELECT id FROM products WHERE id = ? AND tenant_id = ?').get(input.productId, tenantId);
    if (!product) throw new NotFoundError('商品', input.productId);
    const id = uuidv4();
    db.prepare(
      `INSERT INTO campaign_products (id, campaign_id, product_id, discount_type, discount_value)
       VALUES (?, ?, ?, ?, ?)`
    ).run(id, campaignId, input.productId, input.discountType || null, input.discountValue || 0);
    return db.prepare('SELECT * FROM campaign_products WHERE id = ?').get(id) as any;
  }

  removeProductFromCampaign(campaignId: string, productId: string, tenantId: string): void {
    const db = getDatabase();
    db.prepare(
      `DELETE FROM campaign_products WHERE campaign_id = ? AND product_id = ?`
    ).run(campaignId, productId);
  }

  // ==================== Ad Spend (投流记录) ====================

  createAdSpend(tenantId: string, input: {
    platform: string; campaignId?: string; projectId?: string; channel?: string;
    planName?: string; spend: number; impression?: number; click?: number;
    cvr?: number; cpc?: number; cpm?: number; orderCount?: number; gmv?: number;
    roi?: number; note?: string; spendDate: string;
  }): Record<string, unknown> {
    const db = getDatabase();
    const id = uuidv4();
    const roi = input.spend > 0 ? (input.gmv || 0) / input.spend : 0;
    db.prepare(
      `INSERT INTO ad_spend (id, tenant_id, platform, campaign_id, project_id, channel, plan_name,
        spend, impression, click, cvr, cpc, cpm, order_count, gmv, roi, note, spend_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+0000'))`
    ).run(
      id, tenantId, input.platform, input.campaignId || null, input.projectId || null,
      input.channel || null, input.planName || null, input.spend,
      input.impression || 0, input.click || 0, input.cvr || 0,
      input.cpc || 0, input.cpm || 0, input.orderCount || 0, input.gmv || 0, roi,
      input.note || null, input.spendDate
    );
    const result = db.prepare('SELECT * FROM ad_spend WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
    logger.info('ad_spend', `Ad spend recorded: ${input.platform} ¥${input.spend}`, { id, tenantId });
    return result;
  }

  getAdSpendById(id: string, tenantId: string): any | null {
    const db = getDatabase();
    return db.prepare('SELECT * FROM ad_spend WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any | null;
  }

  listAdSpend(tenantId: string, params: PaginationParams & { platform?: string; campaignId?: string; startDate?: string; endDate?: string }): PaginatedResult<any> {
    const where: string[] = ['a.tenant_id = ?'];
    const queryParams: Record<string, unknown> = { tenantId };
    if (params.platform) { queryParams.platform = params.platform; }
    if (params.campaignId) { queryParams.campaignId = params.campaignId; }
    if (params.startDate) { queryParams.startDate = params.startDate; }
    if (params.endDate) { queryParams.endDate = params.endDate; }
    const whereClause = `WHERE ${where.join(' AND ')}`;
    return paginate(
      `SELECT a.*, c.name as campaign_name, p.name as project_name FROM ad_spend a LEFT JOIN campaigns c ON a.campaign_id = c.id LEFT JOIN projects p ON a.project_id = p.id ${whereClause} ORDER BY a.spend_date DESC`,
      `SELECT COUNT(*) as total FROM ad_spend a ${whereClause}`,
      queryParams, params
    );
  }

  getAdSpendSummary(tenantId: string, params: { platform?: string; startDate?: string; endDate?: string }): {
    totalSpend: number; totalImpression: number; totalClick: number; totalGmv: number; totalOrders: number; overallRoi: number;
    byPlatform: Array<{ platform: string; spend: number; gmv: number; roi: number; orders: number }>;
  } {
    const db = getDatabase();
    const where: string[] = ['tenant_id = ?'];
    const queryParams: Record<string, unknown> = { tenantId };
    if (params.platform) { queryParams.platform = params.platform; }
    if (params.startDate) { queryParams.startDate = params.startDate; }
    if (params.endDate) { queryParams.endDate = params.endDate; }
    const whereClause = where.join(' AND ');
    const summary = db.prepare(
      `SELECT SUM(spend) as total_spend, SUM(impression) as total_impression, SUM(click) as total_click,
              SUM(gmv) as total_gmv, SUM(order_count) as total_orders
       FROM ad_spend WHERE ${whereClause}`
    ).get(queryParams) as any;
    const byPlatform = db.prepare(
      `SELECT platform, SUM(spend) as spend, SUM(gmv) as gmv, SUM(order_count) as orders
       FROM ad_spend WHERE ${whereClause} GROUP BY platform`
    ).all(queryParams) as any[];
    return {
      totalSpend: summary.total_spend || 0,
      totalImpression: summary.total_impression || 0,
      totalClick: summary.total_click || 0,
      totalGmv: summary.total_gmv || 0,
      totalOrders: summary.total_orders || 0,
      overallRoi: (summary.total_spend || 0) > 0 ? (summary.total_gmv || 0) / summary.total_spend : 0,
      byPlatform: byPlatform.map((p: any) => ({
        platform: p.platform, spend: p.spend || 0, gmv: p.gmv || 0,
        roi: (p.spend || 0) > 0 ? p.gmv / p.spend : 0, orders: p.orders || 0,
      })),
    };
  }

  // ==================== Product Reviews (商品评价) ====================

  createReview(tenantId: string, input: {
    productId: string; orderId?: string; userId?: string;
    rating: number; description?: string; images?: string[];
  }): Record<string, unknown> {
    const db = getDatabase();
    const id = uuidv4();
    const product = db.prepare('SELECT id FROM products WHERE id = ? AND tenant_id = ?').get(input.productId, tenantId);
    if (!product) throw new NotFoundError('商品', input.productId);
    db.prepare(
      `INSERT INTO product_reviews (id, tenant_id, product_id, order_id, user_id, rating, description, images, is_anonymous, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending', datetime('now', '+0000'))`
    ).run(
      id, tenantId, input.productId, input.orderId || null, input.userId || null,
      input.rating, input.description || null,
      input.images ? JSON.stringify(input.images) : '[]'
    );
    return db.prepare('SELECT * FROM product_reviews WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
  }

  listReviews(tenantId: string, params: PaginationParams & { productId?: string; rating?: number; status?: string }): PaginatedResult<any> {
    const where: string[] = ['r.tenant_id = ?'];
    const queryParams: Record<string, unknown> = { tenantId };
    if (params.productId) { queryParams.productId = params.productId; }
    if (params.rating) { queryParams.rating = params.rating; }
    if (params.status) { queryParams.status = params.status; }
    const whereClause = `WHERE ${where.join(' AND ')}`;
    return paginate(
      `SELECT r.*, p.name as product_name, p.sku, u.display_name as reviewer_name FROM product_reviews r LEFT JOIN products p ON r.product_id = p.id LEFT JOIN users u ON r.user_id = u.id ${whereClause} ORDER BY r.created_at DESC`,
      `SELECT COUNT(*) as total FROM product_reviews r ${whereClause}`,
      queryParams, params
    );
  }

  approveReview(id: string, tenantId: string): any {
    const db = getDatabase();
    const existing = db.prepare('SELECT id FROM product_reviews WHERE id = ? AND tenant_id = ?').get(id, tenantId);
    if (!existing) throw new NotFoundError('评价', id);
    db.prepare("UPDATE product_reviews SET status = 'approved', updated_at = datetime('now', '+0000') WHERE id = ? AND tenant_id = ?").run(id, tenantId);
    return db.prepare('SELECT * FROM product_reviews WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
  }

  replyToReview(id: string, tenantId: string, input: { reply: string; userId: string }): any {
    const db = getDatabase();
    const existing = db.prepare('SELECT id FROM product_reviews WHERE id = ? AND tenant_id = ?').get(id, tenantId);
    if (!existing) throw new NotFoundError('评价', id);
    db.prepare("UPDATE product_reviews SET seller_reply = ?, reply_at = datetime('now', '+0000'), updated_at = datetime('now', '+0000') WHERE id = ? AND tenant_id = ?").run(input.reply, id, tenantId);
    return db.prepare('SELECT * FROM product_reviews WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
  }

  getProductReviewStats(tenantId: string, productId: string): {
    totalReviews: number; avgRating: number; ratingDistribution: Record<number, number>;
  } {
    const db = getDatabase();
    const stats = db.prepare(
      `SELECT COUNT(*) as total_reviews, AVG(rating) as avg_rating
       FROM product_reviews WHERE product_id = ? AND tenant_id = ? AND status = 'approved'`
    ).get(productId, tenantId) as any;
    const distribution = db.prepare(
      `SELECT rating, COUNT(*) as count FROM product_reviews WHERE product_id = ? AND tenant_id = ? AND status = 'approved' GROUP BY rating`
    ).all(productId, tenantId) as any[];
    const ratingDist: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    for (const d of distribution) {
      ratingDist[d.rating] = d.count;
    }
    return {
      totalReviews: stats.total_reviews || 0,
      avgRating: Math.round((stats.avg_rating || 0) * 100) / 100,
      ratingDistribution: ratingDist,
    };
  }
}

export const businessService = new BusinessService();
