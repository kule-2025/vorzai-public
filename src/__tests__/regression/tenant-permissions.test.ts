/**
 * 回归测试：多租户 RBAC+ABAC 权限引擎（BUG-011 已修复版）
 * 验证 action→code 匹配、资源匹配、Deny 优先、通配符等
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearPermissionCache } from '@multi-tenant/permissions/engine';

vi.mock('@utils/storage', () => {
  const store = new Map<string, unknown>();
  return {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: unknown) => { store.set(k, v); }),
    delItem: vi.fn(async (k: string) => { store.delete(k); }),
    listKeys: vi.fn(async (p: string) => Array.from(store.keys()).filter(k => k.startsWith(p))),
  };
});

function makeUser(userId: string, tenantId: string, role: string, perms: string[]) {
  return {
    id: userId, tenantId, email: `${userId}@test.com`, name: `Test ${userId}`,
    department: 'Tech', position: 'Engineer', grade: 5,
    role: role as any, roles: [`${role}-role`], permissions: perms,
    status: 'active' as const, mfaEnabled: false, createdAt: '',
  };
}

function makeEvalOpts(tenantId: string, userId: string, role: string, perms: string[], action: string, resource: string) {
  return {
    action, resource,
    user: makeUser(userId, tenantId, role, perms),
    context: { tenantId, userId, role: role as any, permissions: perms, ip: '127.0.0.1', sessionId: 'mock', deviceId: 'mock', signedAt: '', signature: '' },
    roles: [{
      id: `${role}-role`, tenantId, name: role, code: role, description: '',
      // BUG-011 修复：Role.permissions 存储 permission ID，不是 permission code
      permissions: perms.map((_, i) => `p${i + 1}`),
      isSystem: true, isDefault: true, createdAt: '', updatedAt: '',
    }],
    permissions: perms.map((p, i) => ({
      id: `p${i + 1}`, name: p, code: p, resourceType: 'api',
      resource: p === '*' ? '*' : `${p.split(':')[0]}:*`,
      effect: 'allow' as any, description: '',
    })),
    abacPolicies: [],
  };
}

describe('RBAC + ABAC Permission Engine (BUG-011)', () => {
  beforeEach(async () => { clearPermissionCache(); });

  it('BUG-011: should allow exact action match', async () => {
    const { evaluatePermission } = await import('@multi-tenant/permissions/engine');
    const opts = makeEvalOpts('t1', 'u1', 'admin', ['agent:read'], 'agent:read', 'agent:123');
    const result = evaluatePermission(opts);
    expect(result.allowed).toBe(true);
    expect(result.reason).toContain('agent:read');
  });

  it('BUG-011: should deny wrong action with correct resource', async () => {
    const { evaluatePermission } = await import('@multi-tenant/permissions/engine');
    const opts = makeEvalOpts('t1', 'u2', 'viewer', ['agent:read'], 'agent:write', 'agent:123');
    const result = evaluatePermission(opts);
    expect(result.allowed).toBe(false);
    expect(result.matchedBy).toBe('deny_all');
  });

  it('BUG-011: wildcard permission code=* triggers super_admin bypass', async () => {
    const { evaluatePermission } = await import('@multi-tenant/permissions/engine');
    // perms=['*'] → user.permissions=['*'] → super_admin check fires
    const opts = makeEvalOpts('t1', 'u3', 'admin', ['*'], 'agent:delete', 'agent:123');
    const result = evaluatePermission(opts);
    expect(result.allowed).toBe(true);
    expect(result.matchedBy).toBe('super_admin');
  });

  it('BUG-011: wildcard resource * should allow any resource', async () => {
    const { evaluatePermission } = await import('@multi-tenant/permissions/engine');
    const opts = makeEvalOpts('t1', 'u4', 'analyst', ['agent:read'], 'agent:read', 'agent:any-resource');
    const result = evaluatePermission(opts);
    expect(result.allowed).toBe(true);
  });

  it('BUG-011: deny-first rule blocks unknown actions', async () => {
    const { evaluatePermission } = await import('@multi-tenant/permissions/engine');
    const opts = makeEvalOpts('t1', 'u5', 'operator', ['agent:read', 'agent:write'], 'agent:delete', 'agent:123');
    const result = evaluatePermission(opts);
    expect(result.allowed).toBe(false);
    expect(result.matchedBy).toBe('deny_all');
  });

  it('BUG-011: super_admin bypasses all checks', async () => {
    const { evaluatePermission } = await import('@multi-tenant/permissions/engine');
    const opts = makeEvalOpts('t1', 'u6', 'super_admin', ['*'], 'agent:delete', 'agent:*');
    const result = evaluatePermission(opts);
    expect(result.allowed).toBe(true);
    expect(result.matchedBy).toBe('super_admin');
  });
});

describe('Tenant Storage Isolation', () => {
  beforeEach(async () => { clearPermissionCache(); });

  it('should namespace keys with tenantId', async () => {
    const { tenantSetItem, tenantGetItem } = await import('@multi-tenant/store/mtStore');
    const { createTenantContext, persistContext } = await import('@multi-tenant/auth/tenantContext');

    const tenantA = { id: 'tenant-A', name: 'A', domain: 'a.com', status: 'active' as any, plan: 'standard' as any, createdAt: '', updatedAt: '' };
    const userA = makeUser('u1', 'tenant-A', 'admin', ['*:*']);
    const ctxA = await createTenantContext(tenantA, userA);
    await persistContext(ctxA);
    await tenantSetItem('key1', 'value-A');

    const tenantB = { id: 'tenant-B', name: 'B', domain: 'b.com', status: 'active' as any, plan: 'standard' as any, createdAt: '', updatedAt: '' };
    const userB = makeUser('u2', 'tenant-B', 'admin', ['*:*']);
    const ctxB = await createTenantContext(tenantB, userB);
    await persistContext(ctxB);
    const result = await tenantGetItem('key1');
    expect(result).toBeNull();
  });
});
