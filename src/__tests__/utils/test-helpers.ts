/**
 * 通用测试辅助函数
 * 提供创建测试用 Agent、Tenant、Task、Connector 等对象的工具
 */
import type {
  Agent, AgentConfig, AgentStatus, AgentType,
  Connector, ConnectorType, ConnectorStatus,
  LLMPlatform, LLMRequest, LLMResponse,
  Tenant as AppTenant,
} from '@domain/index';
import type {
  OgsmItem, OgsmLevel, OgsmStatus,
  Task, TaskStatus, TaskPriority,
  RACIEntry, RACIRole,
  Risk, RiskSeverity, RiskStatus,
  HREmployee, HRPillar,
  OgsmTreeNode,
} from '@domain/hrms';
import type {
  TenantConfig, TenantUser, TenantPlan, TenantUserRole,
  Permission, Role, ABACPolicy,
} from '@multi-tenant/types';
import type { ExportConfig, FieldMapping } from '@file-io/types';

// ─── 时间模拟 ───

export function withDate(frozenDate: string, cb: () => void): void {
  const orig = Date.now.bind(Date);
  const fake = () => new Date(frozenDate).getTime();
  Date.now = fake as any;
  try {
    cb();
  } finally {
    Date.now = orig;
  }
}

// ─── Agent 工厂 ───

export function createTestAgent(
  overrides?: Partial<Agent>
): Agent {
  const config: AgentConfig = {
    model: 'gpt-4',
    temperature: 0.7,
    systemPrompt: '你是Vorzai电商助手',
    maxTokens: 2048,
    retryCount: 3,
  };
  const now = new Date().toISOString();
  return {
    id: 'agent-001',
    name: '测试 Agent',
    description: '测试用 Agent',
    type: 'order-manager' as AgentType,
    status: 'idle' as AgentStatus,
    config,
    skills: ['skill-1', 'skill-2'],
    experts: ['expert-1'],
    connectors: ['connector-1'],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ─── Connector 工厂 ───

export function createTestConnector(
  overrides?: Partial<Connector>
): Connector {
  return {
    id: 'connector-001',
    name: '测试连接器',
    type: 'hr-system' as ConnectorType,
    status: 'connected' as ConnectorStatus,
    config: { endpoint: 'https://api.example.com' },
    lastSyncAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── LLMPlatform 工厂 ───

export function createTestLLMPlatform(
  overrides?: Partial<LLMPlatform>
): LLMPlatform {
  return {
    id: 'llm-001',
    name: 'Test LLM',
    provider: 'openai-compat',
    baseUrl: 'https://api.test.com/v1',
    apiKey: 'sk-test-key',
    models: ['test-model-1'],
    isActive: true,
    ...overrides,
  };
}

export function createTestLLMRequest(
  overrides?: Partial<LLMRequest>
): LLMRequest {
  return {
    model: 'test-model',
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello' },
    ],
    temperature: 0.7,
    maxTokens: 128,
    stream: false,
    ...overrides,
  };
}

export function createTestLLMResponse(
  overrides?: Partial<LLMResponse>
): LLMResponse {
  return {
    content: 'Test response',
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    model: 'test-model',
    ...overrides,
  };
}

// ─── OGSM 工厂 ───

export function createTestOgsmItem(
  overrides?: Partial<OgsmItem>
): OgsmItem {
  return {
    id: 'ogsm-001',
    parentId: null,
    level: 'objective' as OgsmLevel,
    title: '测试目标',
    description: '测试用 OGSM 项',
    status: 'planned' as OgsmStatus,
    orderIndex: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    objective: '测试企业目标',
    ...overrides,
  };
}

export function buildOgsmFourLevels(): OgsmItem[] {
  return [
    // Objective
    { id: 'o1', parentId: null, level: 'objective', title: '扩大直播电商份额', description: '', status: 'in-progress' as OgsmStatus, orderIndex: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), objective: '一年内直播GMV破亿' },
    // Strategy (children of o1)
    { id: 's1', parentId: 'o1', level: 'strategy', title: '打造头部主播矩阵', description: '', status: 'in-progress' as OgsmStatus, orderIndex: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), strategy: '签约10位头部主播' },
    { id: 's2', parentId: 'o1', level: 'strategy', title: '优化供应链响应', description: '', status: 'planned' as OgsmStatus, orderIndex: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), strategy: '缩短发货周期至24小时' },
    // Goal (children of s1)
    { id: 'g1', parentId: 's1', level: 'goal', title: '新增签约主播10位', description: '', status: 'in-progress' as OgsmStatus, orderIndex: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), target: 10, metric: '签约主播数' },
    // Measurement (children of g1)
    { id: 'm1', parentId: 'g1', level: 'measurement', title: '月度签约完成数', description: '', status: 'in-progress' as OgsmStatus, orderIndex: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), target: 100, metric: '月度完成度%', unit: '%', baseline: 50, currentValue: 60 },
  ];
}

