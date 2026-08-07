/**
 * Vorzai 多平台对接 API Client
 * 与 /api/platform 后端对接
 *
 * 重要约定：
 *  - 后端返回的连接对象中，密钥类字段只有掩码与布尔量（hasAppSecret / appSecretMasked），
 *    前端任何地方都拿不到明文，也不应尝试回显明文。
 *  - sandbox / mode 字段必须被 UI 显著呈现：沙箱数据不是真实平台数据。
 */

import api from './client';

// ────────────────── 类型 ──────────────────

export type PlatformCode =
  | 'douyin' | 'amazon' | 'taobao' | 'jd' | 'kuaishou' | 'shopify' | 'pdd' | 'shopee' | 'tiktok';

export type ResourceType = 'orders' | 'products' | 'inventory' | 'finance' | 'reviews' | 'logistics';
export type ConnectionStatus = 'disconnected' | 'connected' | 'expired' | 'error' | 'sandbox';
export type AdapterMode = 'live' | 'sandbox';

export interface CredentialFieldSpec {
  key: string;
  label: string;
  type: 'text' | 'secret' | 'select';
  required: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  hint?: string;
}

export interface PlatformCatalogEntry {
  platform: PlatformCode;
  displayName: string;
  supported: boolean;
  authMode: 'oauth' | 'apikey' | 'manual';
  gateway: string;
  docUrl: string;
  capabilities: ResourceType[];
  credentialFields: CredentialFieldSpec[];
  signatureAlgorithm: string;
  endpoints: Record<string, string>;
  sandboxSupported: boolean;
  notes?: string;
}

