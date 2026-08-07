/**
 * 权限引擎 — RBAC + ABAC 混合评估
 * RBAC：基于角色的权限授权
 * ABAC：基于属性（用户/资源/环境）的动态策略决策
 * 支持权限变更实时生效 + 变更追溯
 */

import {
  Permission, PermissionResult, Role, ABACPolicy, ABACCondition,
  TenantUser, TenantContext, PermissionEffect,
} from '@multi-tenant/types';

// ─── 权限缓存（带 TTL） ───

interface CachedPermission {
  result: PermissionResult;
  expiresAt: number;
}

const permissionCache = new Map<string, CachedPermission>();
const MAX_CACHE_SIZE = 500;
const CACHE_TTL_MS = 5 * 60 * 1000; // E-005: 5 分钟缓存过期

function cachePermission(key: string, result: PermissionResult): void {
  if (permissionCache.size >= MAX_CACHE_SIZE) {
    const firstKey = permissionCache.keys().next().value;
    if (firstKey) permissionCache.delete(firstKey);
  }
  permissionCache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** E-005: 周期性清理过期缓存条目（每秒执行） */
let cacheCleanupTimer: ReturnType<typeof setInterval> | null = null;
function startCacheCleanup(): void {
  if (cacheCleanupTimer) return;
  cacheCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of permissionCache) {
      if (entry.expiresAt <= now) {
        permissionCache.delete(key);
      }
    }
  }, 1000);
}

function getPermissionFromCache(key: string): PermissionResult | null {
  const entry = permissionCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    permissionCache.delete(key);
    return null;
  }
  return entry.result;
}

export function clearPermissionCache(): void {
  permissionCache.clear();
}

// 启动缓存清理
startCacheCleanup();

// ─── 通配符匹配 ───

function matchWildcard(pattern: string, resource: string): boolean {
  if (pattern === '*') return true;
  if (pattern === resource) return true;

  const regex = new RegExp(
    '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
  );
  return regex.test(resource);
}

// ─── ABAC 条件评估 ───

function evaluateCondition(
  condition: ABACCondition,
  user: TenantUser,
  resource: Record<string, unknown>,
  context: TenantContext
): boolean {
  let attrValue: unknown;

  switch (condition.source) {
    case 'user':
      attrValue = (user as unknown as Record<string, unknown>)[condition.attribute];
      break;
    case 'resource':
      attrValue = resource[condition.attribute];
      break;
    case 'environment': {
      switch (condition.attribute) {
        case 'ip':
          attrValue = context.ip;
          break;
        case 'time':
          attrValue = new Date().toISOString();
          break;
        case 'deviceId':
          attrValue = context.deviceId;
          break;
        case 'department':
          attrValue = context.department;
          break;
        default:
          attrValue = undefined;
      }
      break;
    }
    default:
      return false;
  }

  const target = condition.value;

  switch (condition.operator) {
    case 'eq':
      return attrValue === target;
    case 'neq':
      return attrValue !== target;
    case 'in':
      return Array.isArray(target) && target.includes(attrValue);
    case 'not_in':
      return Array.isArray(target) && !target.includes(attrValue);
    case 'lt':
      return typeof attrValue === 'number' && typeof target === 'number' && attrValue < target;
    case 'gt':
      return typeof attrValue === 'number' && typeof target === 'number' && attrValue > target;
    case 'lte':
      return typeof attrValue === 'number' && typeof target === 'number' && attrValue <= target;
    case 'gte':
      return typeof attrValue === 'number' && typeof target === 'number' && attrValue >= target;
    case 'contains':
      return typeof attrValue === 'string' && typeof target === 'string' && attrValue.includes(target);
    case 'starts_with':
      return typeof attrValue === 'string' && typeof target === 'string' && attrValue.startsWith(target);
    case 'between':
      return Array.isArray(target) && target.length === 2 &&
        typeof attrValue === 'number' && typeof target[0] === 'number' && typeof target[1] === 'number' &&
        attrValue >= target[0] && attrValue <= target[1];
    case 'time_between': {
      if (!Array.isArray(target) || target.length !== 2) return false;
      const now = new Date();
      const [start, end] = target.map((t) => {
        const [h, m] = String(t).split(':').map(Number);
        const d = new Date(now);
        d.setHours(h, m, 0, 0);
        return d;
      });
      return now >= start && now <= end;
    }
    case 'ip_in_range':
      return typeof attrValue === 'string' && typeof target === 'string' &&
        attrValue.startsWith(target.replace(/\.\*$/, ''));
    default:
      return false;
  }
}

// ─── ABAC 策略评估 ───

