/**
 * Vorzai 执行监控 API Client
 * 对接后端 /api/monitor/*（V2 · M3 执行监控面板 v1）
 *
 * 口径严格对齐后端 monitorService：前端只消费聚合结果，不做任何二次换算、
 * 不写任何 Mock。四线指标（采购 / 库存 / 订单 / 售后）与「今日要处理」清单
 * 均来自一次 /monitor/overview 请求。
 */

import api from './client';

// ─────────────── 类型定义（与后端 monitorService 严格一致）───────────────

export type TodoSource = 'procurement' | 'inventory' | 'order' | 'ticket';
export type TodoSeverity = 'overdue' | 'high' | 'normal';

export interface TodoItem {
  id: string;
  source: TodoSource;
  severity: TodoSeverity;
  title: string;
  detail: string;
  refId: string;
  refNo?: string;
  amount?: number;
  dueDate?: string;
  overdueDays: number;
  /** 前端路由，点击直达源头页面 */
  route: string;
}

export interface MonitorPillars {
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
}

export interface MonitorTodoSummary {
  total: number;
  overdue: number;
  high: number;
  normal: number;
  bySource: Record<TodoSource, number>;
}

export interface MonitorOverview {
  today: string;
  generatedAt: string;
  pillars: MonitorPillars;
  todo: TodoItem[];
  todoSummary: MonitorTodoSummary;
}

// ─────────────── 响应解包 ───────────────

interface RawResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function unwrap<T>(resp: RawResponse<T>): T {
  if (!resp.success) throw new Error(resp.error?.message || '请求失败');
  return resp.data as T;
}

function toQuery(params: Record<string, string | number | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

// ─────────────── API ───────────────

export const monitorApi = {
  /** 执行监控总览：四线指标卡 + 今日要处理清单，一次请求拿全 */
  getOverview: async (): Promise<MonitorOverview> =>
    unwrap<MonitorOverview>(
      await api.call<MonitorOverview>('GET', '/monitor/overview')
    ),

  /** 只要待办清单，供轮询刷新（比总览轻量） */
  getTodoList: async (source?: TodoSource): Promise<TodoItem[]> =>
    unwrap<TodoItem[]>(
      await api.call<TodoItem[]>('GET', `/monitor/todo${toQuery({ source } as never)}`)
    ),
};

export default monitorApi;