export function buildOgsmTree(items: OgsmItem[]): OgsmTreeNode[] {
  function build(parentId: string | null): OgsmTreeNode[] {
    return items
      .filter((i) => i.parentId === parentId)
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((item) => ({
        item,
        children: build(item.id),
        tasks: [],
        risks: [],
        progress: 0,
      }));
  }
  return build(null);
}

// ─── Task 工厂 ───

export function createTestTask(
  overrides?: Partial<Task>
): Task {
  return {
    id: 'task-001',
    title: '测试任务',
    description: '测试用任务',
    status: 'todo' as TaskStatus,
    priority: 'medium' as TaskPriority,
    progress: 0,
    subtasks: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── RACI 工厂 ───

export function createTestRACIEntry(
  overrides?: Partial<RACIEntry>
): RACIEntry {
  return {
    id: 'raci-001',
    taskId: 'task-001',
    employeeId: 'emp-001',
    employeeName: '测试员工',
    role: 'R' as RACIRole,
    roleLabel: '负责人',
    ...overrides,
  };
}

// ─── Risk 工厂 ───

export function createTestRisk(
  overrides?: Partial<Risk>
): Risk {
  return {
    id: 'risk-001',
    title: '测试风险',
    description: '测试用风险项',
    severity: 'high' as RiskSeverity,
    status: 'open' as RiskStatus,
    likelihood: 0.5,
    score: 15,
    detectedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Employee 工厂 ───

export function createTestEmployee(
  overrides?: Partial<HREmployee>
): HREmployee {
  return {
    id: 'emp-001',
    name: '测试员工',
    department: '技术部',
    position: '工程师',
    pillar: 'hrbp' as HRPillar,
    pillarLabel: 'HRBP 业务伙伴',
    status: 'active',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── 租户测试夹具 ───

export function createTestTenant(
  overrides?: Partial<TenantConfig>
): TenantConfig {
  return {
    id: 'tenant-001',
    name: '测试租户',
    domain: 'test.vorzai.com',
    plan: 'pro' as TenantPlan,
    contactEmail: 'admin@test.com',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'active',
    isolation: {
      db: 'shared-tenant-id',
      storage: 'directory',
      cache: 'namespace',
    },
    limits: { maxUsers: 100, maxStorageGB: 50, maxApiCalls: 10000, maxAgents: 10 },
    features: ['hrms', 'analytics'],
    settings: {},
    ...overrides,
  };
}

export function createTestTenantUser(
  overrides?: Partial<TenantUser>
): TenantUser {
  return {
    id: 'user-001',
    tenantId: 'tenant-001',
    email: 'test@test.com',
    name: '测试用户',
    department: '技术部',
    position: '主管',
    grade: 5,
    role: 'member' as TenantUserRole,
    roles: ['role-member'],
    permissions: ['hrms:task:read:own', 'file:upload:own'],
    status: 'active',
    mfaEnabled: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

export function createTestRole(
  overrides?: Partial<Role>
): Role {
  return {
    id: 'role-member',
    tenantId: 'tenant-001',
    name: '普通成员',
    code: 'member',
    description: '基础权限',
    permissions: ['hrms:task:read:own', 'file:upload:own'],
    isSystem: true,
    isDefault: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

export function createTestPermission(
  overrides?: Partial<Permission>
): Permission {
  return {
    id: 'perm-001',
    name: '测试权限',
    code: 'hrms:task:read:own',
    resourceType: 'api',
    resource: 'hrms:task:*',
    effect: 'allow',
    description: '测试用权限',
    ...overrides,
  };
}

export function createTestABACPolicy(
  overrides?: Partial<ABACPolicy>
): ABACPolicy {
  return {
    id: 'abac-001',
    tenantId: 'tenant-001',
    name: '测试ABAC策略',
    description: '仅本部门可访问',
    effect: 'allow',
    resource: 'hrms:employee:*',
    conditions: [
      { attribute: 'department', source: 'environment', operator: 'eq', value: '技术部' },
    ],
    priority: 100,
    enabled: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Export Config 工厂 ───

export function createTestExportConfig(
  overrides?: Partial<ExportConfig>
): ExportConfig {
  const fieldMapping: FieldMapping[] = [
    { sourceField: 'id', targetField: 'ID', required: true },
    { sourceField: 'name', targetField: '名称', required: true },
    { sourceField: 'value', targetField: '值', required: false },
  ];
  return {
    format: 'csv',
    fieldMapping,
    encoding: 'utf-8',
    includeHeaders: true,
    chunkSize: 0,
    filename: 'test-export.csv',
    ...overrides,
  };
}
