/**
 * 库存预警 + 业务-HR 归因路由
 *
 * 挂载点：/api/inventory（见 app.ts）
 *
 * 库存预警：
 *   GET    /api/inventory/rules
 *   POST   /api/inventory/rules
 *   PUT    /api/inventory/rules/:id
 *   DELETE /api/inventory/rules/:id
 *   POST   /api/inventory/rules/:id/toggle
 *   POST   /api/inventory/evaluate
 *   GET    /api/inventory/alerts
 *   GET    /api/inventory/alerts/stats
 *   POST   /api/inventory/alerts/:id/acknowledge
 *   POST   /api/inventory/alerts/:id/resolve
 *   POST   /api/inventory/alerts/:id/ignore
 *
 * 业务-HR 归因（子路径 /attribution/*）：
 *   POST   /api/inventory/attribution/compute
 *   GET    /api/inventory/attribution/ranking
 *   GET    /api/inventory/attribution/efficiency
 *   GET    /api/inventory/attribution/employee/:employeeId
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticateToken, tenantIsolation } from '../middleware/auth';
import { asyncHandler, successResponse } from '../middleware/common';
import { inventoryService, attributionService, currentPeriod } from '../services/inventoryService';

const router = Router();
router.use(authenticateToken, tenantIsolation);

// ==================== zod 校验 schema ====================

const ruleTypeEnum = z.enum(['low_stock', 'out_of_stock', 'overstock', 'slow_moving', 'stockout_eta']);
const severityEnum = z.enum(['info', 'warning', 'critical']);
const scopeEnum = z.enum(['all', 'category', 'product']);
const statusEnum = z.enum(['open', 'acknowledged', 'resolved', 'ignored']);
const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'period 格式应为 YYYY-MM' });
/** 查询串里的数字统一走字符串校验后手工转换（项目 zod 类型垫片不支持 z.coerce） */
const numericQuerySchema = z.string().regex(/^\d+$/, { message: '必须为正整数' }).optional();

const createRuleSchema = z.object({
  name: z.string().min(1, { message: '规则名称不能为空' }).max(100),
  scope: scopeEnum.optional(),
  scopeValue: z.string().max(200).nullable().optional(),
  ruleType: ruleTypeEnum,
  threshold: z.number().min(0),
  windowDays: z.number().int().min(1).max(365).optional(),
  severity: severityEnum.optional(),
  notifyChannels: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

const updateRuleSchema = createRuleSchema.partial();

// ==================== 规则 CRUD ====================

// GET /api/inventory/rules — 规则列表（首次访问自动初始化默认规则）
router.get('/rules', asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  inventoryService.ensureDefaultRules(tenantId);
  const rules = inventoryService.listRules(tenantId);
  successResponse(res, rules, '规则列表加载成功');
}));

// POST /api/inventory/rules — 新建规则
router.post('/rules', asyncHandler(async (req: Request, res: Response) => {
  const input = createRuleSchema.parse(req.body);
  const rule = inventoryService.createRule(req.user!.tenantId, input);
  successResponse(res, rule, '规则创建成功', 201);
}));

// PUT /api/inventory/rules/:id — 更新规则
router.put('/rules/:id', asyncHandler(async (req: Request, res: Response) => {
  const input = updateRuleSchema.parse(req.body);
  const rule = inventoryService.updateRule(req.user!.tenantId, req.params.id, input);
  successResponse(res, rule, '规则更新成功');
}));

// DELETE /api/inventory/rules/:id — 删除规则
router.delete('/rules/:id', asyncHandler(async (req: Request, res: Response) => {
  const result = inventoryService.deleteRule(req.user!.tenantId, req.params.id);
  successResponse(res, result, '规则已删除');
}));

// POST /api/inventory/rules/:id/toggle — 启停规则
router.post('/rules/:id/toggle', asyncHandler(async (req: Request, res: Response) => {
  const { enabled } = z.object({ enabled: z.boolean().optional() }).parse(req.body ?? {});
  const rule = inventoryService.toggleRule(req.user!.tenantId, req.params.id, enabled);
  successResponse(res, rule, rule.enabled ? '规则已启用' : '规则已停用');
}));

// ==================== 规则评估 ====================

