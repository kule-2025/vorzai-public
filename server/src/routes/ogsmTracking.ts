/**
 * OGSM 时间序列追踪 + 经营对标 + 偏离告警 路由
 *
 * /api/ogsm-tracking/snapshots
 *   POST   /                创建单个目标快照
 *   POST   /daily-capture   批量自动打点（租户内所有 active 目标）
 *   GET    /time-series     获取目标时间序列
 *   GET    /tenant-overview 租户整体趋势
 *
 * /api/ogsm-tracking/metric-links
 *   POST   /                创建对标
 *   GET    /                列表（可按 goalId 过滤）
 *   PATCH  /:id             更新（scaleFactor/autoSync/status）
 *   DELETE /:id             删除
 *   POST   /:id/sync        触发同步
 *   POST   /sync-all        批量同步所有 active 链接
 *
 * /api/ogsm-tracking/deviations
 *   GET    /                列表（含未确认/按严重度过滤）
 *   POST   /scan            手动触发扫描
 *   POST   /:id/acknowledge 确认告警
 */

import { Router, Request, Response } from 'express';
import { successResponse, errorResponse } from '../middleware/common';
import { authenticateToken, tenantIsolation } from '../middleware/auth';
import { ogsmTrackingService } from '../services/ogsmTrackingService';
import { z } from 'zod';

const router = Router();

router.use(authenticateToken, tenantIsolation);

// ── 快照 ─────────────────────────────────────────────────────
const snapshotSchema = z.object({
  objective_id: z.string().uuid(),
  snapshot_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: z.string().optional(),
});

router.post('/snapshots', (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const parsed = snapshotSchema.safeParse(req.body);
  if (!parsed.success) return errorResponse(res, 400, parsed.error.message);
  try {
    const snap = ogsmTrackingService.createSnapshot(
      tenantId,
      parsed.data.objective_id,
      parsed.data.snapshot_date,
      parsed.data.note
    );
    successResponse(res, snap);
  } catch (e) {
    errorResponse(res, 400, e instanceof Error ? e.message : String(e));
  }
});

router.post('/snapshots/daily-capture', (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const snapshotDate = (req.body as { snapshotDate?: string }).snapshotDate;
  const r = ogsmTrackingService.captureDailySnapshots(tenantId, snapshotDate);
  successResponse(res, r);
});

const timeSeriesSchema = z.object({
  objective_id: z.string().uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

router.get('/snapshots/time-series', (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const parsed = timeSeriesSchema.safeParse(req.query);
  if (!parsed.success) return errorResponse(res, 400, parsed.error.message);
  const series = ogsmTrackingService.getTimeSeries(
    tenantId,
    parsed.data.objective_id,
    parsed.data.from,
    parsed.data.to
  );
  if (!series) return errorResponse(res, 404, '目标不存在');
  successResponse(res, series);
});

router.get('/snapshots/tenant-overview', (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const days = Number((req.query as { days?: string }).days) || 30;
  successResponse(res, ogsmTrackingService.getTenantOverview(tenantId, days));
});

// ── 经营对标 ─────────────────────────────────────────────────
const createLinkSchema = z.object({
  goal_id: z.string().uuid(),
  metric_key: z.enum(['gmv', 'orders', 'aov', 'gross_profit', 'gross_margin_rate', 'conversion', 'refund_rate', 'paid_orders', 'cost', 'active_sku']),
  period_type: z.enum(['day', 'week', 'month', 'quarter', 'year']).optional(),
  scale_factor: z.number().positive().optional(),
  auto_sync: z.boolean().optional(),
});

router.post('/metric-links', (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const userId = req.user!.userId;
  const parsed = createLinkSchema.safeParse(req.body);
  if (!parsed.success) return errorResponse(res, 400, parsed.error.message);
  try {
    const link = ogsmTrackingService.createMetricLink(
      tenantId,
      parsed.data.goal_id,
      parsed.data.metric_key,
      parsed.data.period_type ?? 'month',
      { scaleFactor: parsed.data.scale_factor, autoSync: parsed.data.auto_sync, createdBy: userId }
    );
    successResponse(res, link);
  } catch (e) {
    errorResponse(res, 400, e instanceof Error ? e.message : String(e));
  }
});

router.get('/metric-links', (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const goalId = (req.query as { goal_id?: string }).goal_id;
  successResponse(res, ogsmTrackingService.listMetricLinks(tenantId, goalId));
});

const updateLinkSchema = z.object({
  scale_factor: z.number().positive().optional(),
  auto_sync: z.boolean().optional(),
  status: z.enum(['active', 'paused', 'archived']).optional(),
});

router.patch('/metric-links/:id', (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const parsed = updateLinkSchema.safeParse(req.body);
  if (!parsed.success) return errorResponse(res, 400, parsed.error.message);
  const link = ogsmTrackingService.updateMetricLink(req.params.id, tenantId, {
    scaleFactor: parsed.data.scale_factor,
    autoSync: parsed.data.auto_sync,
    status: parsed.data.status,
  });
  if (!link) return errorResponse(res, 404, '对标不存在');
  successResponse(res, link);
});

router.delete('/metric-links/:id', (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const ok = ogsmTrackingService.deleteMetricLink(req.params.id, tenantId);
  if (!ok) return errorResponse(res, 404, '对标不存在');
  successResponse(res, { deleted: true });
});

router.post('/metric-links/:id/sync', (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const result = ogsmTrackingService.syncMetricLink(req.params.id, tenantId);
  if (!result) return errorResponse(res, 404, '对标不存在或已停用');
  successResponse(res, result);
});

router.post('/metric-links/sync-all', (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  successResponse(res, ogsmTrackingService.syncAllLinks(tenantId));
});

// ── 偏离告警 ─────────────────────────────────────────────────
router.get('/deviations', (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const acknowledgedQ = (req.query as { acknowledged?: string }).acknowledged;
  const severity = (req.query as { severity?: string }).severity;
  const acknowledged = acknowledgedQ === undefined ? undefined : acknowledgedQ === 'true';
  successResponse(res, ogsmTrackingService.listDeviations(tenantId, { acknowledged, severity }));
});

router.post('/deviations/scan', (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const snapshotDate = (req.body as { snapshotDate?: string }).snapshotDate;
  successResponse(res, ogsmTrackingService.detectDeviations(tenantId, snapshotDate));
});

router.post('/deviations/:id/acknowledge', (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const userId = req.user!.userId;
  const deviation = ogsmTrackingService.acknowledgeDeviation(req.params.id, tenantId, userId);
  if (!deviation) return errorResponse(res, 404, '告警不存在');
  successResponse(res, deviation);
});

export default router;