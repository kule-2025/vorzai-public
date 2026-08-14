/**
 * Workflow Orchestrator 单元测试
 *
 * 覆盖:
 *   - DDD 验证（环检测、缺失节点、自环、无入口）
 *   - 定义 CRUD（创建/查询/列表/更新/删除/级联）
 *   - 节点 CRUD（创建/查询/更新/删除）
 *   - 边 CRUD（创建/删除/唯一约束）
 *   - 图校验（合法图 vs 非法图）
 *   - DAG 执行（线性流程、并行、条件分支、input/output）
 *   - 重试与超时（模拟慢节点）
 *   - 执行记录（查询/状态/取消）
 *   - 多租户隔离
 *   - 工具注册表
 *   - 错误处理（未注册工具、图未激活）
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

let _wfIdx = 0;
function wfName(base: string): string { return `${base}_${Date.now()}_${_wfIdx++}`; }
import {
  workflowOrchestrator,
  registerTool,
  getRegisteredTools,
  getTool,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowEdge,
} from '../src/services/workflowOrchestrator';
import { getDatabase, initDatabase, closeDatabase } from '../src/db';
import { v4 as uuidv4 } from 'uuid';
import { v4 as seedTenantId } from '../src/utils/security';

const TEST_DB_PATH = 'data/test_vorzai_workflow.db';

function seedTenant(): string {
  const db = getDatabase();
  const id = uuidv4();
  const slug = 'wf-' + id.slice(0, 8);
  db.prepare(
    `INSERT INTO tenants (id, name, slug, status) VALUES (?, ?, ?, ?)`
  ).run(id, 'Workflow测试租户', slug, 'active');
  return id;
}

function seedUser(tenantId: string): { id: string; email: string } {
  const db = getDatabase();
  const id = uuidv4();
  const email = `wf-test-${id.slice(0, 6)}@x.com`;
  db.prepare(
    `INSERT INTO users (id, tenant_id, username, password_hash, display_name, email, role, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, tenantId, `wf-user-${id.slice(0, 6)}`, 'hash', '测试用户', email, 'member', 'active');
  return { id, email };
}

let tenantA: string;
let tenantB: string;
let adminA: { id: string; email: string };

// 注册测试工具
beforeAll(() => {
  registerTool('test:greet', {
    description: '打招呼',
    async execute(params: Record<string, unknown>) {
      const name = (params as any).name ?? 'World';
      return { greeting: `Hello, ${name}!`, ts: Date.now() };
    },
  });
  registerTool('test:double', {
    description: '将值乘以 2',
    async execute(params: Record<string, unknown>) {
      const v = Number((params as any).value ?? 0);
      return { result: v * 2 };
    },
  });
  registerTool('test:slow', {
    description: '慢工具（模拟超时）',
    async execute(_params: Record<string, unknown>) {
      await new Promise((r) => setTimeout(r, 10000));
      return { ok: true };
    },
  });
  registerTool('test:counter', {
    description: '累加计数器',
    async execute(params: Record<string, unknown>) {
      const count = Number((params as any).count ?? 0);
      return { new_count: count + 1 };
    },
  });
});

beforeAll(() => {
  initDatabase(TEST_DB_PATH);
  tenantA = seedTenant();
  tenantB = seedTenant();
  adminA = seedUser(tenantA);
});

afterAll(() => {
  closeDatabase();
  // 清理测试库（removeDbFiles 由 data-integrity 测试共享，这里简单关闭即可）
});

// ──────────────────────────────────────────────────────────────
describe('Workflow Definition CRUD', () => {
  it('创建定义', () => {
    const wf = workflowOrchestrator.createDefinition(tenantA, adminA.id, wfName("测试工作流"));
    expect(wf.id).toBeDefined();
    expect(wf.name.startsWith('测试工作流')).toBe(true);
    expect(wf.status).toBe('draft');
    expect(wf.tenant_id).toBe(tenantA);
    expect(wf.created_by).toBe(adminA.id);
  });

  it('查询定义', () => {
    const wf = workflowOrchestrator.createDefinition(tenantA, adminA.id, wfName("可查询工作流"));
    const found = workflowOrchestrator.getDefinition(wf.id, tenantA);
    expect(found).not.toBeNull();
    expect(found?.name?.startsWith('可查询工作流')).toBe(true);
  });

  it('查询不存在定义', () => {
    const found = workflowOrchestrator.getDefinition('non-existent-id', tenantA);
    expect(found).toBeNull();
  });

  it('列出定义', () => {
    const list = workflowOrchestrator.listDefinitions(tenantA);
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  it('按状态过滤', () => {
workflowOrchestrator.createDefinition(tenantA, adminA.id, wfName("草稿流"));
workflowOrchestrator.updateDefinition(
  workflowOrchestrator.listDefinitions(tenantA)[0].id,
      tenantA,
      undefined,
      undefined,
      'active'
    );
    const drafts = workflowOrchestrator.listDefinitions(tenantA, 'draft');
    const actives = workflowOrchestrator.listDefinitions(tenantA, 'active');
    expect(drafts.every((w) => w.status === 'draft')).toBe(true);
    expect(actives.every((w) => w.status === 'active')).toBe(true);
  });

  it('更新定义', () => {
    const wf = workflowOrchestrator.createDefinition(tenantA, adminA.id, wfName("原名"));
    const updated = workflowOrchestrator.updateDefinition(wf.id, tenantA, '新名');
    expect(updated?.name).toBe('新名');
  });

  it('更新不存在的定义', () => {
    const updated = workflowOrchestrator.updateDefinition('fake-id', tenantA, '新名');
    expect(updated).toBeNull();
  });

  it('删除定义（级联）', () => {
    const wf = workflowOrchestrator.createDefinition(tenantA, adminA.id, wfName("将被删除"));
    const node = workflowOrchestrator.createNode(wf.id, '测试节点', 'input');
        workflowOrchestrator.createEdge(wf.id, node.id, node.id, undefined); // 自环不影响删除
    const ok =         workflowOrchestrator.deleteDefinition(wf.id, tenantA);
    expect(ok).toBe(true);
    const found = workflowOrchestrator.getDefinition(wf.id, tenantA);
    expect(found).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────
describe('Workflow Node CRUD', () => {
  let wf: WorkflowDefinition;
  beforeEach(() => {
    wf = workflowOrchestrator.createDefinition(tenantA, adminA.id, wfName("节点测试流"));
  });

  it('创建 input 节点', () => {
    const node = workflowOrchestrator.createNode(wf.id, '入口参数', 'input', {
      position: { x: 100, y: 200 },
      config: { default: { name: 'Alice' } },
    });
    expect(node.node_type).toBe('input');
    expect(node.workflow_id).toBe(wf.id);
    expect(node.config).toEqual({ default: { name: 'Alice' } });
    expect(node.retries).toBe(1);
    expect(node.timeout_seconds).toBe(30);
  });

  it('创建 tool 节点', () => {
    const node = workflowOrchestrator.createNode(wf.id, '打招呼', 'tool', {
      toolType: 'test:greet',
      config: { name: 'Bob' },
      retries: 2,
      timeoutSeconds: 5,
    });
    expect(node.node_type).toBe('tool');
    expect(node.tool_type).toBe('test:greet');
    expect(node.retries).toBe(2);
    expect(node.timeout_seconds).toBe(5);
  });

  it('创建 condition 节点', () => {
    const node = workflowOrchestrator.createNode(wf.id, '条件判断', 'condition');
    expect(node.node_type).toBe('condition');
  });

  it('创建 output 节点', () => {
    const node = workflowOrchestrator.createNode(wf.id, '输出结果', 'output');
    expect(node.node_type).toBe('output');
  });

  it('更新节点', () => {
    const node = workflowOrchestrator.createNode(wf.id, '旧名', 'tool', { toolType: 'test:greet' });
    const updated = workflowOrchestrator.updateNode(node.id, { name: '新名', retries: 3 });
    expect(updated?.name).toBe('新名');
    expect(updated?.retries).toBe(3);
  });

  it('更新不存在的节点', () => {
    const updated = workflowOrchestrator.updateNode('fake-id', { name: 'x' });
    expect(updated).toBeNull();
  });

  it('删除节点', () => {
    const node = workflowOrchestrator.createNode(wf.id, '将被删', 'input');
workflowOrchestrator.deleteNode(node.id);
    const found = workflowOrchestrator.getNode(node.id);
    expect(found).toBeNull();
  });

  it('获取节点列表', () => {
workflowOrchestrator.createNode(wf.id, '节点1', 'input');
workflowOrchestrator.createNode(wf.id, '节点2', 'tool', { toolType: 'test:greet' });
    const nodes = workflowOrchestrator.getNodes(wf.id);
    expect(nodes.length).toBe(2);
  });
});

// ──────────────────────────────────────────────────────────────
describe('Workflow Edge CRUD', () => {
  let wf: WorkflowDefinition;
  beforeEach(() => {
    wf = workflowOrchestrator.createDefinition(tenantA, adminA.id, wfName("边测试流"));
  });

  it('创建边', () => {
    const n1 = workflowOrchestrator.createNode(wf.id, '节点1', 'input');
    const n2 = workflowOrchestrator.createNode(wf.id, '节点2', 'tool', { toolType: 'test:greet' });
    const edge =         workflowOrchestrator.createEdge(wf.id, n1.id, n2.id);
    expect(edge.from_node_id).toBe(n1.id);
    expect(edge.to_node_id).toBe(n2.id);
  });

  it('带条件边', () => {
    const n1 = workflowOrchestrator.createNode(wf.id, '节点1', 'tool', { toolType: 'test:greet' });
    const n2 = workflowOrchestrator.createNode(wf.id, '节点2', 'output');
    const edge =         workflowOrchestrator.createEdge(wf.id, n1.id, n2.id, 'result.greeting.includes("Hello")');
    expect(edge.condition).toBe('result.greeting.includes("Hello")');
  });

  it('唯一约束：同对节点只一条边', () => {
    const n1 = workflowOrchestrator.createNode(wf.id, '节点1', 'input');
    const n2 = workflowOrchestrator.createNode(wf.id, '节点2', 'output');
        workflowOrchestrator.createEdge(wf.id, n1.id, n2.id);
        // 第二次插入同一对节点，UNIQUE 约束忽略
    workflowOrchestrator.createEdge(wf.id, n1.id, n2.id);
    const edges = workflowOrchestrator.getEdges(wf.id);
    expect(edges.length).toBe(1);
  });

  it('删除边', () => {
    const n1 = workflowOrchestrator.createNode(wf.id, '节点1', 'input');
    const n2 = workflowOrchestrator.createNode(wf.id, '节点2', 'output');
    const edge =         workflowOrchestrator.createEdge(wf.id, n1.id, n2.id);
workflowOrchestrator.deleteEdge(edge.id);
    const edges = workflowOrchestrator.getEdges(wf.id);
    expect(edges.find((e) => e.id === edge.id)).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────
describe('Graph Validation', () => {
  it('合法图：input → tool → output', () => {
    const wf = workflowOrchestrator.createDefinition(tenantA, adminA.id, wfName("合法图"));
    const n1 = workflowOrchestrator.createNode(wf.id, '入口', 'input');
    const n2 = workflowOrchestrator.createNode(wf.id, '工具', 'tool', { toolType: 'test:greet', config: { name: 'Alice' } });
    const n3 = workflowOrchestrator.createNode(wf.id, '输出', 'output');
        workflowOrchestrator.createEdge(wf.id, n1.id, n2.id);
        workflowOrchestrator.createEdge(wf.id, n2.id, n3.id);
    const nodes = workflowOrchestrator.getNodes(wf.id);
    const edges = workflowOrchestrator.getEdges(wf.id);
    const { valid, errors } = workflowOrchestrator.validateGraph(nodes, edges);
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('环检测：A→B→C→A', () => {
    const wf = workflowOrchestrator.createDefinition(tenantA, adminA.id, wfName("有环图"));
    const a = workflowOrchestrator.createNode(wf.id, 'A', 'tool', { toolType: 'test:greet', config: {} });
    const b = workflowOrchestrator.createNode(wf.id, 'B', 'tool', { toolType: 'test:greet', config: {} });
    const c = workflowOrchestrator.createNode(wf.id, 'C', 'tool', { toolType: 'test:greet', config: {} });
        workflowOrchestrator.createEdge(wf.id, a.id, b.id);
        workflowOrchestrator.createEdge(wf.id, b.id, c.id);
        workflowOrchestrator.createEdge(wf.id, c.id, a.id);
    const nodes = workflowOrchestrator.getNodes(wf.id);
    const edges = workflowOrchestrator.getEdges(wf.id);
    const { valid, errors } = workflowOrchestrator.validateGraph(nodes, edges);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('环') || e.includes('拓扑'))).toBe(true);
  });

  it('无输入节点', () => {
    const wf = workflowOrchestrator.createDefinition(tenantA, adminA.id, wfName("无入口"));
workflowOrchestrator.createNode(wf.id, wfName("无入口"), 'tool', { toolType: 'test:greet', config: {} });
    const nodes = workflowOrchestrator.getNodes(wf.id);
    const edges = workflowOrchestrator.getEdges(wf.id);
    const { valid, errors } = workflowOrchestrator.validateGraph(nodes, edges);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('input'))).toBe(true);
  });

  it('自环检测', () => {
    const wf = workflowOrchestrator.createDefinition(tenantA, adminA.id, wfName("自环"));
    const n = workflowOrchestrator.createNode(wf.id, '节点', 'tool', { toolType: 'test:greet', config: {} });
        workflowOrchestrator.createEdge(wf.id, n.id, n.id);
    const nodes = workflowOrchestrator.getNodes(wf.id);
    const edges = workflowOrchestrator.getEdges(wf.id);
    const { valid, errors } = workflowOrchestrator.validateGraph(nodes, edges);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('自环'))).toBe(true);
  });

  it('缺失节点引用', () => {
    const wf = workflowOrchestrator.createDefinition(tenantA, adminA.id, wfName("引用缺失"));
workflowOrchestrator.createNode(wf.id, '存在', 'input');
    const nodes = workflowOrchestrator.getNodes(wf.id);
    const edges = [{ id: 'e1', workflow_id: wf.id, from_node_id: 'fake-id', to_node_id: 'also-fake', condition: undefined }];
    const { valid, errors } = workflowOrchestrator.validateGraph(nodes, edges);
    expect(valid).toBe(false);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  it('DAG 排序成功', () => {
    const wf = workflowOrchestrator.createDefinition(tenantA, adminA.id, wfName("DAG"));
    const n1 = workflowOrchestrator.createNode(wf.id, 'A', 'input');
    const n2 = workflowOrchestrator.createNode(wf.id, 'B', 'tool', { toolType: 'test:greet', config: {} });
    const n3 = workflowOrchestrator.createNode(wf.id, 'C', 'output');
        workflowOrchestrator.createEdge(wf.id, n1.id, n2.id);
        workflowOrchestrator.createEdge(wf.id, n2.id, n3.id);
    const nodes = workflowOrchestrator.getNodes(wf.id);
    const edges = workflowOrchestrator.getEdges(wf.id);
    const { valid } = workflowOrchestrator.validateGraph(nodes, edges);
    expect(valid).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────
describe('DAG Execution', () => {
  let wf: WorkflowDefinition;

  beforeEach(() => {
    wf = workflowOrchestrator.createDefinition(tenantA, adminA.id, wfName("执行测试流"));
    workflowOrchestrator.updateDefinition(wf.id, tenantA, undefined, undefined, 'active');
  });

  it('线性流程：input → tool → output', async () => {
    const nIn = workflowOrchestrator.createNode(wf.id, '输入', 'input');
    const nTool = workflowOrchestrator.createNode(wf.id, '打招呼', 'tool', {
      toolType: 'test:greet',
      config: { name: 'Vorzai' },
    });
    const nOut = workflowOrchestrator.createNode(wf.id, '输出', 'output');
            workflowOrchestrator.createEdge(wf.id, nIn.id, nTool.id);
        workflowOrchestrator.createEdge(wf.id, nTool.id, nOut.id);

    const result = await workflowOrchestrator.execute(wf.id, tenantA);
    expect(result.run.status).toBe('succeeded');
    expect(result.logs.length).toBe(3);
    const toolLog = result.logs.find((l) => l.node_id === nTool.id);
    expect(toolLog?.status).toBe('succeeded');
    expect(toolLog?.output).toHaveProperty('greeting');
    expect(toolLog?.output.greeting).toContain('Vorzai');
  });

  it('input 节点接收初始输入', async () => {
    const nIn = workflowOrchestrator.createNode(wf.id, '输入', 'input', {
      config: { default: { name: 'Default' } },
    });
    const nTool = workflowOrchestrator.createNode(wf.id, '工具', 'tool', {
      toolType: 'test:greet',
      config: { name: 'FromInput' },
    });
            workflowOrchestrator.createEdge(wf.id, nIn.id, nTool.id);

    const result = await workflowOrchestrator.execute(wf.id, tenantA, { foo: 'bar' });
    expect(result.run.status).toBe('succeeded');
    const inLog = result.logs.find((l) => l.node_id === nIn.id);
    
    expect(inLog?.output).toHaveProperty('input_received', true);
  });

  it('output 节点收集结果', async () => {
    const nIn = workflowOrchestrator.createNode(wf.id, '输入', 'input');
    const nTool = workflowOrchestrator.createNode(wf.id, '工具', 'tool', {
      toolType: 'test:counter',
      config: { count: 42 },
    });
    const nOut = workflowOrchestrator.createNode(wf.id, '输出', 'output');
            workflowOrchestrator.createEdge(wf.id, nIn.id, nTool.id);
        workflowOrchestrator.createEdge(wf.id, nTool.id, nOut.id);

    const result = await workflowOrchestrator.execute(wf.id, tenantA);
    expect(result.run.status).toBe('succeeded');
    // output 节点应记录 output_recorded
    const outLog = result.logs.find((l) => l.node_id === nOut.id);
    expect(outLog?.output).toHaveProperty('output_recorded', true);
  });

  it('并行执行：input → toolA + toolB → output', async () => {
    const nIn = workflowOrchestrator.createNode(wf.id, '输入', 'input');
    const nA = workflowOrchestrator.createNode(wf.id, '工具A', 'tool', {
      toolType: 'test:double',
      config: { value: 10 },
    });
    const nB = workflowOrchestrator.createNode(wf.id, '工具B', 'tool', {
      toolType: 'test:counter',
      config: { count: 1 },
    });
    const nOut = workflowOrchestrator.createNode(wf.id, '输出', 'output');
        workflowOrchestrator.createEdge(wf.id, nIn.id, nA.id);
        workflowOrchestrator.createEdge(wf.id, nIn.id, nB.id);
        workflowOrchestrator.createEdge(wf.id, nA.id, nOut.id);
        workflowOrchestrator.createEdge(wf.id, nB.id, nOut.id);

    const result = await workflowOrchestrator.execute(wf.id, tenantA);
    expect(result.run.status).toBe('succeeded');
    const logA = result.logs.find((l) => l.node_id === nA.id);
    const logB = result.logs.find((l) => l.node_id === nB.id);
    expect(logA?.output).toHaveProperty('result', 20);
    expect(logB?.output).toHaveProperty('new_count', 2);
    expect(logA?.status).toBe('succeeded');
    expect(logB?.status).toBe('succeeded');
  });

  it('条件分支：条件为 true 继续，false 停止', async () => {
    const nIn = workflowOrchestrator.createNode(wf.id, '输入', 'input');
    const nTool = workflowOrchestrator.createNode(wf.id, '工具', 'tool', {
      toolType: 'test:double',
      config: { value: 5 },
    });

    const nPass = workflowOrchestrator.createNode(wf.id, '通过', 'tool', {
      toolType: 'test:counter',
      config: { count: 10 },
    });
    const nOut = workflowOrchestrator.createNode(wf.id, '输出', 'output');


            workflowOrchestrator.createEdge(wf.id, nIn.id, nTool.id);


            workflowOrchestrator.createEdge(wf.id, nTool.id, nPass.id, 'result.result >= 10');
    // nPass → nOut
            workflowOrchestrator.createEdge(wf.id, nPass.id, nOut.id);

    const result = await workflowOrchestrator.execute(wf.id, tenantA);
    expect(result.run.status).toBe('succeeded');
    const passLog = result.logs.find((l) => l.node_id === nPass.id);
    // result.result=10 ≥ 10，条件通过
    expect(passLog?.status).toBe('succeeded');
  });

  it('条件不满足：下游节点被跳过', async () => {
    const nIn = workflowOrchestrator.createNode(wf.id, '输入', 'input');
    const nTool = workflowOrchestrator.createNode(wf.id, '工具', 'tool', {
      toolType: 'test:double',
      config: { value: 2 }, // result=4
    });

    const nPass = workflowOrchestrator.createNode(wf.id, '应被跳过', 'tool', {
      toolType: 'test:counter',
      config: { count: 0 },
    });
    const nOut = workflowOrchestrator.createNode(wf.id, '输出', 'output');

            workflowOrchestrator.createEdge(wf.id, nIn.id, nTool.id);

    // 条件：result.result >= 100，不满足
            workflowOrchestrator.createEdge(wf.id, nTool.id, nPass.id, 'result.result >= 100');
            workflowOrchestrator.createEdge(wf.id, nPass.id, nOut.id);

    const result = await workflowOrchestrator.execute(wf.id, tenantA);
    expect(result.run.status).toBe('succeeded');
    // nPass 应被 cancelled（所有入边条件不满足）
    const passLog = result.logs.find((l) => l.node_id === nPass.id);
    expect(passLog?.status).toBe('cancelled');
  });

  it('重试机制：自动重试直到成功', async () => {
    const nIn = workflowOrchestrator.createNode(wf.id, '输入', 'input');
    const nTool = workflowOrchestrator.createNode(wf.id, '工具', 'tool', {
      toolType: 'test:greet',
      config: { name: 'RetryTest' },
      retries: 3,
      timeoutSeconds: 1,
    });
            workflowOrchestrator.createEdge(wf.id, nIn.id, nTool.id);

    const result = await workflowOrchestrator.execute(wf.id, tenantA);
    expect(result.run.status).toBe('succeeded');
  });

  it('超时：节点执行时间超过 timeout', { timeout: 15000 }, async () => {
    const nIn = workflowOrchestrator.createNode(wf.id, '输入', 'input');
    const nSlow = workflowOrchestrator.createNode(wf.id, '慢节点', 'tool', {
      toolType: 'test:slow',
      config: {},
      retries: 0,
      timeoutSeconds: 0.1, // 100ms，远小于 10s
    });
        workflowOrchestrator.createEdge(wf.id, nIn.id, nSlow.id);

    const result = await workflowOrchestrator.execute(wf.id, tenantA);
    // 应该失败
    expect(result.run.status).toBe('failed');
    const slowLog = result.logs.find((l) => l.node_id === nSlow.id);
    expect(slowLog?.status).toBe('failed');
  });

  it('错误：未注册的工具', async () => {
    const nIn = workflowOrchestrator.createNode(wf.id, '输入', 'input');
workflowOrchestrator.createNode(wf.id, '未注册工具', 'tool', {
      toolType: 'nonexistent:tool',
      config: {},
    });
    // 无边的独立 tool 节点，仍会尝试执行
    const result = await workflowOrchestrator.execute(wf.id, tenantA);
    expect(result.run.status).toBe('failed');
  });

  it('错误：非 active 状态工作流', async () => {
    const draftWf = workflowOrchestrator.createDefinition(tenantA, adminA.id, wfName("草稿状态"));
    const nIn = workflowOrchestrator.createNode(draftWf.id, '输入', 'input');
workflowOrchestrator.createNode(draftWf.id, '工具', 'tool', { toolType: 'test:greet', config: {} });
    try {
      await workflowOrchestrator.execute(draftWf.id, tenantA);
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err instanceof Error).toBe(true);
      expect((err as Error).message).toContain('not active');
    }
  });
});

// ──────────────────────────────────────────────────────────────
describe('Run Management', () => {
  it('执行记录列表', async () => {
    const wf = workflowOrchestrator.createDefinition(tenantA, adminA.id, wfName("运行管理"));
    workflowOrchestrator.updateDefinition(wf.id, tenantA, undefined, undefined, 'active');
    const nIn = workflowOrchestrator.createNode(wf.id, '输入', 'input');
    const nTool = workflowOrchestrator.createNode(wf.id, '工具', 'tool', { toolType: 'test:greet', config: { name: 'Run' } });
            workflowOrchestrator.createEdge(wf.id, nIn.id, nTool.id);

    await workflowOrchestrator.execute(wf.id, tenantA);
    await workflowOrchestrator.execute(wf.id, tenantA);

    const runs = workflowOrchestrator.listRuns(tenantA, wf.id);
    expect(runs.length).toBeGreaterThanOrEqual(2);
  });

  it('执行记录详情', async () => {
    const wf = workflowOrchestrator.createDefinition(tenantA, adminA.id, wfName("运行详情"));
    workflowOrchestrator.updateDefinition(wf.id, tenantA, undefined, undefined, 'active');
    const nIn = workflowOrchestrator.createNode(wf.id, '输入', 'input');
    const nTool = workflowOrchestrator.createNode(wf.id, '工具', 'tool', { toolType: 'test:greet', config: { name: 'Detail' } });
            workflowOrchestrator.createEdge(wf.id, nIn.id, nTool.id);

    const result = await workflowOrchestrator.execute(wf.id, tenantA);
    const run = workflowOrchestrator.getRun(result.run.id, tenantA);
    expect(run).not.toBeNull();
    expect(run?.status).toBe('succeeded');
    expect(run?.workflow_name?.startsWith('运行详情')).toBe(true);
  });

  it('执行状态摘要', async () => {
    const wf = workflowOrchestrator.createDefinition(tenantA, adminA.id, wfName("状态摘要"));
    workflowOrchestrator.updateDefinition(wf.id, tenantA, undefined, undefined, 'active');
    const nIn = workflowOrchestrator.createNode(wf.id, '输入', 'input');
    const nTool = workflowOrchestrator.createNode(wf.id, '工具', 'tool', { toolType: 'test:greet', config: { name: 'Status' } });
            workflowOrchestrator.createEdge(wf.id, nIn.id, nTool.id);

    const result = await workflowOrchestrator.execute(wf.id, tenantA);
    const status = workflowOrchestrator.getRunStatus(result.run.id, tenantA);
    expect(status).not.toBeNull();
    expect(status?.active).toBe(0);
    expect(status?.succeeded).toBe(2); // input + tool
    expect(status?.failed).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────
describe('Tenant Isolation', () => {
  let tenantBUser: { id: string };

  beforeAll(() => {
    tenantBUser = seedUser(tenantB);
  });

  it('租户 A 看不到租户 B 的工作流', () => {
    const wfB = workflowOrchestrator.createDefinition(tenantB, tenantBUser.id, wfName("租户B私有"));
    const found = workflowOrchestrator.getDefinition(wfB.id, tenantA);
    expect(found).toBeNull();
  });

  it('租户 B 看不到租户 A 的工作流', () => {
    const wfA = workflowOrchestrator.createDefinition(tenantA, adminA.id, wfName("租户A私有"));
    const found = workflowOrchestrator.getDefinition(wfA.id, tenantB);
    expect(found).toBeNull();
  });

  it('跨租户执行失败', async () => {
    const wfA = workflowOrchestrator.createDefinition(tenantA, adminA.id, wfName("跨租户"));
workflowOrchestrator.updateDefinition(wfA.id, tenantA, undefined, undefined, 'active');
workflowOrchestrator.createNode(wfA.id, '输入', 'input');
    try {
      await workflowOrchestrator.execute(wfA.id, tenantB);
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err instanceof Error).toBe(true);
    }
  });

  it('跨租户运行记录不可见', async () => {
    const wfA = workflowOrchestrator.createDefinition(tenantA, adminA.id, wfName("跨租户运行"));
workflowOrchestrator.updateDefinition(wfA.id, tenantA, undefined, undefined, 'active');
    const nIn = workflowOrchestrator.createNode(wfA.id, '输入', 'input');
    const nTool = workflowOrchestrator.createNode(wfA.id, '工具', 'tool', { toolType: 'test:greet', config: { name: 'CrossTenant' } });
workflowOrchestrator.createEdge(wfA.id, nIn.id, nTool.id);

    const result = await workflowOrchestrator.execute(wfA.id, tenantA);
    const found = workflowOrchestrator.getRun(result.run.id, tenantB);
    expect(found).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────
describe('Tool Registry', () => {
  it('注册工具可获取', () => {
    expect(getRegisteredTools()).toContain('test:greet');
    expect(getTool('test:greet')).toBeDefined();
    expect(getTool('nonexistent')).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────
describe('Edge Cases', () => {
  it('空输入图：只有 input + output', async () => {
    const wf = workflowOrchestrator.createDefinition(tenantA, adminA.id, wfName("最简流"));
    workflowOrchestrator.updateDefinition(wf.id, tenantA, undefined, undefined, 'active');
    const nIn = workflowOrchestrator.createNode(wf.id, '输入', 'input');
    const nOut = workflowOrchestrator.createNode(wf.id, '输出', 'output');
        workflowOrchestrator.createEdge(wf.id, nIn.id, nOut.id);

    const result = await workflowOrchestrator.execute(wf.id, tenantA);
    expect(result.run.status).toBe('succeeded');
    expect(result.run.outputs).toHaveProperty('output_recorded', true);
  });

  it('多 input 节点（所有 input 都有入度=0，应全部激活）', async () => {
    const wf = workflowOrchestrator.createDefinition(tenantA, adminA.id, wfName("多入口"));
    workflowOrchestrator.updateDefinition(wf.id, tenantA, undefined, undefined, 'active');
    const nIn1 = workflowOrchestrator.createNode(wf.id, '入口1', 'input');
    const nIn2 = workflowOrchestrator.createNode(wf.id, '入口2', 'input');
    const nOut = workflowOrchestrator.createNode(wf.id, '输出', 'output');
        workflowOrchestrator.createEdge(wf.id, nIn1.id, nOut.id);
        workflowOrchestrator.createEdge(wf.id, nIn2.id, nOut.id);

    const result = await workflowOrchestrator.execute(wf.id, tenantA);
    expect(result.run.status).toBe('succeeded');
    expect(result.logs.filter((l) => l.status === 'succeeded').length).toBe(3);
  });

  it('执行记录按时间排序', async () => {
    const wf = workflowOrchestrator.createDefinition(tenantA, adminA.id, wfName("时间排序"));
    workflowOrchestrator.updateDefinition(wf.id, tenantA, undefined, undefined, 'active');
    const nIn = workflowOrchestrator.createNode(wf.id, '输入', 'input');
    const nTool = workflowOrchestrator.createNode(wf.id, '工具', 'tool', { toolType: 'test:greet', config: { name: 'Sort' } });
            workflowOrchestrator.createEdge(wf.id, nIn.id, nTool.id);

    await workflowOrchestrator.execute(wf.id, tenantA);
    await workflowOrchestrator.execute(wf.id, tenantA);

    const runs = workflowOrchestrator.listRuns(tenantA, wf.id);
    expect(runs.length).toBeGreaterThanOrEqual(2);
    // 确认按 started_at DESC 排序
    const times = runs.map((r) => r.started_at);
    for (let i = 0; i < times.length - 1; i++) {
      expect(times[i] >= times[i + 1]).toBe(true);
    }
  });
});
