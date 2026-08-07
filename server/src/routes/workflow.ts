/**
 * Workflow API Routes — 工作流编排 REST 接口
 *
 * /api/workflows
 *   GET     /                       列表（可过滤 status）
 *   POST    /                       创建工作流定义
 *   GET     /:workflowId            单个工作流（含节点+边）
 *   PUT     /:workflowId            更新工作流
 *   DELETE  /:workflowId            删除工作流（级联）
 *   GET     /:workflowId/graph      完整图（definition + nodes + edges）
 *   POST    /:workflowId/validate   校验图合法性
 *
 * /api/workflows/:workflowId/nodes
 *   GET     /                       列表节点
 *   POST    /                       创建节点
 *   PUT     /:nodeId                更新节点
 *   DELETE  /:nodeId                删除节点
 *
 * /api/workflows/:workflowId/edges
 *   POST    /                       创建边
 *   DELETE  /:edgeId                删除边
 *
 * /api/workflows/:workflowId/runs
 *   POST    /                       触发执行
 *   GET     /                       执行记录列表
 *   GET     /:runId                 单条执行记录
 *   GET     /:runId/status          执行状态摘要
 *   POST    /:runId/cancel          取消执行
 *
 * /api/workflows/tools/registry
 *   GET     /                       已注册工具列表
 */

import { Router, Request, Response } from 'express';
import { successResponse, errorResponse } from '../middleware/common';
import { authenticateToken, tenantIsolation } from '../middleware/auth';
import { workflowOrchestrator, registerTool, getRegisteredTools } from '../services/workflowOrchestrator';
import { z } from 'zod';

const router = Router();

// ── 鉴权 ─────────────────────────────────────────────────────
router.use(authenticateToken, tenantIsolation);

// ── 工具注册 ─────────────────────────────────────────────────
router.get('/tools/registry', (_req: Request, res: Response) => {
  successResponse(res, getRegisteredTools());
});

// ── Workflow 定义 CRUD ────────────────────────────────────────
router.get('/', (req: Request, res: Response) => {
  const tenantId = (req as any).user?.tenantId;
  if (!tenantId) return errorResponse(res, 400, 'tenant_id required');
  const { status } = req.query as { status?: string };
  successResponse(res, workflowOrchestrator.listDefinitions(tenantId, status || undefined));
});

const createDefinitionSchema = z.object({
  name: z.string().min(1, 'name required'),
  description: z.string().optional(),
});

router.post('/', (req: Request, res: Response) => {
  const parsed = createDefinitionSchema.safeParse(req.body);
  if (!parsed.success) return errorResponse(res, 400, parsed.error.message);
  const tenantId = (req as any).user?.tenantId;
  const userId = (req as any).user?.id;
  if (!tenantId || !userId) return errorResponse(res, 400, 'auth required');
  const wf = workflowOrchestrator.createDefinition(tenantId, userId, parsed.data.name, parsed.data.description);
  successResponse(res, wf);
});

router.get('/:workflowId', (req: Request, res: Response) => {
  const tenantId = (req as any).user?.tenantId;
  if (!tenantId) return errorResponse(res, 400, 'tenant_id required');
  const wf = workflowOrchestrator.getDefinition(req.params.workflowId, tenantId);
  if (!wf) return errorResponse(res, 404, 'Workflow not found');
  successResponse(res, wf);
});

const updateDefinitionSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
});

router.put('/:workflowId', (req: Request, res: Response) => {
  const tenantId = (req as any).user?.tenantId;
  if (!tenantId) return errorResponse(res, 400, 'tenant_id required');
  const parsed = updateDefinitionSchema.safeParse(req.body);
  if (!parsed.success) return errorResponse(res, 400, parsed.error.message);
  const wf = workflowOrchestrator.updateDefinition(req.params.workflowId, tenantId, parsed.data.name, parsed.data.description, parsed.data.status);
  if (!wf) return errorResponse(res, 404, 'Workflow not found');
  successResponse(res, wf);
});

router.delete('/:workflowId', (req: Request, res: Response) => {
  const tenantId = (req as any).user?.tenantId;
  if (!tenantId) return errorResponse(res, 400, 'tenant_id required');
  workflowOrchestrator.deleteDefinition(req.params.workflowId, tenantId);
  successResponse(res, { deleted: true });
});

