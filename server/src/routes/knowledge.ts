import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { knowledgeService, skillService, connectorService } from '../services/knowledgeService';
import { NotFoundError } from '../utils/errors';
import { authenticateToken, tenantIsolation, requireRole } from '../middleware/auth';
import { asyncHandler, successResponse, paginatedResponse } from '../middleware/common';

const router = Router();
router.use(authenticateToken, tenantIsolation);

// ==================== Knowledge Bases ====================

router.post('/knowledge-bases', asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    type: z.enum(['general', 'product', 'process', 'faq', 'training', 'policy']).optional(),
    visibility: z.enum(['private', 'team', 'tenant', 'public']).optional(),
  }).parse(req.body);

  const result = knowledgeService.createKnowledgeBase(req.user!.tenantId, { ...input, ownerId: req.user!.userId });
  successResponse(res, result, '知识库创建成功', 201);
}));

router.get('/knowledge-bases', asyncHandler(async (req: Request, res: Response) => {
  const result = knowledgeService.listKnowledgeBases(req.user!.tenantId);
  successResponse(res, result);
}));

router.post('/knowledge-bases/:kbId/documents', asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    title: z.string().min(1),
    content: z.string().optional(),
    contentType: z.enum(['markdown', 'html', 'plain', 'json']).optional(),
    category: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }).parse(req.body);

  const result = knowledgeService.createDocument(req.user!.tenantId, req.params.kbId, { ...input, authorId: req.user!.userId });
  successResponse(res, result, '文档创建成功', 201);
}));

router.get('/knowledge-bases/:kbId/documents', asyncHandler(async (req: Request, res: Response) => {
  const params = {
    page: Number(req.query.page) || undefined,
    limit: Number(req.query.limit) || undefined,
    keyword: req.query.keyword as string | undefined,
    category: req.query.category as string | undefined,
  };
  const result = knowledgeService.listDocumentsPaginated(req.params.kbId, params);
  paginatedResponse(res, result.data, result.pagination);
}));

router.get('/knowledge-bases/:kbId/documents/:docId', asyncHandler(async (req: Request, res: Response) => {
  const result = knowledgeService.getDocument(req.user!.tenantId, req.params.kbId, req.params.docId);
  if (!result) throw new Error('文档不存在');
  successResponse(res, result);
}));

router.delete('/knowledge-bases/:kbId/documents/:docId', asyncHandler(async (req: Request, res: Response) => {
  knowledgeService.deleteDocument(req.user!.tenantId, req.params.kbId, req.params.docId);
  successResponse(res, null, '文档已删除');
}));

router.post('/knowledge/search', asyncHandler(async (req: Request, res: Response) => {
  const { query, knowledgeBaseId, limit } = z.object({
    query: z.string().min(1),
    knowledgeBaseId: z.string().optional(),
    limit: z.number().min(1).max(50).optional(),
  }).parse(req.body);

  const result = knowledgeService.searchKnowledge(req.user!.tenantId, query, {
    knowledgeBaseId,
    limit: limit ?? 10,
  });
  successResponse(res, result);
}));

router.post('/knowledge-bases/:kbId/documents/:docId/generate-skill', asyncHandler(async (req: Request, res: Response) => {
  const { skillName } = z.object({
    skillName: z.string().min(1),
  }).parse(req.body);

  const result = skillService.generateSkillFromDocument(req.user!.tenantId, req.params.kbId, req.params.docId, skillName);
  successResponse(res, result, '企业 Skill 生成成功', 201);
}));

router.get('/skills/enterprise', asyncHandler(async (req: Request, res: Response) => {
  const result = skillService.listEnterpriseSkills(req.user!.tenantId);
  successResponse(res, result);
}));

router.get('/knowledge/search', asyncHandler(async (req: Request, res: Response) => {
  const keyword = z.string().min(1).parse(req.query.q);
  const limit = Number(req.query.limit) || 20;
  const result = knowledgeService.searchDocuments(req.user!.tenantId, keyword, limit);
  successResponse(res, result);
}));

// ==================== Skills ====================

router.post('/skills', asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    name: z.string().min(1),
    slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
    description: z.string().optional(),
    category: z.enum(['system', 'custom', 'marketplace']).optional(),
    triggerKeywords: z.array(z.string()).optional(),
    inputSchema: z.record(z.unknown()).optional(),
    outputSchema: z.record(z.unknown()).optional(),
    executionConfig: z.record(z.unknown()).optional(),
  }).parse(req.body);

  const result = skillService.createSkill(req.user!.tenantId, { ...input, authorId: req.user!.userId });
  successResponse(res, result, '技能创建成功', 201);
}));

router.get('/skills', asyncHandler(async (req: Request, res: Response) => {
  const params = {
    page: Number(req.query.page) || undefined,
    limit: Number(req.query.limit) || undefined,
    category: req.query.category as string | undefined,
    keyword: req.query.keyword as string | undefined,
  };
  const result = skillService.listSkills(req.user!.tenantId, params);
  paginatedResponse(res, result.data, result.pagination);
}));

router.post('/skills/:id/execute', asyncHandler(async (req: Request, res: Response) => {
  const input = z.record(z.unknown()).parse(req.body);
  const result = skillService.executeSkill(req.params.id, req.user!.tenantId, req.user!.userId, input);
  successResponse(res, result, '技能执行完成');
}));

// ==================== Connectors ====================

router.post('/connectors', requireRole('admin'), asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    name: z.string().min(1),
    type: z.enum(['dingtalk', 'feishu', 'email', 'wechat_work', 'custom']),
    description: z.string().optional(),
    config: z.record(z.unknown()).optional(),
  }).parse(req.body);

  const result = connectorService.createConnector(req.user!.tenantId, req.user!.userId, input);
  successResponse(res, result, '连接器创建成功', 201);
}));

router.get('/connectors', asyncHandler(async (req: Request, res: Response) => {
  const result = connectorService.listConnectors(req.user!.tenantId);
  successResponse(res, result);
}));

router.put('/connectors/:id/status', requireRole('admin'), asyncHandler(async (req: Request, res: Response) => {
  const { status, config } = z.object({
    status: z.enum(['connected', 'disconnected', 'error', 'expired']),
    config: z.record(z.unknown()).optional(),
  }).parse(req.body);

  const result = connectorService.updateConnectorStatus(req.params.id, req.user!.tenantId, status, config);
  successResponse(res, result, '连接器状态更新成功');
}));

router.post('/connectors/:id/sync', asyncHandler(async (req: Request, res: Response) => {
  const { syncType } = z.object({ syncType: z.string().default('full') }).parse(req.body);
  const result = connectorService.triggerSync(req.params.id, req.user!.tenantId, syncType);
  successResponse(res, result, '同步已触发');
}));

export default router;
