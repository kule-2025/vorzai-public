/**
 * 执行监控服务（V2 · M3）
 *
 * 解决的问题：业务数据散落在采购、库存、订单、售后四个模块里，
 * 用户必须逐个页面翻找才知道「今天该干什么」。这里做一次跨域聚合，
 * 产出两样东西：
 *   1. pillars   —— 四条业务线的关键计数，用于顶部指标卡
 *   2. todo      —— 「今天要处理」清单，按紧急度排序，每条都能点回源头
 *
 * 设计约束：
 *   - 只读聚合，不产生任何副作用，不写库
 *   - 全部按 tenant_id 过滤，沙箱数据（is_sandbox = 1）一律排除
 *   - 判定阈值集中在 THRESHOLDS，口径可解释、可调整，不散落在 SQL 里
 *   - 不做任何模拟数据兜底：没有数据就是空清单，宁可空着也不骗人
 */

import { getDatabase } from '../db';

// ─────────────── 口径阈值（集中定义，便于评审与调参）───────────────

export const THRESHOLDS = {
  /** 订单确认后超过多少小时未发货算逾期 */
  shipOverdueHours: 48,
  /** 订单成交后超过多少天仍未收全款算催收 */
  paymentOverdueDays: 7,
  /** 工单创建后超过多少小时未首次响应算逾期 */
  ticketResponseOverdueHours: 24,
  /** 待办清单单类目最多返回多少条，防止一次性刷屏 */
  perSourceLimit: 20,
  /** 待办清单总条数上限 */
  totalLimit: 60,
} as const;

export type TodoSource = 'procurement' | 'inventory' | 'order' | 'ticket' | 'hr';
export type TodoSeverity = 'overdue' | 'high' | 'normal';

export interface TodoItem {
  id: string;
  source: TodoSource;
  severity: TodoSeverity;
  title: string;
  detail: string;
  /** 源单据 ID，前端据此跳回详情 */
  refId: string;
  refNo?: string;
  /** 相关金额（有则展示） */
  amount?: number;
  /** 应完成时间（到货日 / 下单时间等） */
  dueDate?: string;
  /** 逾期天数，未逾期为 0 */
  overdueDays: number;
  /** 前端路由，点击直达 */
  route: string;
}

export interface MonitorOverview {
  today: string;
  generatedAt: string;
  pillars: {
    procurement: {
      pendingApproval: number;
      inProgress: number;
      overdue: number;
      openAmount: number;
    };
    inventory: {
      openAlerts: number;
      criticalAlerts: number;
      suggestedQty: number;
    };
    orders: {
      pendingShip: number;
      unpaid: number;
      unpaidAmount: number;
      todayCount: number;
      todayAmount: number;
    };
    service: {
      openTickets: number;
      urgentTickets: number;
      noResponseTickets: number;
    };
    hr: {
      pendingOvertime: number;
      pendingLeave: number;
    };
  };
  todo: TodoItem[];
  todoSummary: {
    total: number;
    overdue: number;
    high: number;
    normal: number;
    bySource: Record<TodoSource, number>;
  };
}

// ─────────────── 工具 ───────────────

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * 计算逾期天数。
 * SQLite 里时间是 'YYYY-MM-DD' 或 'YYYY-MM-DD HH:MM:SS' 文本，
 * 后者不带时区，按 UTC 解析即可（写入时也是 datetime('now') 的 UTC）。
 */
function overdueDaysSince(dateStr: string | null | undefined): number {
  if (!dateStr) return 0;
  const normalized = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
  const t = new Date(normalized).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

function hoursSince(dateStr: string | null | undefined): number {
  if (!dateStr) return 0;
  const normalized = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
  const t = new Date(normalized).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, (Date.now() - t) / 3600000);
}

const SEVERITY_WEIGHT: Record<TodoSeverity, number> = { overdue: 0, high: 1, normal: 2 };

