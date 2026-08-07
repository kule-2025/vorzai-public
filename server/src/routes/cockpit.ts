/**
 * Vorzai 业务驾驶舱路由（Cockpit Routes）
 * 单一聚合端点：GET /api/cockpit/overview
 * - 走标准的 authenticateToken + tenantIsolation 中间件
 * - 返回 CockpitOverview 全量驾驶舱数据
 * - 不修改任何现有路由（向后兼容）
 */
import { Router, Request, Response } from 'express';
import { cockpitService } from '../services/cockpitService';
import { authenticateToken, tenantIsolation } from '../middleware/auth';
import { asyncHandler, successResponse } from '../middleware/common';

const router = Router();

// 所有 cockpit 端点必须先认证 + 租户隔离
router.use(authenticateToken, tenantIsolation);

/**
 * GET /api/cockpit/overview
 * 一次拉取驾驶舱所需的全部数据（5 KPI + 5 段漏斗 + Top5 异常 + 4 业务线切片）
 */
router.get('/overview', asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const data = cockpitService.getOverview(tenantId);
  successResponse(res, data, '驾驶舱数据加载成功');
}));

export default router;
