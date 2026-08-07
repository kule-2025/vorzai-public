/**
 * 多平台对接服务（Platform Service）
 *
 * 职责边界：
 *   适配层（services/adapters/*）负责「取数 + 归一化」，本服务负责「凭据管理 + 编排 + 落库 + 审计」。
 *
 * 三条硬纪律：
 *   1. 【不伪装】没有真实凭据时一律走 sandbox，产出数据带 _sandbox 标记，
 *      落库时 order_no 追加 `SBX-` 前缀，remark 写明「沙箱演练订单」，
 *      API 响应逐级透传 sandbox 字段，前端必须显著提示。
 *   2. 【不裸奔】app_secret / access_token / refresh_token 一律 AES-256-GCM 加密落库，
 *      任何响应只回 maskSecret（前 4 位 + ****）或 hasXxx 布尔量，绝不回明文。
 *   3. 【不崩盘】同步过程中单条脏数据只记 error 日志并计入 failed_count，
 *      绝不让一条坏订单打断整个任务；异常全部写入 platform_sync_logs 可追溯。
 *
 * 所有 SQL 均带 tenant_id 过滤，配合 tenantIsolation 中间件实现租户隔离。
 */
import { randomUUID } from 'crypto';
import { getDatabase } from '../db';
import { logger } from '../utils/logger';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import {
  createAdapter,
  getCatalogEntry,
  isPlatformSupported,
  PLATFORM_CATALOG,
} from './adapters';
import {
  decryptSecret,
  encryptSecret,
  hasSecret,
  maskPlain,
  maskSecret,
} from './adapters/crypto';
import {
  AdapterContext,
  AdapterMode,
  ConnectionStatus,
  ConnectionTestResult,
  NormalizedOrder,
  PlatformAdapter,
  PlatformCatalogEntry,
  PlatformCode,
  ResourceType,
} from './adapters/types';

// ────────────────── 对外 DTO ──────────────────

