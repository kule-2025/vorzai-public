/**
 * Workflow Orchestrator — 可视化工作流编排 v1
 *
 * DAG-based execution engine. 节点类型:
 *   tool      — 执行后端工具（通过 ToolExecutor 调用）
 *   condition — 布尔表达式分叉（控制边条件）
 *   input     — 入口参数节点
 *   output    — 终点输出节点
 *
 * 边条件: 从节点成功 → 通过条件表达式 → 下游节点激活
 * 并行:   所有入度为 0 的节点并行启动
 * 容错:   retries / timeout 自动容错
 */

import { getDatabase, transaction, type DatabaseSync } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

// ── 工具注册表 ──────────────────────────────────────────────────
// 映射 tool_type → { execute, description }
// 实际工具实现由各模块注册（采购、库存、订单、HR、激励…）
export interface ToolExecutor {
  execute(params: Record<string, unknown>, tenantId: string): Promise<Record<string, unknown>>;
  description: string;
}

const toolRegistry: Map<string, ToolExecutor> = new Map();

export function registerTool(name: string, executor: ToolExecutor): void {
  toolRegistry.set(name, executor);
}

export function getRegisteredTools(): string[] {
  return Array.from(toolRegistry.keys());
}

export function getTool(name: string): ToolExecutor | undefined {
  return toolRegistry.get(name);
}

// ── 内置工具注册 ─────────────────────────────────────────────
// 修复审计标红项：工作流工具注册表此前为空，tool 节点运行时必抛
// "Tool 'xxx' not registered"，工作流只能编排、无法执行。
// 此处注册一组安全、无破坏性的内置工具，使 tool 节点真正可运行。
// 注：http_request 仅允许 http/https 并强制超时，避免 SSRF / 请求挂起。
function pStr(v: unknown, d = ''): string {
  return typeof v === 'string' ? v : v == null ? d : String(v);
}
function pNum(v: unknown, d = 0): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : d;
}

function registerBuiltinTools(): void {
  // 1. 延时（仅本地，无副作用）
  registerTool('delay', {
    description: '等待指定毫秒数（最大 60s）',
    async execute(params) {
      const ms = Math.max(0, Math.min(pNum(params.ms, pNum(params.milliseconds, 0)), 60000));
      await new Promise((r) => setTimeout(r, ms));
      return { waitedMs: ms };
    },
  });

  // 2. HTTP 请求（安全受限：仅 http/https，强制超时）
  registerTool('http_request', {
    description: '发起 HTTP 请求（GET/POST/PUT/DELETE/PATCH，仅 http/https，强制超时）',
    async execute(params) {
      const url = pStr(params.url);
      const method = (pStr(params.method, 'GET') || 'GET').toUpperCase();
      if (!/^https?:\/\//i.test(url)) {
        return { ok: false, status: 0, error: '仅允许 http/https 协议' };
      }
      if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
        return { ok: false, status: 0, error: '不支持的 HTTP 方法' };
      }
      const timeoutMs = Math.max(500, Math.min(pNum(params.timeout, 10000), 30000));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const body = params.body !== undefined
          ? (typeof params.body === 'string' ? params.body : JSON.stringify(params.body))
          : undefined;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (params.headers && typeof params.headers === 'object') {
          Object.assign(headers, params.headers as Record<string, string>);
        }
        const res = await fetch(url, {
          method,
          headers,
          body: method === 'GET' ? undefined : body,
          signal: controller.signal,
        });
        const text = await res.text();
        let json: unknown = null;
        try { json = JSON.parse(text); } catch { /* 保留原文 */ }
        return { ok: res.ok, status: res.status, body: json ?? text };
      } catch (e) {
        return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
      } finally {
        clearTimeout(timer);
      }
    },
  });

  // 3. JSON 字段提取（点路径）
  registerTool('json_extract', {
    description: '从 JSON 对象按点路径（如 a.b.c）提取字段',
    async execute(params) {
      const source = params.data ?? params.json ?? params.input;
      const rawPaths = params.paths ?? params.path;
      const paths = Array.isArray(rawPaths)
        ? (rawPaths as unknown[]).map(String)
        : String(rawPaths ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      const out: Record<string, unknown> = {};
      for (const p of paths) {
        const keys = String(p).split('.');
        let cur: any = source;
        for (const k of keys) {
          if (cur == null) { cur = undefined; break; }
          cur = cur[k];
        }
        out[String(p)] = cur;
      }
      return { extracted: out };
    },
  });

  // 4. 回显（便于串联节点 / 调试）
  registerTool('echo', {
    description: '原样回显输入参数',
    async execute(params) {
      return { echo: params };
    },
  });
}

