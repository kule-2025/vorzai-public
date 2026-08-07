/**
 * Vorzai 库存预警 + 业务-HR 归因 API Client
 * 与后端 /api/inventory 对接（归因端点挂在 /api/inventory/attribution/*）
 */

import api from './client';

// ─────────────── 类型定义（与后端 inventoryService 保持一致）───────────────

export type RuleScope = 'all' | 'category' | 'product';
export type RuleType = 'low_stock' | 'out_of_stock' | 'overstock' | 'slow_moving' | 'stockout_eta';
export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertStatus = 'open' | 'acknowledged' | 'resolved' | 'ignored';

export interface InventoryAlertRule {
  id: string;
  tenantId: string;
  name: string;
  scope: RuleScope;
  scopeValue: string | null;
  ruleType: RuleType;
  threshold: number;
  windowDays: number;
  severity: AlertSeverity;
  notifyChannels: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RuleInput {
  name: string;
  scope?: RuleScope;
  scopeValue?: string | null;
  ruleType: RuleType;
  threshold: number;
  windowDays?: number;
  severity?: AlertSeverity;
  notifyChannels?: string[];
  enabled?: boolean;
}

export interface InventoryAlert {
  id: string;
  tenantId: string;
  ruleId: string | null;
  ruleName: string | null;
  productId: string;
  productSku: string | null;
  productName: string | null;
  productCategory: string | null;
  alertType: RuleType | string;
  severity: AlertSeverity;
  currentStock: number;
  threshold: number;
  dailySalesAvg: number;
  daysOfSupply: number | null;
  suggestedQty: number;
  message: string;
  status: AlertStatus;
  acknowledgedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface AlertListResult {
  items: InventoryAlert[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface AlertStats {
  total: number;
  bySeverity: { critical: number; warning: number; info: number };
  byStatus: { open: number; acknowledged: number; resolved: number; ignored: number };
  pending: number;
  restockSkuCount: number;
  suggestedQtyTotal: number;
}

export interface EvaluateResult {
  evaluatedAt: string;
  ruleCount: number;
  productCount: number;
  created: number;
  updated: number;
  autoResolved: number;
  bySeverity: { critical: number; warning: number; info: number };
}

export interface AttributionRow {
  id: string;
  employeeId: string;
  employeeName: string;
  sourceType: string;
  sourceId: string;
  period: string;
  roleInSource: string | null;
  attributionRatio: number;
  gmv: number;
  grossProfit: number;
  orderCount: number;
  ticketCount: number;
  computedAt: string;
}

export interface ComputeAttributionResult {
  period: string;
  orderRows: number;
  ticketRows: number;
  skippedOrders: number;
  skippedTickets: number;
  employeeCount: number;
  totalGmv: number;
  totalGrossProfit: number;
  computedAt: string;
}

export interface EmployeeAttribution {
  employeeId: string;
  employeeName: string;
  employeeNo: string;
  departmentName: string | null;
  position: string | null;
  period: string;
  gmv: number;
  grossProfit: number;
  orderCount: number;
  ticketCount: number;
  details: AttributionRow[];
}

export interface RankingItem {
  rank: number;
  employeeId: string;
  employeeName: string;
  employeeNo: string;
  departmentName: string | null;
  position: string | null;
  gmv: number;
  grossProfit: number;
  orderCount: number;
  ticketCount: number;
  marginRate: number;
}

export interface EfficiencySummary {
  period: string;
  totalGmv: number;
  totalGrossProfit: number;
  totalOrderCount: number;
  totalTicketCount: number;
  headcount: number;
  contributorCount: number;
  gmvPerCapita: number;
  grossProfitPerCapita: number;
  orderPerCapita: number;
  top3: RankingItem[];
  bottom3: RankingItem[];
}

export interface AlertQuery {
  status?: AlertStatus;
  severity?: AlertSeverity;
  productId?: string;
  alertType?: RuleType;
  page?: number;
  limit?: number;
}

// ─────────────── 工具 ───────────────

/** 解包 ApiResponse.data，失败时抛出 error */
function unwrap<T>(
  resp: { success: boolean; data?: T; error?: { code: string; message: string } }
): T {
  if (!resp.success) {
    throw new Error(resp.error?.message || '请求失败');
  }
  return resp.data as T;
}

/** 把查询对象拼成 query string（自动跳过空值） */
function toQuery(params: Record<string, string | number | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

// ─────────────── API ───────────────

export const inventoryApi = {
  // ===== 规则 =====

  /** 规则列表（后端首次访问会自动补齐默认规则） */
  listRules: async (): Promise<InventoryAlertRule[]> =>
    unwrap<InventoryAlertRule[]>(await api.call<InventoryAlertRule[]>('GET', '/inventory/rules')),

  /** 新建规则 */
  createRule: async (input: RuleInput): Promise<InventoryAlertRule> =>
    unwrap<InventoryAlertRule>(await api.call<InventoryAlertRule>('POST', '/inventory/rules', input)),

  /** 更新规则 */
  updateRule: async (id: string, input: Partial<RuleInput>): Promise<InventoryAlertRule> =>
    unwrap<InventoryAlertRule>(await api.call<InventoryAlertRule>('PUT', `/inventory/rules/${id}`, input)),

  /** 删除规则 */
  deleteRule: async (id: string): Promise<{ id: string }> =>
    unwrap<{ id: string }>(await api.call<{ id: string }>('DELETE', `/inventory/rules/${id}`)),

  /** 启停规则；不传 enabled 时后端取反 */
  toggleRule: async (id: string, enabled?: boolean): Promise<InventoryAlertRule> =>
    unwrap<InventoryAlertRule>(
      await api.call<InventoryAlertRule>('POST', `/inventory/rules/${id}/toggle`, { enabled })
    ),

  // ===== 评估与告警 =====

  /** 立即执行一次规则评估 */
  evaluate: async (): Promise<EvaluateResult> =>
    unwrap<EvaluateResult>(await api.call<EvaluateResult>('POST', '/inventory/evaluate', {})),

  /** 告警列表 */
  listAlerts: async (query: AlertQuery = {}): Promise<AlertListResult> =>
    unwrap<AlertListResult>(
      await api.call<AlertListResult>('GET', `/inventory/alerts${toQuery({
        status: query.status,
        severity: query.severity,
        productId: query.productId,
        alertType: query.alertType,
        page: query.page,
        limit: query.limit,
      })}`)
    ),

  /** 告警统计 */
  getAlertStats: async (): Promise<AlertStats> =>
    unwrap<AlertStats>(await api.call<AlertStats>('GET', '/inventory/alerts/stats')),

  /** 确认告警 */
  acknowledgeAlert: async (id: string): Promise<InventoryAlert> =>
    unwrap<InventoryAlert>(await api.call<InventoryAlert>('POST', `/inventory/alerts/${id}/acknowledge`, {})),

  /** 解决告警 */
  resolveAlert: async (id: string): Promise<InventoryAlert> =>
    unwrap<InventoryAlert>(await api.call<InventoryAlert>('POST', `/inventory/alerts/${id}/resolve`, {})),

  /** 忽略告警 */
  ignoreAlert: async (id: string): Promise<InventoryAlert> =>
    unwrap<InventoryAlert>(await api.call<InventoryAlert>('POST', `/inventory/alerts/${id}/ignore`, {})),

  // ===== 业务-HR 归因 =====

  /** 触发归因计算，period 形如 2026-07，不传取当前月 */
  computeAttribution: async (period?: string): Promise<ComputeAttributionResult> =>
    unwrap<ComputeAttributionResult>(
      await api.call<ComputeAttributionResult>('POST', '/inventory/attribution/compute', { period })
    ),

  /** 员工 GMV / 毛利排行榜 */
  getRanking: async (period?: string, limit = 10): Promise<RankingItem[]> =>
    unwrap<RankingItem[]>(
      await api.call<RankingItem[]>('GET', `/inventory/attribution/ranking${toQuery({ period, limit })}`)
    ),

  /** 人效汇总 */
  getEfficiency: async (period?: string): Promise<EfficiencySummary> =>
    unwrap<EfficiencySummary>(
      await api.call<EfficiencySummary>('GET', `/inventory/attribution/efficiency${toQuery({ period })}`)
    ),

  /** 单员工归因明细 */
  getEmployeeAttribution: async (employeeId: string, period?: string): Promise<EmployeeAttribution> =>
    unwrap<EmployeeAttribution>(
      await api.call<EmployeeAttribution>(
        'GET',
        `/inventory/attribution/employee/${employeeId}${toQuery({ period })}`
      )
    ),
};

export default inventoryApi;
