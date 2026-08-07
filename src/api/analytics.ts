/**
 * Vorzai 数据分析 API Client
 * 与 /api/analytics 后端对接，全部数据来自 analyticsService 的真实 SQL 聚合。
 *
 * 设计约定（与 dialog.ts 一致）：
 *   - 通过 api.call<T>(method, path, body?) 发请求；
 *   - unwrap 解包 ApiResponse.data，失败时抛出 error。
 */
import api from './client';

// ════════════════ 响应类型（与 server/src/services/analyticsService.ts 对齐）════════════════

export type MetricUnit = 'currency' | 'count' | 'percent';
export type CompareMode = 'none' | 'prev' | 'yoy';
export type TrendMetric =
  | 'gmv' | 'orders' | 'aov' | 'gross_profit' | 'conversion' | 'refund_rate';
export type Granularity = 'day' | 'week' | 'month';
export type BreakdownDimension =
  | 'platform' | 'category' | 'product' | 'employee'
  | 'department' | 'business_line' | 'live_session';
export type BreakdownMetric = 'gmv' | 'orders' | 'gross_profit';

export interface MetricValue {
  key: string;
  label: string;
  unit: MetricUnit;
  value: number;
  prevValue: number | null;
  changeRate: number | null;
  formula: string;
}

export interface OverviewResult {
  range: { from: string; to: string };
  compare: CompareMode;
  compareRange: { from: string; to: string } | null;
  sampleSize: number;
  metrics: MetricValue[];
  generatedAt: string;
}

export interface TrendPoint {
  bucket: string;
  label: string;
  value: number;
}

export interface TrendResult {
  metric: TrendMetric;
  granularity: Granularity;
  unit: MetricUnit;
  range: { from: string; to: string };
  formula: string;
  points: TrendPoint[];
  hasData: boolean;
}

export interface FunnelStageDetail {
  id: string;
  label: string;
  count: number;
  conversionRate: number;
  lossCount: number;
  formula: string;
}

export interface FunnelResult {
  range: { from: string; to: string };
  stages: FunnelStageDetail[];
  hasData: boolean;
}

export interface BreakdownItem {
  key: string;
  label: string;
  value: number;
  share: number;
  isOther?: boolean;
}

export interface BreakdownResult {
  dimension: BreakdownDimension;
  metric: BreakdownMetric;
  unit: MetricUnit;
  range: { from: string; to: string };
  total: number;
  items: BreakdownItem[];
  formula: string;
  available: boolean;
  reason?: string;
}

export interface ProductStatRow {
  productId: string;
  sku: string;
  name: string;
  category: string;
  quantity: number;
  gmv: number;
  cost: number;
  grossProfit: number;
  marginRate: number;
  abc: 'A' | 'B' | 'C';
  cumulativeShare: number;
}

export interface SlowMovingRow {
  productId: string;
  sku: string;
  name: string;
  stock: number;
  category: string;
  lastUpdatedAt: string;
}

export interface ProductAnalysisResult {
  range: { from: string; to: string };
  available: boolean;
  reason?: string;
  abcSummary: Array<{ tier: 'A' | 'B' | 'C'; skuCount: number; gmv: number; gmvShare: number; desc: string }>;
  rows: ProductStatRow[];
  sellThroughRate: number | null;
  soldSkuCount: number;
  totalSkuCount: number;
  slowMoving: SlowMovingRow[];
  marginTop: ProductStatRow[];
  marginBottom: ProductStatRow[];
  formulas: Record<string, string>;
}

export interface EmployeeEfficiencyRow {
  employeeId: string;
  employeeName: string;
  departmentId: string | null;
  departmentName: string;
  gmv: number;
  grossProfit: number;
  orderCount: number;
  ticketCount: number;
}

export interface DepartmentEfficiencyRow {
  departmentId: string;
  departmentName: string;
  headcount: number;
  gmv: number;
  grossProfit: number;
  gmvPerCapita: number;
  profitPerCapita: number;
}

export interface EmployeeEfficiencyResult {
  period: string;
  available: boolean;
  reason?: string;
  headcount: number;
  attributedEmployeeCount: number;
  totalGmv: number;
  totalGrossProfit: number;
  gmvPerCapita: number | null;
  profitPerCapita: number | null;
  employees: EmployeeEfficiencyRow[];
  departments: DepartmentEfficiencyRow[];
  formulas: Record<string, string>;
}

export interface CustomerTier {
  tier: string;
  desc: string;
  customerCount: number;
  totalSpend: number;
  minSpend: number;
  maxSpend: number;
}

