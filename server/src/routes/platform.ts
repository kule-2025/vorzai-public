/**
 * 平台对接路由（Platform Integration Routes）
 *
 * 挂载点：/api/platform
 *
 * 安全口径：
 *   - 全部端点经 authenticateToken + tenantIsolation，租户隔离由 service 层的 SQL 保证
 *   - 请求体一律 zod 校验，拒绝越权字段
 *   - 响应中的密钥类字段全部脱敏（maskSecret / hasXxx），任何情况下不回明文
 *   - 沙箱结果逐级透传 sandbox 标记，供前端打「非真实数据」横幅
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { platformService } from '../services/platformService';
import { authenticateToken, tenantIsolation } from '../middleware/auth';
import { asyncHandler, successResponse, paginatedResponse } from '../middleware/common';

const router = Router();
router.use(authenticateToken, tenantIsolation);

// ────────────────── 校验 schema ──────────────────

const PLATFORM_ENUM = z.enum([
  'douyin', 'amazon', 'taobao', 'jd', 'kuaishou', 'shopify', 'pdd', 'shopee', 'tiktok',
]);

const RESOURCE_ENUM = z.enum(['orders', 'products', 'inventory', 'finance', 'reviews', 'logistics']);

const createConnectionSchema = z.object({
  platform: PLATFORM_ENUM,
  shopName: z.string().max(120).optional(),
  shopId: z.string().max(120).optional(),
  region: z.string().max(60).optional(),
  authMode: z.enum(['oauth', 'apikey', 'manual']).optional(),
  appKey: z.string().max(200).optional(),
  appSecret: z.string().max(500).optional(),
  accessToken: z.string().max(2000).optional(),
  refreshToken: z.string().max(2000).optional(),
  tokenExpiresAt: z.string().max(40).optional(),
  syncIntervalMinutes: z.number().int().min(5).max(1440).optional(),
  sandbox: z.boolean().optional(),
  extra: z.record(z.string()).optional(),
});

const updateConnectionSchema = z.object({
  shopName: z.string().max(120).optional(),
  shopId: z.string().max(120).optional(),
  region: z.string().max(60).optional(),
  authMode: z.enum(['oauth', 'apikey', 'manual']).optional(),
  appKey: z.string().max(200).optional(),
  appSecret: z.string().max(500).optional(),
  accessToken: z.string().max(2000).optional(),
  refreshToken: z.string().max(2000).optional(),
  tokenExpiresAt: z.string().max(40).optional(),
  syncIntervalMinutes: z.number().int().min(5).max(1440).optional(),
  sandbox: z.boolean().optional(),
  extra: z.record(z.string()).optional(),
});

const syncSchema = z.object({
  resource: RESOURCE_ENUM.default('orders'),
  since: z.string().max(40).optional(),
  until: z.string().max(40).optional(),
  /** async=true 时只创建任务不等待执行结果（预留给后续定时调度） */
  async: z.boolean().optional(),
});

// ────────────────── A. 平台目录 ──────────────────

// GET /api/platform/catalog — 支持的平台清单（凭据字段 / 能力 / 真实端点 / 签名算法）
router.get('/catalog', asyncHandler(async (_req: Request, res: Response) => {
  successResponse(res, platformService.getPlatformCatalog());
}));

// ────────────────── B. 连接管理 ──────────────────

// GET /api/platform/connections?platform=&status=
router.get('/connections', asyncHandler(async (req: Request, res: Response) => {
  const list = platformService.listConnections(req.user!.tenantId, {
    platform: req.query.platform ? String(req.query.platform) : undefined,
    status: req.query.status ? String(req.query.status) : undefined,
  });
  successResponse(res, list);
}));

// POST /api/platform/connections
router.post('/connections', asyncHandler(async (req: Request, res: Response) => {
  const input = createConnectionSchema.parse(req.body);
  const conn = platformService.createConnection(req.user!.tenantId, input);
  successResponse(
    res,
    conn,
    conn.sandbox
      ? '连接已创建（沙箱模式）：后续同步产出的均为本地演练数据，非真实平台数据'
      : '连接已创建，请执行连接测试',
    201
  );
}));

// GET /api/platform/connections/:id
router.get('/connections/:id', asyncHandler(async (req: Request, res: Response) => {
  successResponse(res, platformService.getConnection(req.user!.tenantId, req.params.id));
}));

