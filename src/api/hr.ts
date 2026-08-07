/**
 * Vorzai HR API Client
 * 对接后端 /api/hr/*（员工 / 部门 / 组织架构树 / 本地数据回流同步）
 *
 * V2 · M2 目标：消除「前端 IndexedDB ↔ 后端 hrService」双轨脱节
 *   - 后端是员工数据的单一事实源（single source of truth）
 *   - 前端 IndexedDB 降级为离线缓存，联网时以后端为准
 */

import api from './client';
import type { HREmployee, HRPillar, HRPillarLabel } from '@domain/hrms';

// ─────────────── 类型定义（与后端 hrService 保持一致）───────────────

export type BackendEmployeeStatus =
  | 'active' | 'probation' | 'leave' | 'resigned' | 'terminated';

export interface BackendEmployee {
  id: string;
  tenant_id: string;
  employee_no: string;
  name: string;
  gender?: string | null;
  phone?: string | null;
  email?: string | null;
  department_id?: string | null;
  department_name?: string | null;
  position?: string | null;
  job_level?: string | null;
  employment_type?: string | null;
  hire_date?: string | null;
  leave_date?: string | null;
  status: BackendEmployeeStatus;
  salary_base?: number | null;
  skills?: string | string[] | null;
  created_at: string;
  updated_at?: string;
}

export interface Department {
  id: string;
  tenant_id: string;
  name: string;
  parent_id: string | null;
  leader_id: string | null;
  leader_name?: string | null;
  member_count?: number;
  sort_order?: number;
  created_at: string;
}

export interface OrgMember {
  id: string;
  employeeNo: string;
  name: string;
  position: string | null;
  jobLevel: string | null;
  status: BackendEmployeeStatus;
  hireDate: string | null;
}

export interface OrgNode {
  id: string;
  name: string;
  parentId: string | null;
  leaderId: string | null;
  leaderName: string | null;
  /** 本部门在岗人数（active + probation） */
  memberCount: number;
  /** 本部门 + 全部子部门在岗人数 */
  totalHeadcount: number;
  members: OrgMember[];
  children: OrgNode[];
}

export interface OrgTreeResult {
  tree: OrgNode[];
  summary: {
    departmentCount: number;
    employeeTotal: number;
    activeTotal: number;
    resignedTotal: number;
    unassignedCount: number;
    maxDepth: number;
  };
  generatedAt: string;
}

export interface SyncPayloadItem {
  employeeNo?: string;
  name: string;
  department?: string;
  departmentId?: string;
  position?: string;
  email?: string;
  phone?: string;
  status?: string;
  skills?: string[];
  hireDate?: string;
}

export interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  createdDepartments: number;
  details: Array<{ name: string; action: 'created' | 'updated' | 'skipped'; reason?: string }>;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface EmployeeQuery {
  departmentId?: string;
  status?: BackendEmployeeStatus;
  keyword?: string;
  page?: number;
  limit?: number;
}

// ─────────────── 工具 ───────────────

interface RawResponse<T> {
  success: boolean;
  data?: T;
  pagination?: Pagination;
  error?: { code: string; message: string };
}

function unwrap<T>(resp: RawResponse<T>): T {
  if (!resp.success) throw new Error(resp.error?.message || '请求失败');
  return resp.data as T;
}

function unwrapPaged<T>(resp: RawResponse<T[]>): { items: T[]; pagination: Pagination } {
  if (!resp.success) throw new Error(resp.error?.message || '请求失败');
  return {
    items: (resp.data as T[]) || [],
    pagination: resp.pagination || { page: 1, limit: 20, total: 0, totalPages: 0 },
  };
}

