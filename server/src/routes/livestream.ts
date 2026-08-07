/**
 * 直播电商路由（Livestream Routes）
 * 挂载点：/api/livestream
 *
 * 分组：
 *   场次     GET|POST /sessions、GET|PUT|DELETE /sessions/:id、POST /sessions/:id/advance
 *   脚本     GET|POST /sessions/:id/scripts、PUT|DELETE /scripts/:scriptId
 *            POST /sessions/:id/scripts/generate、POST /sessions/:id/scripts/compliance-check
 *   选品     GET|POST /sessions/:id/products、DELETE /sessions/:id/products/:productId
 *            PUT /sessions/:id/products/:productId/slot、GET /sessions/:id/timeline
 *   指标     POST|GET /sessions/:id/metrics、GET /sessions/:id/snapshot
 *   复盘     POST|GET /sessions/:id/review
 *   绩效     GET /anchors/:employeeId/performance
 *   总览     GET /overview
 *
 * 所有端点均经 authenticateToken + tenantIsolation，tenantId 一律取自 req.user!.tenantId，
 * 绝不接受客户端传入的租户标识。入参统一用 zod 校验。
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { livestreamService, LiveSessionStatus, LiveSegmentType } from '../services/livestreamService';
import { authenticateToken, tenantIsolation } from '../middleware/auth';
import { asyncHandler, successResponse, paginatedResponse } from '../middleware/common';

const router = Router();
router.use(authenticateToken, tenantIsolation);

// ==================== zod schema ====================

const STATUS_VALUES = ['planned', 'ready', 'living', 'ended', 'reviewed', 'cancelled'] as const;
const SEGMENT_VALUES = ['warmup', 'sell', 'interact', 'flashsale', 'lottery', 'closing'] as const;

const sessionCreateSchema = z.object({
  projectId: z.string().optional(),
  title: z.string().min(1, '场次标题不能为空').max(120),
  platform: z.string().max(40).optional(),
  roomId: z.string().max(80).optional(),
  anchorEmployeeId: z.string().optional(),
  assistantEmployeeId: z.string().optional(),
  plannedStart: z.string().optional(),
  plannedEnd: z.string().optional(),
  targetGmv: z.number().nonnegative().optional(),
  targetOrders: z.number().int().nonnegative().optional(),
  coverUrl: z.string().max(500).optional(),
  remark: z.string().max(1000).optional(),
});

const sessionUpdateSchema = sessionCreateSchema.partial();

const advanceSchema = z.object({
  to: z.enum(STATUS_VALUES),
});

const scriptSchema = z.object({
  id: z.string().optional(),
  segmentNo: z.number().int().positive().optional(),
  segmentType: z.enum(SEGMENT_VALUES).optional(),
  title: z.string().min(1, '分段标题不能为空').max(120),
  productId: z.string().optional(),
  durationMinutes: z.number().int().positive().max(600).optional(),
  talkTrack: z.string().max(20000).optional(),
  sellingPoints: z.array(z.string().max(500)).optional(),
  objectionHandling: z.array(z.object({
    objection: z.string().max(200),
    response: z.string().max(2000),
  })).optional(),
  ctaText: z.string().max(1000).optional(),
});

const scriptUpdateSchema = scriptSchema.partial();

const reorderScriptsSchema = z.object({
  orderedIds: z.array(z.string().min(1)).min(1, '排序列表不能为空'),
});

const generateScriptSchema = z.object({
  totalMinutes: z.number().int().positive().max(1440).optional(),
  includeFlashSale: z.boolean().optional(),
  interactEvery: z.number().int().positive().max(20).optional(),
  overwrite: z.boolean().optional(),
  tone: z.enum(['professional', 'warm', 'energetic']).optional(),
});

const addProductsSchema = z.object({
  items: z.array(z.object({
    productId: z.string().min(1),
    livePrice: z.number().nonnegative().optional(),
    plannedDurationMinutes: z.number().int().positive().max(600).optional(),
    stockLocked: z.number().int().nonnegative().optional(),
  })).min(1, '请至少选择一个商品'),
});

const reorderProductsSchema = z.object({
  orderedProductIds: z.array(z.string().min(1)).min(1, '排序列表不能为空'),
});

const slotSchema = z.object({
  plannedSlotStart: z.string().optional(),
  plannedDurationMinutes: z.number().int().positive().max(600).optional(),
  livePrice: z.number().nonnegative().optional(),
  stockLocked: z.number().int().nonnegative().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  explainedCount: z.number().int().nonnegative().optional(),
  soldQty: z.number().int().nonnegative().optional(),
  gmv: z.number().nonnegative().optional(),
});

const metricSchema = z.object({
  capturedAt: z.string().optional(),
  onlineUsers: z.number().int().nonnegative().optional(),
  cumulativeUv: z.number().int().nonnegative().optional(),
  newFollowers: z.number().int().nonnegative().optional(),
  comments: z.number().int().nonnegative().optional(),
  likes: z.number().int().nonnegative().optional(),
  shares: z.number().int().nonnegative().optional(),
  cartClicks: z.number().int().nonnegative().optional(),
  orders: z.number().int().nonnegative().optional(),
  gmv: z.number().nonnegative().optional(),
  avgStaySeconds: z.number().nonnegative().optional(),
});

// 批量导入：{ items: [ ...metric ] }
const batchMetricSchema = z.object({
  items: z.array(metricSchema).min(1, '导入数据不能为空').max(2000),
});

// ==================== 总览 ====================

// GET /api/livestream/overview — 直播总览（本月场次/GMV/UV 价值/Top 主播/近期场次）
router.get('/overview', asyncHandler(async (req: Request, res: Response) => {
  const data = livestreamService.getOverview(req.user!.tenantId);
  successResponse(res, data, '直播总览加载成功');
}));

// GET /api/livestream/compliance/lexicon — 违禁词库（供写稿时实时提示）
router.get('/compliance/lexicon', asyncHandler(async (_req: Request, res: Response) => {
  successResponse(res, livestreamService.getComplianceLexicon());
}));

// ==================== 场次管理 ====================

// GET /api/livestream/sessions — 场次列表（状态/平台/主播/时间范围筛选 + 分页）
router.get('/sessions', asyncHandler(async (req: Request, res: Response) => {
  const query = z.object({
    status: z.enum(STATUS_VALUES).optional(),
    platform: z.string().optional(),
    anchorId: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    keyword: z.string().optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
  }).parse(req.query);

  const result = livestreamService.listSessions(req.user!.tenantId, query);
  paginatedResponse(res, result.data, result.pagination);
}));

// POST /api/livestream/sessions — 新建场次
router.post('/sessions', asyncHandler(async (req: Request, res: Response) => {
  const input = sessionCreateSchema.parse(req.body);
  const data = livestreamService.createSession(req.user!.tenantId, input);
  successResponse(res, data, '直播场次创建成功', 201);
}));

// GET /api/livestream/sessions/:id — 场次详情（含脚本、选品、最新指标、复盘）
router.get('/sessions/:id', asyncHandler(async (req: Request, res: Response) => {
  const data = livestreamService.getSessionDetail(req.user!.tenantId, req.params.id);
  successResponse(res, data);
}));

// PUT /api/livestream/sessions/:id — 更新场次
router.put('/sessions/:id', asyncHandler(async (req: Request, res: Response) => {
  const input = sessionUpdateSchema.parse(req.body);
  const data = livestreamService.updateSession(req.user!.tenantId, req.params.id, input);
  successResponse(res, data, '场次已更新');
}));

// DELETE /api/livestream/sessions/:id — 删除场次（含关联脚本/选品/指标/复盘）
router.delete('/sessions/:id', asyncHandler(async (req: Request, res: Response) => {
  const data = livestreamService.deleteSession(req.user!.tenantId, req.params.id);
  successResponse(res, data, '场次已删除');
}));

// POST /api/livestream/sessions/:id/advance — 状态机流转
router.post('/sessions/:id/advance', asyncHandler(async (req: Request, res: Response) => {
  const { to } = advanceSchema.parse(req.body);
  const data = livestreamService.advanceStatus(
    req.user!.tenantId, req.params.id, to as LiveSessionStatus
  );
  successResponse(res, data, '场次状态已更新');
}));

// ==================== 直播脚本 ====================

// GET /api/livestream/sessions/:id/scripts — 脚本分段列表
router.get('/sessions/:id/scripts', asyncHandler(async (req: Request, res: Response) => {
  const data = livestreamService.listScripts(req.user!.tenantId, req.params.id);
  successResponse(res, data);
}));

// POST /api/livestream/sessions/:id/scripts — 新增脚本分段
router.post('/sessions/:id/scripts', asyncHandler(async (req: Request, res: Response) => {
  const input = scriptSchema.parse(req.body);
  const data = livestreamService.upsertScript(req.user!.tenantId, req.params.id, {
    ...input,
    segmentType: input.segmentType as LiveSegmentType | undefined,
  });
  successResponse(res, data, '脚本分段已保存', 201);
}));

// PUT /api/livestream/sessions/:id/scripts/reorder — 脚本分段重排序
router.put('/sessions/:id/scripts/reorder', asyncHandler(async (req: Request, res: Response) => {
  const { orderedIds } = reorderScriptsSchema.parse(req.body);
  const data = livestreamService.reorderScripts(req.user!.tenantId, req.params.id, orderedIds);
  successResponse(res, data, '脚本顺序已调整');
}));

// POST /api/livestream/sessions/:id/scripts/generate — 一键生成全场脚本
router.post('/sessions/:id/scripts/generate', asyncHandler(async (req: Request, res: Response) => {
  const options = generateScriptSchema.parse(req.body || {});
  const data = livestreamService.generateScript(req.user!.tenantId, req.params.id, options);
  successResponse(res, data, `已生成 ${data.length} 段直播脚本`, 201);
}));

// POST /api/livestream/sessions/:id/scripts/compliance-check — 全场脚本合规检查
router.post('/sessions/:id/scripts/compliance-check', asyncHandler(async (req: Request, res: Response) => {
  const data = livestreamService.checkScriptCompliance(req.user!.tenantId, req.params.id);
  successResponse(
    res, data,
    data.passed
      ? `合规检查通过，共扫描 ${data.scannedSegments} 段脚本`
      : `发现 ${data.highCount} 处高危违禁表述，开播前必须整改`
  );
}));

// PUT /api/livestream/scripts/:scriptId — 更新脚本分段
router.put('/scripts/:scriptId', asyncHandler(async (req: Request, res: Response) => {
  const input = scriptUpdateSchema.parse(req.body);
  const data = livestreamService.updateScript(req.user!.tenantId, req.params.scriptId, {
    ...input,
    segmentType: input.segmentType as LiveSegmentType | undefined,
  });
  successResponse(res, data, '脚本分段已更新');
}));

// DELETE /api/livestream/scripts/:scriptId — 删除脚本分段
router.delete('/scripts/:scriptId', asyncHandler(async (req: Request, res: Response) => {
  const data = livestreamService.deleteScript(req.user!.tenantId, req.params.scriptId);
  successResponse(res, data, '脚本分段已删除');
}));

// ==================== 选品排期 ====================

// GET /api/livestream/sessions/:id/products — 场次选品列表
router.get('/sessions/:id/products', asyncHandler(async (req: Request, res: Response) => {
  const data = livestreamService.listSessionProducts(req.user!.tenantId, req.params.id);
  successResponse(res, data);
}));

// POST /api/livestream/sessions/:id/products — 批量加品
router.post('/sessions/:id/products', asyncHandler(async (req: Request, res: Response) => {
  const { items } = addProductsSchema.parse(req.body);
  const data = livestreamService.addProducts(req.user!.tenantId, req.params.id, items);
  successResponse(
    res, data,
    `已加入 ${data.added} 个商品${data.skipped > 0 ? `，${data.skipped} 个已存在被跳过` : ''}`,
    201
  );
}));

// PUT /api/livestream/sessions/:id/products/reorder — 选品重排序
router.put('/sessions/:id/products/reorder', asyncHandler(async (req: Request, res: Response) => {
  const { orderedProductIds } = reorderProductsSchema.parse(req.body);
  const data = livestreamService.reorderProducts(req.user!.tenantId, req.params.id, orderedProductIds);
  successResponse(res, data, '选品顺序已调整');
}));

// PUT /api/livestream/sessions/:id/products/:productId/slot — 调整讲解时段与直播价
router.put('/sessions/:id/products/:productId/slot', asyncHandler(async (req: Request, res: Response) => {
  const input = slotSchema.parse(req.body);
  const data = livestreamService.updateSlot(
    req.user!.tenantId, req.params.id, req.params.productId, input
  );
  successResponse(res, data, '讲解排期已更新');
}));

// DELETE /api/livestream/sessions/:id/products/:productId — 移除选品
router.delete('/sessions/:id/products/:productId', asyncHandler(async (req: Request, res: Response) => {
  const data = livestreamService.removeProduct(req.user!.tenantId, req.params.id, req.params.productId);
  successResponse(res, data, '商品已从本场移除');
}));

// GET /api/livestream/sessions/:id/timeline — 讲解时间轴 + 总时长校验
router.get('/sessions/:id/timeline', asyncHandler(async (req: Request, res: Response) => {
  const data = livestreamService.getScheduleTimeline(req.user!.tenantId, req.params.id);
  successResponse(res, data);
}));

// ==================== 实时指标 ====================

// POST /api/livestream/sessions/:id/metrics — 录入一条指标快照（手工）
router.post('/sessions/:id/metrics', asyncHandler(async (req: Request, res: Response) => {
  const data = livestreamService.recordMetric(
    req.user!.tenantId, req.params.id, metricSchema.parse(req.body)
  );
  successResponse(res, data, '指标快照已记录', 201);
}));

// POST /api/livestream/sessions/:id/metrics/batch — 批量导入指标快照
router.post('/sessions/:id/metrics/batch', asyncHandler(async (req: Request, res: Response) => {
  const { items } = batchMetricSchema.parse(req.body);
  const data = livestreamService.batchImportMetrics(req.user!.tenantId, req.params.id, items);
  successResponse(res, data, `导入完成：成功 ${data.imported} 条，失败 ${data.failed} 条`, 201);
}));

// GET /api/livestream/sessions/:id/metrics — 指标时间序列
router.get('/sessions/:id/metrics', asyncHandler(async (req: Request, res: Response) => {
  const data = livestreamService.getMetricsTimeline(req.user!.tenantId, req.params.id);
  successResponse(res, data);
}));

// GET /api/livestream/sessions/:id/snapshot — 最新快照 + 目标达成率
router.get('/sessions/:id/snapshot', asyncHandler(async (req: Request, res: Response) => {
  const data = livestreamService.getLiveSnapshot(req.user!.tenantId, req.params.id);
  successResponse(res, data);
}));

// ==================== 复盘 ====================

// POST /api/livestream/sessions/:id/review — 生成/重新生成复盘
router.post('/sessions/:id/review', asyncHandler(async (req: Request, res: Response) => {
  const data = livestreamService.generateReview(
    req.user!.tenantId, req.params.id, req.user!.userId
  );
  successResponse(res, data, `复盘已生成，主播评分 ${data.anchorScore} 分`, 201);
}));

// GET /api/livestream/sessions/:id/review — 查看复盘
router.get('/sessions/:id/review', asyncHandler(async (req: Request, res: Response) => {
  const data = livestreamService.getReview(req.user!.tenantId, req.params.id);
  successResponse(res, data);
}));

// ==================== 主播绩效 ====================

// GET /api/livestream/anchors/:employeeId/performance?period=YYYY-MM
router.get('/anchors/:employeeId/performance', asyncHandler(async (req: Request, res: Response) => {
  const { period } = z.object({
    period: z.string().regex(/^\d{4}(-\d{2})?$/, 'period 格式应为 YYYY 或 YYYY-MM').optional(),
  }).parse(req.query);

  const data = livestreamService.getAnchorPerformance(
    req.user!.tenantId, req.params.employeeId, period
  );
  successResponse(res, data);
}));

// POST /api/livestream/sessions/:id/metrics/sandbox — LC-01: 导入沙箱模板数据
router.post('/sessions/:id/metrics/sandbox', asyncHandler(async (req: Request, res: Response) => {
  const data = livestreamService.addSandboxMetrics(req.user!.tenantId, req.params.id);
  successResponse(res, data, `沙箱数据导入完成：成功 ${data.imported} 条`, 201);
}));

export default router;