// ── 完整图 ────────────────────────────────────────────────────
router.get('/:workflowId/graph', (req: Request, res: Response) => {
  const tenantId = (req as any).user?.tenantId;
  if (!tenantId) return errorResponse(res, 400, 'tenant_id required');
  const graph = workflowOrchestrator.getWorkflowGraph(req.params.workflowId, tenantId);
  if (!graph) return errorResponse(res, 404, 'Workflow not found');
  successResponse(res, graph);
});

// ── 图校验 ────────────────────────────────────────────────────
router.post('/:workflowId/validate', (req: Request, res: Response) => {
  const tenantId = (req as any).user?.tenantId;
  if (!tenantId) return errorResponse(res, 400, 'tenant_id required');
  const graph = workflowOrchestrator.getWorkflowGraph(req.params.workflowId, tenantId);
  if (!graph) return errorResponse(res, 404, 'Workflow not found');
  const result = workflowOrchestrator.validateGraph(graph.nodes, graph.edges);
  successResponse(res, result);
});

// ── 节点 CRUD ─────────────────────────────────────────────────
router.get('/:workflowId/nodes', (req: Request, res: Response) => {
  const tenantId = (req as any).user?.tenantId;
  if (!tenantId) return errorResponse(res, 400, 'tenant_id required');
  const wf = workflowOrchestrator.getDefinition(req.params.workflowId, tenantId);
  if (!wf) return errorResponse(res, 404, 'Workflow not found');
  successResponse(res, workflowOrchestrator.getNodes(req.params.workflowId));
});

const createNodeSchema = z.object({
  name: z.string().min(1),
  node_type: z.enum(['tool', 'condition', 'input', 'output']),
  tool_type: z.string().optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  input_schema: z.record(z.any()).optional(),
  output_schema: z.record(z.any()).optional(),
  config: z.record(z.any()).optional(),
  retries: z.number().int().min(0).max(10).optional(),
  timeout_seconds: z.number().int().min(1).max(300).optional(),
});

router.post('/:workflowId/nodes', (req: Request, res: Response) => {
  const tenantId = (req as any).user?.tenantId;
  if (!tenantId) return errorResponse(res, 400, 'tenant_id required');
  const parsed = createNodeSchema.safeParse(req.body);
  if (!parsed.success) return errorResponse(res, 400, parsed.error.message);
  const node = workflowOrchestrator.createNode(req.params.workflowId, parsed.data.name, parsed.data.node_type, {
    toolType: parsed.data.tool_type,
    position: parsed.data.position,
    inputSchema: parsed.data.input_schema,
    outputSchema: parsed.data.output_schema,
    config: parsed.data.config,
    retries: parsed.data.retries,
    timeoutSeconds: parsed.data.timeout_seconds,
  });
  successResponse(res, node);
});

const updateNodeSchema = z.object({
  name: z.string().min(1).optional(),
  tool_type: z.string().optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  config: z.record(z.any()).optional(),
  retries: z.number().int().min(0).max(10).optional(),
  timeout_seconds: z.number().int().min(1).max(300).optional(),
});

router.put('/:workflowId/nodes/:nodeId', (req: Request, res: Response) => {
  const tenantId = (req as any).user?.tenantId;
  if (!tenantId) return errorResponse(res, 400, 'tenant_id required');
  const parsed = updateNodeSchema.safeParse(req.body);
  if (!parsed.success) return errorResponse(res, 400, parsed.error.message);
  if (!workflowOrchestrator.verifyNodeOwnership(req.params.nodeId, tenantId)) {
    return errorResponse(res, 404, 'Node not found');
  }
  const node = workflowOrchestrator.updateNode(req.params.nodeId, {
    name: parsed.data.name,
    toolType: parsed.data.tool_type,
    position: parsed.data.position,
    config: parsed.data.config,
    retries: parsed.data.retries,
    timeoutSeconds: parsed.data.timeout_seconds,
  });
  if (!node) return errorResponse(res, 404, 'Node not found');
  successResponse(res, node);
});

router.delete('/:workflowId/nodes/:nodeId', (req: Request, res: Response) => {
  const tenantId = (req as any).user?.tenantId;
  if (!tenantId) return errorResponse(res, 400, 'tenant_id required');
  if (!workflowOrchestrator.verifyNodeOwnership(req.params.nodeId, tenantId)) {
    return errorResponse(res, 404, 'Node not found');
  }
  workflowOrchestrator.deleteNode(req.params.nodeId);
  successResponse(res, { deleted: true });
});