// PUT /api/platform/connections/:id
router.put('/connections/:id', asyncHandler(async (req: Request, res: Response) => {
  const input = updateConnectionSchema.parse(req.body);
  successResponse(res, platformService.updateConnection(req.user!.tenantId, req.params.id, input), '连接配置已更新');
}));

// DELETE /api/platform/connections/:id
router.delete('/connections/:id', asyncHandler(async (req: Request, res: Response) => {
  successResponse(res, platformService.deleteConnection(req.user!.tenantId, req.params.id), '连接已删除');
}));

// POST /api/platform/connections/:id/test — 真实发起一次鉴权探针调用
router.post('/connections/:id/test', asyncHandler(async (req: Request, res: Response) => {
  const result = await platformService.testConnection(req.user!.tenantId, req.params.id);
  successResponse(res, result, result.message);
}));

// POST /api/platform/connections/:id/sync — 触发一次同步（默认同步执行并返回结果）
router.post('/connections/:id/sync', asyncHandler(async (req: Request, res: Response) => {
  const body = syncSchema.parse(req.body || {});
  const tenantId = req.user!.tenantId;

  const job = platformService.createSyncJob(tenantId, req.params.id, {
    resource: body.resource,
    since: body.since,
    until: body.until,
  });

  if (body.async) {
    successResponse(res, job, '同步任务已入队', 202);
    return;
  }

  const finished = await platformService.runSyncJob(tenantId, job.id);
  successResponse(
    res,
    finished,
    finished.sandbox
      ? `同步完成（沙箱演练数据）：成功 ${finished.successCount} 条 / 共 ${finished.totalCount} 条`
      : `同步完成：成功 ${finished.successCount} 条 / 共 ${finished.totalCount} 条`
  );
}));

// ────────────────── C. 同步任务 ──────────────────

// GET /api/platform/jobs?connectionId=&status=&resource=&page=&limit=
router.get('/jobs', asyncHandler(async (req: Request, res: Response) => {
  const result = platformService.listSyncJobs(req.user!.tenantId, {
    connectionId: req.query.connectionId ? String(req.query.connectionId) : undefined,
    status: req.query.status ? String(req.query.status) : undefined,
    resource: req.query.resource ? String(req.query.resource) : undefined,
    page: Number(req.query.page) || 1,
    limit: Number(req.query.limit) || 20,
  });
  paginatedResponse(res, result.data, result.pagination);
}));

// GET /api/platform/jobs/:id
router.get('/jobs/:id', asyncHandler(async (req: Request, res: Response) => {
  successResponse(res, platformService.getSyncJob(req.user!.tenantId, req.params.id));
}));

// POST /api/platform/jobs/:id/run — 执行一个 pending 任务（配合 async 创建使用）
router.post('/jobs/:id/run', asyncHandler(async (req: Request, res: Response) => {
  const job = await platformService.runSyncJob(req.user!.tenantId, req.params.id);
  successResponse(res, job, '同步任务已执行');
}));

// POST /api/platform/jobs/:id/cancel
router.post('/jobs/:id/cancel', asyncHandler(async (req: Request, res: Response) => {
  successResponse(res, platformService.cancelSyncJob(req.user!.tenantId, req.params.id), '同步任务已取消');
}));

// GET /api/platform/jobs/:id/logs
router.get('/jobs/:id/logs', asyncHandler(async (req: Request, res: Response) => {
  const logs = platformService.listSyncLogs(req.user!.tenantId, {
    jobId: req.params.id,
    level: req.query.level ? String(req.query.level) : undefined,
    limit: Number(req.query.limit) || 200,
  });
  successResponse(res, logs);
}));

// GET /api/platform/logs?connectionId=&level=&limit=
router.get('/logs', asyncHandler(async (req: Request, res: Response) => {
  const logs = platformService.listSyncLogs(req.user!.tenantId, {
    connectionId: req.query.connectionId ? String(req.query.connectionId) : undefined,
    level: req.query.level ? String(req.query.level) : undefined,
    limit: Number(req.query.limit) || 100,
  });
  successResponse(res, logs);
}));

// ────────────────── D. 统计 ──────────────────

// GET /api/platform/stats
router.get('/stats', asyncHandler(async (req: Request, res: Response) => {
  successResponse(res, platformService.getStats(req.user!.tenantId));
}));

export default router;