class MonitorService {
  /**
   * 执行监控总览。
   * 一次查询把四条业务线的计数与待办都算出来，前端只发一个请求。
   */
  getOverview(tenantId: string): MonitorOverview {
    const db = getDatabase();
    const today = todayStr();

    // ═══ 1. 采购：待审批 / 在途 / 逾期未到货 ═══
    const poStats = db
      .prepare(
        `SELECT
           SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) AS pending_approval,
           SUM(CASE WHEN status IN ('approved','receiving') THEN 1 ELSE 0 END) AS in_progress,
           COALESCE(SUM(CASE WHEN status IN ('submitted','approved','receiving')
                             THEN total_amount ELSE 0 END), 0) AS open_amount
         FROM purchase_orders
         WHERE tenant_id = ? AND COALESCE(is_sandbox, 0) = 0`
      )
      .get(tenantId) as any;

    const overduePOs = db
      .prepare(
        `SELECT id, po_no, supplier_name, expected_date, total_amount
         FROM purchase_orders
         WHERE tenant_id = ? AND COALESCE(is_sandbox, 0) = 0
           AND status IN ('approved','receiving')
           AND expected_date IS NOT NULL AND expected_date < ?
         ORDER BY expected_date ASC
         LIMIT ?`
      )
      .all(tenantId, today, THRESHOLDS.perSourceLimit) as any[];

    const pendingApprovalPOs = db
      .prepare(
        `SELECT id, po_no, supplier_name, total_amount, created_at
         FROM purchase_orders
         WHERE tenant_id = ? AND COALESCE(is_sandbox, 0) = 0 AND status = 'submitted'
         ORDER BY created_at ASC
         LIMIT ?`
      )
      .all(tenantId, THRESHOLDS.perSourceLimit) as any[];

    // ═══ 2. 库存：未处理预警 ═══
    const alertStats = db
      .prepare(
        `SELECT
           COUNT(*) AS open_alerts,
           SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) AS critical_alerts,
           COALESCE(SUM(suggested_qty), 0) AS suggested_qty
         FROM inventory_alerts
         WHERE tenant_id = ? AND status = 'open'`
      )
      .get(tenantId) as any;

    const openAlerts = db
      .prepare(
        `SELECT a.id, a.alert_type, a.severity, a.current_stock, a.suggested_qty,
                a.message, a.created_at, p.name AS product_name, p.sku
         FROM inventory_alerts a
         LEFT JOIN products p ON p.id = a.product_id
         WHERE a.tenant_id = ? AND a.status = 'open'
         ORDER BY CASE a.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
                  a.created_at ASC
         LIMIT ?`
      )
      .all(tenantId, THRESHOLDS.perSourceLimit) as any[];

    // ═══ 3. 订单：待发货 / 待收款 / 今日成交 ═══
    const orderStats = db
      .prepare(
        `SELECT
           SUM(CASE WHEN order_status IN ('pending','confirmed','processing') THEN 1 ELSE 0 END) AS pending_ship,
           SUM(CASE WHEN payment_status IN ('unpaid','partial')
                     AND order_status NOT IN ('cancelled','refunded','returned') THEN 1 ELSE 0 END) AS unpaid,
           COALESCE(SUM(CASE WHEN payment_status IN ('unpaid','partial')
                              AND order_status NOT IN ('cancelled','refunded','returned')
                             THEN total_amount - COALESCE(paid_amount, 0) ELSE 0 END), 0) AS unpaid_amount,
           SUM(CASE WHEN substr(created_at, 1, 10) = ? THEN 1 ELSE 0 END) AS today_count,
           COALESCE(SUM(CASE WHEN substr(created_at, 1, 10) = ? THEN total_amount ELSE 0 END), 0) AS today_amount
         FROM orders
         WHERE tenant_id = ? AND COALESCE(is_sandbox, 0) = 0`
      )
      .get(today, today, tenantId) as any;

    const shipPending = db
      .prepare(
        `SELECT id, order_no, customer_name, total_amount, order_status, created_at
         FROM orders
         WHERE tenant_id = ? AND COALESCE(is_sandbox, 0) = 0
           AND order_status IN ('pending','confirmed','processing')
         ORDER BY created_at ASC
         LIMIT ?`
      )
      .all(tenantId, THRESHOLDS.perSourceLimit) as any[];

    const paymentPending = db
      .prepare(
        `SELECT id, order_no, customer_name, total_amount, paid_amount, created_at
         FROM orders
         WHERE tenant_id = ? AND COALESCE(is_sandbox, 0) = 0
           AND payment_status IN ('unpaid','partial')
           AND order_status NOT IN ('cancelled','refunded','returned')
         ORDER BY created_at ASC
         LIMIT ?`
      )
      .all(tenantId, THRESHOLDS.perSourceLimit) as any[];

    // ═══ 4. 售后：未关闭工单 ═══
    const ticketStats = db
      .prepare(
        `SELECT
           COUNT(*) AS open_tickets,
           SUM(CASE WHEN priority IN ('urgent','high') THEN 1 ELSE 0 END) AS urgent_tickets,
           SUM(CASE WHEN first_response_at IS NULL THEN 1 ELSE 0 END) AS no_response_tickets
         FROM service_tickets
         WHERE tenant_id = ? AND status IN ('open','in_progress','reopened','waiting_customer')`
      )
      .get(tenantId) as any;

    const openTickets = db
      .prepare(
        `SELECT id, ticket_no, subject, priority, category, status,
                first_response_at, created_at
         FROM service_tickets
         WHERE tenant_id = ? AND status IN ('open','reopened','in_progress')
         ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1
                                WHEN 'normal' THEN 2 ELSE 3 END,
                  created_at ASC
         LIMIT ?`
      )
      .all(tenantId, THRESHOLDS.perSourceLimit) as any[];

    // ═══ 汇总待办 ═══
    const todo: TodoItem[] = [];

    for (const po of overduePOs) {
      const days = overdueDaysSince(po.expected_date);
      todo.push({
        id: `po-overdue-${po.id}`,
        source: 'procurement',
        severity: 'overdue',
        title: `采购单 ${po.po_no} 逾期未到货`,
        detail: `供应商 ${po.supplier_name || '未指定'}，预计到货 ${po.expected_date}，已逾期 ${days} 天`,
        refId: po.id,
        refNo: po.po_no,
        amount: round2(po.total_amount),
        dueDate: po.expected_date,
        overdueDays: days,
        route: '/procurement',
      });
    }

    for (const po of pendingApprovalPOs) {
      todo.push({
        id: `po-approve-${po.id}`,
        source: 'procurement',
        severity: 'high',
        title: `采购单 ${po.po_no} 待审批`,
        detail: `供应商 ${po.supplier_name || '未指定'}，金额 ¥${round2(po.total_amount)}`,
        refId: po.id,
        refNo: po.po_no,
        amount: round2(po.total_amount),
        dueDate: po.created_at,
        overdueDays: 0,
        route: '/procurement',
      });
    }

    for (const a of openAlerts) {
      const critical = a.severity === 'critical';
      todo.push({
        id: `alert-${a.id}`,
        source: 'inventory',
        severity: critical ? 'overdue' : 'high',
        title: `库存预警：${a.product_name || a.sku || '未知商品'}`,
        detail: a.message || `当前库存 ${a.current_stock}，建议补货 ${a.suggested_qty}`,
        refId: a.id,
        refNo: a.sku || undefined,
        dueDate: a.created_at,
        overdueDays: overdueDaysSince(a.created_at),
        route: '/inventory-alerts',
      });
    }

    for (const o of shipPending) {
      const hours = hoursSince(o.created_at);
      const isOverdue = hours > THRESHOLDS.shipOverdueHours;
      todo.push({
        id: `order-ship-${o.id}`,
        source: 'order',
        severity: isOverdue ? 'overdue' : 'normal',
        title: `订单 ${o.order_no} 待发货`,
        detail: isOverdue
          ? `${o.customer_name || '客户'} · 下单已 ${Math.floor(hours)} 小时，超过 ${THRESHOLDS.shipOverdueHours} 小时时效`
          : `${o.customer_name || '客户'} · 下单 ${Math.floor(hours)} 小时`,
        refId: o.id,
        refNo: o.order_no,
        amount: round2(o.total_amount),
        dueDate: o.created_at,
        overdueDays: isOverdue ? Math.floor(hours / 24) : 0,
        route: '/orders',
      });
    }

    for (const o of paymentPending) {
      const days = overdueDaysSince(o.created_at);
      const isOverdue = days > THRESHOLDS.paymentOverdueDays;
      const outstanding = round2((o.total_amount || 0) - (o.paid_amount || 0));
      todo.push({
        id: `order-pay-${o.id}`,
        source: 'order',
        severity: isOverdue ? 'overdue' : 'high',
        title: `订单 ${o.order_no} 待收款 ¥${outstanding}`,
        detail: `${o.customer_name || '客户'} · 已下单 ${days} 天${isOverdue ? `，超过 ${THRESHOLDS.paymentOverdueDays} 天账期` : ''}`,
        refId: o.id,
        refNo: o.order_no,
        amount: outstanding,
        dueDate: o.created_at,
        overdueDays: isOverdue ? days : 0,
        route: '/orders',
      });
    }

    for (const t of openTickets) {
      const hours = hoursSince(t.created_at);
      const noResponseOverdue = !t.first_response_at && hours > THRESHOLDS.ticketResponseOverdueHours;
      const urgent = t.priority === 'urgent' || t.priority === 'high';
      todo.push({
        id: `ticket-${t.id}`,
        source: 'ticket',
        severity: noResponseOverdue ? 'overdue' : urgent ? 'high' : 'normal',
        title: `工单 ${t.ticket_no}：${t.subject}`,
        detail: noResponseOverdue
          ? `创建已 ${Math.floor(hours)} 小时仍未首次响应`
          : `优先级 ${t.priority} · 状态 ${t.status}`,
        refId: t.id,
        refNo: t.ticket_no,
        dueDate: t.created_at,
        overdueDays: noResponseOverdue ? Math.floor(hours / 24) : 0,
        route: '/service',
      });
    }

    // ── HR：调休 / 加班 待审批（V2 调休业务规则融入「今天要处理」）──
    const hrPendingOvertime = db.prepare(
      `SELECT id, employee_id, date, hours FROM overtime_records WHERE tenant_id = ? AND status = 'pending' ORDER BY date ASC LIMIT ?`
    ).all(tenantId, THRESHOLDS.perSourceLimit) as Array<{ id: string; employee_id: string; date: string; hours: number }>;
    const hrPendingLeave = db.prepare(
      `SELECT id, employee_id, total_hours, start_datetime FROM leave_applications WHERE tenant_id = ? AND status = 'pending' AND leave_type_id = 'lt_compensatory' ORDER BY submitted_at ASC LIMIT ?`
    ).all(tenantId, THRESHOLDS.perSourceLimit) as Array<{ id: string; employee_id: string; total_hours: number; start_datetime: string }>;

    for (const o of hrPendingOvertime) {
      todo.push({
        id: `ot-${o.id}`,
        source: 'hr',
        severity: 'normal',
        title: `加班申请待审批 · ${o.hours}h`,
        detail: `员工 ${o.employee_id} · ${o.date} 加班`,
        refId: o.id,
        overdueDays: 0,
        route: '/hr',
      });
    }
    for (const l of hrPendingLeave) {
      todo.push({
        id: `lv-${l.id}`,
        source: 'hr',
        severity: 'normal',
        title: `调休申请待审批 · ${l.total_hours}h`,
        detail: `员工 ${l.employee_id} · 计划 ${String(l.start_datetime || '').slice(0, 10)}`,
        refId: l.id,
        overdueDays: 0,
        route: '/hr',
      });
    }

    // 排序：先按紧急度，同紧急度按逾期天数倒序，再按到期时间正序
    todo.sort((a, b) => {
      const s = SEVERITY_WEIGHT[a.severity] - SEVERITY_WEIGHT[b.severity];
      if (s !== 0) return s;
      if (a.overdueDays !== b.overdueDays) return b.overdueDays - a.overdueDays;
      return String(a.dueDate || '').localeCompare(String(b.dueDate || ''));
    });

    const limited = todo.slice(0, THRESHOLDS.totalLimit);

    const bySource: Record<TodoSource, number> = {
      procurement: 0, inventory: 0, order: 0, ticket: 0, hr: 0,
    };
    for (const t of limited) bySource[t.source] += 1;

    return {
      today,
      generatedAt: nowIso(),
      pillars: {
        procurement: {
          pendingApproval: poStats?.pending_approval || 0,
          inProgress: poStats?.in_progress || 0,
          overdue: overduePOs.length,
          openAmount: round2(poStats?.open_amount || 0),
        },
        inventory: {
          openAlerts: alertStats?.open_alerts || 0,
          criticalAlerts: alertStats?.critical_alerts || 0,
          suggestedQty: alertStats?.suggested_qty || 0,
        },
        orders: {
          pendingShip: orderStats?.pending_ship || 0,
          unpaid: orderStats?.unpaid || 0,
          unpaidAmount: round2(orderStats?.unpaid_amount || 0),
          todayCount: orderStats?.today_count || 0,
          todayAmount: round2(orderStats?.today_amount || 0),
        },
        service: {
          openTickets: ticketStats?.open_tickets || 0,
          urgentTickets: ticketStats?.urgent_tickets || 0,
          noResponseTickets: ticketStats?.no_response_tickets || 0,
        },
        hr: {
          pendingOvertime: hrPendingOvertime.length,
          pendingLeave: hrPendingLeave.length,
        },
      },
      todo: limited,
      todoSummary: {
        total: limited.length,
        overdue: limited.filter((t) => t.severity === 'overdue').length,
        high: limited.filter((t) => t.severity === 'high').length,
        normal: limited.filter((t) => t.severity === 'normal').length,
        bySource,
      },
    };
  }

  /** 只要待办清单，供轮询刷新使用（比全量总览便宜） */
  getTodoList(tenantId: string, source?: TodoSource): TodoItem[] {
    const all = this.getOverview(tenantId).todo;
    return source ? all.filter((t) => t.source === source) : all;
  }
}

export const monitorService = new MonitorService();
export default monitorService;