// POST /api/inventory/evaluate — 立即执行一次全量规则评估
router.post('/evaluate', asyncHandler(async (req: Request, res: Response) => {
  const result = inventoryService.evaluateRules(req.user!.tenantId);
  successResponse(
    res,
    result,
    `评估完成：新增 ${result.created} 条告警，更新 ${result.updated} 条，自动关闭 ${result.autoResolved} 条`
  );
}));

// ==================== 告警管理 ====================

// GET /api/inventory/alerts/stats — 告警汇总统计（须置于 /alerts/:id 之前）
router.get('/alerts/stats', asyncHandler(async (req: Request, res: Response) => {
  const stats = inventoryService.getAlertStats(req.user!.tenantId);
  successResponse(res, stats, '告警统计加载成功');
}));

// GET /api/inventory/alerts — 告警列表（支持状态/严重度/商品过滤 + 分页）
router.get('/alerts', asyncHandler(async (req: Request, res: Response) => {
  const query = z.object({
    status: statusEnum.optional(),
    severity: severityEnum.optional(),
    productId: z.string().optional(),
    alertType: ruleTypeEnum.optional(),
    page: numericQuerySchema,
    limit: numericQuerySchema,
  }).parse(req.query);

  const result = inventoryService.listAlerts(req.user!.tenantId, {
    status: query.status,
    severity: query.severity,
    productId: query.productId,
    alertType: query.alertType,
    page: query.page ? Number(query.page) : 1,
    limit: query.limit ? Number(query.limit) : 20,
  });
  successResponse(res, result, '告警列表加载成功');
}));

// POST /api/inventory/alerts/:id/acknowledge — 确认告警
router.post('/alerts/:id/acknowledge', asyncHandler(async (req: Request, res: Response) => {
  const alert = inventoryService.acknowledgeAlert(req.user!.tenantId, req.params.id, req.user!.userId);
  successResponse(res, alert, '告警已确认');
}));

// POST /api/inventory/alerts/:id/resolve — 标记已解决
router.post('/alerts/:id/resolve', asyncHandler(async (req: Request, res: Response) => {
  const alert = inventoryService.resolveAlert(req.user!.tenantId, req.params.id, req.user!.userId);
  successResponse(res, alert, '告警已解决');
}));

// POST /api/inventory/alerts/:id/ignore — 忽略告警
router.post('/alerts/:id/ignore', asyncHandler(async (req: Request, res: Response) => {
  const alert = inventoryService.ignoreAlert(req.user!.tenantId, req.params.id, req.user!.userId);
  successResponse(res, alert, '告警已忽略');
}));

// ==================== 业务-HR 归因 ====================

// POST /api/inventory/attribution/compute — 触发指定月份的归因计算
router.post('/attribution/compute', asyncHandler(async (req: Request, res: Response) => {
  const { period } = z.object({ period: periodSchema.optional() }).parse(req.body ?? {});
  const result = attributionService.computeAttributions(req.user!.tenantId, period || currentPeriod());
  successResponse(
    res,
    result,
    `归因完成：订单 ${result.orderRows} 条，工单 ${result.ticketRows} 条`
  );
}));

// GET /api/inventory/attribution/ranking — 员工 GMV / 毛利排行榜
router.get('/attribution/ranking', asyncHandler(async (req: Request, res: Response) => {
  const query = z.object({
    period: periodSchema.optional(),
    limit: numericQuerySchema,
  }).parse(req.query);

  const data = attributionService.getAttributionRanking(
    req.user!.tenantId,
    query.period || currentPeriod(),
    query.limit ? Number(query.limit) : 10
  );
  successResponse(res, data, '人效排行榜加载成功');
}));

// GET /api/inventory/attribution/efficiency — 人效汇总
router.get('/attribution/efficiency', asyncHandler(async (req: Request, res: Response) => {
  const query = z.object({ period: periodSchema.optional() }).parse(req.query);
  const data = attributionService.getEfficiencySummary(req.user!.tenantId, query.period || currentPeriod());
  successResponse(res, data, '人效汇总加载成功');
}));

// GET /api/inventory/attribution/employee/:employeeId — 单员工归因明细
router.get('/attribution/employee/:employeeId', asyncHandler(async (req: Request, res: Response) => {
  const query = z.object({ period: periodSchema.optional() }).parse(req.query);
  const data = attributionService.getEmployeeAttribution(
    req.user!.tenantId,
    req.params.employeeId,
    query.period || currentPeriod()
  );
  successResponse(res, data, '员工归因明细加载成功');
}));

export default router;
