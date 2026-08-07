/**
 * 数据分析路由（Analytics Routes）— 挂载于 /api/analytics
 *
 * 全部端点走 authenticateToken + tenantIsolation，
 * 入参用 zod 校验，日期缺省为「近 30 天」。
 * 数据全部来自 analyticsService 的真实 SQL 聚合，无任何占位数据。
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { analyticsService, todayStr, addDays } from '../services/analyticsService';
import { authenticateToken, tenantIsolation } from '../middleware/auth';
import { asyncHandler, successResponse } from '../middleware/common';

const router = Router();
router.use(authenticateToken, tenantIsolation);

// ──────────────── 通用校验片段 ────────────────

/** YYYY-MM-DD 形状校验（真实性由 assertValidDate 二次校验） */
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: '日期格式必须为 YYYY-MM-DD' });

const rangeSchema = z.object({
  from: dateStr.optional(),
  to: dateStr.optional(),
});

/** 形状合法不代表日期存在（如 2026-02-31），这里做真实性校验 */
function assertValidDate(s: string): void {
  const t = Date.parse(`${s}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== s) {
    throw new Error(`日期不合法: ${s}`);
  }
}

/** 解析并兜底日期区间：默认近 30 天；from > to 时自动交换 */
function resolveRange(input: { from?: string; to?: string }): { from: string; to: string } {
  if (input.from) assertValidDate(input.from);
  if (input.to) assertValidDate(input.to);
  const to = input.to || todayStr();
  const from = input.from || addDays(to, -29);
  return from <= to ? { from, to } : { from: to, to: from };
}

/** limit 手工解析（zod shim 无 coerce.number） */
function parseLimit(raw: unknown, fallback: number): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 50) {
    throw new Error('limit 必须是 1~50 之间的整数');
  }
  return n;
}

/** 区间跨度上限，防止一次拉爆内存 */
const MAX_RANGE_DAYS = 731;
function assertRangeSpan(range: { from: string; to: string }): void {
  const span = Math.round(
    (Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86400000
  ) + 1;
  if (span > MAX_RANGE_DAYS) {
    throw new Error(`查询区间不得超过 ${MAX_RANGE_DAYS} 天（当前 ${span} 天），请缩小范围`);
  }
}

// ──────────────── 1. 总览 ────────────────

// GET /api/analytics/overview?from&to&compare
router.get('/overview', asyncHandler(async (req: Request, res: Response) => {
  const q = rangeSchema.extend({
    compare: z.enum(['none', 'prev', 'yoy']).optional(),
  }).parse(req.query);

  const range = resolveRange(q);
  assertRangeSpan(range);

  const data = analyticsService.getOverview(req.user!.tenantId, {
    ...range,
    compare: q.compare || 'none',
  });
  successResponse(res, data);
}));

// ──────────────── 2. 趋势 ────────────────

// GET /api/analytics/trend?metric&granularity&from&to
router.get('/trend', asyncHandler(async (req: Request, res: Response) => {
  const q = rangeSchema.extend({
    metric: z.enum(['gmv', 'orders', 'aov', 'gross_profit', 'conversion', 'refund_rate']).optional(),
    granularity: z.enum(['day', 'week', 'month']).optional(),
  }).parse(req.query);

  const range = resolveRange(q);
  assertRangeSpan(range);

  const data = analyticsService.getTrend(req.user!.tenantId, {
    metric: q.metric || 'gmv',
    granularity: q.granularity || 'day',
    ...range,
  });
  successResponse(res, data);
}));

// ──────────────── 3. 全链路漏斗 ────────────────

// GET /api/analytics/funnel?from&to
router.get('/funnel', asyncHandler(async (req: Request, res: Response) => {
  const range = resolveRange(rangeSchema.parse(req.query));
  assertRangeSpan(range);
  successResponse(res, analyticsService.getFunnel(req.user!.tenantId, range));
}));

// ──────────────── 4. 多维拆解 ────────────────

// GET /api/analytics/breakdown?dimension&metric&from&to&limit
router.get('/breakdown', asyncHandler(async (req: Request, res: Response) => {
  const q = rangeSchema.extend({
    dimension: z.enum([
      'platform', 'category', 'product', 'employee',
      'department', 'business_line', 'live_session',
    ]).optional(),
    metric: z.enum(['gmv', 'orders', 'gross_profit']).optional(),
  }).parse(req.query);

  const range = resolveRange(q);
  assertRangeSpan(range);

  const data = analyticsService.getDimensionBreakdown(req.user!.tenantId, {
    dimension: q.dimension || 'platform',
    metric: q.metric || 'gmv',
    limit: parseLimit(req.query.limit, 10),
    ...range,
  });
  successResponse(res, data);
}));

// ──────────────── 5. 商品分析 ────────────────

// GET /api/analytics/products?from&to
router.get('/products', asyncHandler(async (req: Request, res: Response) => {
  const range = resolveRange(rangeSchema.parse(req.query));
  assertRangeSpan(range);
  successResponse(res, analyticsService.getProductAnalysis(req.user!.tenantId, range));
}));

// ──────────────── 6. 人效分析 ────────────────

// GET /api/analytics/employees?period  （period: YYYY 或 YYYY-MM，默认本月）
router.get('/employees', asyncHandler(async (req: Request, res: Response) => {
  const q = z.object({
    period: z.string().regex(/^\d{4}(-\d{2})?$/, { message: 'period 格式必须为 YYYY 或 YYYY-MM' }).optional(),
  }).parse(req.query);

  const data = analyticsService.getEmployeeEfficiency(req.user!.tenantId, {
    period: q.period || todayStr().slice(0, 7),
  });
  successResponse(res, data);
}));

// ──────────────── 7. 客户分析 ────────────────

// GET /api/analytics/customers?from&to
router.get('/customers', asyncHandler(async (req: Request, res: Response) => {
  const range = resolveRange(rangeSchema.parse(req.query));
  assertRangeSpan(range);
  successResponse(res, analyticsService.getCustomerAnalysis(req.user!.tenantId, range));
}));

// ──────────────── 8. 经营健康度 ────────────────

// GET /api/analytics/health  （固定统计窗口：近 30 天）
router.get('/health', asyncHandler(async (req: Request, res: Response) => {
  successResponse(res, analyticsService.getHealthScore(req.user!.tenantId));
}));

// ──────────────── 9. 快照固化 ────────────────

// POST /api/analytics/snapshots/compute  body: { periodType, date }
router.post('/snapshots/compute', asyncHandler(async (req: Request, res: Response) => {
  const body = z.object({
    periodType: z.enum(['day', 'week', 'month', 'quarter', 'year']).optional(),
    date: dateStr.optional(),
  }).parse(req.body || {});

  if (body.date) assertValidDate(body.date);

  const data = analyticsService.computeSnapshots(
    req.user!.tenantId,
    body.periodType || 'day',
    body.date || todayStr()
  );
  successResponse(res, data, '指标快照已固化');
}));

// ──────────────── 10. 结构化报告 ────────────────

// GET /api/analytics/report?from&to
router.get('/report', asyncHandler(async (req: Request, res: Response) => {
  const range = resolveRange(rangeSchema.parse(req.query));
  assertRangeSpan(range);
  successResponse(res, analyticsService.exportReport(req.user!.tenantId, range));
}));

export default router;
