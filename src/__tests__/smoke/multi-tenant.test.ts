/**
 * 冒烟测试：多租户隔离（BUG-011 已修复版）
 * 验证租户创建、切换、数据隔离、RBAC action 校验基本可用性
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Mock 存储层 ───
const mockStore = new Map<string, unknown>();

vi.mock('@utils/storage', () => ({
  getItem: vi.fn(async (key: string) => mockStore.get(key) ?? null),
  setItem: vi.fn(async (key: string, val: unknown) => { mockStore.set(key, val); }),
  delItem: vi.fn(async (key: string) => { mockStore.delete(key); }),
  listKeys: vi.fn(async (prefix: string) => Array.from(mockStore.keys()).filter(k => k.startsWith(prefix))),
  clearAll: vi.fn(async () => { mockStore.clear(); }),
}));

// ─── 通用测试工厂 ───

function createUser(userId: string, tenantId: string, role: string, perms: string[]) {
  return {
    id: userId,
    tenantId,
    email: `${userId}@test.com`,
    name: `Test ${userId}`,
    department: 'Tech',
    position: 'Engineer',
    grade: 5,
    role: role as any,
    roles: [`${role}-role`],
    permissions: perms,
    status: 'active' as const,
    mfaEnabled: false,
    createdAt: '',
  };
}

function createTenantConfig(tenantId: string) {
  return { id: tenantId, name: `Tenant ${tenantId}`, domain: `${tenantId}.example.com`, status: 'active' as const, plan: 'standard' as const, createdAt: '', updatedAt: '' };
}

async function createTestContext(userId: string, tenantId: string, role: string, perms: string[]) {
  const { createTenantContext } = await import('@multi-tenant/auth/tenantContext');
  return createTenantContext(
    createTenantConfig(tenantId),
    createUser(userId, tenantId, role, perms)
  );
}

function makeEvalOptions(userId: string, tenantId: string, role: string, perms: string[], action: string, resource: string) {
  return {
    action,
    resource,
    user: createUser(userId, tenantId, role, perms),
    context: { tenantId, userId, role: role as any, permissions: perms, ip: '127.0.0.1', sessionId: 'mock', deviceId: 'mock', signedAt: '', signature: '' },
    roles: [{
      id: `${role}-role`, tenantId, name: role, code: role, description: '',
      // BUG-011 修复：Role.permissions 存储 permission ID（p1/p2），不是 permission code
      permissions: perms.map((_, i) => `p${i + 1}`),
      isSystem: true, isDefault: true, createdAt: '', updatedAt: '',
    }],
    permissions: perms.map((p, i) => ({
      id: `p${i + 1}`, name: p, code: p, resourceType: 'api',
      resource: p.split(':')[0] === '*' ? '*' : `${p.split(':')[0]}:*`,
      effect: 'allow' as any, description: '',
    })),
    abacPolicies: [],
  };
}

// ─── 测试套件 ───

describe('Multi-Tenant Isolation Smoke Test', () => {
  beforeEach(() => { mockStore.clear(); });

  it('should create tenant context with valid TenantConfig/TenantUser', async () => {
    const ctx = await createTestContext('user-1', 'tenant-A', 'admin', ['*:*']);
    expect(ctx).toBeDefined();
    expect(ctx.tenantId).toBe('tenant-A');
    expect(ctx.userId).toBe('user-1');
    expect(ctx.role).toBe('admin');
  });

  it('should isolate data between tenants', async () => {
    const { createTenantContext, persistContext } = await import('@multi-tenant/auth/tenantContext');
    const { tenantSetItem, tenantGetItem } = await import('@multi-tenant/store/mtStore');

    const tenantA = createTenantConfig('tenant-A');
    const userA = createUser('user-1', 'tenant-A', 'admin', ['*:*']);
    const ctxA = await createTenantContext(tenantA, userA);
    await persistContext(ctxA);
    await tenantSetItem('test-key', { value: 'data-A' });

    const tenantB = createTenantConfig('tenant-B');
    const userB = createUser('user-2', 'tenant-B', 'admin', ['*:*']);
    const ctxB = await createTenantContext(tenantB, userB);
    await persistContext(ctxB);
    const result = await tenantGetItem('test-key');

    expect(result).toBeNull();
  });

  it('BUG-011: should allow correct action+resource combo', async () => {
    const { evaluatePermission } = await import('@multi-tenant/permissions/engine');
    const opts = makeEvalOptions('u1', 't1', 'admin', ['agent:read'], 'agent:read', 'agent:*');
    const result = evaluatePermission(opts);
    expect(result).toBeDefined();
    expect(result.allowed).toBe(true);
    expect(result.reason).toContain('action=agent:read');
  });

  it('BUG-011: should deny wrong action even if resource matches', async () => {
    const { evaluatePermission } = await import('@multi-tenant/permissions/engine');
    // 用户只有 agent:read 权限，试图执行 agent:write → 应被拒绝
    const opts = makeEvalOptions('u1', 't1', 'viewer', ['agent:read'], 'agent:write', 'agent:123');
    const result = evaluatePermission(opts);
    expect(result).toBeDefined();
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('action=agent:write');
  });

  it('BUG-011: wildcard permission code=* triggers super_admin bypass', async () => {
    const { evaluatePermission } = await import('@multi-tenant/permissions/engine');
    // perms=['*'] → user.permissions=['*'] → super_admin check fires first
    const opts = makeEvalOptions('u1', 't1', 'admin', ['*'], 'agent:delete', 'agent:*');
    const result = evaluatePermission(opts);
    expect(result.allowed).toBe(true);
    expect(result.matchedBy).toBe('super_admin');
    expect(result.reason).toContain('超级管理员');
  });
});
