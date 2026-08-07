/**
 * Vorzai 直播电商 API Client
 * 与后端 /api/livestream 对接。
 *
 * 说明：指标数据全部来自人工录入或批量导入，本模块不做任何平台实时接口调用，
 * 前端展示时必须如实标注数据来源，不得包装成「实时数据」。
 */

import api from './client';

// ─────────────── 类型定义（与服务端保持一致） ───────────────

export type LiveSessionStatus = 'planned' | 'ready' | 'living' | 'ended' | 'reviewed' | 'cancelled';
export type LiveSegmentType = 'warmup' | 'sell' | 'interact' | 'flashsale' | 'lottery' | 'closing';

export interface LiveSession {
  id: string;
  tenantId: string;
  projectId: string | null;
  title: string;
  platform: string;
  roomId: string | null;
  anchorEmployeeId: string | null;
  anchorName: string | null;
  assistantEmployeeId: string | null;
  assistantName: string | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  durationMinutes: number;
  targetGmv: number;
  actualGmv: number;
  targetOrders: number;
  actualOrders: number;
  status: LiveSessionStatus;
  coverUrl: string | null;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
  gmvAchievementRate: number;
}

export interface ComplianceFlag {
  word: string;
  category: string;
  severity: 'high' | 'medium' | 'low';
  field: 'talk_track' | 'cta_text';
  suggestion: string;
}

export interface ComplianceIssue extends ComplianceFlag {
  scriptId: string;
  segmentNo: number;
  segmentTitle: string;
  context: string;
}

export interface ComplianceReport {
  sessionId: string;
  scannedSegments: number;
  totalIssues: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  passed: boolean;
  issues: ComplianceIssue[];
  byCategory: Array<{ category: string; count: number }>;
  checkedAt: string;
}

export interface LiveScript {
  id: string;
  tenantId: string;
  sessionId: string;
  segmentNo: number;
  segmentType: LiveSegmentType;
  title: string;
  productId: string | null;
  productName: string | null;
  durationMinutes: number;
  talkTrack: string;
  sellingPoints: string[];
  objectionHandling: Array<{ objection: string; response: string }>;
  ctaText: string;
  complianceFlags: ComplianceFlag[];
  createdAt: string;
  updatedAt: string;
}

export interface LiveSessionProduct {
  id: string;
  tenantId: string;
  sessionId: string;
  productId: string;
  sku: string | null;
  productName: string | null;
  category: string | null;
  sellingPrice: number | null;
  marketPrice: number | null;
  costPrice: number | null;
  stock: number;
  sortOrder: number;
  plannedSlotStart: string | null;
  plannedDurationMinutes: number;
  livePrice: number | null;
  stockLocked: number;
  explainedCount: number;
  soldQty: number;
  gmv: number;
  conversionRate: number;
  createdAt: string;
}

export interface LiveMetric {
  id: string;
  tenantId: string;
  sessionId: string;
  capturedAt: string;
  onlineUsers: number;
  cumulativeUv: number;
  newFollowers: number;
  comments: number;
  likes: number;
  shares: number;
  cartClicks: number;
  orders: number;
  gmv: number;
  avgStaySeconds: number;
  source: string;
}

export interface DiagnosisItem {
  rule: string;
  dimension: string;
  text: string;
  metric?: string;
}

export interface LiveReview {
  id: string;
  tenantId: string;
  sessionId: string;
  gmvAchievementRate: number;
  uvValue: number;
  conversionRate: number;
  avgStaySeconds: number;
  bestProductId: string | null;
  bestProductName: string | null;
  worstProductId: string | null;
  worstProductName: string | null;
  highlights: DiagnosisItem[];
  problems: DiagnosisItem[];
  actions: DiagnosisItem[];
  anchorScore: number;
  reviewerId: string | null;
  createdAt: string;
}

export interface ScheduleSlot {
  productId: string;
  sku: string | null;
  productName: string | null;
  sortOrder: number;
  offsetMinutes: number;
  slotStart: string | null;
  slotEnd: string | null;
  durationMinutes: number;
  livePrice: number | null;
}

export interface ScheduleTimeline {
  sessionId: string;
  plannedStart: string | null;
  plannedTotalMinutes: number;
  scheduledMinutes: number;
  remainingMinutes: number;
  overflow: boolean;
  warnings: string[];
  slots: ScheduleSlot[];
}

export interface LiveSnapshot {
  sessionId: string;
  status: LiveSessionStatus;
  latest: LiveMetric | null;
  targetGmv: number;
  targetOrders: number;
  gmvAchievementRate: number;
  ordersAchievementRate: number;
  uvValue: number;
  conversionRate: number;
  dataSourceNote: string;
}

export interface AnchorPerformance {
  employeeId: string;
  employeeName: string | null;
  period: string;
  sessionCount: number;
  liveMinutes: number;
  totalGmv: number;
  totalOrders: number;
  totalUv: number;
  avgUvValue: number;
  avgConversionRate: number;
  avgStaySeconds: number;
  avgGmvAchievementRate: number;
  avgAnchorScore: number;
  bestSession: { id: string; title: string; gmv: number } | null;
  sessions: Array<{
    id: string; title: string; plannedStart: string | null; status: LiveSessionStatus;
    targetGmv: number; actualGmv: number; achievementRate: number; anchorScore: number | null;
  }>;
}