function evaluateABAC(
  policies: ABACPolicy[],
  action: string,          // BUG-011: 新增 action 参数
  resource: string,
  user: TenantUser,
  resourceAttrs: Record<string, unknown>,
  context: TenantContext
): PermissionResult | null {
  // BUG-011: ABAC 也需匹配 action（如 policy.resource="data:*:delete" 匹配 action="agent:delete"）
  const sorted = [...policies]
    .filter((p) =>
      p.enabled &&
      (matchWildcard(p.resource, resource) || matchAction(p.resource, action))
    )
    .sort((a, b) => b.priority - a.priority);

  for (const policy of sorted) {
    const allMatch = policy.conditions.every((c) =>
      evaluateCondition(c, user, resourceAttrs, context)
    );
    if (allMatch) {
      return {
        allowed: policy.effect === 'allow',
        reason: `ABAC策略 "${policy.name}" 匹配`,
        matchedBy: 'abac',
        matchedPolicies: [policy.id],
        evaluatedAt: new Date().toISOString(),
      };
    }
  }

  return null;
}

// ─── RBAC 评估 ───

function evaluateRBAC(
  roles: Role[],
  permissions: Permission[],
  action: string,        // BUG-011: 新增 action 参数
  resource: string,
  user: TenantUser
): PermissionResult | null {
  const userRoles = roles.filter((r) => user.roles.includes(r.id) || r.code === user.role);
  const userPerms = permissions.filter((p) =>
    userRoles.some((r) => r.permissions.includes(p.id))
  );

  // 通配符权限：action=* 或 resource=* 时，仅允许通配符
  const wildcardPerm = userPerms.find((p) => p.code === '*');
  if (wildcardPerm) {
    return {
      allowed: wildcardPerm.effect === 'allow',
      reason: '通配符权限匹配',
      matchedBy: 'role',
      matchedPolicies: [wildcardPerm.id],
      evaluatedAt: new Date().toISOString(),
    };
  }

  // BUG-011: Deny 优先 — 同时匹配 action 和 resource
  const deny = userPerms.find(
    (p) =>
      p.effect === 'deny' &&
      matchAction(p.code, action) &&
      matchWildcard(p.resource, resource)
  );
  if (deny) {
    return {
      allowed: false,
      reason: `Deny 权限 "${deny.name}" 拒绝访问 (action=${action}, resource=${resource})`,
      matchedBy: 'role',
      matchedPolicies: [deny.id],
      evaluatedAt: new Date().toISOString(),
    };
  }

  // BUG-011: Allow 匹配 — 必须同时匹配 action 和 resource
  const allow = userPerms.find(
    (p) =>
      p.effect === 'allow' &&
      matchAction(p.code, action) &&
      matchWildcard(p.resource, resource)
  );
  if (allow) {
    return {
      allowed: true,
      reason: `RBAC 权限 "${allow.name}" 允许访问 (action=${action}, resource=${resource})`,
      matchedBy: 'role',
      matchedPolicies: [allow.id],
      evaluatedAt: new Date().toISOString(),
    };
  }

  return null;
}

/**
 * BUG-011 核心修复：action → permission.code 的匹配逻辑
 * 支持精确匹配（p.code === action）和通配符匹配（p.code 含 *）
 * 例：action="agent:read" 匹配 p.code="agent:read" 或 p.code="agent:*"
 */
function matchAction(permissionCode: string, action: string): boolean {
  if (permissionCode === '*') return true;           // 通配符动作
  if (permissionCode === action) return true;        // 精确匹配
  // 通配符匹配：p.code="agent:*" 匹配 action="agent:read"
  const regex = new RegExp('^' + permissionCode.replace(/\*/g, '.*') + '$');
  return regex.test(action);
}

// ─── 主权限评估入口 ───

export interface EvalOptions {
  user: TenantUser;
  roles: Role[];
  permissions: Permission[];
  abacPolicies: ABACPolicy[];
  context: TenantContext;
  action: string;             // BUG-011: 必须指定要执行的动作（如 "agent:read"）
  resource: string;           // 目标资源（如 "agent:123"）
  resourceAttrs?: Record<string, unknown>;
  cacheKey?: string;
}

