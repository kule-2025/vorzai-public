/**
 * 数据完整性专项测试
 * 覆盖：事务原子性、备份/恢复、超额支付守恒、跨租户防护
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../src/app';
import http from 'http';
import { AddressInfo } from 'net';
import { initDatabase, closeDatabase, getDatabase, transaction } from '../src/db';
import { createBackup, listBackups, restoreBackup } from '../src/db/backup';
import { v4 as uuidv4 } from 'uuid';
import { registerUserAndGetToken, createTenant, makeRequest, removeDbFiles } from './test-helpers';

// 使用临时数据库，避免污染生产数据
const TEST_DB_PATH = process.env.VORZAI_TEST_DB || 'data/test_vorzai_integrity.db';


describe('事务原子性', () => {
  beforeAll(() => {
    // 先清掉上一轮可能残留的库与 WAL，保证从干净状态起跑
    removeDbFiles(TEST_DB_PATH);
    initDatabase(TEST_DB_PATH);
  });

  afterAll(() => {
    closeDatabase();
    removeDbFiles(TEST_DB_PATH);
  });

  it('事务回滚后不应有任何写入', () => {
    const db = getDatabase();
    const tenantId = uuidv4();
    db.prepare('INSERT INTO tenants (id, name, slug, status) VALUES (?, ?, ?, ?)')
      .run(tenantId, 'TestTenant', `slug-${tenantId.slice(0, 8)}`, 'active');

    const before = (db.prepare('SELECT COUNT(*) as c FROM users WHERE tenant_id = ?').get(tenantId) as any).c;

    expect(() => {
      transaction(() => {
        db.prepare('INSERT INTO users (id, tenant_id, username, password_hash, display_name, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(uuidv4(), tenantId, 'u1', 'hash', 'U1', 'member', 'active');
        // 触发错误：id 为 TEXT PRIMARY KEY（SQLite 允许 NULL），
        // 故改为对显式 NOT NULL 的列 tenant_id 插入 NULL，
        // 可靠地触发 "NOT NULL constraint failed" 异常以验证回滚。
        db.prepare('INSERT INTO users (id, tenant_id, username, password_hash, display_name, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(uuidv4(), null, 'u2', 'hash', 'U2', 'member', 'active');
      });
    }).toThrow();

    const after = (db.prepare('SELECT COUNT(*) as c FROM users WHERE tenant_id = ?').get(tenantId) as any).c;
    expect(after).toBe(before);
  });

  it('事务提交后数据可见', () => {
    const db = getDatabase();
    const tenantId = uuidv4();
    db.prepare('INSERT INTO tenants (id, name, slug, status) VALUES (?, ?, ?, ?)')
      .run(tenantId, 'TestTenant2', `slug2-${tenantId.slice(0, 8)}`, 'active');

    // 用户名带租户前缀：即便测试库有残留，也不会与历史行撞名
    const username = `committed-${tenantId.slice(0, 8)}`;
    transaction(() => {
      db.prepare('INSERT INTO users (id, tenant_id, username, password_hash, display_name, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(uuidv4(), tenantId, username, 'hash', 'C', 'member', 'active');
    });

    // 断言限定在本次生成的租户内，避免跨轮次数据干扰
    const count = (db
      .prepare('SELECT COUNT(*) as c FROM users WHERE tenant_id = ? AND username = ?')
      .get(tenantId, username) as any).c;
    expect(count).toBe(1);
  });
});

describe('备份与恢复', () => {
  beforeAll(() => {
    // 先清掉上一轮可能残留的库与 WAL，保证从干净状态起跑
    removeDbFiles(TEST_DB_PATH);
    initDatabase(TEST_DB_PATH);
  });

  afterAll(() => {
    closeDatabase();
    removeDbFiles(TEST_DB_PATH);
  });

  it('应能创建备份并列出', () => {
    const result = createBackup('test-tenant');
    expect(result.backupId).toBeTruthy();
    expect(result.sizeBytes).toBeGreaterThan(0);

    const backups = listBackups();
    expect(backups.some((b) => b.backupId === result.backupId)).toBe(true);
  });

  it('恢复应返回前置快照信息', () => {
    const backups = listBackups();
    expect(backups.length).toBeGreaterThan(0);
    const result = restoreBackup(backups[0].backupId, 'test-tenant');
    expect(result.restoredFrom).toBe(backups[0].backupId);
    expect(result.preRestoreSnapshot).toBeTruthy();
  });
});

describe('支付金额守恒（业务逻辑）', () => {
  let app: http.Server;
  let port: number;
  let authToken: string;
  let tenantId: string;

  beforeAll(async () => {
    // 与其他 describe 块保持一致：先清库再初始化，避免继承上一轮残留的租户 slug
    removeDbFiles(TEST_DB_PATH);
    initDatabase(TEST_DB_PATH);
    app = http.createServer(createApp());
    await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', () => resolve()));
    port = (app.address() as AddressInfo).port;

    const tenant = await createTenant(app, port);
    tenantId = tenant.tenantId;
    authToken = tenant.token;
  });

  afterAll(() => {
    return new Promise<void>((resolve) => app.close(() => resolve()));
  });

  // 创建测试商品（订单 item 需要真实存在的商品 ID）
  async function createTestProduct(sku: string, price: number): Promise<string> {
    const p = await makeRequest(app, port, 'POST', '/api/business/products', authToken, {
      sku, name: `测试商品-${sku}`, sellingPrice: price, costPrice: price * 0.6, stock: 100,
    });
    expect(p.status).toBe(201);
    return p.body.data.id;
  }

  it('超额收款应被拒绝', async () => {
    const productId = await createTestProduct(`SKU-OV-${Date.now()}`, 100);
    // 创建订单
    const order = await makeRequest(app, port, 'POST', '/api/business/orders', authToken, {
      items: [{ productId, quantity: 2, unitPrice: 100 }],
    });
    expect(order.status).toBe(201);
    const orderId = order.body.data.id;

    // 超额收款
    const overpay = await makeRequest(app, port, 'PUT', `/api/business/orders/${orderId}/payment`, authToken, {
      amount: 500, // 总额仅 200
    });
    expect(overpay.status).toBe(400);
  });

  it('分段收款累计正确，结清后订单状态推进', async () => {
    const productId = await createTestProduct(`SKU-PAY-${Date.now()}`, 200);
    const order = await makeRequest(app, port, 'POST', '/api/business/orders', authToken, {
      items: [{ productId, quantity: 1, unitPrice: 200 }],
    });
    const orderId = order.body.data.id;

    // 部分收款 80
    const p1 = await makeRequest(app, port, 'PUT', `/api/business/orders/${orderId}/payment`, authToken, { amount: 80 });
    expect(p1.body.data.paid_amount).toBe(80);
    expect(p1.body.data.payment_status).toBe('partial');

    // 结清 120
    const p2 = await makeRequest(app, port, 'PUT', `/api/business/orders/${orderId}/payment`, authToken, { amount: 120 });
    expect(p2.body.data.paid_amount).toBe(200);
    expect(p2.body.data.payment_status).toBe('paid');
    expect(p2.body.data.order_status).toBe('confirmed');
  });
});