export interface LivestreamOverview {
  generatedAt: string;
  month: string;
  sessionCount: number;
  livingCount: number;
  totalGmv: number;
  totalOrders: number;
  avgUvValue: number;
  avgConversionRate: number;
  topAnchors: Array<{
    employeeId: string; name: string; sessionCount: number; gmv: number; avgScore: number;
  }>;
  recentSessions: LiveSession[];
}

export interface SessionDetail {
  session: LiveSession;
  scripts: LiveScript[];
  products: LiveSessionProduct[];
  latestMetric: LiveMetric | null;
  review: LiveReview | null;
}

export interface SessionInput {
  projectId?: string;
  title: string;
  platform?: string;
  roomId?: string;
  anchorEmployeeId?: string;
  assistantEmployeeId?: string;
  plannedStart?: string;
  plannedEnd?: string;
  targetGmv?: number;
  targetOrders?: number;
  coverUrl?: string;
  remark?: string;
}

export interface ScriptInput {
  segmentNo?: number;
  segmentType?: LiveSegmentType;
  title: string;
  productId?: string;
  durationMinutes?: number;
  talkTrack?: string;
  sellingPoints?: string[];
  objectionHandling?: Array<{ objection: string; response: string }>;
  ctaText?: string;
}

export interface MetricInput {
  capturedAt?: string;
  onlineUsers?: number;
  cumulativeUv?: number;
  newFollowers?: number;
  comments?: number;
  likes?: number;
  shares?: number;
  cartClicks?: number;
  orders?: number;
  gmv?: number;
  avgStaySeconds?: number;
}

export interface GenerateScriptOptions {
  totalMinutes?: number;
  includeFlashSale?: boolean;
  interactEvery?: number;
  overwrite?: boolean;
  tone?: 'professional' | 'warm' | 'energetic';
}

export interface SessionListFilters {
  status?: LiveSessionStatus;
  platform?: string;
  anchorId?: string;
  from?: string;
  to?: string;
  keyword?: string;
  page?: number;
  limit?: number;
}

export interface Pagination {
  page: number; limit: number; total: number; totalPages: number;
}

// ─────────────── 内部工具 ───────────────

interface RawResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
  message?: string;
  pagination?: Pagination;
}

/** 解包 ApiResponse.data，失败时抛出可读错误 */
function unwrap<T>(resp: RawResponse<T>): T {
  if (!resp.success) {
    throw new Error(resp.error?.message || '请求失败');
  }
  return resp.data as T;
}

/** 分页接口解包：同时返回 data 与 pagination */
function unwrapPaged<T>(resp: RawResponse<T[]>): { data: T[]; pagination: Pagination } {
  if (!resp.success) {
    throw new Error(resp.error?.message || '请求失败');
  }
  return {
    data: resp.data || [],
    pagination: resp.pagination || { page: 1, limit: 20, total: (resp.data || []).length, totalPages: 1 },
  };
}