export interface CustomerAnalysisResult {
  range: { from: string; to: string };
  available: boolean;
  reason?: string;
  identifiedCustomers: number;
  anonymousOrders: number;
  newCustomers: number;
  returningCustomers: number;
  repurchaseRate: number | null;
  repurchaseCycleMedianDays: number | null;
  repurchaseSampleSize: number;
  tiers: CustomerTier[];
  formulas: Record<string, string>;
}

export interface HealthDimension {
  key: string;
  label: string;
  score: number | null;
  rawValue: number | null;
  rawLabel: string;
  rule: string;
  diagnosis: string;
  suggestion: string;
}

export interface HealthScoreResult {
  overallScore: number | null;
  grade: string;
  evaluatedDimensions: number;
  totalDimensions: number;
  dimensions: HealthDimension[];
  generatedAt: string;
  note: string;
}

export interface ReportResult {
  range: { from: string; to: string };
  generatedAt: string;
  overview: OverviewResult;
  funnel: FunnelResult;
  products: ProductAnalysisResult;
  customers: CustomerAnalysisResult;
  employees: EmployeeEfficiencyResult;
  health: HealthScoreResult;
  topPlatforms: BreakdownResult;
  topProducts: BreakdownResult;
  conclusions: string[];
}

/** 解包 ApiResponse.data，失败时抛出 error */
function unwrap<T>(
  resp: { success: boolean; data?: T; error?: { code: string; message: string } }
): T {
  if (!resp.success) {
    throw resp.error || { code: 'UNKNOWN', message: '请求失败' };
  }
  return resp.data as T;
}

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '') sp.set(k, String(v));
  });
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// ══════════════════ API 封装 ═════════════════

export const analyticsApi = {
  /** 经营总览（含同环比）。compare: none/prev/yoy */
  getOverview: async (from: string, to: string, compare: CompareMode = 'prev'): Promise<OverviewResult> =>
    unwrap(await api.call<OverviewResult>('GET', `/analytics/overview${qs({ from, to, compare })}`)),

  /** 趋势分析。metric: gmv/orders/aov/gross_profit/conversion/refund_rate；granularity: day/week/month */
  getTrend: async (metric: TrendMetric, granularity: Granularity, from: string, to: string): Promise<TrendResult> =>
    unwrap(await api.call<TrendResult>('GET', `/analytics/trend${qs({ metric, granularity, from, to })}`)),

  /** 全链路漏斗 */
  getFunnel: async (from: string, to: string): Promise<FunnelResult> =>
    unwrap(await api.call<FunnelResult>('GET', `/analytics/funnel${qs({ from, to })}`)),

  /** 多维拆解。dimension: platform/category/product/employee/department/business_line/live_session */
  getBreakdown: async (
    dimension: BreakdownDimension, metric: BreakdownMetric, from: string, to: string, limit = 10
  ): Promise<BreakdownResult> =>
    unwrap(await api.call<BreakdownResult>('GET', `/analytics/breakdown${qs({ dimension, metric, from, to, limit })}`)),

  /** 商品分析（ABC / 动销 / 滞销 / 毛利率异常） */
  getProducts: async (from: string, to: string): Promise<ProductAnalysisResult> =>
    unwrap(await api.call<ProductAnalysisResult>('GET', `/analytics/products${qs({ from, to })}`)),

  /** 人效分析。period: YYYY 或 YYYY-MM，默认本月 */
  getEmployees: async (period?: string): Promise<EmployeeEfficiencyResult> =>
    unwrap(await api.call<EmployeeEfficiencyResult>('GET', `/analytics/employees${qs({ period })}`)),

  /** 客户分析（RFM / 复购 / 价值分层） */
  getCustomers: async (from: string, to: string): Promise<CustomerAnalysisResult> =>
    unwrap(await api.call<CustomerAnalysisResult>('GET', `/analytics/customers${qs({ from, to })}`)),

  /** 经营健康度（固定近 30 天） */
  getHealth: async (): Promise<HealthScoreResult> =>
    unwrap(await api.call<HealthScoreResult>('GET', '/analytics/health')),

  /** 结构化报告 */
  getReport: async (from: string, to: string): Promise<ReportResult> =>
    unwrap(await api.call<ReportResult>('GET', `/analytics/report${qs({ from, to })}`)),

  /** 指标快照固化（写入 analytics_snapshots 缓存表） */
  computeSnapshots: async (periodType: string, date?: string): Promise<unknown> =>
    unwrap(await api.call<unknown>('POST', '/analytics/snapshots/compute', { periodType, date })),
};

export default analyticsApi;