function toQuery(params: Record<string, string | number | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

// ─────────────── 前后端模型映射（双轨归一的关键）───────────────

const PILLAR_LABEL: Record<HRPillar, HRPillarLabel> = {
  coe: 'COE 专家中心',
  hrbp: 'HRBP 业务伙伴',
  ssc: 'SSC 共享服务中心',
} as Record<HRPillar, HRPillarLabel>;

/**
 * 后端 employees 行 → 前端 HREmployee
 *
 * 说明：三支柱（pillar）是纯前端组织视角的分类，后端表中无对应列。
 * 这里按岗位关键词做一次可解释的推断，无法判定时归入 ssc，
 * 前端可再手工调整，但不再自行编造员工主数据。
 */
export function toHREmployee(row: BackendEmployee): HREmployee {
  const position = row.position || '';
  let pillar: HRPillar = 'ssc';
  if (/专家|COE|培训|发展|OD/i.test(position)) pillar = 'coe';
  else if (/BP|业务|运营|销售|市场/i.test(position)) pillar = 'hrbp';

  let skills: string[] = [];
  if (Array.isArray(row.skills)) skills = row.skills;
  else if (typeof row.skills === 'string' && row.skills.trim()) {
    try {
      const parsed = JSON.parse(row.skills);
      if (Array.isArray(parsed)) skills = parsed;
    } catch {
      skills = [];
    }
  }

  return {
    id: row.id,
    name: row.name,
    department: row.department_name || '未分配',
    position: position || '—',
    pillar,
    pillarLabel: PILLAR_LABEL[pillar],
    email: row.email || undefined,
    phone: row.phone || undefined,
    // 后端五态 → 前端两态：仅 active/probation 视为在岗
    status: row.status === 'active' || row.status === 'probation' ? 'active' : 'inactive',
    skills,
    createdAt: row.created_at,
    employeeNo: row.employee_no,
    // 能从后端读回来，本身就说明它已经在后端了
    syncedAt: row.updated_at || row.created_at,
  };
}

/**
 * 前端 HREmployee → 同步载荷
 * 前端历史数据没有工号，用 id 派生一个稳定工号，保证多次同步幂等。
 */
export function toSyncPayload(e: HREmployee): SyncPayloadItem {
  return {
    employeeNo: deriveEmployeeNo(e),
    name: e.name,
    department: e.department && e.department !== '未分配' ? e.department : undefined,
    position: e.position && e.position !== '—' ? e.position : undefined,
    email: e.email,
    phone: e.phone,
    status: e.status,
    skills: e.skills,
  };
}

/** 由前端本地 id 派生稳定工号（同一条记录多次同步得到相同工号） */
export function deriveEmployeeNo(e: HREmployee): string {
  // 已经带后端工号的（拉取回来或同步过的），直接沿用，避免同一人产生第二条记录
  if (e.employeeNo && e.employeeNo.trim()) return e.employeeNo.trim();
  const raw = String(e.id || e.name);
  const cleaned = raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (cleaned.length >= 6) return `LOC-${cleaned.slice(-10)}`;
  // id 太短或全中文时用简单哈希兜底，避免碰撞
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) >>> 0;
  return `LOC-${h.toString(36).toUpperCase()}`;
}

// ─────────────── API ───────────────

export const hrApi = {
  // ===== 员工 =====

  listEmployees: async (
    query: EmployeeQuery = {}
  ): Promise<{ items: BackendEmployee[]; pagination: Pagination }> =>
    unwrapPaged<BackendEmployee>(
      await api.call<BackendEmployee[]>('GET', `/hr/employees${toQuery(query as never)}`)
    ),

  /** 拉取全部员工并转成前端模型（分页自动翻页，上限 2000 条防御） */
  fetchAllAsHREmployees: async (): Promise<HREmployee[]> => {
    const all: BackendEmployee[] = [];
    let page = 1;
    const limit = 100;
    for (;;) {
      const r = await hrApi.listEmployees({ page, limit });
      all.push(...r.items);
      if (r.items.length < limit || all.length >= 2000) break;
      if (page >= r.pagination.totalPages) break;
      page++;
    }
    return all.map(toHREmployee);
  },

  getEmployee: async (id: string): Promise<BackendEmployee> =>
    unwrap<BackendEmployee>(await api.call<BackendEmployee>('GET', `/hr/employees/${id}`)),

  // ===== 部门与组织树 =====

  listDepartments: async (): Promise<Department[]> =>
    unwrap<Department[]>(await api.call<Department[]>('GET', '/hr/departments')),

  createDepartment: async (input: {
    name: string; parentId?: string; leaderId?: string;
  }): Promise<Department> =>
    unwrap<Department>(await api.call<Department>('POST', '/hr/departments', input)),

  /** H1：组织架构树（层级 + 在岗人数汇总），前端组织视图唯一数据源 */
  getOrgTree: async (): Promise<OrgTreeResult> =>
    unwrap<OrgTreeResult>(await api.call<OrgTreeResult>('GET', '/hr/org-tree')),

  // ===== H2 本地数据回流 =====

  /** 把前端本地员工推送到后端，幂等键 (tenant, employeeNo) */
  syncEmployees: async (employees: SyncPayloadItem[]): Promise<SyncResult> =>
    unwrap<SyncResult>(await api.call<SyncResult>('POST', '/hr/sync', { employees })),
};

export default hrApi;