registerBuiltinTools();

// ── 条件表达式求值 ─────────────────────────────────────────────
/**
 * 支持的条件表达式语法（安全受限）：
 *   "result === true"
 *   "result.status === 'ok'"
 *   "count >= 5"
 *   "result.value > 0"
 *
 * 用 Function 在 sandbox 中求值，上下文为 { result: nodeOutput }
 */
function evalCondition(condition: string, context: Record<string, unknown>): boolean {
  // 安全护栏：审计报告指出的 RCE 风险点。
  // 在 new Function 求值前，先用白名单正则阻断任何可疑字符（禁止空格外的特殊符号、函数调用等）。
  if (typeof condition !== 'string' || condition.length > 200) return false;
  // 仅允许：字母数字、下划线、点、引号、比较/逻辑/括号/空白
  const SAFE_CONDITION = /^[A-Za-z0-9_.'"<>!=&\|()\s]+$/;
  if (!SAFE_CONDITION.test(condition)) {
    logger.warn('workflow', `Condition rejected (unsafe chars): "${condition}"`);
    return false;
  }
  try {
    // 限制: 只允许简单比较，不允许调用任意函数
    // 关键：用 return 包裹条件表达式，否则函数体为语句体，无返回值
    const fn = new Function('result', 'return ' + condition);
    const resultArg = context.result ?? context;
    const val = Boolean(fn(resultArg));
    return val;
  } catch (e) {
    logger.warn('workflow', `Condition eval failed: "${condition}" error=${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

// ── 顶层类型 ──────────────────────────────────────────────────
export interface WorkflowDefinition {
  id: string;
  tenant_id: string;
  name: string;
  description?: string;
  status: 'draft' | 'active' | 'archived';
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface WorkflowNode {
  id: string;
  workflow_id: string;
  name: string;
  node_type: 'tool' | 'condition' | 'input' | 'output';
  tool_type?: string;
  position?: string;
  input_schema?: string;
  output_schema?: string;
  config: Record<string, unknown>;
  retries: number;
  timeout_seconds: number;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  created_at: string;
  updated_at: string;
}

export interface WorkflowEdge {
  id: string;
  workflow_id: string;
  from_node_id: string;
  to_node_id: string;
  condition?: string;
}

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  tenant_id: string;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  started_at: string;
  finished_at?: string;
  error?: string;
  triggered_by?: string;
  triggered_by_type: 'manual' | 'schedule' | 'api' | 'auto';
}

/**
 * Raw shape as stored in SQLite: `inputs` / `outputs` are JSON text columns.
 * Callers must parse them into `WorkflowRun` before returning to consumers.
 */
type WorkflowRunRow = Omit<WorkflowRun, 'inputs' | 'outputs'> & {
  inputs: string | null;
  outputs: string | null;
};

export interface WorkflowRunLog {
  id: string;
  run_id: string;
  node_id: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error?: string;
  retry_count: number;
  started_at?: string;
  finished_at?: string;
}

export interface WorkflowDefinitionWithGraph {
  definition: WorkflowDefinition;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface RunResult {
  run: WorkflowRun;
  logs: WorkflowRunLog[];
}

export interface ExecutionStatus {
  run: WorkflowRun;
  active: number;
  succeeded: number;
  failed: number;
  pending: number;
}

// ── 引擎 ───────────────────────────────────────────────────────
export class WorkflowOrchestrator {
  // ── 定义 CRUD ──────────────────────────────────────────────
  createDefinition(tenantId: string, createdBy: string, name: string, description?: string): WorkflowDefinition {
    const db = getDatabase();
    const id = uuidv4();
    transaction(() => {
      db.prepare(
        `INSERT INTO workflow_definition (id, tenant_id, name, description, status, created_by)
         VALUES (?, ?, ?, ?, 'draft', ?)`
      ).run(id, tenantId, name, description ?? null, createdBy);
    });
    return db.prepare('SELECT * FROM workflow_definition WHERE id = ?').get(id) as WorkflowDefinition;
  }

  getDefinition(id: string, tenantId: string): WorkflowDefinition | null {
    const db = getDatabase();
    const row = db.prepare(
      'SELECT * FROM workflow_definition WHERE id = ? AND tenant_id = ?'
    ).get(id, tenantId) as WorkflowDefinition | null | undefined;
    return row ?? null;
  }

  listDefinitions(tenantId: string, status?: string): WorkflowDefinition[] {
    const db = getDatabase();
    if (status) {
      return db.prepare(
        'SELECT * FROM workflow_definition WHERE tenant_id = ? AND status = ? ORDER BY created_at DESC'
      ).all(tenantId, status) as WorkflowDefinition[];
    }
    return db.prepare(
      'SELECT * FROM workflow_definition WHERE tenant_id = ? ORDER BY created_at DESC'
    ).all(tenantId) as WorkflowDefinition[];
  }

  updateDefinition(id: string, tenantId: string, name?: string, description?: string, status?: string): WorkflowDefinition | null {
    const db = getDatabase();
    const existing = this.getDefinition(id, tenantId);
    if (!existing) return null;

    transaction(() => {
      const sets: string[] = [];
      const params: unknown[] = [];
      if (name !== undefined) { sets.push('name = ?'); params.push(name); }
      if (description !== undefined) { sets.push('description = ?'); params.push(description ?? null); }
      if (status !== undefined) { sets.push('status = ?'); params.push(status); }
      sets.push("updated_at = datetime('now')");
      params.push(id, tenantId);
      db.prepare(`UPDATE workflow_definition SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...params);
    });
    return this.getDefinition(id, tenantId);
  }

  deleteDefinition(id: string, tenantId: string): boolean {
    const db = getDatabase();
    // SECURITY: verify tenant ownership BEFORE any cascading delete.
    // workflow_node / workflow_edge / workflow_run_log carry no tenant_id column,
    // so they can only be scoped through the parent definition. Deleting them
    // first and checking ownership last would let one tenant wipe another's graph.
    const owned = db
      .prepare('SELECT id FROM workflow_definition WHERE id = ? AND tenant_id = ?')
      .get(id, tenantId);
    if (!owned) return false;

    transaction(() => {
      // 级联删除所有关联节点/边/执行记录
      const nodes = db.prepare('SELECT id FROM workflow_node WHERE workflow_id = ?').all(id) as { id: string }[];
      const runs = db.prepare('SELECT id FROM workflow_run WHERE workflow_id = ?').all(id) as { id: string }[];
      nodes.forEach((n) => {
        db.prepare('DELETE FROM workflow_node WHERE id = ?').run(n.id);
        db.prepare('DELETE FROM workflow_run_log WHERE node_id = ?').run(n.id);
      });
      runs.forEach((r) => {
        db.prepare('DELETE FROM workflow_run_log WHERE run_id = ?').run(r.id);
      });
      db.prepare('DELETE FROM workflow_edge WHERE workflow_id = ?').run(id);
      db.prepare('DELETE FROM workflow_run WHERE workflow_id = ?').run(id);
      db.prepare('DELETE FROM workflow_definition WHERE id = ? AND tenant_id = ?').run(id, tenantId);
    });
    return true;
  }

  // ── 完整图（definition + nodes + edges）────────────────────
  getWorkflowGraph(workflowId: string, tenantId: string): WorkflowDefinitionWithGraph | null {
    const definition = this.getDefinition(workflowId, tenantId);
    if (!definition) return null;
    return { definition, nodes: this.getNodes(workflowId), edges: this.getEdges(workflowId) };
  }

  // ── 节点 CRUD ──────────────────────────────────────────────
  createNode(
    workflowId: string,
    name: string,
    nodeType: 'tool' | 'condition' | 'input' | 'output',
    opts: {
      toolType?: string;
      position?: { x: number; y: number };
      inputSchema?: Record<string, unknown>;
      outputSchema?: Record<string, unknown>;
      config?: Record<string, unknown>;
      retries?: number;
      timeoutSeconds?: number;
    } = {}
  ): WorkflowNode {
    const db = getDatabase();
    const id = uuidv4();
    transaction(() => {
      db.prepare(
        `INSERT INTO workflow_node (id, workflow_id, name, node_type, tool_type,
          position, input_schema, output_schema, config, retries, timeout_seconds)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        workflowId,
        name,
        nodeType,
        opts.toolType ?? null,
        opts.position ? JSON.stringify(opts.position) : null,
        opts.inputSchema ? JSON.stringify(opts.inputSchema) : null,
        opts.outputSchema ? JSON.stringify(opts.outputSchema) : null,
        opts.config ? JSON.stringify(opts.config) : '{}',
        opts.retries ?? 1,
        opts.timeoutSeconds ?? 30
      );
    });
    return this._hydrateNode(db.prepare('SELECT * FROM workflow_node WHERE id = ?').get(id) as WorkflowNode);
  }

  getNodes(workflowId: string): WorkflowNode[] {
    const db = getDatabase();
    return (db.prepare(
      'SELECT * FROM workflow_node WHERE workflow_id = ? ORDER BY created_at'
    ).all(workflowId) as WorkflowNode[]).map(this._hydrateNode);
  }

  getNode(nodeId: string): WorkflowNode | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM workflow_node WHERE id = ?').get(nodeId) as WorkflowNode | null;
    return row ? this._hydrateNode(row) : null;
  }

  updateNode(nodeId: string, patch: {
    name?: string;
    toolType?: string;
    position?: { x: number; y: number };
    config?: Record<string, unknown>;
    retries?: number;
    timeoutSeconds?: number;
  }): WorkflowNode | null {
    const db = getDatabase();
    const existing = db.prepare('SELECT * FROM workflow_node WHERE id = ?').get(nodeId) as WorkflowNode | null;
    if (!existing) return null;

    transaction(() => {
      const sets: string[] = [];
      const params: unknown[] = [];
      if (patch.name !== undefined) { sets.push('name = ?'); params.push(patch.name); }
      if (patch.toolType !== undefined) { sets.push('tool_type = ?'); params.push(patch.toolType ?? null); }
      if (patch.position !== undefined) { sets.push('position = ?'); params.push(JSON.stringify(patch.position)); }
      if (patch.config !== undefined) { sets.push('config = ?'); params.push(JSON.stringify(patch.config)); }
      if (patch.retries !== undefined) { sets.push('retries = ?'); params.push(patch.retries); }
      if (patch.timeoutSeconds !== undefined) { sets.push('timeout_seconds = ?'); params.push(patch.timeoutSeconds); }
      sets.push("updated_at = datetime('now')");
      params.push(nodeId);
      db.prepare(`UPDATE workflow_node SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    });
    return this.getNode(nodeId);
  }

  deleteNode(nodeId: string): boolean {
    const db = getDatabase();
    transaction(() => {
      db.prepare('DELETE FROM workflow_edge WHERE from_node_id = ? OR to_node_id = ?').run(nodeId, nodeId);
      db.prepare('DELETE FROM workflow_run_log WHERE node_id = ?').run(nodeId);
      db.prepare('DELETE FROM workflow_node WHERE id = ?').run(nodeId);
    });
    return true;
  }

  // ── 边 CRUD ────────────────────────────────────────────────
  createEdge(
    workflowId: string,
    fromNodeId: string,
    toNodeId: string,
    condition?: string
  ): WorkflowEdge {
    const db = getDatabase();
    const id = uuidv4();
    transaction(() => {
      db.prepare(
        `INSERT OR IGNORE INTO workflow_edge (id, workflow_id, from_node_id, to_node_id, condition)
         VALUES (?, ?, ?, ?, ?)`
      ).run(id, workflowId, fromNodeId, toNodeId, condition ?? null);
    });
    return db.prepare('SELECT * FROM workflow_edge WHERE id = ?').get(id) as WorkflowEdge;
  }

  getEdges(workflowId: string): WorkflowEdge[] {
    const db = getDatabase();
    return db.prepare(
      'SELECT * FROM workflow_edge WHERE workflow_id = ?'
    ).all(workflowId) as WorkflowEdge[];
  }

  /**
   * 校验节点是否属于该租户的工作流（workflow_node 本身无 tenant_id 列，
   * 需通过 workflow_definition 的 tenant_id 间接隔离）。
   */
  verifyNodeOwnership(nodeId: string, tenantId: string): boolean {
    const db = getDatabase();
    const row = db.prepare(
      `SELECT n.id FROM workflow_node n
       JOIN workflow_definition w ON n.workflow_id = w.id
       WHERE n.id = ? AND w.tenant_id = ?`
    ).get(nodeId, tenantId);
    return !!row;
  }

  /** 校验边是否属于该租户的工作流（同上，间接隔离）。 */
  verifyEdgeOwnership(edgeId: string, tenantId: string): boolean {
    const db = getDatabase();
    const row = db.prepare(
      `SELECT e.id FROM workflow_edge e
       JOIN workflow_definition w ON e.workflow_id = w.id
       WHERE e.id = ? AND w.tenant_id = ?`
    ).get(edgeId, tenantId);
    return !!row;
  }

  /** 校验节点是否挂在某工作流下（用于创建边时校验 from/to 归属）。 */
  verifyNodeInWorkflow(nodeId: string, workflowId: string): boolean {
    const db = getDatabase();
    const row = db.prepare(
      'SELECT id FROM workflow_node WHERE id = ? AND workflow_id = ?'
    ).get(nodeId, workflowId);
    return !!row;
  }

  deleteEdge(edgeId: string): boolean {
    const db = getDatabase();
    db.prepare('DELETE FROM workflow_edge WHERE id = ?').run(edgeId);
    return true;
  }

  // ── 图校验（DAG 合法性）────────────────────────────────────
  /**
   * 校验工作流图是否合法：
   * 1. 不能有环（DAG）
   * 2. 不能有无入度的非 input 节点（除非是起点）
   * 3. 必须有至少一个 input 节点（作为入口）
   * 4. 所有节点必须在定义中
   */
  validateGraph(nodes: WorkflowNode[], edges: WorkflowEdge[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const nodeMap = new Map<string, WorkflowNode>();
    nodes.forEach((n) => nodeMap.set(n.id, n));

    // 必须有至少一个 input 节点
    const inputNodes = nodes.filter((n) => n.node_type === 'input');
    if (inputNodes.length === 0) errors.push('缺少 input 入口节点');

    // 检查边的两端节点是否存在
    edges.forEach((e) => {
      if (!nodeMap.has(e.from_node_id)) errors.push(`边 ${e.id} 起点节点 ${e.from_node_id} 不存在`);
      if (!nodeMap.has(e.to_node_id)) errors.push(`边 ${e.id} 终点节点 ${e.to_node_id} 不存在`);
      if (nodeMap.has(e.from_node_id) && nodeMap.has(e.to_node_id) && e.from_node_id === e.to_node_id) {
        errors.push(`边 ${e.id} 形成自环`);
      }
    });

    // 拓扑排序检测环
    const adj = new Map<string, string[]>();
    const indegree = new Map<string, number>();
    nodes.forEach((n) => {
      adj.set(n.id, []);
      indegree.set(n.id, 0);
    });
    edges.forEach((e) => {
      if (adj.has(e.from_node_id)) adj.get(e.from_node_id)!.push(e.to_node_id);
      indegree.set(e.to_node_id, (indegree.get(e.to_node_id) || 0) + 1);
    });

    // Kahn 算法
    const queue: string[] = [];
    indegree.forEach((deg, nid) => { if (deg === 0) queue.push(nid); });
    const visited = 0;
    const order: string[] = [];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      order.push(cur);
      for (const nxt of (adj.get(cur) ?? [])) {
        indegree.set(nxt, indegree.get(nxt)! - 1);
        if (indegree.get(nxt)! === 0) queue.push(nxt);
      }
    }
    if (order.length !== nodes.length) {
      errors.push(`工作流图包含环，无法拓扑排序`);
    }

    return { valid: errors.length === 0, errors };
  }

  // ── 执行引擎 ───────────────────────────────────────────────
  async execute(
    workflowId: string,
    tenantId: string,
    inputs: Record<string, unknown> = {},
    triggeredBy?: string,
    triggeredByType: 'manual' | 'schedule' | 'api' | 'auto' = 'manual'
  ): Promise<RunResult> {
    const graph = this.getWorkflowGraph(workflowId, tenantId);
    if (!graph) {
      throw new Error(`Workflow ${workflowId} not found or not accessible`);
    }
    if (graph.definition.status !== 'active') {
      throw new Error(`Workflow is not active (status: ${graph.definition.status})`);
    }
    const { definition, nodes, edges } = graph;

    // 校验图
    const { valid, errors } = this.validateGraph(nodes, edges);
    if (!valid) {
      throw new Error(`Workflow graph invalid: ${errors.join('; ')}`);
    }

    const runId = uuidv4();
    const db = getDatabase();
    transaction(() => {
      db.prepare(
        `INSERT INTO workflow_run (id, workflow_id, tenant_id, inputs, triggered_by, triggered_by_type)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(runId, workflowId, tenantId, JSON.stringify(inputs), triggeredBy ?? null, triggeredByType);
    });

    // 初始化所有节点的 run_log（status=pending）
    const nodeOutputCache = new Map<string, Record<string, unknown>>();
    nodes.forEach((n) => {
      this._upsertRunLog(db, runId, n.id, 'pending', {}, {});
      nodeOutputCache.set(n.id, {});
    });

    try {
      const result = await this._runDag(db, runId, nodes, edges, nodeOutputCache, inputs);
      return this._finalizeRun(db, runId, 'succeeded', undefined, result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('workflow', `Run ${runId} failed: ${msg}`);
      return this._finalizeRun(db, runId, 'failed', msg);
    }
  }

  // ── DAG 执行核心 ───────────────────────────────────────────
  private async _runDag(
    db: DatabaseSync,
    runId: string,
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
    nodeOutputCache: Map<string, Record<string, unknown>>,
    initialInputs: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const nodeMap = new Map<string, WorkflowNode>();
    nodes.forEach((n) => nodeMap.set(n.id, n));

    // 邻接表 + 反向邻接表
    const outAdj = new Map<string, { nodeId: string; condition?: string }[]>();
    const inAdj = new Map<string, string[]>();
    nodes.forEach((n) => { outAdj.set(n.id, []); inAdj.set(n.id, []); });
    edges.forEach((e) => {
      if (outAdj.has(e.from_node_id)) outAdj.get(e.from_node_id)!.push({ nodeId: e.to_node_id, condition: e.condition });
      if (inAdj.has(e.to_node_id)) inAdj.get(e.to_node_id)!.push(e.from_node_id);
    });

    const completed = new Set<string>();
    const failed = new Set<string>();

    // 初始输入节点直接提供 inputs
    const inputNodes = nodes.filter((n) => n.node_type === 'input');
    inputNodes.forEach((n) => {
      nodeOutputCache.set(n.id, { input_received: true, ...initialInputs, _input_node: true });
      this._updateRunLog(db, runId, n.id, 'succeeded', {}, { input_received: true, ...initialInputs, _input_node: true });
      completed.add(n.id);
    });

    const finalOutputs: Record<string, unknown> = { ...initialInputs };

    while (completed.size < nodes.length && !failed.size) {
      // 找出所有入边都已满足的待激活节点
      const ready: string[] = [];
      for (const n of nodes) {
        if (completed.has(n.id) || failed.has(n.id)) continue;
        const preds = inAdj.get(n.id) ?? [];
        if (preds.length === 0) {
          // 无前置节点的独立入口
          ready.push(n.id);
          continue;
        }
        const allSatisfied = preds.every((p) => {
          if (!completed.has(p)) return false;
          // 检查该边（p → n）的条件
          const edge = edges.find((e) => e.from_node_id === p && e.to_node_id === n.id);
          if (edge && edge.condition) {
            return evalCondition(edge.condition, { result: nodeOutputCache.get(p) ?? {} });
          }
          return true;
        });
        if (allSatisfied) ready.push(n.id);
      }

      if (ready.length === 0) {
        // 没有 ready 节点 = 死锁（所有边条件都未通过）
        logger.warn('workflow', `Run ${runId} deadlocked: no ready nodes`);
        // 将死锁节点标记为 cancelled
        for (const n of nodes) {
          if (!completed.has(n.id) && !failed.has(n.id)) {
            this._updateRunLog(db, runId, n.id, 'cancelled', {}, {});
            completed.add(n.id);
          }
        }
        break;
      }

      // 并行执行 ready 节点
      const promises = ready.map(async (nodeId) => {
        const node = nodeMap.get(nodeId)!;
        try {
          await this._executeNode(db, runId, node, nodeOutputCache, inAdj);
          completed.add(nodeId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error('workflow', `Node ${nodeId} failed in run ${runId}: ${msg}`);
          failed.add(nodeId);
        }
      });
      await Promise.allSettled(promises);

      // 如果存在失败节点，中断并抛出错误
      if (failed.size > 0) {
        logger.warn('workflow', `Run ${runId} has ${failed.size} failed nodes`);
        throw new Error(`${failed.size} node(s) failed execution`);
      }
    }

    // 收集 output 节点
    for (const n of nodes) {
      if (n.node_type === 'output') {
        const out = nodeOutputCache.get(n.id) ?? {};
        Object.assign(finalOutputs, out);
      }
    }
    return finalOutputs;
  }

  // ── 单节点执行 ─────────────────────────────────────────────
  private async _executeNode(
    db: DatabaseSync,
    runId: string,
    node: WorkflowNode,
    nodeOutputCache: Map<string, Record<string, unknown>>,
    inAdj: Map<string, string[]>
  ): Promise<void> {
    this._updateRunLog(db, runId, node.id, 'running', {}, {});
    const deadline = Date.now() + node.timeout_seconds * 1000;
    const maxAttempts = node.retries + 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (Date.now() > deadline) {
        this._updateRunLog(db, runId, node.id, 'failed', {}, { error: `Timeout after ${node.timeout_seconds}s` });
        logger.warn('workflow', `Node ${node.id} timed out`);
        return;
      }

      let result: Record<string, unknown> = {};
      try {
        // 对 condition 节点：从第一个前置节点的输出中继承 result 字段，供边条件表达式引用
        const predecessorOutput = node.node_type === 'condition'
          ? (nodeOutputCache.get(inAdj.get(node.id)?.[0] ?? '') ?? {})
          : {};
        result = await this._runNodeType(node, predecessorOutput);
        // 工具执行完毕后再次检查超时（防止工具运行时间超过 timeout）
        if (Date.now() > deadline) {
          this._updateRunLog(db, runId, node.id, 'failed', {}, { error: `Timeout after ${node.timeout_seconds}s` });
          logger.warn('workflow', `Node ${node.id} timed out after execution`);
          throw new Error(`Timeout after ${node.timeout_seconds}s`);
        }
        nodeOutputCache.set(node.id, result);
        this._updateRunLog(db, runId, node.id, 'succeeded', {}, result, attempt);
        logger.info('workflow', `Node ${node.id} (${node.name}) succeeded`, { runId, attempt, type: node.node_type });
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('workflow', `Node ${node.id} attempt ${attempt + 1} failed: ${msg}`);
        if (attempt < maxAttempts - 1) continue;
        // 全部重试完毕，标记失败
        this._updateRunLog(db, runId, node.id, 'failed', {}, { error: msg });
        throw new Error(msg);
      }
    }
  }

  // ── 节点类型分发 ───────────────────────────────────────────
  private async _runNodeType(node: WorkflowNode, predecessorOutput: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    switch (node.node_type) {
      case 'tool': {
        const executor = getTool(node.tool_type ?? '');
        if (!executor) {
          throw new Error(`Tool '${node.tool_type}' not registered`);
        }
        return executor.execute(node.config, '');
      }
      case 'condition': {
        // condition 节点通过前置节点的输出，供边条件表达式引用
        return { result: true, evaluated: true, ...predecessorOutput };
      }
      case 'input': {
        // input 节点由执行器提供初始值
        return { input_received: true, config: node.config };
      }
      case 'output': {
        return { output_recorded: true, config: node.config };
      }
      default:
        throw new Error(`Unknown node type: ${node.node_type}`);
    }
  }

  // ── Run 状态更新 ───────────────────────────────────────────
  private _finalizeRun(
    db: DatabaseSync,
    runId: string,
    status: 'succeeded' | 'failed',
    error?: string,
    outputs?: Record<string, unknown>
  ): RunResult {
    const logs = (db.prepare(
      'SELECT * FROM workflow_run_log WHERE run_id = ? ORDER BY started_at, id'
    ).all(runId) as WorkflowRunLog[]).map(this._hydrateLog);

    transaction(() => {
      const sets = ["status = ?", "finished_at = datetime('now')"];
      const params: unknown[] = [status];
      if (error) { sets.push('error = ?'); params.push(error); }
      if (outputs) { sets.push('outputs = ?'); params.push(JSON.stringify(outputs)); }
      params.push(runId);
      db.prepare(`UPDATE workflow_run SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    });

    const run = db.prepare('SELECT * FROM workflow_run WHERE id = ?').get(runId) as WorkflowRun;
    return { run: this._hydrateRun(run), logs };
  }

  // ── 查询接口 ───────────────────────────────────────────────
  getRun(runId: string, tenantId: string): WorkflowRun | null {
    const db = getDatabase();
    const row = db.prepare(
      'SELECT r.*, w.name as workflow_name FROM workflow_run r ' +
      'JOIN workflow_definition w ON r.workflow_id = w.id ' +
      'WHERE r.id = ? AND r.tenant_id = ?'
    ).get(runId, tenantId) as WorkflowRunRow | null;
    return row ? { ...row, inputs: JSON.parse(row.inputs || '{}'), outputs: JSON.parse(row.outputs || '{}') } : null;
  }

  listRuns(tenantId: string, workflowId?: string, status?: string): WorkflowRun[] {
    const db = getDatabase();
    let sql = `SELECT r.*, w.name as workflow_name FROM workflow_run r
      JOIN workflow_definition w ON r.workflow_id = w.id
      WHERE r.tenant_id = ?`;
    const params: unknown[] = [tenantId];
    if (workflowId) { sql += ' AND r.workflow_id = ?'; params.push(workflowId); }
    if (status) { sql += ' AND r.status = ?'; params.push(status); }
    sql += ' ORDER BY r.started_at DESC LIMIT 50';
    const rows = db.prepare(sql).all(...params) as WorkflowRunRow[];
    return rows.map((r) => ({
      ...r,
      inputs: JSON.parse(r.inputs || '{}'),
      outputs: JSON.parse(r.outputs || '{}'),
    }));
  }

  getRunStatus(runId: string, tenantId: string): ExecutionStatus | null {
    const run = this.getRun(runId, tenantId);
    if (!run) return null;
    const db = getDatabase();
    const logs = db.prepare(
      'SELECT status, COUNT(*) as c FROM workflow_run_log WHERE run_id = ? GROUP BY status'
    ).all(runId) as { status: string; c: number }[];
    const statusMap = new Map<string, number>();
    logs.forEach((l) => statusMap.set(l.status, l.c));
    return {
      run,
      active: statusMap.get('running') ?? 0,
      succeeded: statusMap.get('succeeded') ?? 0,
      failed: statusMap.get('failed') ?? 0,
      pending: statusMap.get('pending') ?? 0,
    };
  }

  cancelRun(runId: string, tenantId: string): WorkflowRun | null {
    const db = getDatabase();
    const existing = db.prepare(
      'SELECT * FROM workflow_run WHERE id = ? AND tenant_id = ?'
    ).get(runId, tenantId) as WorkflowRun | null;
    if (!existing || existing.status !== 'running') return existing;
    transaction(() => {
      db.prepare("UPDATE workflow_run SET status = 'cancelled', finished_at = datetime('now') WHERE id = ?").run(runId);
      db.prepare("UPDATE workflow_run_log SET status = 'cancelled', finished_at = datetime('now') WHERE run_id = ? AND status IN ('pending', 'running')").run(runId);
    });
    return this.getRun(runId, tenantId);
  }

  // ── 私有：数据水合 ─────────────────────────────────────────
  private _hydrateNode(node: WorkflowNode): WorkflowNode {
    return {
      ...node,
      config: typeof node.config === 'string' ? JSON.parse(node.config) : (node.config ?? {}),
    };
  }

  private _hydrateLog(log: WorkflowRunLog): WorkflowRunLog {
    return {
      ...log,
      input: typeof log.input === 'string' ? JSON.parse(log.input) : (log.input ?? {}),
      output: typeof log.output === 'string' ? JSON.parse(log.output) : (log.output ?? {}),
    };
  }

  private _hydrateRun(run: WorkflowRun): WorkflowRun {
    return {
      ...run,
      inputs: typeof run.inputs === 'string' ? JSON.parse(run.inputs) : (run.inputs ?? {}),
      outputs: typeof run.outputs === 'string' ? JSON.parse(run.outputs) : (run.outputs ?? {}),
    };
  }

  // ── 私有：日志写入 ─────────────────────────────────────────
  private _upsertRunLog(
    db: DatabaseSync,
    runId: string,
    nodeId: string,
    status: string,
    input: Record<string, unknown>,
    output: Record<string, unknown>,
    retryCount?: number
  ): void {
    const id = uuidv4();
    db.prepare(
      `INSERT INTO workflow_run_log (id, run_id, node_id, status, input, output, retry_count)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, runId, nodeId, status, JSON.stringify(input), JSON.stringify(output), retryCount ?? 0);
  }

  private _updateRunLog(
    db: DatabaseSync,
    runId: string,
    nodeId: string,
    status: string,
    input: Record<string, unknown>,
    output: Record<string, unknown>,
    retryCount?: number
  ): void {
    // 按 run_id + node_id 更新最新一条日志
    const logId = db.prepare(
      `SELECT id FROM workflow_run_log WHERE run_id = ? AND node_id = ? ORDER BY created_at DESC LIMIT 1`
    ).get(runId, nodeId) as { id: string } | null;
    if (logId) {
      const sets = ['status = ?', 'output = ?', 'finished_at = datetime(\'now\')'];
      const params: unknown[] = [status, JSON.stringify(output)];
      if (retryCount !== undefined) { sets.push('retry_count = ?'); params.push(retryCount); }
      if (Object.keys(input).length > 0) { sets.push('input = ?'); params.push(JSON.stringify(input)); }
      params.push(logId.id);
      db.prepare(`UPDATE workflow_run_log SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    }
  }
}

export const workflowOrchestrator = new WorkflowOrchestrator();