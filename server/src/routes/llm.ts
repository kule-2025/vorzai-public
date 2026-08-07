/**
 * LLM 平台管理 API 路由
 * 挂载：/api/llm
 * api_key 仅在创建/更新时接收，列表与详情返回脱敏预览。
 */
import { Router, Request, Response } from 'express';
import { authenticateToken, tenantIsolation } from '../middleware/auth';
import { llmService } from '../services/llmService';

const router = Router();
router.use(authenticateToken, tenantIsolation);

router.get('/', (req: Request, res: Response) => {
  const tenantId = (req as any).tenantId;
  res.json({ success: true, data: llmService.list(tenantId) });
});

router.get('/:id', (req: Request, res: Response) => {
  const tenantId = (req as any).tenantId;
  const p = llmService.getById(req.params.id, tenantId);
  if (!p) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '平台不存在' } });
    return;
  }
  res.json({ success: true, data: p });
});

router.post('/', (req: Request, res: Response) => {
  const tenantId = (req as any).tenantId;
  const userId = (req as any).user?.id;
  try {
    const p = llmService.create({ tenantId, createdBy: userId, ...req.body });
    res.status(201).json({ success: true, data: p });
  } catch (e: any) {
    res.status(400).json({ success: false, error: { code: 'INVALID', message: e.message } });
  }
});

router.put('/:id', (req: Request, res: Response) => {
  const tenantId = (req as any).tenantId;
  try {
    const p = llmService.update(req.params.id, tenantId, req.body);
    res.json({ success: true, data: p });
  } catch (e: any) {
    const code = e.constructor?.name === 'NotFoundError' ? 404 : 400;
    res.status(code).json({ success: false, error: { code: 'UPDATE_FAILED', message: e.message } });
  }
});

router.delete('/:id', (req: Request, res: Response) => {
  const tenantId = (req as any).tenantId;
  try {
    llmService.remove(req.params.id, tenantId);
    res.json({ success: true, data: null, message: '已删除' });
  } catch (e: any) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: e.message } });
  }
});

export default router;