/** 连接（脱敏后）——这是唯一允许出现在 HTTP 响应中的连接形态 */
export interface ConnectionDTO {
  id: string;
  platform: PlatformCode;
  platformName: string;
  shopName: string | null;
  shopId: string | null;
  region: string | null;
  authMode: string;
  /** app_key 明文落库但响应仍做脱敏 */
  appKeyMasked: string | null;
  /** 密钥类字段一律只回「是否已配置 + 掩码」 */
  hasAppSecret: boolean;
  appSecretMasked: string | null;
  hasAccessToken: boolean;
  accessTokenMasked: string | null;
  hasRefreshToken: boolean;
  tokenExpiresAt: string | null;
  status: ConnectionStatus;
  /** 运行模式：由 status 与凭据完整度共同推导 */
  mode: AdapterMode;
  /** 是否处于沙箱（前端据此打黄色横幅） */
  sandbox: boolean;
  /** 凭据是否已补齐到可发起 live 调用 */
  credentialsComplete: boolean;
  lastError: string | null;
  lastSyncAt: string | null;
  syncIntervalMinutes: number;
  capabilities: ResourceType[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateConnectionInput {
  platform: string;
  shopName?: string;
  shopId?: string;
  region?: string;
  authMode?: string;
  appKey?: string;
  appSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: string;
  syncIntervalMinutes?: number;
  /** 用户主动选择沙箱演练 */
  sandbox?: boolean;
  /** 平台特有扩展字段（marketplaceId / apiVersion / locationId 等） */
  extra?: Record<string, string>;
}

export type UpdateConnectionInput = Partial<Omit<CreateConnectionInput, 'platform'>>;

export interface SyncJobDTO {
  id: string;
  connectionId: string;
  platform: PlatformCode | null;
  shopName: string | null;
  resource: ResourceType;
  direction: string;
  status: string;
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
  /** 该任务是否产出沙箱数据 */
  sandbox: boolean;
}

export interface SyncLogDTO {
  id: string;
  jobId: string | null;
  connectionId: string | null;
  level: string;
  message: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface PlatformStats {
  connectionCount: number;
  connectedCount: number;
  sandboxCount: number;
  errorCount: number;
  /** 由平台连接同步进来的订单总数 */
  syncedOrderCount: number;
  syncedOrderAmount: number;
  /** 其中属于沙箱演练的订单数 */
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

// ────────────────── 内部行类型 ──────────────────

interface ConnectionRow {
  id: string;
  tenant_id: string;
  platform: string;
  shop_name: string | null;
  shop_id: string | null;
  region: string | null;
  auth_mode: string | null;
  app_key: string | null;
  app_secret_enc: string | null;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: string | null;
  status: string;
  last_error: string | null;
  last_sync_at: string | null;
  sync_interval_minutes: number | null;
  capabilities: string | null;
  created_at: string;
  updated_at: string;
}

/** 沙箱订单在 orders 表中的可识别前缀（schema 暂无 is_sandbox 列，用前缀兜底） */
const SANDBOX_ORDER_PREFIX = 'SBX-';

const VALID_RESOURCES: ResourceType[] = ['orders', 'products', 'inventory', 'finance', 'reviews', 'logistics'];

// ────────────────── 服务实现 ──────────────────

class PlatformService {
  // ══════════ A. 平台目录 ══════════

  /** 支持的平台清单：凭据字段、能力、真实端点与签名算法，供前端动态渲染 */
  getPlatformCatalog(): PlatformCatalogEntry[] {
    return PLATFORM_CATALOG;
  }

  // ══════════ B. 连接管理 ══════════

  listConnections(tenantId: string, filters: { platform?: string; status?: string } = {}): ConnectionDTO[] {
    const db = getDatabase();
    let sql = 'SELECT * FROM platform_connections WHERE tenant_id = ?';
    const params: unknown[] = [tenantId];

    if (filters.platform) {
      sql += ' AND platform = ?';
      params.push(filters.platform);
    }
    if (filters.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }
    sql += ' ORDER BY created_at DESC';

    const rows = db.prepare(sql).all(...params) as ConnectionRow[];
    return rows.map((r) => this.toConnectionDTO(r));
  }

  getConnection(tenantId: string, id: string): ConnectionDTO {
    return this.toConnectionDTO(this.mustGetRow(tenantId, id));
  }

  createConnection(tenantId: string, input: CreateConnectionInput): ConnectionDTO {
    const db = getDatabase();

    if (!isPlatformSupported(input.platform)) {
      const entry = getCatalogEntry(input.platform);
      throw new ValidationError(
        entry
          ? `${entry.displayName} 适配器尚未实现，暂不可创建连接`
          : `不支持的平台: ${input.platform}`
      );
    }

    const platform = input.platform as PlatformCode;
    const shopId = input.shopId || null;

    // schema 的 UNIQUE(tenant_id, platform, shop_id) 约束，提前给出可读报错
    const dup = db
      .prepare('SELECT id FROM platform_connections WHERE tenant_id = ? AND platform = ? AND IFNULL(shop_id, \'\') = ?')
      .get(tenantId, platform, shopId || '') as { id: string } | undefined;
    if (dup) {
      throw new ConflictError(`该平台下已存在相同店铺 ID 的连接（${dup.id}），请勿重复创建`);
    }

    const id = randomUUID();
    const entry = getCatalogEntry(platform);
    const capabilities = entry ? entry.capabilities : [];

    // 用户主动选沙箱，或凭据不完整 → 直接落 sandbox 状态
    const complete = this.isCredentialsComplete(platform, {
      appKey: input.appKey,
      appSecret: input.appSecret,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      shopId: input.shopId,
    });
    const status: ConnectionStatus = input.sandbox || !complete ? 'sandbox' : 'disconnected';

    db.prepare(
      `INSERT INTO platform_connections
         (id, tenant_id, platform, shop_name, shop_id, region, auth_mode,
          app_key, app_secret_enc, access_token_enc, refresh_token_enc, token_expires_at,
          status, sync_interval_minutes, capabilities, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+0000'), datetime('now', '+0000'))`
    ).run(
      id,
      tenantId,
      platform,
      input.shopName || (entry ? `${entry.displayName}店铺` : null),
      shopId,
      input.region || null,
      input.authMode || (entry ? entry.authMode : 'oauth'),
      input.appKey || null,
      encryptSecret(input.appSecret),
      encryptSecret(input.accessToken),
      encryptSecret(input.refreshToken),
      input.tokenExpiresAt || null,
      status,
      input.syncIntervalMinutes ?? 30,
      JSON.stringify(capabilities)
    );

    // 平台扩展字段（marketplaceId / apiVersion / locationId）随 region 一起存在 region 字段的 JSON 里
    if (input.extra && Object.keys(input.extra).length) {
      db.prepare('UPDATE platform_connections SET region = ? WHERE id = ? AND tenant_id = ?')
        .run(JSON.stringify({ region: input.region || null, ...input.extra }), id, tenantId);
    }

    this.writeLog(tenantId, null, id, 'info', `创建 ${entry ? entry.displayName : platform} 连接（${status === 'sandbox' ? '沙箱模式' : '待测试'}）`);
    logger.info('platform', `Connection created: ${platform}`, { id, status });

    return this.getConnection(tenantId, id);
  }

  updateConnection(tenantId: string, id: string, input: UpdateConnectionInput): ConnectionDTO {
    const db = getDatabase();
    const row = this.mustGetRow(tenantId, id);

    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (col: string, value: unknown): void => {
      sets.push(`${col} = ?`);
      params.push(value);
    };

    if (input.shopName !== undefined) push('shop_name', input.shopName || null);
    if (input.shopId !== undefined) push('shop_id', input.shopId || null);
    if (input.authMode !== undefined) push('auth_mode', input.authMode);
    if (input.appKey !== undefined) push('app_key', input.appKey || null);
    if (input.tokenExpiresAt !== undefined) push('token_expires_at', input.tokenExpiresAt || null);
    if (input.syncIntervalMinutes !== undefined) push('sync_interval_minutes', input.syncIntervalMinutes);

    // 密钥类字段：传空字符串表示「清空」，不传表示「保持不变」
    if (input.appSecret !== undefined) push('app_secret_enc', encryptSecret(input.appSecret));
    if (input.accessToken !== undefined) push('access_token_enc', encryptSecret(input.accessToken));
    if (input.refreshToken !== undefined) push('refresh_token_enc', encryptSecret(input.refreshToken));

    if (input.region !== undefined || input.extra !== undefined) {
      const current = this.parseRegion(row.region);
      const merged = {
        region: input.region !== undefined ? input.region : current.region,
        ...current.extra,
        ...(input.extra || {}),
      };
      push('region', Object.keys(merged).length > 1 ? JSON.stringify(merged) : (merged.region || null));
    }

    // 切换沙箱开关：显式改写 status，凭据变更后重置为待测试
    if (input.sandbox !== undefined) {
      push('status', input.sandbox ? 'sandbox' : 'disconnected');
      push('last_error', null);
    } else if (input.appSecret !== undefined || input.accessToken !== undefined || input.refreshToken !== undefined) {
      if (row.status !== 'sandbox') {
        push('status', 'disconnected');
        push('last_error', null);
      }
    }

    if (!sets.length) return this.toConnectionDTO(row);

    sets.push("updated_at = datetime('now', '+0000')");
    params.push(id, tenantId);
    db.prepare(`UPDATE platform_connections SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...params);

    this.writeLog(tenantId, null, id, 'info', '更新连接配置');
    return this.getConnection(tenantId, id);
  }

  deleteConnection(tenantId: string, id: string): { id: string; deleted: boolean } {
    const db = getDatabase();
    this.mustGetRow(tenantId, id);
    // sync_jobs / sync_logs 已配置 ON DELETE CASCADE；orders.source_connection_id 保留为历史追溯
    db.prepare('DELETE FROM platform_connections WHERE id = ? AND tenant_id = ?').run(id, tenantId);
    logger.info('platform', `Connection deleted: ${id}`);
    return { id, deleted: true };
  }

  /** 连接测试：调用适配器最轻量的鉴权型接口，回写 status / last_error */
  async testConnection(tenantId: string, id: string): Promise<ConnectionTestResult> {
    const db = getDatabase();
    const row = this.mustGetRow(tenantId, id);
    const adapter = this.buildAdapter(row);

    let result: ConnectionTestResult;
    try {
      result = await adapter.testConnection();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      result = {
        success: false,
        status: 'error',
        message,
        endpoint: adapter.gateway,
        mode: adapter.mode,
        sandbox: false,
      };
    }

    db.prepare(
      `UPDATE platform_connections
         SET status = ?, last_error = ?, shop_name = COALESCE(?, shop_name), token_expires_at = COALESCE(?, token_expires_at), updated_at = datetime('now', '+0000')
       WHERE id = ? AND tenant_id = ?`
    ).run(
      result.status,
      result.success ? null : result.message,
      result.shopName || null,
      result.tokenExpiresAt || null,
      id,
      tenantId
    );

    this.writeLog(
      tenantId, null, id,
      result.success ? 'info' : 'error',
      `连接测试${result.success ? '成功' : '失败'}：${result.message}`,
      { endpoint: result.endpoint, mode: result.mode, sandbox: result.sandbox }
    );

    return result;
  }

  // ══════════ C. 同步引擎 ══════════

  /** 创建同步任务（仅入库，不执行） */
  createSyncJob(
    tenantId: string,
    connectionId: string,
    options: { resource: string; since?: string; until?: string; direction?: 'pull' | 'push' }
  ): SyncJobDTO {
    const db = getDatabase();
    this.mustGetRow(tenantId, connectionId);

    if (!VALID_RESOURCES.includes(options.resource as ResourceType)) {
      throw new ValidationError(`不支持的同步资源: ${options.resource}`);
    }

    const id = randomUUID();
    db.prepare(
      `INSERT INTO platform_sync_jobs
         (id, tenant_id, connection_id, resource, direction, status, since_time, until_time, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, datetime('now', '+0000'))`
    ).run(
      id, tenantId, connectionId,
      options.resource,
      options.direction || 'pull',
      options.since || null,
      options.until || null
    );

    this.writeLog(tenantId, id, connectionId, 'info', `同步任务已创建：${options.resource}`);
    return this.getSyncJob(tenantId, id);
  }

  /**
   * 执行同步任务：拉取 → 归一化 → 去重 upsert → 回写任务计数与状态。
   * 单条数据异常只计 failed 并写 error 日志，不中断整个任务。
   */
  async runSyncJob(tenantId: string, jobId: string): Promise<SyncJobDTO> {
    const db = getDatabase();
    const job = this.mustGetJobRow(tenantId, jobId);

    if (job.status === 'running') {
      throw new ConflictError('该同步任务正在执行中，请勿重复触发');
    }
    if (job.status === 'success' || job.status === 'failed') {
      throw new ConflictError('该同步任务已结束，请创建新任务');
    }

    const conn = this.mustGetRow(tenantId, job.connection_id);
    const adapter = this.buildAdapter(conn);

    db.prepare("UPDATE platform_sync_jobs SET status = 'running', started_at = datetime('now', '+0000') WHERE id = ? AND tenant_id = ?")
      .run(jobId, tenantId);
    this.writeLog(tenantId, jobId, conn.id, 'info', `开始同步 ${job.resource}（模式：${adapter.mode}）`);

    let total = 0;
    let success = 0;
    let failed = 0;
    let sandboxSeen = false;
    let cursor: string | null = job.cursor || null;
    let errorMessage: string | null = null;

    try {
      if (job.resource === 'orders') {
        // 最多翻 20 页，防止异常游标导致死循环
        for (let page = 0; page < 20; page++) {
          const res = await adapter.fetchOrders({
            since: job.since_time || undefined,
            until: job.until_time || undefined,
            cursor,
            pageSize: 50,
          });
          if (res.sandbox) sandboxSeen = true;
          total += res.items.length;

          for (const order of res.items) {
            try {
              this.upsertOrder(tenantId, conn.id, order);
              success++;
            } catch (e) {
              failed++;
              this.writeLog(
                tenantId, jobId, conn.id, 'error',
                `订单 ${order.platformOrderId} 落库失败：${e instanceof Error ? e.message : String(e)}`,
                { platformOrderId: order.platformOrderId, sandbox: order._sandbox }
              );
            }
          }

          cursor = res.nextCursor;
          db.prepare('UPDATE platform_sync_jobs SET cursor = ?, total_count = ?, success_count = ?, failed_count = ? WHERE id = ? AND tenant_id = ?')
            .run(cursor, total, success, failed, jobId, tenantId);

          if (!res.hasMore || !cursor) break;
        }
      } else if (job.resource === 'products' || job.resource === 'inventory') {
        // 商品 / 库存目前只做拉取与审计留痕，落库归属「库存与商品」模块，避免跨模块写冲突
        const res = job.resource === 'products'
          ? await adapter.fetchProducts({ pageSize: 100 })
          : await adapter.fetchInventory({ pageSize: 100 });
        if (res.sandbox) sandboxSeen = true;
        total = res.items.length;
        success = res.items.length;
        this.writeLog(
          tenantId, jobId, conn.id, 'info',
          `已拉取 ${total} 条${job.resource === 'products' ? '商品' : '库存'}数据（结果暂存于日志 payload，供商品模块消费）`,
          { sandbox: res.sandbox, sample: res.items.slice(0, 5) }
        );
      } else {
        throw new ValidationError(`资源 ${job.resource} 的同步能力尚未实现`);
      }
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : String(e);
      this.writeLog(tenantId, jobId, conn.id, 'error', `同步中断：${errorMessage}`);
      logger.error('platform', `Sync job failed: ${jobId}`, { error: errorMessage });
    }

    const finalStatus = errorMessage
      ? (success > 0 ? 'partial' : 'failed')
      : (failed > 0 ? 'partial' : 'success');

    db.prepare(
      `UPDATE platform_sync_jobs
         SET status = ?, total_count = ?, success_count = ?, failed_count = ?, cursor = ?,
             error_message = ?, finished_at = datetime('now', '+0000')
       WHERE id = ? AND tenant_id = ?`
    ).run(finalStatus, total, success, failed, cursor, errorMessage, jobId, tenantId);

    if (!errorMessage) {
      db.prepare("UPDATE platform_connections SET last_sync_at = datetime('now', '+0000'), updated_at = datetime('now', '+0000') WHERE id = ? AND tenant_id = ?")
        .run(conn.id, tenantId);
    }

    this.writeLog(
      tenantId, jobId, conn.id,
      finalStatus === 'success' ? 'info' : (finalStatus === 'failed' ? 'error' : 'warn'),
      sandboxSeen
        ? `同步结束（沙箱演练数据）：共 ${total} 条，成功 ${success}，失败 ${failed}。请注意：以上均为本地演练数据，非真实平台数据。`
        : `同步结束：共 ${total} 条，成功 ${success}，失败 ${failed}`,
      { sandbox: sandboxSeen, status: finalStatus }
    );

    return this.getSyncJob(tenantId, jobId);
  }

  listSyncJobs(
    tenantId: string,
    filters: { connectionId?: string; status?: string; resource?: string; page?: number; limit?: number } = {}
  ): { data: SyncJobDTO[]; pagination: { page: number; limit: number; total: number; totalPages: number } } {
    const db = getDatabase();
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 20));

    let where = 'WHERE j.tenant_id = ?';
    const params: unknown[] = [tenantId];
    if (filters.connectionId) { where += ' AND j.connection_id = ?'; params.push(filters.connectionId); }
    if (filters.status) { where += ' AND j.status = ?'; params.push(filters.status); }
    if (filters.resource) { where += ' AND j.resource = ?'; params.push(filters.resource); }

    const totalRow = db.prepare(`SELECT COUNT(*) as total FROM platform_sync_jobs j ${where}`).get(...params) as { total: number };
    const rows = db.prepare(
      `SELECT j.*, c.platform, c.shop_name, c.status AS conn_status
         FROM platform_sync_jobs j
         LEFT JOIN platform_connections c ON c.id = j.connection_id
         ${where}
         ORDER BY j.created_at DESC
         LIMIT ? OFFSET ?`
    ).all(...params, limit, (page - 1) * limit) as Array<Record<string, unknown>>;

    const total = Number(totalRow?.total || 0);
    return {
      data: rows.map((r) => this.toJobDTO(r)),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  getSyncJob(tenantId: string, jobId: string): SyncJobDTO {
    const db = getDatabase();
    const row = db.prepare(
      `SELECT j.*, c.platform, c.shop_name, c.status AS conn_status
         FROM platform_sync_jobs j
         LEFT JOIN platform_connections c ON c.id = j.connection_id
        WHERE j.id = ? AND j.tenant_id = ?`
    ).get(jobId, tenantId) as Record<string, unknown> | undefined;
    if (!row) throw new NotFoundError('同步任务', jobId);
    return this.toJobDTO(row);
  }

  cancelSyncJob(tenantId: string, jobId: string): SyncJobDTO {
    const db = getDatabase();
    const job = this.mustGetJobRow(tenantId, jobId);
    if (job.status === 'success' || job.status === 'failed') {
      throw new ConflictError('任务已结束，无法取消');
    }
    db.prepare(
      `UPDATE platform_sync_jobs
         SET status = 'failed', error_message = '用户手动取消', finished_at = datetime('now', '+0000')
       WHERE id = ? AND tenant_id = ?`
    ).run(jobId, tenantId);
    this.writeLog(tenantId, jobId, job.connection_id, 'warn', '同步任务被用户手动取消');
    return this.getSyncJob(tenantId, jobId);
  }

  listSyncLogs(
    tenantId: string,
    filters: { jobId?: string; connectionId?: string; level?: string; limit?: number } = {}
  ): SyncLogDTO[] {
    const db = getDatabase();
    let sql = 'SELECT * FROM platform_sync_logs WHERE tenant_id = ?';
    const params: unknown[] = [tenantId];
    if (filters.jobId) { sql += ' AND job_id = ?'; params.push(filters.jobId); }
    if (filters.connectionId) { sql += ' AND connection_id = ?'; params.push(filters.connectionId); }
    if (filters.level) { sql += ' AND level = ?'; params.push(filters.level); }
    sql += ' ORDER BY created_at DESC, rowid DESC LIMIT ?';
    params.push(Math.min(500, Math.max(1, Number(filters.limit) || 100)));

    const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      jobId: r.job_id ? String(r.job_id) : null,
      connectionId: r.connection_id ? String(r.connection_id) : null,
      level: String(r.level || 'info'),
      message: String(r.message || ''),
      payload: this.safeParse(r.payload),
      createdAt: String(r.created_at || ''),
    }));
  }

  /** 同步概览：连接健康度 + 订单产出 + 任务成功率 + 平台占比 */
  getStats(tenantId: string): PlatformStats {
    const db = getDatabase();

    const conns = db.prepare('SELECT platform, status, last_sync_at FROM platform_connections WHERE tenant_id = ?')
      .all(tenantId) as Array<{ platform: string; status: string; last_sync_at: string | null }>;

    const orderRows = db.prepare(
      `SELECT o.platform AS platform,
              COUNT(*) AS cnt,
              SUM(o.total_amount) AS amount,
              SUM(CASE WHEN o.order_no LIKE ? THEN 1 ELSE 0 END) AS sandbox_cnt
         FROM orders o
        WHERE o.tenant_id = ? AND o.source_connection_id IS NOT NULL
        GROUP BY o.platform`
    ).all(`${SANDBOX_ORDER_PREFIX}%`, tenantId) as Array<{ platform: string; cnt: number; amount: number; sandbox_cnt: number }>;

    const jobRow = db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS ok,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS bad
         FROM platform_sync_jobs WHERE tenant_id = ?`
    ).get(tenantId) as { total: number; ok: number; bad: number } | undefined;

    const syncedOrderCount = orderRows.reduce((s, r) => s + Number(r.cnt || 0), 0);
    const syncedOrderAmount = orderRows.reduce((s, r) => s + Number(r.amount || 0), 0);
    const sandboxOrderCount = orderRows.reduce((s, r) => s + Number(r.sandbox_cnt || 0), 0);

    const connByPlatform = new Map<string, number>();
    for (const c of conns) connByPlatform.set(c.platform, (connByPlatform.get(c.platform) || 0) + 1);

    const platformKeys = new Set<string>([...connByPlatform.keys(), ...orderRows.map((r) => r.platform).filter(Boolean)]);
    const byPlatform = Array.from(platformKeys).map((p) => {
      const row = orderRows.find((r) => r.platform === p);
      const cnt = Number(row?.cnt || 0);
      const entry = getCatalogEntry(p);
      return {
        platform: p as PlatformCode,
        platformName: entry ? entry.displayName : p,
        connectionCount: connByPlatform.get(p) || 0,
        orderCount: cnt,
        orderAmount: Math.round(Number(row?.amount || 0) * 100) / 100,
        sandboxOrderCount: Number(row?.sandbox_cnt || 0),
        ratio: syncedOrderCount ? Math.round((cnt / syncedOrderCount) * 1000) / 1000 : 0,
      };
    }).sort((a, b) => b.orderCount - a.orderCount);

    const jobTotal = Number(jobRow?.total || 0);
    const jobSuccess = Number(jobRow?.ok || 0);
    const lastSyncAt = conns
      .map((c) => c.last_sync_at)
      .filter((v): v is string => !!v)
      .sort()
      .pop() || null;

    return {
      connectionCount: conns.length,
      connectedCount: conns.filter((c) => c.status === 'connected').length,
      sandboxCount: conns.filter((c) => c.status === 'sandbox').length,
      errorCount: conns.filter((c) => c.status === 'error' || c.status === 'expired').length,
      syncedOrderCount,
      syncedOrderAmount: Math.round(syncedOrderAmount * 100) / 100,
      sandboxOrderCount,
      jobTotal,
      jobSuccess,
      jobFailed: Number(jobRow?.bad || 0),
      successRate: jobTotal ? Math.round((jobSuccess / jobTotal) * 1000) / 1000 : 0,
      byPlatform,
      lastSyncAt,
    };
  }

  // ══════════ 内部工具 ══════════

  private mustGetRow(tenantId: string, id: string): ConnectionRow {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM platform_connections WHERE id = ? AND tenant_id = ?')
      .get(id, tenantId) as ConnectionRow | undefined;
    if (!row) throw new NotFoundError('平台连接', id);
    return row;
  }

  private mustGetJobRow(tenantId: string, id: string): Record<string, any> {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM platform_sync_jobs WHERE id = ? AND tenant_id = ?')
      .get(id, tenantId) as Record<string, any> | undefined;
    if (!row) throw new NotFoundError('同步任务', id);
    return row;
  }

  /** region 字段兼容两种写法：纯字符串区域，或 {region, ...extra} 的 JSON */
  private parseRegion(raw: string | null): { region: string | null; extra: Record<string, string> } {
    if (!raw) return { region: null, extra: {} };
    if (!raw.trim().startsWith('{')) return { region: raw, extra: {} };
    try {
      const obj = JSON.parse(raw) as Record<string, string | null>;
      const { region, ...extra } = obj;
      return { region: region ? String(region) : null, extra: extra as Record<string, string> };
    } catch {
      return { region: raw, extra: {} };
    }
  }

  /** 各平台发起 live 调用所需的最小凭据集（与适配器 hasLiveCredentials 保持一致） */
  private isCredentialsComplete(
    platform: PlatformCode,
    creds: { appKey?: string | null; appSecret?: string | null; accessToken?: string | null; refreshToken?: string | null; shopId?: string | null }
  ): boolean {
    switch (platform) {
      case 'amazon':
        return !!(creds.appKey && creds.appSecret && creds.refreshToken);
      case 'shopify':
        return !!(creds.shopId && creds.accessToken);
      default:
        return !!(creds.appKey && creds.appSecret && creds.accessToken);
    }
  }

  /** 由连接行装配适配器实例（解密凭据只在此处发生，不外泄） */
  private buildAdapter(row: ConnectionRow): PlatformAdapter {
    const parsed = this.parseRegion(row.region);
    const ctx: AdapterContext = {
      connectionId: row.id,
      tenantId: row.tenant_id,
      platform: row.platform as PlatformCode,
      mode: row.status === 'sandbox' ? 'sandbox' : 'live',
      shopName: row.shop_name || undefined,
      region: parsed.region || undefined,
      credentials: {
        appKey: row.app_key || undefined,
        appSecret: decryptSecret(row.app_secret_enc) || undefined,
        accessToken: decryptSecret(row.access_token_enc) || undefined,
        refreshToken: decryptSecret(row.refresh_token_enc) || undefined,
        shopId: row.shop_id || undefined,
        region: parsed.region || undefined,
        extra: parsed.extra,
      },
    };
    return createAdapter(ctx);
  }

  private toConnectionDTO(row: ConnectionRow): ConnectionDTO {
    const parsed = this.parseRegion(row.region);
    const platform = row.platform as PlatformCode;
    const entry = getCatalogEntry(platform);

    const complete = this.isCredentialsComplete(platform, {
      appKey: row.app_key,
      appSecret: decryptSecret(row.app_secret_enc),
      accessToken: decryptSecret(row.access_token_enc),
      refreshToken: decryptSecret(row.refresh_token_enc),
      shopId: row.shop_id,
    });
    const sandbox = row.status === 'sandbox' || !complete;

    return {
      id: row.id,
      platform,
      platformName: entry ? entry.displayName : platform,
      shopName: row.shop_name,
      shopId: row.shop_id,
      region: parsed.region,
      authMode: row.auth_mode || 'oauth',
      appKeyMasked: maskPlain(row.app_key),
      hasAppSecret: hasSecret(row.app_secret_enc),
      appSecretMasked: maskSecret(row.app_secret_enc),
      hasAccessToken: hasSecret(row.access_token_enc),
      accessTokenMasked: maskSecret(row.access_token_enc),
      hasRefreshToken: hasSecret(row.refresh_token_enc),
      tokenExpiresAt: row.token_expires_at,
      status: row.status as ConnectionStatus,
      mode: sandbox ? 'sandbox' : 'live',
      sandbox,
      credentialsComplete: complete,
      lastError: row.last_error,
      lastSyncAt: row.last_sync_at,
      syncIntervalMinutes: Number(row.sync_interval_minutes ?? 30),
      capabilities: this.safeParseArray(row.capabilities) as ResourceType[],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toJobDTO(row: Record<string, unknown>): SyncJobDTO {
    return {
      id: String(row.id),
      connectionId: String(row.connection_id),
      platform: row.platform ? (String(row.platform) as PlatformCode) : null,
      shopName: row.shop_name ? String(row.shop_name) : null,
      resource: String(row.resource) as ResourceType,
      direction: String(row.direction || 'pull'),
      status: String(row.status || 'pending'),
      cursor: row.cursor ? String(row.cursor) : null,
      sinceTime: row.since_time ? String(row.since_time) : null,
      untilTime: row.until_time ? String(row.until_time) : null,
      totalCount: Number(row.total_count || 0),
      successCount: Number(row.success_count || 0),
      failedCount: Number(row.failed_count || 0),
      errorMessage: row.error_message ? String(row.error_message) : null,
      startedAt: row.started_at ? String(row.started_at) : null,
      finishedAt: row.finished_at ? String(row.finished_at) : null,
      createdAt: String(row.created_at || ''),
      sandbox: String(row.conn_status || '') === 'sandbox',
    };
  }

  /**
   * 订单去重 upsert。
   * 去重键：(tenant_id, platform, platform_order_id)；
   * 沙箱订单的 order_no 追加 SBX- 前缀，便于统计与人工识别。
   *
   * 已知 schema 缺口（需组长补列，当前做降级处理）：
   *   - 无 platform_subsidy 列 → 平台补贴并入 discount 合计
   *   - 无 currency 列        → 非 CNY 币种在 remark 中标注
   *   - 无 is_sandbox 列      → 用 order_no 的 SBX- 前缀 + remark 标注
   */
  private upsertOrder(tenantId: string, connectionId: string, order: NormalizedOrder): void {
    const db = getDatabase();

    if (!order.platformOrderId) {
      throw new Error('平台订单号为空，无法落库');
    }

    const orderNo = order._sandbox ? `${SANDBOX_ORDER_PREFIX}${order.orderNo}` : order.orderNo;
    const totalDiscount = Math.round((order.discount + order.platformSubsidy) * 100) / 100;
    const remarkParts: string[] = [];
    if (order._sandbox) remarkParts.push('【沙箱演练订单·非真实平台数据】');
    if (order.currency && order.currency !== 'CNY') remarkParts.push(`币种:${order.currency}`);
    if (order.platformSubsidy > 0) remarkParts.push(`平台补贴:${order.platformSubsidy}`);
    if (order.remark) remarkParts.push(order.remark);
    const remark = remarkParts.join(' ') || null;

    const existing = db.prepare(
      'SELECT id FROM orders WHERE tenant_id = ? AND platform = ? AND platform_order_id = ?'
    ).get(tenantId, order.platform, order.platformOrderId) as { id: string } | undefined;

    const itemsJson = JSON.stringify(order.items);

    if (existing) {
      db.prepare(
        `UPDATE orders SET
           customer_name = ?, customer_phone = ?, customer_email = ?, shipping_address = ?,
           items = ?, subtotal = ?, discount = ?, shipping_fee = ?, tax = ?,
           total_amount = ?, paid_amount = ?, payment_method = ?, payment_status = ?, order_status = ?,
           shipping_no = ?, shipping_company = ?, shipped_at = ?, remark = ?,
           source_connection_id = ?, updated_at = datetime('now', '+0000')
         WHERE id = ? AND tenant_id = ?`
      ).run(
        order.buyerNick || order.receiverName, order.receiverPhone, order.buyerEmail, order.shippingAddress,
        itemsJson, order.subtotal, totalDiscount, order.shippingFee, order.tax,
        order.totalAmount, order.paidAmount, order.paymentMethod, order.paymentStatus, order.orderStatus,
        order.shippingNo, order.shippingCompany, order.shippedAt, remark,
        connectionId,
        existing.id, tenantId
      );
      return;
    }

    // order_no 撞 UNIQUE(tenant_id, order_no) 时补随机后缀，保证同步不被历史脏数据卡死
    let finalOrderNo = orderNo;
    const dup = db.prepare('SELECT id FROM orders WHERE tenant_id = ? AND order_no = ?')
      .get(tenantId, finalOrderNo) as { id: string } | undefined;
    if (dup) finalOrderNo = `${orderNo}-${randomUUID().slice(0, 6)}`;

    db.prepare(
      `INSERT INTO orders
         (id, tenant_id, order_no, platform, platform_order_id,
          customer_name, customer_phone, customer_email, shipping_address, items,
          subtotal, discount, shipping_fee, tax, total_amount, paid_amount,
          payment_method, payment_status, order_status,
          shipping_no, shipping_company, shipped_at, remark,
          source_connection_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+0000'))`
    ).run(
      randomUUID(), tenantId, finalOrderNo, order.platform, order.platformOrderId,
      order.buyerNick || order.receiverName, order.receiverPhone, order.buyerEmail, order.shippingAddress, itemsJson,
      order.subtotal, totalDiscount, order.shippingFee, order.tax, order.totalAmount, order.paidAmount,
      order.paymentMethod, order.paymentStatus, order.orderStatus,
      order.shippingNo, order.shippingCompany, order.shippedAt, remark,
      connectionId, order.createdAt
    );
  }

  private writeLog(
    tenantId: string,
    jobId: string | null,
    connectionId: string | null,
    level: 'info' | 'warn' | 'error',
    message: string,
    payload?: Record<string, unknown>
  ): void {
    try {
      getDatabase().prepare(
        `INSERT INTO platform_sync_logs (id, tenant_id, job_id, connection_id, level, message, payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+0000'))`
      ).run(
        randomUUID(), tenantId, jobId, connectionId, level,
        message.slice(0, 1000),
        payload ? JSON.stringify(payload).slice(0, 4000) : null
      );
    } catch (e) {
      // 日志写失败不能影响主流程
      logger.warn('platform', `写同步日志失败: ${String(e)}`);
    }
  }

  private safeParse(raw: unknown): Record<string, unknown> | null {
    if (!raw) return null;
    try {
      const v = JSON.parse(String(raw));
      return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : { value: v };
    } catch {
      return null;
    }
  }

  private safeParseArray(raw: unknown): string[] {
    if (!raw) return [];
    try {
      const v = JSON.parse(String(raw));
      return Array.isArray(v) ? v.map(String) : [];
    } catch {
      return [];
    }
  }
}

export const platformService = new PlatformService();
export default platformService;
