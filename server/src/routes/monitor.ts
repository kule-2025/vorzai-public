/**
 * Vorzai 执行监控路由（V2 · M3）
 *
 * 挂载点：/api/monitor
 *   GET /overview   跨域聚合总览（四条业务线指标卡 + 今日要处理清单）
 *   GET /todo       仅待办清单，支持按来源过滤，供轮询刷新
 *
 * 全部为只读接口，对已认证用户开放，按租户隔离。
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { monitorService } from '../services/monitorService';
import { authenticateToken, tenantIsolation } from '../middleware/auth';
import { asyncHandler, successResponse } from '../middleware/common';

const router = Router();
router.use(authenticateToken, tenantIsolation);

router.get(
  '/overview',
  asyncHandler(async (req: Request, res: Response) => {
    const data = monitorService.getOverview(req.user!.tenantId);
    successResponse(res, data);
  })
);

const todoQuerySchema = z.object({
  source: z.enum(['procurement', 'inventory', 'order', 'ticket']).optional(),
});

router.get(
  '/todo',
  asyncHandler(async (req: Request, res: Response) => {
    const { source } = todoQuerySchema.parse(req.query);
    const data = monitorService.getTodoList(req.user!.tenantId, source);
    successResponse(res, data);
  })
);

export default router;
