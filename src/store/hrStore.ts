/**
 * HRMS 状态管理（Zustand + IndexedDB 持久化）
 * 覆盖 OGSM / 任务 / RACI / 风险 / 激励 / 试点 / 制度文档 / 三支柱
 *
 * 单一真相源策略（B4 修复说明）：
 * - 后端 API（@api/hr 的 hrApi）是唯一真相源，所有写操作必须经由 hrApi 落库。
 * - 本 store 仅作为「离线缓存 / 乐观更新层」，在后端不可达时提供本地可读副本；
 *   挂载时通过 hydrate() 用后端数据水合，避免「看起来丢了 / 两边不一致」。
 * - 禁止仅写入 IndexedDB 而不调用 hrApi；新增 HR 写入点须同步走 hrApi。
 */
import { create } from 'zustand';
import {
  OgsmItem, OgsmLevel, OgsmStatus, Task, TaskStatus, TaskPriority,
  RACIEntry, RACIRole, RACIMatrixRow, Risk, RiskSeverity, RiskStatus,
  Incentive, IncentiveType, IncentiveResult,
  Pilot, PilotStatus, PilotMetric, RolloutPlan, RolloutPhase,
  PolicyDocument, ChangeRecord,
  HREmployee, COEExpert, HRBP, SSCMember, HRPillar, HRPillarLabel,
  ScenarioConfig, EcomScenario,
  OgsmTreeNode, OGSMViewMode,
} from '@domain/hrms';
import { getItem, setItem, delItem, exportDataWithKeys, importData } from '@utils/storage';
import { moduleBus } from '@api/moduleBus';
import {
  hrApi, toSyncPayload, deriveEmployeeNo,
  type OrgNode, type OrgTreeResult, type SyncResult,
} from '@api/hr';

// 存储 key
const STORE_KEYS = {
  ogsm: 'hrms:ogsm',
  tasks: 'hrms:tasks',
  raci: 'hrms:raci',
  risks: 'hrms:risks',
  incentives: 'hrms:incentives',
  incentiveResults: 'hrms:incentive-results',
  pilots: 'hrms:pilots',
  policies: 'hrms:policies',
  employees: 'hrms:employees',
  scenarios: 'hrms:scenarios',
  config: 'hrms:config',
  syncMeta: 'hrms:sync-meta',
} as const;

type StoreKey = keyof typeof STORE_KEYS;

// 持久化加载器
async function loadAll(): Promise<Partial<HRMSState>> {
  const state: Partial<HRMSState> = {};
  const allKeys: StoreKey[] = Object.keys(STORE_KEYS) as StoreKey[];
  for (const key of allKeys) {
    const value = await getItem(STORE_KEYS[key]);
    if (value) (state as any)[key] = value;
  }
  return state;
}

// 持久化写入器
function persist(key: string, value: unknown): void {
  setItem(STORE_KEYS[key as keyof typeof STORE_KEYS], value).catch(() => {});
}

export interface HRMSState {
  // OGSM
  ogsmItems: OgsmItem[];
  selectedOgsmId?: string;
  viewMode: OGSMViewMode;

  // 任务
  tasks: Task[];
  selectedTaskId?: string;

  // RACI
  raciEntries: RACIEntry[];

  // 风险
  risks: Risk[];

  // 激励
  incentives: Incentive[];
  incentiveResults: IncentiveResult[];

  // 试点
  pilots: Pilot[];

  // 制度文档
  policies: PolicyDocument[];

  // 员工
  employees: HREmployee[];

  // 业务场景配置
  scenarios: ScenarioConfig[];

  // 视图状态
  taskFilter: TaskFilter;
  riskFilter: RiskFilter;

  // ─── V2 · M2 后端同步（消除 IndexedDB ↔ hrService 双轨脱节）───
  /** 本地缓存是否已从 IndexedDB 水合，避免重复加载 */
  hydrated: boolean;
  /** 同步元信息（持久化，重启后仍能看到上次同步时间） */
  syncMeta: HRSyncMeta | null;
  /** 当前同步状态（不持久化，进程内瞬时） */
  syncStatus: HRSyncStatus;
  syncMessage: string;
  /** 后端组织架构树（H1），前端组织视图唯一数据源 */
  orgTree: OrgNode[];
  orgSummary: OrgTreeResult['summary'] | null;
  orgLoading: boolean;
  orgError: string;
}

