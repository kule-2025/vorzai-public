import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { ogsmService } from '../services/ogsmService';
import { raciEnhancementService } from '../services/raciEnhancementService';
import { authenticateToken, tenantIsolation, requireRole } from '../middleware/auth';
import { asyncHandler, successResponse, paginatedResponse, errorResponse } from '../middleware/common';

const router = Router();
router.use(authenticateToken, tenantIsolation);

// ==================== Objectives ====================

router.post('/objectives', asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    level: z.enum(['company', 'department', 'team', 'individual']).optional(),
    parentId: z.string().optional(),
    ownerId: z.string().optional(),
    departmentId: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  }).parse(req.body);

  const result = ogsmService.createObjective(req.user!.tenantId, input);
  successResponse(res, result, '目标创建成功', 201);
}));

router.get('/objectives', asyncHandler(async (req: Request, res: Response) => {
  const params = {
    page: Number(req.query.page) || undefined,
    limit: Number(req.query.limit) || undefined,
    level: req.query.level as string | undefined,
    status: req.query.status as string | undefined,
    ownerId: req.query.ownerId as string | undefined,
    sortBy: req.query.sortBy as string | undefined,
    sortOrder: req.query.sortOrder as 'ASC' | 'DESC' | undefined,
  };
  const result = ogsmService.listObjectives(req.user!.tenantId, params);
  paginatedResponse(res, result.data, result.pagination);
}));

// 租户级 OGSM 汇总统计（Dashboard 四象限 / Tab 角标）
router.get('/stats', asyncHandler(async (req: Request, res: Response) => {
  const stats = ogsmService.getOgsmStats(req.user!.tenantId);
  successResponse(res, stats);
}));

router.get('/objectives/:id', asyncHandler(async (req: Request, res: Response) => {
  const result = ogsmService.getObjective(req.params.id, req.user!.tenantId);
  successResponse(res, result);
}));

router.get('/objectives/:id/tree', asyncHandler(async (req: Request, res: Response) => {
  const result = ogsmService.getOgsmTree(req.params.id, req.user!.tenantId);
  if (!result) return errorResponse(res, 404, '目标树不存在');
  successResponse(res, result);
}));

router.put('/objectives/:id', asyncHandler(async (req: Request, res: Response) => {
  const result = ogsmService.updateObjective(req.params.id, req.user!.tenantId, req.body);
  successResponse(res, result, '目标更新成功');
}));

router.delete('/objectives/:id', requireRole('admin', 'manager'), asyncHandler(async (req: Request, res: Response) => {
  ogsmService.deleteObjective(req.params.id, req.user!.tenantId);
  successResponse(res, null, '目标已删除');
}));

// ==================== Goals ====================

router.post('/goals', asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    objectiveId: z.string(),
    title: z.string().min(1),
    description: z.string().optional(),
    metricType: z.enum(['percentage', 'number', 'currency', 'boolean']).optional(),
    targetValue: z.number().optional(),
    unit: z.string().optional(),
    ownerId: z.string().optional(),
    deadline: z.string().optional(),
  }).parse(req.body);

  const result = ogsmService.createGoal(req.user!.tenantId, input);
  successResponse(res, result, '目标指标创建成功', 201);
}));

router.get('/objectives/:objectiveId/goals', asyncHandler(async (req: Request, res: Response) => {
  if (!ogsmService.verifyObjectiveOwnership(req.params.objectiveId, req.user!.tenantId)) {
    return errorResponse(res, 404, '目标不存在');
  }
  const result = ogsmService.listGoals(req.params.objectiveId);
  successResponse(res, result);
}));

router.put('/goals/:id/progress', asyncHandler(async (req: Request, res: Response) => {
  const { currentValue } = z.object({ currentValue: z.number() }).parse(req.body);
  const result = ogsmService.updateGoalProgress(req.params.id, currentValue, req.user!.tenantId);
  successResponse(res, result, '进度已更新');
}));

// ==================== Strategies ====================

router.post('/strategies', asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    goalId: z.string(),
    title: z.string().min(1),
    description: z.string().optional(),
    ownerId: z.string().optional(),
  }).parse(req.body);

  const result = ogsmService.createStrategy(req.user!.tenantId, input);
  successResponse(res, result, '策略创建成功', 201);
}));

router.get('/goals/:goalId/strategies', asyncHandler(async (req: Request, res: Response) => {
  if (!ogsmService.verifyGoalOwnership(req.params.goalId, req.user!.tenantId)) {
    return errorResponse(res, 404, '指标不存在');
  }
  const result = ogsmService.listStrategies(req.params.goalId);
  successResponse(res, result);
}));

// ==================== Measures ====================

router.post('/measures', asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    strategyId: z.string(),
    title: z.string().min(1),
    description: z.string().optional(),
    metricType: z.enum(['percentage', 'number', 'currency', 'boolean']).optional(),
    targetValue: z.number().optional(),
    unit: z.string().optional(),
    frequency: z.enum(['daily', 'weekly', 'monthly', 'quarterly']).optional(),
    ownerId: z.string().optional(),
    deadline: z.string().optional(),
  }).parse(req.body);

  const result = ogsmService.createMeasure(req.user!.tenantId, input);
  successResponse(res, result, '度量创建成功', 201);
}));

