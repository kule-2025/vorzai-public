/**
 * 执行监控服务测试（V2 · M3）
 *
 * 覆盖：
 *   指标口径：采购 / 库存 / 订单 / 售后 四条线的计数与金额是否准确
 *   待办生成：逾期采购、待审采购、库存预警、待发货、待收款、未响应工单
 *   排序规则：overdue 优先，同级按逾期天数倒序
 *   边界：沙箱数据剔除、已取消订单不催收、已响应工单不算逾期
 *   多租户：跨租户数据完全不可见
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDatabase, closeDatabase, getDatabase } from '../src/db';
import { monitorService, THRESHOLDS } from '../src/services/monitorService';
import { v4 as uuidv4 } from 'uuid';
import { removeDbFiles } from './test-helpers';

const TEST_DB_PATH = process.env.VORZAI_TEST_DB_MONITOR || 'data/test_vorzai_monitor.db';

let tenantA: string;
let tenantB: string;

// ─────────────── 种子工具 ───────────────

function seedTenant(name: string): string {
  const db = getDatabase();
  const id = uuidv4();
  db.prepare('INSERT INTO tenants (id, name, slug, status) VALUES (?, ?, ?, ?)')
    .run(id, name, `${name}-${id.slice(0, 8)}`, 'active');
  return id;
}

/** 相对当前时间偏移若干天，返回 'YYYY-MM-DD HH:MM:SS'（与 SQLite datetime('now') 同格式，UTC） */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 19).replace('T', ' ');
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3600000).toISOString().slice(0, 19).replace('T', ' ');
}

/** 相对今天偏移若干天，返回 'YYYY-MM-DD' */
function dateOffset(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

function seedPurchaseOrder(
  tenantId: string,
  poNo: string,
  status: string,
  opts: { expectedDate?: string | null; amount?: number; sandbox?: boolean } = {}
): string {
  const db = getDatabase();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO purchase_orders
       (id, tenant_id, po_no, supplier_name, status, total_amount, expected_date, is_sandbox)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, tenantId, poNo, '测试供应商', status,
    opts.amount ?? 1000, opts.expectedDate ?? null, opts.sandbox ? 1 : 0
  );
  return id;
}

function seedProduct(tenantId: string, sku: string, name: string): string {
  const db = getDatabase();
  const id = uuidv4();
  db.prepare('INSERT INTO products (id, tenant_id, sku, name, stock) VALUES (?, ?, ?, ?, ?)')
    .run(id, tenantId, sku, name, 5);
  return id;
}

function seedAlert(
  tenantId: string,
  productId: string,
  severity: string,
  status = 'open',
  suggestedQty = 30
): string {
  const db = getDatabase();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO inventory_alerts
       (id, tenant_id, product_id, alert_type, severity, current_stock, suggested_qty, message, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, tenantId, productId, 'low_stock', severity, 5, suggestedQty, '库存偏低', status);
  return id;
}

function seedOrder(
  tenantId: string,
  orderNo: string,
  opts: {
    orderStatus?: string;
    paymentStatus?: string;
    total?: number;
    paid?: number;
    createdAt?: string;
    sandbox?: boolean;
  } = {}
): string {
  const db = getDatabase();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO orders
       (id, tenant_id, order_no, customer_name, total_amount, paid_amount,
        payment_status, order_status, is_sandbox, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, tenantId, orderNo, '测试客户',
    opts.total ?? 500, opts.paid ?? 0,
    opts.paymentStatus ?? 'unpaid', opts.orderStatus ?? 'pending',
    opts.sandbox ? 1 : 0, opts.createdAt ?? daysAgo(0)
  );
  return id;
}

function seedTicket(
  tenantId: string,
  ticketNo: string,
  opts: {
    priority?: string;
    status?: string;
    firstResponseAt?: string | null;
    createdAt?: string;
  } = {}
): string {
  const db = getDatabase();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO service_tickets
       (id, tenant_id, ticket_no, subject, priority, status, first_response_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, tenantId, ticketNo, '测试工单',
    opts.priority ?? 'normal', opts.status ?? 'open',
    opts.firstResponseAt ?? null, opts.createdAt ?? daysAgo(0)
  );
  return id;
}

function findTodo(todo: any[], predicate: (t: any) => boolean) {
  return todo.find(predicate);
}

// ════════════════════════════════════════════════════════════