// ── 边 ────────────────────────────────────────────────────────
const createEdgeSchema = z.object({
  from_node_id: z.string(),
  to_node_id: z.string(),
  condition: z.string().optional(),
});

router.post('/:workflowId/edges', (req: Request, res: Response) => {
  const tenantId = (req as any).user?.tenantId;
  if (!tenantId) return errorResponse(res, 400, 'tenant_id required');
  const wf = workflowOrchestrator.getDefinition(req.params.workflowId, tenantId);
  if (!wf) return errorResponse(res, 404, 'Workflow not found');
  const parsed = createEdgeSchema.safeParse(req.body);
  if (!parsed.success) return errorResponse(res, 400, parsed.error.message);
  // 防止把其他租户工作流的节点连进本工作流
  if (!workflowOrchestrator.verifyNodeInWorkflow(parsed.data.from_node_id, req.params.workflowId) ||
      !workflowOrchestrator.verifyNodeInWorkflow(parsed.data.to_node_id, req.params.workflowId)) {
    return errorResponse(res, 400, '节点不属于该工作流');
  }
  const edge = workflowOrchestrator.createEdge(
    req.params.workflowId,
    parsed.data.from_node_id,
    parsed.data.to_node_id,
    parsed.data.condition
  );
  successResponse(res, edge);
});

router.delete('/:workflowId/edges/:edgeId', (req: Request, res: Response) => {
  const tenantId = (req as any).user?.tenantId;
  if (!tenantId) return errorResponse(res, 400, 'tenant_id required');
  if (!workflowOrchestrator.verifyEdgeOwnership(req.params.edgeId, tenantId)) {
    return errorResponse(res, 404, 'Edge not found');
  }
  workflowOrchestrator.deleteEdge(req.params.edgeId);
  successResponse(res, { deleted: true });
});

// ── 执行 ─────────────────────────────────────────────────────
const triggerRunSchema = z.object({
  inputs: z.record(z.any()).optional(),
  triggered_by_type: z.enum(['manual', 'schedule', 'api', 'auto']).optional(),
});

router.post('/:workflowId/runs', async (req: Request, res: Response) => {
  const tenantId = (req as any).user?.tenantId;
  const userId = (req as any).user?.id;
  if (!tenantId) return errorResponse(res, 400, 'tenant_id required');
  const parsed = triggerRunSchema.safeParse(req.body);
  if (!parsed.success) return errorResponse(res, 400, parsed.error.message);
  try {
    const result = await workflowOrchestrator.execute(
      req.params.workflowId,
      tenantId,
      parsed.data.inputs ?? {},
      userId,
      parsed.data.triggered_by_type ?? 'manual'
    );
    successResponse(res, { run: result.run, logs: result.logs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errorResponse(res, 500, msg);
  }
});

router.get('/:workflowId/runs', (req: Request, res: Response) => {
  const tenantId = (req as any).user?.tenantId;
  if (!tenantId) return errorResponse(res, 400, 'tenant_id required');
  const { status } = req.query as { status?: string };
  successResponse(res, workflowOrchestrator.listRuns(tenantId, req.params.workflowId, status || undefined));
});

router.get('/:workflowId/runs/:runId', (req: Request, res: Response) => {
  const tenantId = (req as any).user?.tenantId;
  if (!tenantId) return errorResponse(res, 400, 'tenant_id required');
  const run = workflowOrchestrator.getRun(req.params.runId, tenantId);
  if (!run) return errorResponse(res, 404, 'Run not found');
  successResponse(res, run);
});

router.get('/:workflowId/runs/:runId/status', (req: Request, res: Response) => {
  const tenantId = (req as any).user?.tenantId;
  if (!tenantId) return errorResponse(res, 400, 'tenant_id required');
  const status = workflowOrchestrator.getRunStatus(req.params.runId, tenantId);
  if (!status) return errorResponse(res, 404, 'Run not found');
  successResponse(res, status);
});

router.post('/:workflowId/runs/:runId/cancel', (req: Request, res: Response) => {
  const tenantId = (req as any).user?.tenantId;
  if (!tenantId) return errorResponse(res, 400, 'tenant_id required');
  const run = workflowOrchestrator.cancelRun(req.params.runId, tenantId);
  if (!run) return errorResponse(res, 404, 'Run not found');
  successResponse(res, run);
});

export default router;