router.get('/strategies/:strategyId/measures', asyncHandler(async (req: Request, res: Response) => {
  if (!ogsmService.verifyStrategyOwnership(req.params.strategyId, req.user!.tenantId)) {
    return errorResponse(res, 404, '策略不存在');
  }
  const result = ogsmService.listMeasures(req.params.strategyId);
  successResponse(res, result);
}));

// ==================== RACI Matrix ====================

router.post('/raci', asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    entityType: z.enum(['objective', 'goal', 'strategy', 'measure', 'project', 'task']),
    entityId: z.string(),
    userId: z.string(),
    responsibility: z.enum(['R', 'A', 'C', 'I']),
  }).parse(req.body);

  const result = ogsmService.setRaci(req.user!.tenantId, input);
  successResponse(res, result, 'RACI分配成功', 201);
}));

router.get('/raci/:entityType/:entityId', asyncHandler(async (req: Request, res: Response) => {
  const result = ogsmService.getRaciMatrix(req.params.entityType, req.params.entityId);
  successResponse(res, result);
}));

// ==================== Incentives ====================

router.post('/incentives', requireRole('admin', 'manager'), asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    name: z.string().min(1),
    type: z.enum(['bonus', 'commission', 'promotion', 'recognition', 'penalty']),
    description: z.string().optional(),
    rules: z.record(z.unknown()).optional(),
    targetType: z.enum(['individual', 'team', 'department', 'company']).optional(),
    targetId: z.string().optional(),
    amount: z.number().optional(),
    currency: z.string().optional(),
    effectiveFrom: z.string().optional(),
    effectiveTo: z.string().optional(),
  }).parse(req.body);

  const result = ogsmService.createIncentive(req.user!.tenantId, req.user!.userId, input);
  successResponse(res, result, '激励方案创建成功', 201);
}));

router.get('/incentives', asyncHandler(async (req: Request, res: Response) => {
  const params = {
    page: Number(req.query.page) || undefined,
    limit: Number(req.query.limit) || undefined,
    type: req.query.type as string | undefined,
    status: req.query.status as string | undefined,
  };
  const result = ogsmService.listIncentives(req.user!.tenantId, params);
  paginatedResponse(res, result.data, result.pagination);
}));

// ==================== Dashboard / Analytics ====================

router.get('/objectives/:id/progress', asyncHandler(async (req: Request, res: Response) => {
  const result = ogsmService.getObjectProgress(req.params.id, req.user!.tenantId);
  successResponse(res, result);
}));

router.get('/goals/:id/alignment', asyncHandler(async (req: Request, res: Response) => {
  const result = ogsmService.getGoalAlignment(req.params.id, req.user!.tenantId);
  successResponse(res, result);
}));

router.get('/raci', asyncHandler(async (req: Request, res: Response) => {
  const result = ogsmService.getRACIMatrix(req.user!.tenantId);
  successResponse(res, result);
}));

router.get('/incentives/summary', requireRole('admin', 'manager'), asyncHandler(async (req: Request, res: Response) => {
  const result = ogsmService.getIncentiveSummary(req.user!.tenantId);
  successResponse(res, result);
}));

// ==================== RACI 增强 (R1-R5) ====================
// R1: A 唯一性校验
router.get('/raci/check-a/:entityType/:entityId', asyncHandler(async (req: Request, res: Response) => {
  successResponse(res, raciEnhancementService.checkAUniqueness(
    req.user!.tenantId, req.params.entityType, req.params.entityId
  ));
}));

router.get('/raci/duplicate-as', asyncHandler(async (req: Request, res: Response) => {
  successResponse(res, raciEnhancementService.findDuplicateAs(req.user!.tenantId));
}));

// R2
router.get('/raci/uncovered', asyncHandler(async (req: Request, res: Response) => {
  successResponse(res, raciEnhancementService.findUncovered(req.user!.tenantId));
}));

// R3
router.get('/raci/load', asyncHandler(async (req: Request, res: Response) => {
  successResponse(res, raciEnhancementService.getLoadStats(req.user!.tenantId));
}));

// R4
router.get('/raci/my-responsibilities', asyncHandler(async (req: Request, res: Response) => {
  const userId = req.query.userId as string || req.user!.userId;
  successResponse(res, raciEnhancementService.getMyResponsibilities(req.user!.tenantId, userId));
}));

// R5
router.get('/raci/alignment-chain/:entityType/:entityId', asyncHandler(async (req: Request, res: Response) => {
  const result = raciEnhancementService.getAlignmentChain(
    req.user!.tenantId, req.params.entityType, req.params.entityId
  );
  if (!result) return errorResponse(res, 404, '无法追溯对齐链路');
  successResponse(res, result);
}));

export default router;
