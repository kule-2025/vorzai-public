/**
 * 售后闭环 + 客户分层 单元测试 (C1/C2/C3)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
let _idx = 0; function uniq(b: string): string { return `${b}_${Date.now()}_${_idx++}`; }
import { aftersalesService } from '../src/services/aftersalesService';
import { getDatabase, initDatabase, closeDatabase } from '../src/db';
import { v4 as uuidv4 } from 'uuid';

const TEST_DB_PATH = 'data/test_vorzai_aftersales.db';

function seedTenant() { const db = getDatabase(); const id = uuidv4(); db.prepare(`INSERT INTO tenants (id,name,slug,status) VALUES (?,'test',?,'active')`).run(id, 'as-' + id.slice(0,6)); return id; }
function seedUser(tenantId: string, name?: string) { const db = getDatabase(); const id = uuidv4(); db.prepare(`INSERT INTO users (id,tenant_id,username,password_hash,display_name,email,role,status) VALUES (?,?,?,?,?,?,?,?)`).run(id, tenantId, 'u'+id.slice(0,4), 'hash', name ?? uniq('用户'), `${id.slice(0,4)}@x.com`, 'member', 'active'); return id; }
function seedProduct(tenantId: string) { const db = getDatabase(); const id = uuidv4(); db.prepare(`INSERT INTO products (id,tenant_id,name,sku,cost_price,selling_price,stock) VALUES (?,?,?,?,?,?,?)`).run(id, tenantId, uniq('商品'), 'SKU-' + id.slice(0,6), 50, 100, 100); return id; }
function seedOrder(tenantId: string, productId: string) { const db = getDatabase(); const id = uuidv4(); db.prepare(`INSERT INTO orders (id,tenant_id,order_no,customer_name,items,total_amount,paid_amount,payment_status,order_status) VALUES (?,?,?,?,?,?,?,?,?)`).run(id, tenantId, 'ORD'+Date.now(), '客户', JSON.stringify([{productId,quantity:2,unitPrice:100}]), 200, 200, 'paid', 'delivered'); return id; }

let tenantA: string, tenantB: string, userA: string;
beforeAll(() => { initDatabase(TEST_DB_PATH); tenantA = seedTenant(); tenantB = seedTenant(); userA = seedUser(tenantA, '王五'); });
afterAll(() => closeDatabase());

describe('C1 退货闭环', () => {
  it('创建退货申请', () => {
    const ret = aftersalesService.createReturn(tenantA, userA, {
      reason: '质量问题', returnItems: [{ productId: 'p1', sku: 'SKU-A', name: '测试商品', quantity: 1, unitPrice: 99 }], note: '测试退货',
    });
    expect(ret.return_no.startsWith('RET-')).toBe(true);
    expect(ret.status).toBe('pending');
    expect(ret.return_items.length).toBe(1);
    expect(ret.return_items[0].quantity).toBe(1);
  });

  it('审批通过', () => {
    const ret = aftersalesService.createReturn(tenantA, userA, {
      returnItems: [{ quantity: 2, unitPrice: 50 }],
    });
    const approved = aftersalesService.approveReturn(ret.id, tenantA, userA);
    expect(approved).not.toBeNull();
    expect(approved!.status).toBe('approved');
  });

  it('驳回', () => {
    const ret = aftersalesService.createReturn(tenantA, userA, {
      returnItems: [{ quantity: 1, unitPrice: 10 }],
    });
    const rejected = aftersalesService.rejectReturn(ret.id, tenantA, '不符合退货条件');
    expect(rejected!.status).toBe('rejected');
  });

  it('退货入库（联动 stock_transactions）', () => {
    const pId = seedProduct(tenantA);
    const oId = seedOrder(tenantA, pId);
    const ret = aftersalesService.createReturn(tenantA, userA, {
      orderId: oId, returnItems: [{ productId: pId, quantity: 2, unitPrice: 100 }],
    });
    aftersalesService.approveReturn(ret.id, tenantA, userA);
    const received = aftersalesService.receiveReturn(ret.id, tenantA, userA);
    expect(received).not.toBeNull();
    expect(received!.status).toBe('received');
    // verify stock
    const db = getDatabase();
    const product = db.prepare('SELECT stock FROM products WHERE id = ?').get(pId) as any;
    expect(product.stock).toBe(102); // 100 + 2 returned
  });

  it('退款联动（更新订单 payment_status）', () => {
    const pId = seedProduct(tenantA);
    const oId = seedOrder(tenantA, pId);
    const ret = aftersalesService.createReturn(tenantA, userA, {
      orderId: oId, returnItems: [{ productId: pId, quantity: 2, unitPrice: 100 }],
    });
    aftersalesService.approveReturn(ret.id, tenantA, userA);
    aftersalesService.receiveReturn(ret.id, tenantA, userA);
    const refunded = aftersalesService.processRefund(ret.id, tenantA);
    expect(refunded).not.toBeNull();
    expect(refunded!.status).toBe('refunded');
  });

  it('列表过滤', () => {
    const list = aftersalesService.listReturns(tenantA, { status: 'pending' });
    expect(list.every((r) => r.status === 'pending' || r.status === 'approved')).toBe(true);
  });

  it('租户隔离', () => {
    const list = aftersalesService.listReturns(tenantB);
    expect(list.length).toBe(0);
  });
});

describe('C2 客户标签', () => {
  it('添加标签', () => {
    const tag = aftersalesService.addTag(tenantA, { customerId: 'cust-001', customerName: 'VIP客户', tag: 'high_value', category: 'value', score: 95 });
    expect(tag.tag).toBe('high_value');
    expect(tag.category).toBe('value');
  });

  it('查询标签', () => {
    aftersalesService.addTag(tenantA, { customerId: 'cust-002', customerName: '流失风险', tag: 'churn_risk', category: 'risk' });
    const tags = aftersalesService.listTags(tenantA, 'cust-002');
    expect(tags.length).toBe(1);
    expect(tags[0].tag).toBe('churn_risk');
  });

  it('删除标签', () => {
    const tag = aftersalesService.addTag(tenantA, { customerId: 'cust-003', tag: 'test_delete' });
    expect(aftersalesService.removeTag(tag.id, tenantA)).toBe(true);
    expect(aftersalesService.listTags(tenantA, 'cust-003').filter((t) => t.tag === 'test_delete').length).toBe(0);
  });

  it('客户分层', () => {
    const segments = aftersalesService.getCustomerSegments(tenantA);
    expect(segments.length).toBeGreaterThan(0);
    expect(segments[0]).toHaveProperty('tag');
    expect(segments[0]).toHaveProperty('count');
  });
});

describe('C3 转化断点', () => {
  it('漏斗分析（无数据时也正常返回）', () => {
    const r = aftersalesService.analyzeConversion(tenantA, '2024-01-01', '2024-01-31');
    expect(r.funnel.length).toBe(6);
    expect(r.funnel[0].stage).toBe('创建订单');
    expect(Array.isArray(r.breakpoints)).toBe(true);
    expect(typeof r.overallConversion).toBe('number');
  });
});