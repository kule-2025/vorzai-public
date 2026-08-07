/**
 * 激励规则引擎 + 批量结算路由（V2 · I1-I2）
 *
 * /api/incentives/rules          — 规则 CRUD
 * /api/incentives/calc/:period   — 批量结算 + 汇总
 *
 * 与 /api/ogsm/incentives 共存（ogsm 路由保留原手动激励 CRUD，向后兼容）
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticateToken, tenantIsolation, requireRole } from '../middleware/auth';
import { asyncHandler, successResponse } from '../middleware/common';
import { incentiveRuleEngine } from '../services/incentiveRuleEngine';

const router = Router();

router.use(authenticateToken, tenantIsolation);

// ==================== I1: 规则 CRUD ====================

/** POST /api/incentives/rules — 创建激励规则 */
router.post('/rules', requireRole('admin', 'manager'), asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    name: z.string().min(1),
    rule_type: z.enum(['commission', 'bonus', 'special', 'points']),
    description: z.string().optional(),
    trigger_config: z.object({
      trigger_type: z.enum(['always', 'order_threshold', 'achievement_threshold']).default('always'),
      threshold: z.number().optional(),
      metric: z.string().optional(),
    }).optional(),
    formula: z.string().min(1),
    target_type: z.enum(['individual', 'team', 'department', 'company']).optional(),
    target_id: z.string().optional(),
    min_payout: z.number().min(0).optional(),
    max_payout: z.number().min(0).optional(),
    priority: z.number().int().optional(),
    effective_from: z.string().optional(),
    effective_to: z.string().optional(),
    status: z.enum(['active', 'inactive', 'draft']).optional(),
  }).parse(req.body);

  const result = incentiveRuleEngine.createRule(req.user!.tenantId, req.user!.userId, input);
  successResponse(res, result, '激励规则创建成功', 201);
}));

/** GET /api/incentives/rules — 列出激励规则 */
router.get('/rules', asyncHandler(async (req: Request, res: Response) => {
  const filters: { status?: string; rule_type?: string } = {};
  if (typeof req.query.status === 'string') filters.status = req.query.status;
  if (typeof req.query.rule_type === 'string') filters.rule_type = req.query.rule_type;
  const rules = incentiveRuleEngine.listRules(req.user!.tenantId, filters);
  successResponse(res, rules);
}));

/** GET /api/incentives/rules/:id — 获取单条规则 */
router.get('/rules/:id', asyncHandler(async (req: Request, res: Response) => {
  const rule = incentiveRuleEngine.getRule(req.user!.tenantId, req.params.id);
  if (!rule) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '规则不存在' } }); return; }
  successResponse(res, rule);
}));

/** PUT /api/incentives/rules/:id — 更新激励规则 */
router.put('/rules/:id', requireRole('admin', 'manager'), asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    name: z.string().min(1).optional(),
    rule_type: z.enum(['commission', 'bonus', 'special', 'points']).optional(),
    description: z.string().optional(),
    trigger_config: z.object({
      trigger_type: z.enum(['always', 'order_threshold', 'achievement_threshold']).optional(),
      threshold: z.number().optional(),
      metric: z.string().optional(),
    }).optional(),
    formula: z.string().min(1).optional(),
    target_type: z.enum(['individual', 'team', 'department', 'company']).optional(),
    target_id: z.string().optional(),
    min_payout: z.number().min(0).optional(),
    max_payout: z.number().min(0).optional(),
    priority: z.number().int().optional(),
    effective_from: z.string().optional(),
    effective_to: z.string().optional(),
    status: z.enum(['active', 'inactive', 'draft', 'archived']).optional(),
  }).parse(req.body);

  const rule = incentiveRuleEngine.updateRule(req.user!.tenantId, req.params.id, input);
  if (!rule) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '规则不存在' } }); return; }
  successResponse(res, rule, '规则更新成功');
}));

/** DELETE /api/incentives/rules/:id — 归档规则（软删除） */
router.delete('/rules/:id', requireRole('admin', 'manager'), asyncHandler(async (req: Request, res: Response) => {
  const deleted = incentiveRuleEngine.deleteRule(req.user!.tenantId, req.params.id);
  if (!deleted) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '规则不存在或已归档' } }); return; }
  successResponse(res, { id: req.params.id }, '规则已归档');
}));

// ==================== I2: 批量结算 ====================

/** POST /api/incentives/calc/:period — 触发批量结算（period 格式 YYYY-MM） */
router.post('/calc/:period', requireRole('admin', 'manager'), asyncHandler(async (req: Request, res: Response) => {
  const period = z.string().regex(/^\d{4}-\d{2}$/, 'period 格式须为 YYYY-MM').parse(req.params.period);
  const result = await incentiveRuleEngine.calculateIncentives(req.user!.tenantId, period);
  successResponse(res, result, '批量结算完成');
}));

/** GET /api/incentives/calc/:period/summary — 查看结算汇总 */
router.get('/calc/:period/summary', asyncHandler(async (req: Request, res: Response) => {
  const period = z.string().regex(/^\d{4}-\d{2}$/, 'period 格式须为 YYYY-MM').parse(req.params.period);
  const summary = incentiveRuleEngine.getCalculationSummary(req.user!.tenantId, period);
  successResponse(res, summary);
}));

export default router;