export interface PlatformConnection {
  id: string;
  platform: PlatformCode;
  platformName: string;
  shopName: string | null;
  shopId: string | null;
  region: string | null;
  authMode: string;
  appKeyMasked: string | null;
  hasAppSecret: boolean;
  appSecretMasked: string | null;
  hasAccessToken: boolean;
  accessTokenMasked: string | null;
  hasRefreshToken: boolean;
  tokenExpiresAt: string | null;
  status: ConnectionStatus;
  mode: AdapterMode;
  sandbox: boolean;
  credentialsComplete: boolean;
  lastError: string | null;
  lastSyncAt: string | null;
  syncIntervalMinutes: number;
  capabilities: ResourceType[];
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionTestResult {
  success: boolean;
  status: ConnectionStatus;
  message: string;
  endpoint: string;
  mode: AdapterMode;
  shopName?: string;
  tokenExpiresAt?: string;
  sandbox: boolean;
}

export interface SyncJob {
  id: string;
  connectionId: string;
  platform: PlatformCode | null;
  shopName: string | null;
  resource: ResourceType;
  direction: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'partial';
  cursor: string | null;
  sinceTime: string | null;
  untilTime: string | null;
  totalCount: number;
  successCount: number;
  failedCount: number;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  sandbox: boolean;
}

export interface SyncLog {
  id: string;
  jobId: string | null;
  connectionId: string | null;
  level: 'info' | 'warn' | 'error';
  message: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface PlatformStats {
  connectionCount: number;
  connectedCount: number;
  sandboxCount: number;
  errorCount: number;
  syncedOrderCount: number;
  syncedOrderAmount: number;
  sandboxOrderCount: number;
  jobTotal: number;
  jobSuccess: number;
  jobFailed: number;
  successRate: number;
  byPlatform: Array<{
    platform: PlatformCode;
    platformName: string;
    connectionCount: number;
    orderCount: number;
    orderAmount: number;
    sandboxOrderCount: number;
    ratio: number;
  }>;
  lastSyncAt: string | null;
}

export interface CreateConnectionInput {
  platform: PlatformCode;
  shopName?: string;
  shopId?: string;
  region?: string;
  authMode?: 'oauth' | 'apikey' | 'manual';
  appKey?: string;
  appSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  syncIntervalMinutes?: number;
  sandbox?: boolean;
  extra?: Record<string, string>;
}

export type UpdateConnectionInput = Partial<Omit<CreateConnectionInput, 'platform'>>;

export interface Paginated<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

// ────────────────── 工具 ──────────────────

/** 解包 ApiResponse.data，失败时抛出可读错误 */
function unwrap<T>(resp: {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
  message?: string;
}): T {
  if (!resp.success) {
    throw new Error(resp.error?.message || resp.message || '请求失败');
  }
  return resp.data as T;
}

// ────────────────── API ──────────────────

export const platformApi = {
  /** 平台目录（凭据字段 / 能力 / 真实端点 / 签名算法） */
  getCatalog: async (): Promise<PlatformCatalogEntry[]> =>
    unwrap<PlatformCatalogEntry[]>(await api.call<PlatformCatalogEntry[]>('GET', '/platform/catalog')),

  /** 连接列表 */
  listConnections: async (filters: { platform?: string; status?: string } = {}): Promise<PlatformConnection[]> => {
    const qs = new URLSearchParams();
    if (filters.platform) qs.set('platform', filters.platform);
    if (filters.status) qs.set('status', filters.status);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return unwrap<PlatformConnection[]>(await api.call<PlatformConnection[]>('GET', `/platform/connections${suffix}`));
  },

  getConnection: async (id: string): Promise<PlatformConnection> =>
    unwrap<PlatformConnection>(await api.call<PlatformConnection>('GET', `/platform/connections/${id}`)),

  createConnection: async (input: CreateConnectionInput): Promise<PlatformConnection> =>
    unwrap<PlatformConnection>(await api.call<PlatformConnection>('POST', '/platform/connections', input)),

  updateConnection: async (id: string, input: UpdateConnectionInput): Promise<PlatformConnection> =>
    unwrap<PlatformConnection>(await api.call<PlatformConnection>('PUT', `/platform/connections/${id}`, input)),

  deleteConnection: async (id: string): Promise<{ id: string; deleted: boolean }> =>
    unwrap<{ id: string; deleted: boolean }>(await api.call('DELETE', `/platform/connections/${id}`)),

  /** 连接测试：live 模式会真实发起一次平台鉴权探针调用 */
  testConnection: async (id: string): Promise<ConnectionTestResult> =>
    unwrap<ConnectionTestResult>(await api.call<ConnectionTestResult>('POST', `/platform/connections/${id}/test`)),

  /** 触发同步（默认同步等待结果返回） */
  sync: async (
    id: string,
    body: { resource?: ResourceType; since?: string; until?: string; async?: boolean } = {}
  ): Promise<SyncJob> =>
    unwrap<SyncJob>(await api.call<SyncJob>('POST', `/platform/connections/${id}/sync`, {
      resource: body.resource || 'orders',
      since: body.since,
      until: body.until,
      async: body.async,
    })),

  /** 任务列表（分页） */
  listJobs: async (
    filters: { connectionId?: string; status?: string; resource?: string; page?: number; limit?: number } = {}
  ): Promise<Paginated<SyncJob>> => {
    const qs = new URLSearchParams();
    if (filters.connectionId) qs.set('connectionId', filters.connectionId);
    if (filters.status) qs.set('status', filters.status);
    if (filters.resource) qs.set('resource', filters.resource);
    qs.set('page', String(filters.page || 1));
    qs.set('limit', String(filters.limit || 20));
    const resp = await api.call<SyncJob[]>('GET', `/platform/jobs?${qs.toString()}`);
    if (!resp.success) throw new Error(resp.error?.message || '获取同步任务失败');
    return {
      data: (resp.data || []) as SyncJob[],
      pagination: resp.pagination || { page: 1, limit: 20, total: 0, totalPages: 1 },
    };
  },

  getJob: async (id: string): Promise<SyncJob> =>
    unwrap<SyncJob>(await api.call<SyncJob>('GET', `/platform/jobs/${id}`)),

  runJob: async (id: string): Promise<SyncJob> =>
    unwrap<SyncJob>(await api.call<SyncJob>('POST', `/platform/jobs/${id}/run`)),

  cancelJob: async (id: string): Promise<SyncJob> =>
    unwrap<SyncJob>(await api.call<SyncJob>('POST', `/platform/jobs/${id}/cancel`)),

  getJobLogs: async (id: string, limit = 200): Promise<SyncLog[]> =>
    unwrap<SyncLog[]>(await api.call<SyncLog[]>('GET', `/platform/jobs/${id}/logs?limit=${limit}`)),

  listLogs: async (filters: { connectionId?: string; level?: string; limit?: number } = {}): Promise<SyncLog[]> => {
    const qs = new URLSearchParams();
    if (filters.connectionId) qs.set('connectionId', filters.connectionId);
    if (filters.level) qs.set('level', filters.level);
    qs.set('limit', String(filters.limit || 100));
    return unwrap<SyncLog[]>(await api.call<SyncLog[]>('GET', `/platform/logs?${qs.toString()}`));
  },

  getStats: async (): Promise<PlatformStats> =>
    unwrap<PlatformStats>(await api.call<PlatformStats>('GET', '/platform/stats')),
};

export default platformApi;
