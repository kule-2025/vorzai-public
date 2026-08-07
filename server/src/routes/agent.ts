/**
 * Agent 管理 API 路由
 * 挂载：/api/agents
 */
import { Router, Request, Response } from 'express';
import { authenticateToken, tenantIsolation } from '../middleware/auth';
import { agentService } from '../services/agentService';

const router = Router();
router.use(authenticateToken, tenantIsolation);

router.get('/', (req: Request, res: Response) => {
  const tenantId = (req as any).tenantId;
  res.json({ success: true, data: agentService.list(tenantId) });
});

router.get('/:id', (req: Request, res: Response) => {
  const tenantId = (req as any).tenantId;
  const agent = agentService.getById(req.params.id, tenantId);
  if (!agent) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Agent 不存在' } });
    return;
  }
  res.json({ success: true, data: agent });
});

router.post('/', (req: Request, res: Response) => {
  const tenantId = (req as any).tenantId;
  const userId = (req as any).user?.id;
  try {
    const agent = agentService.create({ tenantId, createdBy: userId, ...req.body });
    res.status(201).json({ success: true, data: agent });
  } catch (e: any) {
    res.status(400).json({ success: false, error: { code: 'INVALID', message: e.message } });
  }
});

router.put('/:id', (req: Request, res: Response) => {
  const tenantId = (req as any).tenantId;
  try {
    const agent = agentService.update(req.params.id, tenantId, req.body);
    res.json({ success: true, data: agent });
  } catch (e: any) {
    const code = e.constructor?.name === 'NotFoundError' ? 404 : 400;
    res.status(code).json({ success: false, error: { code: 'UPDATE_FAILED', message: e.message } });
  }
});

router.post('/:id/start', (req: Request, res: Response) => {
  const tenantId = (req as any).tenantId;
  try {
    const agent = agentService.setStatus(req.params.id, tenantId, 'running');
    res.json({ success: true, data: agent });
  } catch (e: any) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: e.message } });
  }
});

router.post('/:id/stop', (req: Request, res: Response) => {
  const tenantId = (req as any).tenantId;
  try {
    const agent = agentService.setStatus(req.params.id, tenantId, 'idle');
    res.json({ success: true, data: agent });
  } catch (e: any) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: e.message } });
  }
});

router.delete('/:id', (req: Request, res: Response) => {
  const tenantId = (req as any).tenantId;
  try {
    agentService.remove(req.params.id, tenantId);
    res.json({ success: true, data: null, message: '已删除' });
  } catch (e: any) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: e.message } });
  }
});

export default router;