describe('执行监控 · 指标聚合与今日待办', () => {
  beforeAll(() => {
    removeDbFiles(TEST_DB_PATH);
    initDatabase(TEST_DB_PATH);
    tenantA = seedTenant('监控租户A');
    tenantB = seedTenant('监控租户B');

    // ── 采购：1 张逾期、1 张待审、1 张在途未逾期、1 张沙箱逾期（应被剔除）
    seedPurchaseOrder(tenantA, 'PO-OVERDUE', 'approved', { expectedDate: dateOffset(-5), amount: 2000 });
    seedPurchaseOrder(tenantA, 'PO-SUBMIT', 'submitted', { amount: 800 });
    seedPurchaseOrder(tenantA, 'PO-ONTIME', 'receiving', { expectedDate: dateOffset(3), amount: 1200 });
    seedPurchaseOrder(tenantA, 'PO-SANDBOX', 'approved', { expectedDate: dateOffset(-9), amount: 9999, sandbox: true });

    // ── 库存：1 条 critical、1 条 warning、1 条已处理（不应出现）
    const p1 = seedProduct(tenantA, 'SKU-A', '爆款保温杯');
    const p2 = seedProduct(tenantA, 'SKU-B', '常规маска');
    const p3 = seedProduct(tenantA, 'SKU-C', '已处理商品');
    seedAlert(tenantA, p1, 'critical', 'open', 100);
    seedAlert(tenantA, p2, 'warning', 'open', 20);
    seedAlert(tenantA, p3, 'critical', 'resolved', 50);

    // ── 订单
    // 超时未发货（72 小时前）
    seedOrder(tenantA, 'SO-SHIP-LATE', {
      orderStatus: 'confirmed', paymentStatus: 'paid', total: 300, paid: 300, createdAt: hoursAgo(72),
    });
    // 刚下单未发货（2 小时前，不算逾期）
    seedOrder(tenantA, 'SO-SHIP-FRESH', {
      orderStatus: 'pending', paymentStatus: 'paid', total: 200, paid: 200, createdAt: hoursAgo(2),
    });
    // 欠款超账期（10 天前，部分付款）
    seedOrder(tenantA, 'SO-PAY-LATE', {
      orderStatus: 'completed', paymentStatus: 'partial', total: 1000, paid: 400, createdAt: daysAgo(10),
    });
    // 已取消且未付款 —— 不应进入催收
    seedOrder(tenantA, 'SO-CANCELLED', {
      orderStatus: 'cancelled', paymentStatus: 'unpaid', total: 5000, paid: 0, createdAt: daysAgo(20),
    });
    // 沙箱订单 —— 不计入
    seedOrder(tenantA, 'SO-SANDBOX', {
      orderStatus: 'pending', paymentStatus: 'unpaid', total: 8888, paid: 0, createdAt: daysAgo(30), sandbox: true,
    });

    // ── 工单：1 条超 24h 未响应、1 条已响应的高优、1 条已关闭
    seedTicket(tenantA, 'TK-NORESP', { priority: 'normal', status: 'open', createdAt: hoursAgo(48) });
    seedTicket(tenantA, 'TK-URGENT', { priority: 'urgent', status: 'in_progress', firstResponseAt: hoursAgo(1), createdAt: hoursAgo(3) });
    seedTicket(tenantA, 'TK-CLOSED', { priority: 'urgent', status: 'closed', createdAt: hoursAgo(100) });

    // ── 他租户噪声数据
    seedPurchaseOrder(tenantB, 'PO-OTHER', 'approved', { expectedDate: dateOffset(-30), amount: 77777 });
    seedOrder(tenantB, 'SO-OTHER', { orderStatus: 'pending', paymentStatus: 'unpaid', total: 66666 });
  });

  afterAll(() => {
    closeDatabase();
    removeDbFiles(TEST_DB_PATH);
  });

  // ─────────────── 采购口径 ───────────────

  it('采购指标：待审批 / 在途 / 逾期计数正确，沙箱单被剔除', () => {
    const { pillars } = monitorService.getOverview(tenantA);
    expect(pillars.procurement.pendingApproval).toBe(1);
    // approved + receiving，沙箱那张不算 → PO-OVERDUE + PO-ONTIME = 2
    expect(pillars.procurement.inProgress).toBe(2);
    // 逾期只有 PO-OVERDUE，沙箱的 PO-SANDBOX 虽然逾期 9 天也不计
    expect(pillars.procurement.overdue).toBe(1);
  });

  it('采购在途金额只累计未完结单据，不含沙箱', () => {
    const { pillars } = monitorService.getOverview(tenantA);
    // submitted 800 + approved 2000 + receiving 1200 = 4000
    expect(pillars.procurement.openAmount).toBe(4000);
  });

  it('逾期采购单生成 overdue 级待办，并带出逾期天数', () => {
    const { todo } = monitorService.getOverview(tenantA);
    const item = findTodo(todo, (t) => t.refNo === 'PO-OVERDUE');
    expect(item).toBeTruthy();
    expect(item.severity).toBe('overdue');
    expect(item.source).toBe('procurement');
    expect(item.overdueDays).toBeGreaterThanOrEqual(4);
    expect(item.route).toBe('/procurement');
  });

  it('待审批采购单生成 high 级待办，不标记逾期', () => {
    const { todo } = monitorService.getOverview(tenantA);
    const item = findTodo(todo, (t) => t.refNo === 'PO-SUBMIT');
    expect(item).toBeTruthy();
    expect(item.severity).toBe('high');
    expect(item.overdueDays).toBe(0);
  });

  it('未到期的在途采购单不产生待办', () => {
    const { todo } = monitorService.getOverview(tenantA);
    expect(findTodo(todo, (t) => t.refNo === 'PO-ONTIME')).toBeUndefined();
  });

  // ─────────────── 库存口径 ───────────────

  it('库存指标只统计 open 状态预警', () => {
    const { pillars } = monitorService.getOverview(tenantA);
    expect(pillars.inventory.openAlerts).toBe(2);
    expect(pillars.inventory.criticalAlerts).toBe(1);
    // 100 + 20，已 resolved 的 50 不计
    expect(pillars.inventory.suggestedQty).toBe(120);
  });

  it('critical 预警按 overdue 处理，warning 按 high', () => {
    const { todo } = monitorService.getOverview(tenantA);
    const critical = findTodo(todo, (t) => t.source === 'inventory' && t.refNo === 'SKU-A');
    const warning = findTodo(todo, (t) => t.source === 'inventory' && t.refNo === 'SKU-B');
    expect(critical?.severity).toBe('overdue');
    expect(warning?.severity).toBe('high');
  });

  it('已处理的预警不进入待办', () => {
    const { todo } = monitorService.getOverview(tenantA);
    expect(findTodo(todo, (t) => t.refNo === 'SKU-C')).toBeUndefined();
  });

  // ─────────────── 订单口径 ───────────────

  it('待发货计数覆盖 pending/confirmed/processing，排除沙箱', () => {
    const { pillars } = monitorService.getOverview(tenantA);
    // SO-SHIP-LATE(confirmed) + SO-SHIP-FRESH(pending)，沙箱那张不算
    expect(pillars.orders.pendingShip).toBe(2);
  });

  it('待收款金额按 total − paid 计算，已取消订单不计入', () => {
    const { pillars } = monitorService.getOverview(tenantA);
    // 仅 SO-PAY-LATE：1000 − 400 = 600；SO-CANCELLED 与沙箱单被排除
    expect(pillars.orders.unpaid).toBe(1);
    expect(pillars.orders.unpaidAmount).toBe(600);
  });

  it('超过发货时效的订单标记 overdue，新单只是 normal', () => {
    const { todo } = monitorService.getOverview(tenantA);
    const late = findTodo(todo, (t) => t.id.startsWith('order-ship-') && t.refNo === 'SO-SHIP-LATE');
    const fresh = findTodo(todo, (t) => t.id.startsWith('order-ship-') && t.refNo === 'SO-SHIP-FRESH');
    expect(late?.severity).toBe('overdue');
    expect(fresh?.severity).toBe('normal');
  });

  it('超账期欠款标记 overdue 并带出未收金额', () => {
    const { todo } = monitorService.getOverview(tenantA);
    const item = findTodo(todo, (t) => t.id.startsWith('order-pay-') && t.refNo === 'SO-PAY-LATE');
    expect(item).toBeTruthy();
    expect(item.severity).toBe('overdue');
    expect(item.amount).toBe(600);
    expect(item.overdueDays).toBeGreaterThanOrEqual(THRESHOLDS.paymentOverdueDays);
  });

  it('已取消订单既不催收也不催发货', () => {
    const { todo } = monitorService.getOverview(tenantA);
    expect(findTodo(todo, (t) => t.refNo === 'SO-CANCELLED')).toBeUndefined();
  });

  it('沙箱订单完全不出现在待办里', () => {
    const { todo } = monitorService.getOverview(tenantA);
    expect(findTodo(todo, (t) => t.refNo === 'SO-SANDBOX')).toBeUndefined();
  });

  // ─────────────── 售后口径 ───────────────

  it('工单指标只统计未关闭工单', () => {
    const { pillars } = monitorService.getOverview(tenantA);
    // TK-NORESP(open) + TK-URGENT(in_progress)，TK-CLOSED 不算
    expect(pillars.service.openTickets).toBe(2);
    expect(pillars.service.urgentTickets).toBe(1);
    expect(pillars.service.noResponseTickets).toBe(1);
  });

  it('超时未首次响应的工单升级为 overdue', () => {
    const { todo } = monitorService.getOverview(tenantA);
    const item = findTodo(todo, (t) => t.refNo === 'TK-NORESP');
    expect(item?.severity).toBe('overdue');
  });

  it('已响应的紧急工单是 high 而非 overdue', () => {
    const { todo } = monitorService.getOverview(tenantA);
    const item = findTodo(todo, (t) => t.refNo === 'TK-URGENT');
    expect(item?.severity).toBe('high');
  });

  it('已关闭工单不进入待办', () => {
    const { todo } = monitorService.getOverview(tenantA);
    expect(findTodo(todo, (t) => t.refNo === 'TK-CLOSED')).toBeUndefined();
  });

  // ─────────────── 排序与汇总 ───────────────

  it('待办按 overdue → high → normal 排序', () => {
    const { todo } = monitorService.getOverview(tenantA);
    const weight = { overdue: 0, high: 1, normal: 2 } as Record<string, number>;
    for (let i = 1; i < todo.length; i++) {
      expect(weight[todo[i].severity]).toBeGreaterThanOrEqual(weight[todo[i - 1].severity]);
    }
  });

  it('同级待办按逾期天数倒序', () => {
    const { todo } = monitorService.getOverview(tenantA);
    const overdue = todo.filter((t) => t.severity === 'overdue');
    for (let i = 1; i < overdue.length; i++) {
      expect(overdue[i].overdueDays).toBeLessThanOrEqual(overdue[i - 1].overdueDays);
    }
  });

  it('汇总数与清单实际条目一致', () => {
    const { todo, todoSummary } = monitorService.getOverview(tenantA);
    expect(todoSummary.total).toBe(todo.length);
    expect(todoSummary.overdue + todoSummary.high + todoSummary.normal).toBe(todo.length);
    const sourceSum = Object.values(todoSummary.bySource).reduce((a, b) => a + b, 0);
    expect(sourceSum).toBe(todo.length);
  });

  it('待办 id 全局唯一，前端渲染不会撞 key', () => {
    const { todo } = monitorService.getOverview(tenantA);
    expect(new Set(todo.map((t) => t.id)).size).toBe(todo.length);
  });

  // ─────────────── 过滤与隔离 ───────────────

  it('getTodoList 支持按来源过滤', () => {
    const only = monitorService.getTodoList(tenantA, 'inventory');
    expect(only.length).toBe(2);
    expect(only.every((t) => t.source === 'inventory')).toBe(true);
  });

  it('租户隔离：看不到他租户的任何单据', () => {
    const { todo, pillars } = monitorService.getOverview(tenantB);
    expect(findTodo(todo, (t) => t.refNo === 'PO-OVERDUE')).toBeUndefined();
    expect(findTodo(todo, (t) => t.refNo === 'SO-PAY-LATE')).toBeUndefined();
    // B 自己的数据仍然可见
    expect(findTodo(todo, (t) => t.refNo === 'PO-OTHER')).toBeTruthy();
    expect(pillars.inventory.openAlerts).toBe(0);
  });

  it('空租户返回结构完整的空结果，而不是抛错', () => {
    const empty = seedTenant('监控空租户');
    const result = monitorService.getOverview(empty);
    expect(result.todo).toEqual([]);
    expect(result.todoSummary.total).toBe(0);
    expect(result.pillars.procurement.pendingApproval).toBe(0);
    expect(result.pillars.orders.todayAmount).toBe(0);
    expect(result.generatedAt).toBeTruthy();
  });
});