export function evaluatePermission(options: EvalOptions): PermissionResult {
  const { user, roles, permissions, abacPolicies, context, action, resource, resourceAttrs, cacheKey } = options;

  // 缓存（E-005: 带 TTL 过期检查）
  if (cacheKey) {
    const cached = getPermissionFromCache(cacheKey);
    if (cached) return cached;
  }

  // 超级管理员直接通过
  if (user.role === 'super_admin' || user.permissions.includes('*')) {
    const result: PermissionResult = {
      allowed: true,
      reason: '超级管理员，忽略权限检查',
      matchedBy: 'super_admin',
      matchedPolicies: [],
      evaluatedAt: new Date().toISOString(),
    };
    if (cacheKey) cachePermission(cacheKey, result);
    return result;
  }

  // 1. RBAC 评估 — BUG-011: 传入 action
  const rbacResult = evaluateRBAC(roles, permissions, action, resource, user);
  if (rbacResult) {
    if (cacheKey) cachePermission(cacheKey, rbacResult);
    return rbacResult;
  }

  // 2. ABAC 评估 — BUG-011: ABAC 也需校验 action
  const abacResult = evaluateABAC(
    abacPolicies,
    action,                // 传入 action 用于 ABAC 策略匹配
    resource,
    user,
    resourceAttrs || {},
    context
  );
  if (abacResult) {
    if (cacheKey) cachePermission(cacheKey, abacResult);
    return abacResult;
  }

  // 默认拒绝
  const defaultResult: PermissionResult = {
    allowed: false,
    reason: '无匹配权限策略，默认拒绝 (action=' + action + ', resource=' + resource + ')',
    matchedBy: 'deny_all',
    matchedPolicies: [],
    evaluatedAt: new Date().toISOString(),
  };
  if (cacheKey) cachePermission(cacheKey, defaultResult);
  return defaultResult;
}

// ─── 快捷权限检查 ───

export function checkPermission(
  user: TenantUser,
  action: string,         // BUG-011: 新增 action 参数
  resource: string,
  roles: Role[],
  permissions: Permission[],
  abacPolicies: ABACPolicy[],
  context: TenantContext
): boolean {
  return evaluatePermission({
    user,
    roles,
    permissions,
    abacPolicies,
    context,
    action,
    resource,
  }).allowed;
}

// ─── 数据行级过滤 ───

export function filterByTenant<T extends { tenantId?: string }>(
  items: T[],
  tenantId: string
): T[] {
  // SECURITY: Only return items that explicitly belong to this tenant
  // Items without tenantId are system-level and should not leak to tenants
  return items.filter((item) => item.tenantId === tenantId);
}

export function filterByDepartment<T extends { department?: string }>(
  items: T[],
  department: string
): T[] {
  return items.filter((item) => !item.department || item.department === department);
}

// ─── 权限变更追溯记录 ───

export interface PermissionChangeLog {
  id: string;
  tenantId: string;
  changedBy: string;
  changeType: 'role:create' | 'role:update' | 'role:delete' | 'role:assign' | 'permission:add' | 'permission:remove' | 'abac:create' | 'abac:update' | 'abac:delete';
  targetId: string;
  targetName: string;
  before: unknown;
  after: unknown;
  timestamp: string;
}

// ─── 测试夹具 ───

export function createTestPermissionData() {
  const permissions: Permission[] = [
    { id: 'p1', name: '全部权限', code: '*', resourceType: 'api', resource: '*', effect: 'allow', description: '超级权限' },
    { id: 'p2', name: '员工查看', code: 'hrms:employee:read', resourceType: 'api', resource: 'hrms:employee:*', effect: 'allow', description: '查看员工信息' },
    { id: 'p3', name: '员工编辑', code: 'hrms:employee:write', resourceType: 'api', resource: 'hrms:employee:*', effect: 'allow', description: '编辑员工信息' },
    { id: 'p4', name: '文件上传', code: 'file:upload', resourceType: 'api', resource: 'file:upload:*', effect: 'allow', description: '上传文件' },
    { id: 'p5', name: '文件下载', code: 'file:download', resourceType: 'api', resource: 'file:download:*', effect: 'allow', description: '下载文件' },
    { id: 'p6', name: '仅本部门', code: 'hrms:employee:read:dept', resourceType: 'data_row', resource: 'hrms:employee:*', effect: 'allow', description: '仅查看本部门员工' },
    { id: 'p7', name: '禁止删除', code: 'hrms:employee:delete', resourceType: 'api', resource: 'hrms:employee:*', effect: 'deny', description: '禁止删除员工' },
  ];

  const roles: Role[] = [
    { id: 'r1', tenantId: 't1', name: '租户管理员', code: 'tenant_admin', description: '全权限', permissions: ['p1'], isSystem: true, isDefault: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    { id: 'r2', tenantId: 't1', name: '部门主管', code: 'dept_head', description: '部门权限', permissions: ['p2', 'p3', 'p4', 'p5'], isSystem: true, isDefault: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    { id: 'r3', tenantId: 't1', name: '普通成员', code: 'member', description: '基础权限', permissions: ['p2', 'p4', 'p5'], isSystem: true, isDefault: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  ];

  const abacPolicies: ABACPolicy[] = [
    {
      id: 'abac-1', tenantId: 't1', name: '工作时间限制', description: '仅工作时间内可删除数据',
      effect: 'deny', resource: 'data:*:delete', conditions: [
        { attribute: 'time', source: 'environment', operator: 'time_between', value: ['09:00', '18:00'] },
      ], priority: 100, enabled: true, createdAt: '2026-01-01T00:00:00Z',
    },
  ];

  return { permissions, roles, abacPolicies };
}