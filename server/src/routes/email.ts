import { Request, Response } from 'express';
import { z } from 'zod';
import { emailConnectorService } from '../services/emailConnectorService';
import { authedRouter, requireRole } from '../middleware/auth';
import { asyncHandler, successResponse } from '../middleware/common';

const router = authedRouter();

const createEmailConnectorSchema = z.object({
  name: z.string().min(1).max(100),
  provider: z.enum(['smtp', 'imap', 'api']),
  config: z.object({
    host: z.string().min(1),
    port: z.number().min(1).max(65535),
    username: z.string(),
    password: z.string(),
    ssl: z.boolean().optional(),
    tls: z.boolean().optional(),
  }),
  emailAddress: z.string().email().optional(),
});

const updateEmailConnectorSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  config: z.object({
    host: z.string().min(1).optional(),
    port: z.number().min(1).max(65535).optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    ssl: z.boolean().optional(),
    tls: z.boolean().optional(),
  }).optional(),
  emailAddress: z.string().email().optional(),
});

const sendEmailSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(200),
  body: z.string().min(1),
});

// GET /api/connectors/email — 列出邮箱连接器
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const connectors = emailConnectorService.listEmailConnectors(req.user!.tenantId);
  successResponse(res, connectors);
}));

// POST /api/connectors/email — 创建邮箱连接器
router.post('/', requireRole('admin', 'owner'), asyncHandler(async (req: Request, res: Response) => {
  const input = createEmailConnectorSchema.parse(req.body);
  const connector = emailConnectorService.createEmailConnector({
    tenantId: req.user!.tenantId,
    ...input,
  });
  successResponse(res, connector, '邮箱连接器已创建', 201);
}));

// GET /api/connectors/email/:id — 获取单个
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const connectors = emailConnectorService.listEmailConnectors(req.user!.tenantId);
  const connector = connectors.find((c) => c.id === req.params.id);
  if (!connector) {
    successResponse(res, null, '邮箱连接器不存在', 404);
    return;
  }
  successResponse(res, connector);
}));

// PUT /api/connectors/email/:id — 更新
router.put('/:id', requireRole('admin', 'owner'), asyncHandler(async (req: Request, res: Response) => {
  const connectors = emailConnectorService.listEmailConnectors(req.user!.tenantId);
  const existing = connectors.find((c) => c.id === req.params.id);
  if (!existing) {
    successResponse(res, null, '邮箱连接器不存在', 404);
    return;
  }
  const input = updateEmailConnectorSchema.parse(req.body);
  const connector = emailConnectorService.updateEmailConnector(req.params.id, req.user!.tenantId, input);
  successResponse(res, connector, '邮箱连接器已更新');
}));

// DELETE /api/connectors/email/:id — 删除
router.delete('/:id', requireRole('admin', 'owner'), asyncHandler(async (req: Request, res: Response) => {
  const connectors = emailConnectorService.listEmailConnectors(req.user!.tenantId);
  const existing = connectors.find((c) => c.id === req.params.id);
  if (!existing) {
    successResponse(res, null, '邮箱连接器不存在', 404);
    return;
  }
  emailConnectorService.deleteEmailConnector(req.params.id, req.user!.tenantId);
  successResponse(res, null, '邮箱连接器已删除');
}));

// POST /api/connectors/email/:id/connect — 测试连接
router.post('/:id/connect', asyncHandler(async (req: Request, res: Response) => {
  const connectors = emailConnectorService.listEmailConnectors(req.user!.tenantId);
  const existing = connectors.find((c) => c.id === req.params.id);
  if (!existing) {
    successResponse(res, null, '邮箱连接器不存在', 404);
    return;
  }
  const result = await emailConnectorService.connectEmailConnector(req.params.id, req.user!.tenantId);
  successResponse(res, result, result.success ? '连接测试成功' : '连接测试失败');
}));

// POST /api/connectors/email/:id/sync — 同步收件箱
router.post('/:id/sync', asyncHandler(async (req: Request, res: Response) => {
  const connectors = emailConnectorService.listEmailConnectors(req.user!.tenantId);
  const existing = connectors.find((c) => c.id === req.params.id);
  if (!existing) {
    successResponse(res, null, '邮箱连接器不存在', 404);
    return;
  }
  const messages = await emailConnectorService.syncInbox(req.params.id, req.user!.tenantId);
  successResponse(res, messages, '同步完成');
}));

// POST /api/connectors/email/:id/send — 发送邮件
router.post('/:id/send', asyncHandler(async (req: Request, res: Response) => {
  const connectors = emailConnectorService.listEmailConnectors(req.user!.tenantId);
  const existing = connectors.find((c) => c.id === req.params.id);
  if (!existing) {
    successResponse(res, null, '邮箱连接器不存在', 404);
    return;
  }
  const input = sendEmailSchema.parse(req.body);
  const result = await emailConnectorService.sendEmail(req.params.id, req.user!.tenantId, input);
  successResponse(res, result, result.success ? '邮件已发送' : '发送失败');
}));

// GET /api/connectors/email/:id/logs — 获取同步日志
router.get('/:id/logs', asyncHandler(async (req: Request, res: Response) => {
  const connectors = emailConnectorService.listEmailConnectors(req.user!.tenantId);
  const existing = connectors.find((c) => c.id === req.params.id);
  if (!existing) {
    successResponse(res, null, '邮箱连接器不存在', 404);
    return;
  }
  const logs = emailConnectorService.getSyncLogs(req.params.id, req.user!.tenantId);
  successResponse(res, logs);
}));

export default router;