function toQuery(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.append(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// ─────────────── API ───────────────

export const livestreamApi = {
  // ===== 总览 =====

  /** 直播总览：本月场次 / 总 GMV / 平均 UV 价值 / Top 主播 / 近期场次 */
  getOverview: async (): Promise<LivestreamOverview> =>
    unwrap(await api.call<LivestreamOverview>('GET', '/livestream/overview')),

  /** 违禁词库（写稿时实时提示用） */
  getComplianceLexicon: async (): Promise<Array<{
    word: string; category: string; severity: string; suggestion: string;
  }>> =>
    unwrap(await api.call('GET', '/livestream/compliance/lexicon')),

  // ===== 场次管理 =====

  listSessions: async (filters: SessionListFilters = {}): Promise<{ data: LiveSession[]; pagination: Pagination }> =>
    unwrapPaged(await api.call<LiveSession[]>('GET', `/livestream/sessions${toQuery(filters as Record<string, unknown>)}`)),

  getSession: async (id: string): Promise<SessionDetail> =>
    unwrap(await api.call<SessionDetail>('GET', `/livestream/sessions/${id}`)),

  createSession: async (input: SessionInput): Promise<LiveSession> =>
    unwrap(await api.call<LiveSession>('POST', '/livestream/sessions', input)),

  updateSession: async (id: string, input: Partial<SessionInput>): Promise<LiveSession> =>
    unwrap(await api.call<LiveSession>('PUT', `/livestream/sessions/${id}`, input)),

  deleteSession: async (id: string): Promise<{ id: string }> =>
    unwrap(await api.call<{ id: string }>('DELETE', `/livestream/sessions/${id}`)),

  /** 状态机流转：planned → ready → living → ended → reviewed */
  advanceStatus: async (id: string, to: LiveSessionStatus): Promise<LiveSession> =>
    unwrap(await api.call<LiveSession>('POST', `/livestream/sessions/${id}/advance`, { to })),

  // ===== 直播脚本 =====

  listScripts: async (sessionId: string): Promise<LiveScript[]> =>
    unwrap(await api.call<LiveScript[]>('GET', `/livestream/sessions/${sessionId}/scripts`)),

  createScript: async (sessionId: string, input: ScriptInput): Promise<LiveScript> =>
    unwrap(await api.call<LiveScript>('POST', `/livestream/sessions/${sessionId}/scripts`, input)),

  updateScript: async (scriptId: string, input: Partial<ScriptInput>): Promise<LiveScript> =>
    unwrap(await api.call<LiveScript>('PUT', `/livestream/scripts/${scriptId}`, input)),

  deleteScript: async (scriptId: string): Promise<{ id: string }> =>
    unwrap(await api.call<{ id: string }>('DELETE', `/livestream/scripts/${scriptId}`)),

  reorderScripts: async (sessionId: string, orderedIds: string[]): Promise<LiveScript[]> =>
    unwrap(await api.call<LiveScript[]>('PUT', `/livestream/sessions/${sessionId}/scripts/reorder`, { orderedIds })),

  /** 一键生成全场脚本（暖场 → 秒杀 → 讲品循环 → 互动 → 收尾） */
  generateScript: async (sessionId: string, options: GenerateScriptOptions = {}): Promise<LiveScript[]> =>
    unwrap(await api.call<LiveScript[]>('POST', `/livestream/sessions/${sessionId}/scripts/generate`, options)),

  /** 全场脚本合规检查 */
  checkCompliance: async (sessionId: string): Promise<ComplianceReport> =>
    unwrap(await api.call<ComplianceReport>('POST', `/livestream/sessions/${sessionId}/scripts/compliance-check`)),

  // ===== 选品排期 =====

  listProducts: async (sessionId: string): Promise<LiveSessionProduct[]> =>
    unwrap(await api.call<LiveSessionProduct[]>('GET', `/livestream/sessions/${sessionId}/products`)),

  addProducts: async (
    sessionId: string,
    items: Array<{ productId: string; livePrice?: number; plannedDurationMinutes?: number; stockLocked?: number }>
  ): Promise<{ added: number; skipped: number; products: LiveSessionProduct[] }> =>
    unwrap(await api.call('POST', `/livestream/sessions/${sessionId}/products`, { items })),

  removeProduct: async (sessionId: string, productId: string): Promise<{ productId: string }> =>
    unwrap(await api.call('DELETE', `/livestream/sessions/${sessionId}/products/${productId}`)),

  reorderProducts: async (sessionId: string, orderedProductIds: string[]): Promise<LiveSessionProduct[]> =>
    unwrap(await api.call<LiveSessionProduct[]>(
      'PUT', `/livestream/sessions/${sessionId}/products/reorder`, { orderedProductIds }
    )),

  updateSlot: async (
    sessionId: string,
    productId: string,
    input: {
      plannedSlotStart?: string; plannedDurationMinutes?: number; livePrice?: number;
      stockLocked?: number; sortOrder?: number; explainedCount?: number; soldQty?: number; gmv?: number;
    }
  ): Promise<LiveSessionProduct> =>
    unwrap(await api.call<LiveSessionProduct>(
      'PUT', `/livestream/sessions/${sessionId}/products/${productId}/slot`, input
    )),

  /** 讲解时间轴 + 总时长校验 */
  getTimeline: async (sessionId: string): Promise<ScheduleTimeline> =>
    unwrap(await api.call<ScheduleTimeline>('GET', `/livestream/sessions/${sessionId}/timeline`)),

  // ===== 指标与复盘 =====

  recordMetric: async (sessionId: string, input: MetricInput): Promise<LiveMetric> =>
    unwrap(await api.call<LiveMetric>('POST', `/livestream/sessions/${sessionId}/metrics`, input)),

  batchImportMetrics: async (
    sessionId: string, items: MetricInput[]
  ): Promise<{ imported: number; failed: number; errors: string[] }> =>
    unwrap(await api.call('POST', `/livestream/sessions/${sessionId}/metrics/batch`, { items })),

  getMetrics: async (sessionId: string): Promise<LiveMetric[]> =>
    unwrap(await api.call<LiveMetric[]>('GET', `/livestream/sessions/${sessionId}/metrics`)),

  getSnapshot: async (sessionId: string): Promise<LiveSnapshot> =>
    unwrap(await api.call<LiveSnapshot>('GET', `/livestream/sessions/${sessionId}/snapshot`)),

  generateReview: async (sessionId: string): Promise<LiveReview> =>
    unwrap(await api.call<LiveReview>('POST', `/livestream/sessions/${sessionId}/review`)),

  getReview: async (sessionId: string): Promise<LiveReview | null> =>
    unwrap(await api.call<LiveReview | null>('GET', `/livestream/sessions/${sessionId}/review`)),

  // ===== 主播绩效 =====

  getAnchorPerformance: async (employeeId: string, period?: string): Promise<AnchorPerformance> =>
    unwrap(await api.call<AnchorPerformance>(
      'GET', `/livestream/anchors/${employeeId}/performance${toQuery({ period })}`
    )),
};

export default livestreamApi;