export type HRSyncStatus = 'idle' | 'syncing' | 'success' | 'error';

export interface HRSyncMeta {
  lastSyncAt?: string;
  lastPullAt?: string;
  lastResult?: SyncResult;
}

export interface TaskFilter {
  status?: TaskStatus;
  priority?: TaskPriority;
  assignee?: string;
  scenario?: EcomScenario;
  search?: string;
}

export interface RiskFilter {
  severity?: RiskSeverity;
  status?: RiskStatus;
  assignee?: string;
}

export interface HRMSStore extends HRMSState {
  // OGSM actions
  addOgsmItem: (item: Omit<OgsmItem, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateOgsmItem: (id: string, updates: Partial<OgsmItem>) => void;
  deleteOgsmItem: (id: string) => void;
  buildOgsmTree: () => OgsmTreeNode[];
  getOgsmByLevel: (level: OgsmLevel) => OgsmItem[];

  // 任务 actions
  addTask: (task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  moveTaskToColumn: (id: string, status: TaskStatus) => void;
  getTaskByOgsmId: (ogsmId: string) => Task[];

  // RACI actions
  addRACIEntry: (entry: Omit<RACIEntry, 'id'>) => void;
  removeRACIEntry: (taskId: string, role: RACIRole) => void;
  getRACIMatrix: (taskId: string) => RACIMatrixRow;

  // 风险 actions
  addRisk: (risk: Omit<Risk, 'id' | 'detectedAt' | 'score'>) => void;
  updateRisk: (id: string, updates: Partial<Risk>) => void;
  deleteRisk: (id: string) => void;

  // 激励 actions
  addIncentive: (incentive: Omit<Incentive, 'id' | 'createdAt'>) => void;
  updateIncentive: (id: string, updates: Partial<Incentive>) => void;
  deleteIncentive: (id: string) => void;
  calculateIncentive: (incentiveId: string, employeeId: string) => void;

  // 试点 actions
  addPilot: (pilot: Omit<Pilot, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updatePilot: (id: string, updates: Partial<Pilot>) => void;
  deletePilot: (id: string) => void;

  // 制度文档 actions
  addPolicy: (policy: Omit<PolicyDocument, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updatePolicy: (id: string, updates: Partial<PolicyDocument>) => void;
  versionPolicy: (id: string, change: string) => void;
  deletePolicy: (id: string) => void;

  // 员工 actions
  addEmployee: (employee: Omit<HREmployee, 'id' | 'createdAt'>) => void;
  updateEmployee: (id: string, updates: Partial<HREmployee>) => void;
  deleteEmployee: (id: string) => void;

  // 场景配置
  addScenario: (scenario: Omit<ScenarioConfig, 'id' | 'createdAt'>) => void;

  // 视图
  setViewMode: (mode: OGSMViewMode) => void;
  setSelectedOgsm: (id: string | undefined) => void;
  setSelectedTask: (id: string | undefined) => void;
  setTaskFilter: (filter: TaskFilter) => void;
  setRiskFilter: (filter: RiskFilter) => void;

  // 数据导入导出
  exportHRMS: () => Promise<string>;
  importHRMS: (jsonStr: string) => Promise<void>;

  // ─── V2 · M2 后端同步 ───
  /** 从 IndexedDB 水合本地缓存（幂等，重复调用只生效一次） */
  hydrate: () => Promise<void>;
  /** 把本地员工回流后端（幂等键 = 工号），成功后回写 employeeNo / syncedAt */
  syncEmployeesToBackend: () => Promise<SyncResult | null>;
  /** 以后端为准拉取员工，按工号与本地合并（后端字段覆盖本地） */
  pullEmployeesFromBackend: () => Promise<number>;
  /** 拉取后端组织架构树 */
  loadOrgTree: () => Promise<void>;
}

// ID 生成器
let _counter = 0;
function genId(prefix: string): string {
  _counter += 1;
  return `${prefix}_${Date.now()}_${_counter}`;
}

// OGSM 树构建器
function buildTree(items: OgsmItem[], parentId: string | null, depth: number = 0): OgsmTreeNode[] {
  const children = items
    .filter((i) => i.parentId === parentId)
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((item) => ({
      item,
      children: buildTree(items, item.id, depth + 1),
      tasks: [],
      risks: [],
      progress: 0,
    }));
  return children;
}

// 初始状态
const initialState: HRMSState = {
  ogsmItems: [],
  tasks: [],
  raciEntries: [],
  risks: [],
  incentives: [],
  incentiveResults: [],
  pilots: [],
  policies: [],
  employees: [],
  scenarios: [],
  viewMode: 'tree',
  taskFilter: {},
  riskFilter: {},
  hydrated: false,
  syncMeta: null,
  syncStatus: 'idle',
  syncMessage: '',
  orgTree: [],
  orgSummary: null,
  orgLoading: false,
  orgError: '',
};

export const useHRMSStore = create<HRMSStore>((set, get) => ({
  ...initialState,

  // ═══ OGSM ═══
  addOgsmItem: (item) => {
    const existing = get().ogsmItems;
    const maxOrder = existing.filter((i) => i.parentId === item.parentId).reduce((max, i) => Math.max(max, i.orderIndex), -1);
    const newId = genId('ogsm');
    const now = new Date().toISOString();
    set({ ogsmItems: [...existing, { ...item, id: newId, orderIndex: maxOrder + 1, createdAt: now, updatedAt: now }] });
    persist('ogsm', get().ogsmItems);
    moduleBus.broadcast('hrms:ogsm-add', { id: newId });
  },

  updateOgsmItem: (id, updates) => {
    const updated = get().ogsmItems.map((i) =>
      i.id === id ? { ...i, ...updates, updatedAt: new Date().toISOString() } : i
    );
    set({ ogsmItems: updated });
    persist('ogsm', updated);
    moduleBus.broadcast('hrms:ogsm-update', { id, updates });
  },

  deleteOgsmItem: (id) => {
    const updated = get().ogsmItems.filter((i) => i.id !== id);
    set({ ogsmItems: updated });
    persist('ogsm', updated);
    moduleBus.broadcast('hrms:ogsm-delete', { id });
  },

  buildOgsmTree: () => {
    return buildTree(get().ogsmItems, null);
  },

  getOgsmByLevel: (level) => get().ogsmItems.filter((i) => i.level === level),

  // ═══ 任务 ═══
  addTask: (task) => {
    const existing = get().tasks;
    const newId = genId('task');
    const now = new Date().toISOString();
    set({ tasks: [...existing, { ...task, id: newId, createdAt: now, updatedAt: now, progress: task.progress || 0, subtasks: task.subtasks || [], attachments: task.attachments || [] }] });
    persist('tasks', get().tasks);
    moduleBus.broadcast('hrms:task-add', { id: newId });
  },

  updateTask: (id, updates) => {
    const updated = get().tasks.map((t) =>
      t.id === id ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t
    );
    set({ tasks: updated });
    persist('tasks', updated);
    moduleBus.broadcast('hrms:task-update', { id, updates });
  },

  deleteTask: (id) => {
    const updated = get().tasks.filter((t) => t.id !== id);
    set({ tasks: updated });
    persist('tasks', updated);
  },

  moveTaskToColumn: (id, status) => {
    get().updateTask(id, { status });
  },

  getTaskByOgsmId: (ogsmId) => get().tasks.filter((t) => t.ogsmId === ogsmId),

  // ═══ RACI ═══
  addRACIEntry: (entry) => {
    const existing = get().raciEntries;
    const newId = genId('raci');
    set({ raciEntries: [...existing, { ...entry, id: newId }] });
    persist('raci', get().raciEntries);
  },

  removeRACIEntry: (taskId, role) => {
    const updated = get().raciEntries.filter((e) => !(e.taskId === taskId && e.role === role));
    set({ raciEntries: updated });
    persist('raci', updated);
  },

  getRACIMatrix: (taskId) => {
    const entries = get().raciEntries.filter((e) => e.taskId === taskId);
    const roles: Record<RACIRole, RACIEntry | null> = { R: null, A: null, C: null, I: null };
    entries.forEach((e) => { roles[e.role] = e; });
    const task = get().tasks.find((t) => t.id === taskId);
    return { taskId, taskTitle: task?.title || '', roles };
  },

  // ═══ 风险 ═══
  addRisk: (risk) => {
    const existing = get().risks;
    const newId = genId('risk');
    const severityScore: Record<RiskSeverity, number> = { critical: 4, high: 3, medium: 2, low: 1 };
    const severity = risk.severity || 'medium';
    const score = (severityScore[severity] * (risk.likelihood || 0.5)) * 10;
    set({ risks: [...existing, { ...risk, id: newId, detectedAt: new Date().toISOString(), score: Math.round(score * 10) / 10 }] });
    persist('risks', get().risks);
  },

  updateRisk: (id, updates) => {
    const updated = get().risks.map((r) => r.id === id ? { ...r, ...updates } : r);
    set({ risks: updated });
    persist('risks', updated);
  },

  deleteRisk: (id) => {
    const updated = get().risks.filter((r) => r.id !== id);
    set({ risks: updated });
    persist('risks', updated);
  },

  // ═══ 激励 ═══
  addIncentive: (incentive) => {
    const existing = get().incentives;
    const newId = genId('inc');
    const now = new Date().toISOString();
    set({ incentives: [...existing, { ...incentive, id: newId, createdAt: now, status: 'active' as const }] });
    persist('incentives', get().incentives);
  },

  updateIncentive: (id, updates) => {
    const updated = get().incentives.map((i) => i.id === id ? { ...i, ...updates } : i);
    set({ incentives: updated });
    persist('incentives', updated);
  },

  deleteIncentive: (id) => {
    const updated = get().incentives.filter((i) => i.id !== id);
    set({ incentives: updated });
    persist('incentives', updated);
  },

  calculateIncentive: (incentiveId, employeeId) => {
    const incentive = get().incentives.find((i) => i.id === incentiveId);
    if (!incentive) return;
    const employee = get().employees.find((e) => e.id === employeeId);
    const existing = get().incentiveResults;
    const now = new Date().toISOString();
    set({ incentiveResults: [...existing, { incentiveId, employeeId, employeeName: employee?.name || '', reward: incentive.reward, calculatedAt: now, status: 'pending' }] });
    persist('incentiveResults', get().incentiveResults);
  },

  // ═══ 试点 ═══
  addPilot: (pilot) => {
    const existing = get().pilots;
    const newId = genId('pilot');
    const now = new Date().toISOString();
    set({ pilots: [...existing, { ...pilot, id: newId, createdAt: now, updatedAt: now, metrics: pilot.metrics || [], status: 'planning' as PilotStatus }] });
    persist('pilots', get().pilots);
  },

  updatePilot: (id, updates) => {
    const updated = get().pilots.map((p) => p.id === id ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p);
    set({ pilots: updated });
    persist('pilots', updated);
  },

  deletePilot: (id) => {
    const updated = get().pilots.filter((p) => p.id !== id);
    set({ pilots: updated });
    persist('pilots', updated);
  },

  // ═══ 制度文档 ═══
  addPolicy: (policy) => {
    const existing = get().policies;
    const newId = genId('policy');
    const now = new Date().toISOString();
    set({ policies: [...existing, { ...policy, id: newId, createdAt: now, updatedAt: now, version: policy.version || 'v1.0', changeLog: policy.changeLog || [] }] });
    persist('policies', get().policies);
  },

  updatePolicy: (id, updates) => {
    const updated = get().policies.map((p) => p.id === id ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p);
    set({ policies: updated });
    persist('policies', updated);
  },

  versionPolicy: (id, change) => {
    const policies = get().policies;
    const policy = policies.find((p) => p.id === id);
    if (!policy) return;
    const currentVersion = policy.version || 'v1.0';
    const versionNum = parseInt(currentVersion.replace('v', '').split('.')[0]) || 1;
    const newVersion = `v${versionNum + 1}.0`;
    const now = new Date().toISOString();
    const updated = policies.map((p) =>
      p.id === id
        ? {
          ...p,
          version: newVersion,
          changeLog: [...(p.changeLog || []), { version: newVersion, change, changedBy: 'system', changedAt: now }],
          updatedAt: now,
        }
        : p
    );
    set({ policies: updated });
    persist('policies', updated);
  },

  deletePolicy: (id) => {
    const updated = get().policies.filter((p) => p.id !== id);
    set({ policies: updated });
    persist('policies', updated);
  },

  // ═══ 员工 ═══
  addEmployee: (employee) => {
    const existing = get().employees;
    const newId = genId('emp');
    const pillarLabel: Record<HRPillar, string> = { coe: 'COE 专家中心', hrbp: 'HRBP 业务伙伴', ssc: 'SSC 共享服务中心' };
    set({ employees: [...existing, { ...employee, id: newId, createdAt: new Date().toISOString(), pillarLabel: pillarLabel[employee.pillar] as HRPillarLabel }] });
    persist('employees', get().employees);
  },

  updateEmployee: (id, updates) => {
    const updated = get().employees.map((e) => e.id === id ? { ...e, ...updates } : e);
    set({ employees: updated });
    persist('employees', updated);
  },

  deleteEmployee: (id) => {
    const updated = get().employees.filter((e) => e.id !== id);
    set({ employees: updated });
    persist('employees', updated);
  },

  // ═══ 场景配置 ═══
  addScenario: (scenario) => {
    const existing = get().scenarios;
    const newId = genId('scene');
    set({ scenarios: [...existing, { ...scenario, id: newId, createdAt: new Date().toISOString() }] });
    persist('scenarios', get().scenarios);
  },

  // ═══ 视图 ═══
  setViewMode: (mode) => set({ viewMode: mode }),
  setSelectedOgsm: (id) => set({ selectedOgsmId: id }),
  setSelectedTask: (id) => set({ selectedTaskId: id }),
  setTaskFilter: (filter) => set({ taskFilter: filter }),
  setRiskFilter: (filter) => set({ riskFilter: filter }),

  // ═══ 导入导出 ═══
  exportHRMS: async () => {
    const state = get();
    const data = {
      ogsm: state.ogsmItems,
      tasks: state.tasks,
      raci: state.raciEntries,
      risks: state.risks,
      incentives: state.incentives,
      incentiveResults: state.incentiveResults,
      pilots: state.pilots,
      policies: state.policies,
      employees: state.employees,
      scenarios: state.scenarios,
      exportedAt: new Date().toISOString(),
    };
    return JSON.stringify(data, null, 2);
  },

  importHRMS: async (jsonStr) => {
    try {
      const data = JSON.parse(jsonStr);
      if (data.ogsm) persist('ogsm', data.ogsm);
      if (data.tasks) persist('tasks', data.tasks);
      if (data.raci) persist('raci', data.raci);
      if (data.risks) persist('risks', data.risks);
      if (data.incentives) persist('incentives', data.incentives);
      if (data.incentiveResults) persist('incentiveResults', data.incentiveResults);
      if (data.pilots) persist('pilots', data.pilots);
      if (data.policies) persist('policies', data.policies);
      if (data.employees) persist('employees', data.employees);
      if (data.scenarios) persist('scenarios', data.scenarios);
      // Reload from storage
      const loaded = await loadAll();
      set({ ...loaded } as HRMSState);
    } catch (e) {
      throw new Error('导入数据格式错误');
    }
  },

  // ═══ V2 · M2 后端同步 ═══

  /**
   * 水合：把 IndexedDB 里的历史数据读回内存。
   * 此前 persist() 只写不读，刷新后本地数据形同丢失，这里补上读回路。
   */
  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const loaded = await loadAll();
      set({ ...(loaded as Partial<HRMSState>), hydrated: true });
    } catch {
      // IndexedDB 不可用（如无痕模式）时不阻断，退化为纯内存
      set({ hydrated: true });
    }
  },

  /**
   * 本地员工回流后端。
   * 幂等键是工号：本地记录没有工号时由 id 派生一个稳定值，
   * 因此重复点同步只会走 update，不会产生重复员工。
   */
  syncEmployeesToBackend: async () => {
    const employees = get().employees;
    if (employees.length === 0) {
      set({ syncStatus: 'success', syncMessage: '本地暂无员工，无需同步' });
      return { created: 0, updated: 0, skipped: 0, createdDepartments: 0, details: [] };
    }

    set({ syncStatus: 'syncing', syncMessage: `正在同步 ${employees.length} 名员工…` });
    try {
      const result = await hrApi.syncEmployees(employees.map(toSyncPayload));
      const now = new Date().toISOString();

      // details 与提交顺序一一对应；只有真正落库的才打同步时间戳，
      // 被后端跳过的记录保持未同步状态，避免虚假的「已同步」。
      const stamped = employees.map((e, idx) => {
        const detail = result.details[idx];
        const ok = !detail || detail.action !== 'skipped';
        return {
          ...e,
          employeeNo: deriveEmployeeNo(e),
          syncedAt: ok ? now : e.syncedAt,
        };
      });

      const meta: HRSyncMeta = { ...(get().syncMeta || {}), lastSyncAt: now, lastResult: result };
      set({
        employees: stamped,
        syncMeta: meta,
        syncStatus: 'success',
        syncMessage: `同步完成：新增 ${result.created}，更新 ${result.updated}，跳过 ${result.skipped}`,
      });
      persist('employees', stamped);
      persist('syncMeta', meta);
      moduleBus.broadcast('hrms:employees-synced', {
        created: result.created, updated: result.updated, skipped: result.skipped,
      });
      return result;
    } catch (err) {
      set({
        syncStatus: 'error',
        syncMessage: err instanceof Error ? err.message : '同步失败，请检查后端服务',
      });
      return null;
    }
  },

  /**
   * 反向拉取：以后端为准刷新本地。
   * 按工号合并——后端有的以后端为准，本地独有的（还没同步上去）保留，
   * 这样离线期间新增的记录不会被一次拉取抹掉。
   */
  pullEmployeesFromBackend: async () => {
    set({ syncStatus: 'syncing', syncMessage: '正在从后端拉取员工…' });
    try {
      const remote = await hrApi.fetchAllAsHREmployees();
      const remoteByNo = new Map(remote.map((e) => [e.employeeNo || e.id, e]));

      // 本地独有 = 工号在后端查不到的记录
      const localOnly = get().employees.filter((e) => !remoteByNo.has(deriveEmployeeNo(e)));
      const merged = [...remote, ...localOnly];

      const now = new Date().toISOString();
      const meta: HRSyncMeta = { ...(get().syncMeta || {}), lastPullAt: now };
      set({
        employees: merged,
        syncMeta: meta,
        syncStatus: 'success',
        syncMessage: `已拉取 ${remote.length} 名员工${localOnly.length ? `，另保留 ${localOnly.length} 条未同步的本地记录` : ''}`,
      });
      persist('employees', merged);
      persist('syncMeta', meta);
      return remote.length;
    } catch (err) {
      set({
        syncStatus: 'error',
        syncMessage: err instanceof Error ? err.message : '拉取失败，请检查后端服务',
      });
      return 0;
    }
  },

  /** 组织架构树：直接消费后端聚合结果，前端不再自行拼层级 */
  loadOrgTree: async () => {
    set({ orgLoading: true, orgError: '' });
    try {
      const result = await hrApi.getOrgTree();
      set({
        orgTree: result.tree,
        orgSummary: result.summary,
        orgLoading: false,
        orgError: '',
      });
    } catch (err) {
      set({
        orgTree: [],
        orgSummary: null,
        orgLoading: false,
        orgError: err instanceof Error ? err.message : '组织架构加载失败',
      });
    }
  },
}));
