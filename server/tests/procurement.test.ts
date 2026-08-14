/**
 * 采购供应链模块单元测试（V2 · M1 / S1-S6）
 *
 * 覆盖：
 *   S1 供应商台账：创建/去重/查询/更新/归档保护
 *   S2 采购单：创建/金额计算/状态机流转/非法流转拦截
 *   S3 到货入库：库存回写/加权均价/流水落库/超量拦截/部分到货
 *   S4 补货建议：缺口计算/一键转采购单
 *   S6 供应商绩效：交期达成率/合格率/综合评分口径
 *   多租户隔离：跨租户不可见
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDatabase, closeDatabase, getDatabase } from '../src/db';
import { procurementService } from '../src/services/procurementService';
import { v4 as uuidv4 } from 'uuid';
import { removeDbFiles } from './test-helpers';

const TEST_DB_PATH = process.env.VORZAI_TEST_DB_PROC || 'data/test_vorzai_procurement.db';

// 测试租户与商品
let tenantA: string;
let tenantB: string;
let productX: string;
let productY: string;
let userId: string;

function seedTenant(name: string): string {
  const db = getDatabase();
  const id = uuidv4();
  db.prepare('INSERT INTO tenants (id, name, slug, status) VALUES (?, ?, ?, ?)')
    .run(id, name, `${name}-${id.slice(0, 8)}`, 'active');
  return id;
}

function seedProduct(tenantId: string, sku: string, stock: number, costPrice: number, supplierName?: string): string {
  const db = getDatabase();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO products (id, tenant_id, sku, name, stock, cost_price, selling_price, supplier_name, status)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(id, tenantId, sku, `商品-${sku}`, stock, costPrice, costPrice * 2, supplierName || null, 'listed');
  return id;
}

describe('采购供应链 · S1 供应商台账', () => {
  beforeAll(() => {
    removeDbFiles(TEST_DB_PATH);
    initDatabase(TEST_DB_PATH);
    tenantA = seedTenant('TenantA');
    tenantB = seedTenant('TenantB');
    userId = uuidv4();
    const db = getDatabase();
    db.prepare('INSERT INTO users (id, tenant_id, username, password_hash, display_name, role, status) VALUES (?,?,?,?,?,?,?)')
      .run(userId, tenantA, `buyer-${userId.slice(0, 6)}`, 'hash', '采购员', 'manager', 'active');
    productX = seedProduct(tenantA, 'SKU-X', 10, 20, '华东供应商');
    productY = seedProduct(tenantA, 'SKU-Y', 0, 50);
  });

  afterAll(() => {
    closeDatabase();
    removeDbFiles(TEST_DB_PATH);
  });

  it('应能创建供应商并带默认值', () => {
    const s = procurementService.createSupplier(tenantA, { name: '华东供应商', contactName: '张三', leadTimeDays: 5 }, userId);
    expect(s).toBeTruthy();
    expect(s!.name).toBe('华东供应商');
    expect(s!.grade).toBe('B');           // 默认等级
    expect(s!.paymentTerms).toBe('net30'); // 默认账期
    expect(s!.leadTimeDays).toBe(5);
    expect(s!.status).toBe('active');
  });

  it('同租户同名供应商应被拒绝', () => {
    expect(() => procurementService.createSupplier(tenantA, { name: '华东供应商' }, userId)).toThrow(/已存在/);
  });

  it('不同租户可以有同名供应商（租户隔离）', () => {
    const s = procurementService.createSupplier(tenantB, { name: '华东供应商' }, userId);
    expect(s!.name).toBe('华东供应商');
  });

  it('空名称应被拒绝', () => {
    expect(() => procurementService.createSupplier(tenantA, { name: '   ' }, userId)).toThrow(/不能为空/);
  });

  it('列表应只返回本租户数据', () => {
    const listA = procurementService.listSuppliers(tenantA, {});
    const listB = procurementService.listSuppliers(tenantB, {});
    expect(listA.pagination.total).toBe(1);
    expect(listB.pagination.total).toBe(1);
    expect(listA.data[0].id).not.toBe(listB.data[0].id);
  });

  it('跨租户读取单个供应商应 404', () => {
    const sB = procurementService.listSuppliers(tenantB, {}).data[0];
    expect(() => procurementService.getSupplier(tenantA, sB.id)).toThrow(/不存在/);
  });

  it('应能更新供应商等级与账期', () => {
    const s = procurementService.listSuppliers(tenantA, {}).data[0];
    const updated = procurementService.updateSupplier(tenantA, s.id, { grade: 'A', paymentTerms: 'net60' });
    expect(updated!.grade).toBe('A');
    expect(updated!.paymentTerms).toBe('net60');
  });

  it('关键词搜索应命中', () => {
    const r = procurementService.listSuppliers(tenantA, { keyword: '华东' });
    expect(r.pagination.total).toBe(1);
  });
});

describe('采购供应链 · S2 采购单与状态机', () => {
  let supplierId: string;
  let poId: string;

  beforeAll(() => {
    removeDbFiles(TEST_DB_PATH);
    initDatabase(TEST_DB_PATH);
    tenantA = seedTenant('TenantPO');
    userId = uuidv4();
    const db = getDatabase();
    db.prepare('INSERT INTO users (id, tenant_id, username, password_hash, display_name, role, status) VALUES (?,?,?,?,?,?,?)')
      .run(userId, tenantA, `po-${userId.slice(0, 6)}`, 'hash', '采购员', 'manager', 'active');
    productX = seedProduct(tenantA, 'PO-SKU-X', 10, 20);
    productY = seedProduct(tenantA, 'PO-SKU-Y', 5, 50);
    supplierId = procurementService.createSupplier(tenantA, { name: '测试供应商' }, userId)!.id;
  });

  afterAll(() => {
    closeDatabase();
    removeDbFiles(TEST_DB_PATH);
  });

  it('应能创建采购单并正确计算总额', () => {
    const po = procurementService.createPurchaseOrder(tenantA, {
      supplierId,
      expectedDate: '2099-12-31',
      items: [
        { productId: productX, quantity: 100, unitPrice: 18.5 },
        { productId: productY, quantity: 20, unitPrice: 45 },
      ],
    }, userId);
    poId = po.id;
    // 100×18.5 + 20×45 = 1850 + 900 = 2750
    expect(po.totalAmount).toBe(2750);
    expect(po.status).toBe('draft');
    expect(po.statusLabel).toBe('草稿');
    expect(po.items).toHaveLength(2);
    expect(po.supplierName).toBe('测试供应商');
    expect(po.poNo).toMatch(/^PO\d{8}\d{4}$/);
  });

  it('明细应自动补全 SKU 与名称快照', () => {
    const po = procurementService.getPurchaseOrder(tenantA, poId);
    const item = po.items.find((i: any) => i.productId === productX);
    expect(item.productSku).toBe('PO-SKU-X');
    expect(item.productName).toBe('商品-PO-SKU-X');
    expect(item.subtotal).toBe(1850);
  });

  it('空明细采购单应被拒绝', () => {
    expect(() => procurementService.createPurchaseOrder(tenantA, { items: [] }, userId)).toThrow(/至少需要一条明细/);
  });

  it('数量为 0 的明细应被拒绝', () => {
    expect(() => procurementService.createPurchaseOrder(tenantA, {
      items: [{ productId: productX, quantity: 0, unitPrice: 10 }],
    }, userId)).toThrow(/数量必须大于 0/);
  });

  it('负单价应被拒绝', () => {
    expect(() => procurementService.createPurchaseOrder(tenantA, {
      items: [{ productId: productX, quantity: 1, unitPrice: -5 }],
    }, userId)).toThrow(/不能为负数/);
  });

  it('状态机：draft → submitted → approved 合法', () => {
    let po = procurementService.transitionPurchaseOrder(tenantA, poId, 'submitted', userId);
    expect(po.status).toBe('submitted');
    po = procurementService.transitionPurchaseOrder(tenantA, poId, 'approved', userId);
    expect(po.status).toBe('approved');
    expect(po.approvedBy).toBe(userId);
    expect(po.approvedAt).toBeTruthy();
  });

  it('状态机：approved → completed 非法（必须先收货）', () => {
    expect(() => procurementService.transitionPurchaseOrder(tenantA, poId, 'completed', userId))
      .toThrow(/不能从「已审批」流转到「已完成」/);
  });

  it('采购单号在租户内唯一递增', () => {
    const po2 = procurementService.createPurchaseOrder(tenantA, {
      items: [{ productId: productX, quantity: 1, unitPrice: 10 }],
    }, userId);
    const po1No = procurementService.getPurchaseOrder(tenantA, poId).poNo;
    expect(po2.poNo).not.toBe(po1No);
  });

  it('按状态筛选采购单', () => {
    const approved = procurementService.listPurchaseOrders(tenantA, { status: 'approved' });
    expect(approved.pagination.total).toBe(1);
    const drafts = procurementService.listPurchaseOrders(tenantA, { status: 'draft' });
    expect(drafts.pagination.total).toBe(1);
  });
});

describe('采购供应链 · S3 到货入库与库存联动', () => {
  let supplierId: string;
  let poId: string;
  let itemXId: string;
  let itemYId: string;

  beforeAll(() => {
    removeDbFiles(TEST_DB_PATH);
    initDatabase(TEST_DB_PATH);
    tenantA = seedTenant('TenantRecv');
    userId = uuidv4();
    const db = getDatabase();
    db.prepare('INSERT INTO users (id, tenant_id, username, password_hash, display_name, role, status) VALUES (?,?,?,?,?,?,?)')
      .run(userId, tenantA, `rc-${userId.slice(0, 6)}`, 'hash', '仓管', 'manager', 'active');
    // X: 库存 100，成本 10；准备用 20 元采购 100 件 → 加权均价应为 15
    productX = seedProduct(tenantA, 'RC-SKU-X', 100, 10);
    productY = seedProduct(tenantA, 'RC-SKU-Y', 0, 0);
    supplierId = procurementService.createSupplier(tenantA, { name: '入库供应商' }, userId)!.id;

    const po = procurementService.createPurchaseOrder(tenantA, {
      supplierId,
      expectedDate: '2099-12-31',
      items: [
        { productId: productX, quantity: 100, unitPrice: 20 },
        { productId: productY, quantity: 50, unitPrice: 8 },
      ],
    }, userId);
    poId = po.id;
    itemXId = po.items.find((i: any) => i.productId === productX).id;
    itemYId = po.items.find((i: any) => i.productId === productY).id;
    procurementService.transitionPurchaseOrder(tenantA, poId, 'submitted', userId);
    procurementService.transitionPurchaseOrder(tenantA, poId, 'approved', userId);
  });

  afterAll(() => {
    closeDatabase();
    removeDbFiles(TEST_DB_PATH);
  });

  it('草稿状态不允许入库', () => {
    const draft = procurementService.createPurchaseOrder(tenantA, {
      items: [{ productId: productX, quantity: 1, unitPrice: 1 }],
    }, userId);
    const draftItem = draft.items[0].id;
    expect(() => procurementService.receivePurchaseOrder(tenantA, draft.id, [
      { itemId: draftItem, receivedQuantity: 1 },
    ], userId)).toThrow(/只有「已审批」或「收货中」/);
  });

  it('到货数量超过订购量应被拒绝', () => {
    expect(() => procurementService.receivePurchaseOrder(tenantA, poId, [
      { itemId: itemXId, receivedQuantity: 999 },
    ], userId)).toThrow(/超过未到货数量/);
  });

  it('合格数量不能大于到货数量', () => {
    expect(() => procurementService.receivePurchaseOrder(tenantA, poId, [
      { itemId: itemXId, receivedQuantity: 10, qualifiedQuantity: 20 },
    ], userId)).toThrow(/合格数量必须在/);
  });

  it('部分到货：状态保持 receiving，库存与加权均价正确回写', () => {
    const result = procurementService.receivePurchaseOrder(tenantA, poId, [
      { itemId: itemXId, receivedQuantity: 100, qualifiedQuantity: 100 },
    ], userId);

    expect(result.status).toBe('receiving'); // Y 还没到

    const db = getDatabase();
    const p = db.prepare('SELECT stock, cost_price FROM products WHERE id = ?').get(productX) as any;
    // 库存 100 + 100 = 200
    expect(p.stock).toBe(200);
    // 加权均价 = (100×10 + 100×20) / 200 = 15
    expect(p.cost_price).toBe(15);
  });

  it('入库应生成 purchase_in 流水且前后库存可追溯', () => {
    const txns = procurementService.listStockTransactions(tenantA, { productId: productX, txnType: 'purchase_in' });
    expect(txns.pagination.total).toBe(1);
    const t = txns.data[0];
    expect(t.quantity).toBe(100);
    expect(t.stockBefore).toBe(100);
    expect(t.stockAfter).toBe(200);
    expect(t.unitCost).toBe(20);
    expect(t.refType).toBe('purchase_order');
    expect(t.refId).toBe(poId);
  });

  it('质检不合格部分不入库，但计入到货数量', () => {
    const result = procurementService.receivePurchaseOrder(tenantA, poId, [
      { itemId: itemYId, receivedQuantity: 50, qualifiedQuantity: 45, remark: '5 件破损' },
    ], userId);

    // 全部明细到齐 → 自动完成
    expect(result.status).toBe('completed');
    expect(result.receivedDate).toBeTruthy();

    const db = getDatabase();
    const p = db.prepare('SELECT stock FROM products WHERE id = ?').get(productY) as any;
    expect(p.stock).toBe(45); // 只有合格品入库

    const item = result.items.find((i: any) => i.id === itemYId);
    expect(item.receivedQuantity).toBe(50);
    expect(item.qualifiedQuantity).toBe(45);
  });

  it('供应商累计采购额应累加实收金额', () => {
    const s = procurementService.getSupplier(tenantA, supplierId);
    // X: 100×20 = 2000；Y: 45×8 = 360 → 2360
    expect(s!.totalPurchaseAmount).toBe(2360);
  });

  it('手工库存调整应落流水且拦截负库存', () => {
    const before = (getDatabase().prepare('SELECT stock FROM products WHERE id = ?').get(productY) as any).stock;
    const r = procurementService.adjustStock(tenantA, { productId: productY, quantity: -5, remark: '盘亏' }, userId);
    expect(r.stockBefore).toBe(before);
    expect(r.stockAfter).toBe(before - 5);

    expect(() => procurementService.adjustStock(tenantA, { productId: productY, quantity: -99999 }, userId))
      .toThrow(/调整后库存为负/);
    expect(() => procurementService.adjustStock(tenantA, { productId: productY, quantity: 0 }, userId))
      .toThrow(/不能为 0/);
  });

  it('有进行中采购单的供应商不可删除', () => {
    const s2 = procurementService.createSupplier(tenantA, { name: '待删供应商' }, userId)!;
    const po = procurementService.createPurchaseOrder(tenantA, {
      supplierId: s2.id,
      items: [{ productId: productX, quantity: 1, unitPrice: 1 }],
    }, userId);
    procurementService.transitionPurchaseOrder(tenantA, po.id, 'submitted', userId);
    expect(() => procurementService.deleteSupplier(tenantA, s2.id)).toThrow(/进行中的采购单/);

    // 取消后可归档
    procurementService.transitionPurchaseOrder(tenantA, po.id, 'cancelled', userId);
    procurementService.deleteSupplier(tenantA, s2.id);
    expect(procurementService.getSupplier(tenantA, s2.id)!.status).toBe('archived');
  });
});

describe('采购供应链 · S4 补货建议', () => {
  let supplierId: string;

  beforeAll(() => {
    removeDbFiles(TEST_DB_PATH);
    initDatabase(TEST_DB_PATH);
    tenantA = seedTenant('TenantRepl');
    userId = uuidv4();
    const db = getDatabase();
    db.prepare('INSERT INTO users (id, tenant_id, username, password_hash, display_name, role, status) VALUES (?,?,?,?,?,?,?)')
      .run(userId, tenantA, `rp-${userId.slice(0, 6)}`, 'hash', '补货员', 'manager', 'active');

    supplierId = procurementService.createSupplier(tenantA, { name: '补货供应商' }, userId)!.id;
    // 断货商品，挂供应商名，应能自动匹配台账
    productX = seedProduct(tenantA, 'RP-SKU-X', 0, 12, '补货供应商');
    // 库存充足商品，不应出现在建议里
    productY = seedProduct(tenantA, 'RP-SKU-Y', 10000, 3);

    // 造 30 天内的销售订单：X 卖了 300 件 → 日均 10
    db.prepare(
      `INSERT INTO orders (id, tenant_id, order_no, items, total_amount, paid_amount, order_status, created_at)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(
      uuidv4(), tenantA, 'ORD-1',
      JSON.stringify([{ productId: productX, quantity: 300, unitPrice: 25 }]),
      7500, 7500, 'completed', new Date(Date.now() - 5 * 86400000).toISOString()
    );
    // 已取消订单不应计入销量
    db.prepare(
      `INSERT INTO orders (id, tenant_id, order_no, items, total_amount, paid_amount, order_status, created_at)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(
      uuidv4(), tenantA, 'ORD-2',
      JSON.stringify([{ productId: productX, quantity: 9999, unitPrice: 25 }]),
      0, 0, 'cancelled', new Date(Date.now() - 3 * 86400000).toISOString()
    );
  });

  afterAll(() => {
    closeDatabase();
    removeDbFiles(TEST_DB_PATH);
  });

  it('断货商品应产生补货建议，取消单不计入销量', () => {
    const r = procurementService.buildReplenishSuggestions(tenantA, { coverDays: 30, windowDays: 30 });
    const x = r.suggestions.find((s) => s.productId === productX);
    expect(x).toBeTruthy();
    // 日均 = 300/30 = 10；目标 = 10×30 = 300；缺口 = 300 - 0 = 300
    expect(x!.dailySalesAvg).toBe(10);
    expect(x!.suggestedQty).toBe(300);
    expect(x!.reason).toContain('已断货');
    // 应匹配到供应商台账
    expect(x!.supplierId).toBe(supplierId);
  });

  it('库存充足商品不应出现在建议中', () => {
    const r = procurementService.buildReplenishSuggestions(tenantA, { coverDays: 30 });
    expect(r.suggestions.find((s) => s.productId === productY)).toBeUndefined();
  });

  it('覆盖天数应影响建议量', () => {
    const r60 = procurementService.buildReplenishSuggestions(tenantA, { coverDays: 60 });
    const x = r60.suggestions.find((s) => s.productId === productX);
    expect(x!.suggestedQty).toBe(600); // 10×60
  });

  it('一键转采购单应按供应商分组', () => {
    const r = procurementService.createPOFromSuggestions(tenantA, [productX], { coverDays: 30 }, userId);
    expect(r.createdCount).toBe(1);
    const po = r.purchaseOrders[0];
    expect(po.source).toBe('replenish_suggestion');
    expect(po.supplierId).toBe(supplierId);
    expect(po.items[0].quantity).toBe(300);
    // 无历史采购价 → 回落成本价 12
    expect(po.items[0].unitPrice).toBe(12);
    expect(po.totalAmount).toBe(3600);
  });

  it('无补货需求的商品转单应被拒绝', () => {
    expect(() => procurementService.createPOFromSuggestions(tenantA, [productY], {}, userId))
      .toThrow(/无补货需求/);
    expect(() => procurementService.createPOFromSuggestions(tenantA, [], {}, userId))
      .toThrow(/请选择要补货的商品/);
  });
});

describe('采购供应链 · S6 供应商绩效与总览', () => {
  let supplierGood: string;
  let supplierLate: string;

  beforeAll(() => {
    removeDbFiles(TEST_DB_PATH);
    initDatabase(TEST_DB_PATH);
    tenantA = seedTenant('TenantPerf');
    userId = uuidv4();
    const db = getDatabase();
    db.prepare('INSERT INTO users (id, tenant_id, username, password_hash, display_name, role, status) VALUES (?,?,?,?,?,?,?)')
      .run(userId, tenantA, `pf-${userId.slice(0, 6)}`, 'hash', '主管', 'manager', 'active');
    productX = seedProduct(tenantA, 'PF-SKU-X', 0, 10);

    supplierGood = procurementService.createSupplier(tenantA, { name: '守时供应商' }, userId)!.id;
    supplierLate = procurementService.createSupplier(tenantA, { name: '迟到供应商' }, userId)!.id;

    // 守时：预期 2099-12-31，实际今天到 → 按期
    const poGood = procurementService.createPurchaseOrder(tenantA, {
      supplierId: supplierGood, expectedDate: '2099-12-31',
      items: [{ productId: productX, quantity: 10, unitPrice: 10 }],
    }, userId);
    procurementService.transitionPurchaseOrder(tenantA, poGood.id, 'submitted', userId);
    procurementService.transitionPurchaseOrder(tenantA, poGood.id, 'approved', userId);
    procurementService.receivePurchaseOrder(tenantA, poGood.id, [
      { itemId: poGood.items[0].id, receivedQuantity: 10, qualifiedQuantity: 10 },
    ], userId);

    // 迟到：预期 2020-01-01，今天才到 → 逾期；且 10 件到货只有 5 件合格
    const poLate = procurementService.createPurchaseOrder(tenantA, {
      supplierId: supplierLate, expectedDate: '2020-01-01',
      items: [{ productId: productX, quantity: 10, unitPrice: 10 }],
    }, userId);
    procurementService.transitionPurchaseOrder(tenantA, poLate.id, 'submitted', userId);
    procurementService.transitionPurchaseOrder(tenantA, poLate.id, 'approved', userId);
    procurementService.receivePurchaseOrder(tenantA, poLate.id, [
      { itemId: poLate.items[0].id, receivedQuantity: 10, qualifiedQuantity: 5 },
    ], userId);
  });

  afterAll(() => {
    closeDatabase();
    removeDbFiles(TEST_DB_PATH);
  });

  it('守时供应商交期达成率应为 100%，合格率 100%', () => {
    const p = procurementService.getSupplierPerformance(tenantA, supplierGood) as any;
    expect(p.onTimeRate).toBe(100);
    expect(p.completionRate).toBe(100);
    expect(p.qualifyRate).toBe(100);
    expect(p.score).toBe(100); // 100×0.4 + 100×0.3 + 100×0.3
  });

  it('迟到供应商交期 0%、合格率 50%，综合评分按公式计算', () => {
    const p = procurementService.getSupplierPerformance(tenantA, supplierLate) as any;
    expect(p.onTimeRate).toBe(0);
    expect(p.completionRate).toBe(100);
    expect(p.qualifyRate).toBe(50);
    // 0×0.4 + 100×0.3 + 50×0.3 = 45
    expect(p.score).toBe(45);
    expect(p.formula).toContain('onTimeRate×0.4');
  });

  it('绩效结果应回写供应商台账 rating', () => {
    procurementService.getSupplierPerformance(tenantA);
    const s = procurementService.getSupplier(tenantA, supplierLate);
    expect(s!.rating).toBe(45);
    expect(s!.onTimeRate).toBe(0);
  });

  it('采购总览应正确聚合状态分布与逾期单', () => {
    // 造一张逾期未完成的单
    const overduePo = procurementService.createPurchaseOrder(tenantA, {
      supplierId: supplierLate, expectedDate: '2020-06-01',
      items: [{ productId: productX, quantity: 5, unitPrice: 10 }],
    }, userId);
    procurementService.transitionPurchaseOrder(tenantA, overduePo.id, 'submitted', userId);
    procurementService.transitionPurchaseOrder(tenantA, overduePo.id, 'approved', userId);

    const ov = procurementService.getProcurementOverview(tenantA);
    expect(ov.purchaseOrders.total).toBe(3);
    expect(ov.purchaseOrders.completed).toBe(2);
    expect(ov.purchaseOrders.inProgress).toBe(1);
    expect(ov.suppliers.active).toBe(2);
    expect(ov.overdueOrders).toHaveLength(1);
    expect(ov.overdueOrders[0].poNo).toBe(overduePo.poNo);
    expect(ov.overdueOrders[0].overdueDays).toBeGreaterThan(1000);
  });
});
