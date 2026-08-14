/**
 * 多租户管理员视图 — 租户配置 / 用户管理 / 角色权限 / 安全策略 / 审计日志
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  TenantConfig, TenantUser, TenantPlan, Role, Permission,
  ABACPolicy, SecurityEvent, AuditEntry, AlertConfig, AlertChannel,
  ComplianceDocument, TenantUserRole, TenantContext,
} from '@multi-tenant/types';
import { SYSTEM_ROLES } from '@multi-tenant/types';
import {
  createTenantContext, verifyTenantContext, persistContext, clearContext,
} from '@multi-tenant/auth/tenantContext';
import { evaluatePermission, createTestPermissionData } from '@multi-tenant/permissions/engine';
import { initializeTenantStorage } from '@multi-tenant/store/mtStore';
import {
  queryAuditLogs, querySecurityEvents, resolveSecurityEvent,
  writeAuditLog, generateAuditReport,
} from '@multi-tenant/audit/auditLogger';
import { listTenantFiles, formatFileSize } from '@multi-tenant/file/fileIsolation';
import { api } from '@api/client';
import { toast } from '@components/Common/Toast';

// ─── 默认模拟数据 ───

const DEFAULT_TENANT: TenantConfig = {
  id: 'tenant-001',
  name: 'Vorzai 电商',
  domain: 'vorzai-ecommerce.com',
  plan: 'pro',
  contactEmail: 'admin@vorzai-ecommerce.com',
  status: 'active',
  isolation: { db: 'shared-tenant-id', storage: 'directory', cache: 'namespace' },
  limits: { maxUsers: 50, maxStorageGB: 10, maxApiCalls: 100000, maxAgents: 20 },
  features: ['ogsm', 'hrms', 'file-io', 'audit', 'rbac'],
  settings: {},
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-07-23T00:00:00Z',
  logo: undefined,
  contactPhone: undefined,
};

const DEFAULT_ADMIN: TenantUser = {
  id: 'user-admin-001',
  tenantId: 'tenant-001',
  email: 'admin@vorzai-ecommerce.com',
  name: '超级管理员',
  department: '技术部',
  position: '系统管理员',
  grade: 10,
  role: 'super_admin',
  roles: ['role-super-admin'],
  permissions: ['*'],
  status: 'active',
  mfaEnabled: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-07-23T00:00:00Z',
};

// ─── Tab 配置 ───

type TenantTab = 'overview' | 'users' | 'roles' | 'abac' | 'audit' | 'security' | 'files' | 'compliance' | 'alerts' | 'settings';

const TABS: { id: TenantTab; label: string }[] = [
  { id: 'overview', label: '租户概览' },
  { id: 'users', label: '用户管理' },
  { id: 'roles', label: '角色权限' },
  { id: 'abac', label: 'ABAC 策略' },
  { id: 'audit', label: '审计日志' },
  { id: 'security', label: '安全事件' },
  { id: 'files', label: '文件管理' },
  { id: 'compliance', label: '合规文档' },
  { id: 'alerts', label: '告警配置' },
  { id: 'settings', label: '安全设置' },
];

// ─── 主组件 ───

export function TenantAdmin() {
  const [activeTab, setActiveTab] = useState<TenantTab>('overview');
  const [tenant, setTenant] = useState<TenantConfig>(DEFAULT_TENANT);
  const [currentUser] = useState<TenantUser>(DEFAULT_ADMIN);
  const [context, setContext] = useState<TenantContext | null>(null);

  // 初始化租户上下文
  useEffect(() => {
    (async () => {
      const ctx = await createTenantContext(tenant, currentUser);
      setContext(ctx);
      await persistContext(ctx);
      await initializeTenantStorage(tenant.id);
    })();
  }, []);

  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview': return <TenantOverview tenant={tenant} />;
      case 'users': return <TenantUsers />;
      case 'roles': return <TenantRoles />;
      case 'abac': return <TenantABAC tenantId={tenant.id} />;
      case 'audit': return <TenantAudit tenantId={tenant.id} />;
      case 'security': return <TenantSecurity tenantId={tenant.id} />;
      case 'files': return <TenantFiles tenantId={tenant.id} />;
      case 'compliance': return <TenantCompliance tenantId={tenant.id} />;
      case 'alerts': return <TenantAlerts tenantId={tenant.id} />;
      case 'settings': return <TenantSettings tenant={tenant} setTenant={setTenant} />;
    }
  };

  return (
    <div className="hrms-container">
      <div className="hrms-header">
        <h2 className="page-title">多租户管理后台</h2>
        <div className="hrms-header-actions">
          <span className={`badge ${tenant.status === 'active' ? 'badge-success' : 'badge-warning'}`}>
            {tenant.status === 'active' ? '运行中' : '已停用'}
          </span>
          <span className="badge badge-info">{tenant.plan}</span>
        </div>
      </div>

      <div className="hrms-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`tab-btn ${activeTab === tab.id ? 'tab-active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="hrms-content">
        {renderTabContent()}
      </div>
    </div>
  );
}

// ─── 租户概览 ───

function TenantOverview({ tenant }: { tenant: TenantConfig }) {
  return (
    <div className="mt-panel">
      <div className="card-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        <div className="card">
          <div className="card-body" style={{ padding: 16 }}>
            <div className="card-label" style={{ color: 'var(--gray-500)', fontSize: 12, marginBottom: 4 }}>租户名称</div>
            <div className="card-value" style={{ fontSize: 18, fontWeight: 700 }}>{tenant.name}</div>
          </div>
        </div>
        <div className="card">
          <div className="card-body" style={{ padding: 16 }}>
            <div className="card-label" style={{ color: 'var(--gray-500)', fontSize: 12, marginBottom: 4 }}>域名</div>
            <div className="card-value" style={{ fontSize: 18, fontWeight: 700 }}>{tenant.domain}</div>
          </div>
        </div>
        <div className="card">
          <div className="card-body" style={{ padding: 16 }}>
            <div className="card-label" style={{ color: 'var(--gray-500)', fontSize: 12, marginBottom: 4 }}>套餐</div>
            <div className="card-value" style={{ fontSize: 18, fontWeight: 700 }}>{tenant.plan}</div>
          </div>
        </div>
      </div>

      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>隔离策略</div>
      <div className="card-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        {[
          { label: '数据库隔离', value: tenant.isolation.db === 'dedicated-db' ? '独立数据库' : tenant.isolation.db === 'shared-tenant-id' ? '共享库 + TenantID' : '共享 Schema' },
          { label: '文件存储隔离', value: tenant.isolation.storage === 'bucket' ? '独立 Bucket' : '租户目录隔离' },
          { label: '缓存隔离', value: tenant.isolation.cache === 'dedicated' ? '独立缓存' : '命名空间 + 前缀' },
        ].map((item) => (
          <div className="card" key={item.label}>
            <div className="card-body" style={{ padding: 16 }}>
              <div className="card-label" style={{ color: 'var(--gray-500)', fontSize: 12, marginBottom: 4 }}>{item.label}</div>
              <div className="card-value" style={{ fontSize: 14, fontWeight: 600 }}>{item.value}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>资源限制</div>
      <div className="card-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        {[
          { label: '最大用户数', value: `${tenant.limits.maxUsers}` },
          { label: '存储空间', value: `${tenant.limits.maxStorageGB} GB` },
          { label: 'API 调用/月', value: `${(tenant.limits.maxApiCalls / 10000).toFixed(0)}万` },
          { label: '最大 Agent', value: `${tenant.limits.maxAgents}` },
        ].map((item) => (
          <div className="card" key={item.label}>
            <div className="card-body" style={{ padding: 16 }}>
              <div className="card-label" style={{ color: 'var(--gray-500)', fontSize: 12, marginBottom: 4 }}>{item.label}</div>
              <div className="card-value" style={{ fontSize: 14, fontWeight: 600 }}>{item.value}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>已启用功能</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {tenant.features.map((f) => (
          <span key={f} className="badge badge-success">{f}</span>
        ))}
      </div>
    </div>
  );
}

// ─── 用户管理 ───

interface ApiTenantUser {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  role: string;
  status: string;
  department_id: string | null;
  last_login_at: string | null;
  created_at: string;
}

const API_ROLE_LABELS: Record<string, string> = {
  owner: '所有者', admin: '管理员', manager: '经理', member: '成员', viewer: '只读',
};
const API_STATUS_LABELS: Record<string, string> = {
  active: '活跃', inactive: '已停用', suspended: '已冻结', pending: '待激活',
};

function TenantUsers() {
  const [users, setUsers] = useState<ApiTenantUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [newUser, setNewUser] = useState({
    username: '', displayName: '', email: '', phone: '', password: '', role: 'member',
  });

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.tenant.listUsers(q ? { q } : undefined);
    if (res.success && res.data) {
      setUsers(res.data as ApiTenantUser[]);
      setError(null);
    } else {
      setError(res.error?.message || '加载用户失败');
    }
    setLoading(false);
  }, [q]);

  useEffect(() => { void load(); }, [load]);

  const addUser = async () => {
    if (!newUser.username.trim() || !newUser.displayName.trim() || !newUser.password) {
      toast('warning', '请填写用户名、显示名与初始密码');
      return;
    }
    const res = await api.tenant.createUser({
      username: newUser.username.trim(),
      password: newUser.password,
      displayName: newUser.displayName.trim(),
      email: newUser.email.trim() || undefined,
      phone: newUser.phone.trim() || undefined,
      role: newUser.role,
    });
    if (res.success) {
      toast('success', '用户已创建');
      writeAuditLog('user:create', `创建用户: ${newUser.username}`, { resource: 'user', resourceId: res.data?.id });
      setNewUser({ username: '', displayName: '', email: '', phone: '', password: '', role: 'member' });
      setShowAdd(false);
      await load();
    } else {
      toast('error', '创建失败', res.error?.message);
    }
  };

  const toggleUserStatus = async (user: ApiTenantUser) => {
    setBusyId(user.id);
    const res = user.status === 'active'
      ? await api.tenant.deactivateUser(user.id)
      : await api.tenant.updateUser(user.id, { status: 'active' });
    setBusyId(null);
    if (res.success) {
      toast('success', user.status === 'active' ? '已停用' : '已启用');
      writeAuditLog('user:update', `切换用户状态: ${user.username}`, { resource: 'user', resourceId: user.id });
      await load();
    } else {
      toast('error', '操作失败', res.error?.message);
    }
  };

  const changeRole = async (user: ApiTenantUser, role: string) => {
    setBusyId(user.id);
    const res = await api.tenant.updateUser(user.id, { role });
    setBusyId(null);
    if (res.success) {
      toast('success', `角色已更新为 ${API_ROLE_LABELS[role] || role}`);
      writeAuditLog('user:update', `变更角色: ${user.username} → ${role}`, { resource: 'user', resourceId: user.id });
      await load();
    } else {
      toast('error', '变更失败', res.error?.message);
    }
  };

  return (
    <div className="mt-panel">
      <div className="hrms-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12 }}>
        <span className="text-secondary" style={{ fontSize: 13 }}>
          共 {users.length} 个用户（当前租户）
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="input-ecom"
            style={{ width: 200 }}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索用户名/姓名/邮箱"
          />
          <button className="btn-ghost" onClick={() => void load()}>刷新</button>
          <button className="btn-ecom" onClick={() => setShowAdd(!showAdd)}>+ 添加用户</button>
        </div>
      </div>

      {error && (
        <div className="card" style={{ padding: 12, marginBottom: 12, color: 'var(--danger-text)', fontSize: 13 }}>
          {error}
        </div>
      )}

      {showAdd && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 12 }}>
            <div>
              <label htmlFor="tu-username" style={{ fontSize: 12, color: 'var(--gray-500)', display: 'block', marginBottom: 4 }}>用户名 *</label>
              <input id="tu-username" className="input-ecom" value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} placeholder="登录用户名" />
            </div>
            <div>
              <label htmlFor="tu-display" style={{ fontSize: 12, color: 'var(--gray-500)', display: 'block', marginBottom: 4 }}>显示名 *</label>
              <input id="tu-display" className="input-ecom" value={newUser.displayName} onChange={(e) => setNewUser({ ...newUser, displayName: e.target.value })} placeholder="真实姓名" />
            </div>
            <div>
              <label htmlFor="tu-password" style={{ fontSize: 12, color: 'var(--gray-500)', display: 'block', marginBottom: 4 }}>初始密码 *</label>
              <input id="tu-password" type="password" className="input-ecom" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} placeholder="至少 8 位，含大小写与数字" />
            </div>
            <div>
              <label htmlFor="tu-email" style={{ fontSize: 12, color: 'var(--gray-500)', display: 'block', marginBottom: 4 }}>邮箱</label>
              <input id="tu-email" className="input-ecom" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} placeholder="选填" />
            </div>
            <div>
              <label htmlFor="tu-phone" style={{ fontSize: 12, color: 'var(--gray-500)', display: 'block', marginBottom: 4 }}>手机号</label>
              <input id="tu-phone" className="input-ecom" value={newUser.phone} onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })} placeholder="选填" />
            </div>
            <div>
              <label htmlFor="tu-role" style={{ fontSize: 12, color: 'var(--gray-500)', display: 'block', marginBottom: 4 }}>角色</label>
              <select id="tu-role" className="input-ecom" value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>
                {Object.entries(API_ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          <button className="btn-ecom" onClick={() => void addUser()}>确认添加</button>
        </div>
      )}

      <div className="table-wrap">
        <table className="table-ecom" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-color)', fontSize: 12, color: 'var(--gray-500)' }}>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>用户名</th>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>显示名</th>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>邮箱</th>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>角色</th>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>状态</th>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>最后登录</th>
              <th style={{ textAlign: 'right', padding: '8px 12px' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--gray-500)' }}>加载中…</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--gray-500)' }}>暂无用户</td></tr>
            ) : users.map((user) => (
              <tr key={user.id} style={{ borderBottom: '1px solid var(--border-color)', fontSize: 13, opacity: busyId === user.id ? 0.5 : 1 }}>
                <td style={{ padding: '10px 12px', fontWeight: 600 }}>{user.username}</td>
                <td style={{ padding: '10px 12px' }}>{user.display_name}</td>
                <td style={{ padding: '10px 12px', color: 'var(--gray-500)' }}>{user.email || '—'}</td>
                <td style={{ padding: '10px 12px' }}>
                  <select
                    className="input-ecom"
                    style={{ fontSize: 12, padding: '2px 6px' }}
                    value={user.role}
                    disabled={busyId === user.id}
                    onChange={(e) => void changeRole(user, e.target.value)}
                  >
                    {Object.entries(API_ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </td>
                <td style={{ padding: '10px 12px' }}>
                  <span className={`badge ${user.status === 'active' ? 'badge-success' : 'badge-warning'}`}>
                    {API_STATUS_LABELS[user.status] || user.status}
                  </span>
                </td>
                <td style={{ padding: '10px 12px', color: 'var(--gray-500)', fontSize: 12 }}>
                  {user.last_login_at ? user.last_login_at.slice(0, 16) : '从未登录'}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                  <button
                    className="btn-ghost"
                    style={{ fontSize: 12 }}
                    disabled={busyId === user.id}
                    onClick={() => void toggleUserStatus(user)}
                  >
                    {user.status === 'active' ? '停用' : '启用'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="role-legend" style={{ marginTop: 16, fontSize: 12, color: 'var(--gray-500)' }}>
        数据来自后端 users 表（按当前租户隔离）。停用为软删除，保留历史业务数据关联。
      </div>
    </div>
  );
}

// ─── 角色权限管理 ───

interface ApiRole {
  key: string;
  level: number;
  label: string;
  description: string;
  permissions: string[];
  userCount: number;
}

/**
 * 角色权限视图 — 数据源为后端 `/api/tenant/roles`。
 *
 * 说明：系统采用固定角色层级（schema.sql users.role CHECK 约束 + RBAC 中间件），
 * 不支持自定义角色或勾选式权限编辑；此处如实展示后端角色定义、权限点与真实人数。
 */
function TenantRoles() {
  const [roles, setRoles] = useState<ApiRole[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await api.tenant.listRoles();
      if (res.success && res.data) {
        setRoles(res.data);
        setSelectedKey((prev) => prev ?? res.data![0]?.key ?? null);
        setError(null);
      } else {
        setError(res.error?.message || '加载角色失败');
      }
      setLoading(false);
    })();
  }, []);

  const selected = roles.find((r) => r.key === selectedKey);

  if (loading) {
    return <div className="mt-panel" style={{ padding: 24, textAlign: 'center', color: 'var(--gray-500)' }}>加载中…</div>;
  }
  if (error) {
    return <div className="mt-panel" style={{ padding: 24, color: 'var(--danger-text)' }}>{error}</div>;
  }

  return (
    <div className="mt-panel" style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 16 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>角色层级</div>
        {[...roles].sort((a, b) => b.level - a.level).map((role) => (
          <div
            key={role.key}
            className="card"
            style={{
              padding: '10px 12px', marginBottom: 8, cursor: 'pointer',
              border: selectedKey === role.key ? '2px solid var(--accent)' : '1px solid var(--border-color)',
            }}
            onClick={() => setSelectedKey(role.key)}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{role.label}</span>
              <span className="badge badge-info" style={{ fontSize: 10 }}>L{role.level}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--gray-500)', marginTop: 2 }}>
              {role.userCount} 人 · {role.key}
            </div>
          </div>
        ))}
      </div>
      <div>
        {selected ? (
          <>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
              {selected.label} — 权限点
            </div>
            <div style={{ fontSize: 12, color: 'var(--gray-500)', marginBottom: 12 }}>
              {selected.description}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {selected.permissions.map((perm) => (
                <div key={perm} className="card" style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: 999,
                    background: 'var(--success-500, #22c55e)', flexShrink: 0,
                  }} />
                  <code style={{ fontSize: 12, fontWeight: 600 }}>{perm}</code>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, fontSize: 12, color: 'var(--gray-500)' }}>
              共 {selected.permissions.length} 项权限点 · 当前 {selected.userCount} 人持有该角色。
              角色为系统内置层级，由后端 RBAC 中间件强制校验，不支持在此自定义。
            </div>
          </>
        ) : (
          <div className="text-secondary" style={{ padding: 24, textAlign: 'center' }}>请选择一个角色查看权限点</div>
        )}
      </div>
    </div>
  );
}

// ─── ABAC 策略 ───

function TenantABAC({ tenantId }: { tenantId: string }) {
  const [policies, setPolicies] = useState<ABACPolicy[]>(() => {
    const saved = localStorage.getItem('mt:mock:abac');
    return saved ? JSON.parse(saved) : [];
  });
  const [showAdd, setShowAdd] = useState(false);
  const [newPolicy, setNewPolicy] = useState<Partial<ABACPolicy>>({});

  useEffect(() => {
    localStorage.setItem('mt:mock:abac', JSON.stringify(policies));
  }, [policies]);

  const addPolicy = () => {
    if (!newPolicy.name || !newPolicy.resource) return;
    const policy: ABACPolicy = {
      id: `abac-${Date.now()}`,
      tenantId,
      name: newPolicy.name || '新的策略',
      description: newPolicy.description || '',
      effect: newPolicy.effect || 'deny',
      resource: newPolicy.resource || '*',
      conditions: newPolicy.conditions || [],
      priority: newPolicy.priority || 0,
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    setPolicies((prev) => [...prev, policy]);
    setShowAdd(false);
    setNewPolicy({});
  };

  const togglePolicy = (id: string) => {
    setPolicies((prev) => prev.map((p) => p.id === id ? { ...p, enabled: !p.enabled } : p));
  };

  const deletePolicy = (id: string) => {
    setPolicies((prev) => prev.filter((p) => p.id !== id));
  };

  return (
    <div className="mt-panel">
      <div className="hrms-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span className="text-secondary" style={{ fontSize: 13 }}>共 {policies.length} 条策略</span>
        <button className="btn-ecom" onClick={() => setShowAdd(!showAdd)}>+ 添加策略</button>
      </div>

      {showAdd && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--gray-500)', display: 'block', marginBottom: 4 }}>策略名称</label>
              <input className="input-ecom" value={newPolicy.name || ''} onChange={(e) => setNewPolicy({ ...newPolicy, name: e.target.value })} placeholder="如：工作时间限制" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--gray-500)', display: 'block', marginBottom: 4 }}>资源匹配模式</label>
              <input className="input-ecom" value={newPolicy.resource || ''} onChange={(e) => setNewPolicy({ ...newPolicy, resource: e.target.value })} placeholder="如：data:*:delete" />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--gray-500)', display: 'block', marginBottom: 4 }}>效果</label>
              <select className="input-ecom" value={newPolicy.effect || 'deny'} onChange={(e) => setNewPolicy({ ...newPolicy, effect: e.target.value as any })}>
                <option value="allow">允许</option>
                <option value="deny">拒绝</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--gray-500)', display: 'block', marginBottom: 4 }}>优先级</label>
              <input className="input-ecom" type="number" value={newPolicy.priority || 0} onChange={(e) => setNewPolicy({ ...newPolicy, priority: parseInt(e.target.value) || 0 })} />
            </div>
          </div>
          <button className="btn-ecom" onClick={addPolicy}>创建策略</button>
        </div>
      )}

      {policies.map((policy) => (
        <div className="card" key={policy.id} style={{ padding: 12, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              {policy.name}
              <span className={`badge ${policy.effect === 'allow' ? 'badge-success' : 'badge-warning'}`} style={{ marginLeft: 8, fontSize: 10 }}>
                {policy.effect === 'allow' ? '允许' : '拒绝'}
              </span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 4 }}>
              资源: {policy.resource} | 条件: {policy.conditions.length > 0 ? policy.conditions.map((c) => `${c.attribute} ${c.operator} ${c.value}`).join(', ') : '无条件'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className={`badge ${policy.enabled ? 'badge-success' : 'badge-warning'}`}>{policy.enabled ? '启用' : '停用'}</span>
            <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => togglePolicy(policy.id)}>切换</button>
            <button className="btn-ghost" style={{ fontSize: 12, color: 'var(--danger-text)' }} onClick={() => deletePolicy(policy.id)}>删除</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── 审计日志 ───

function TenantAudit({ tenantId }: { tenantId: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ severity: '', action: '', limit: 50 });
  const [report, setReport] = useState<{
    totalEntries: number; byAction: Record<string, number>;
    bySeverity: Record<string, number>;
    topUsers: { userId: string; userName: string; count: number }[];
    securityEvents: number;
  } | null>(null);

  const loadAudit = useCallback(async () => {
    setLoading(true);
    const { entries: e } = await queryAuditLogs({
      tenantId,
      severity: filter.severity as any || undefined,
      action: filter.action as any || undefined,
      limit: filter.limit,
    });
    setEntries(e);
    setLoading(false);
  }, [tenantId, filter]);

  const loadReport = useCallback(async () => {
    const r = await generateAuditReport({
      tenantId,
      startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      endDate: new Date().toISOString(),
    });
    setReport(r);
  }, [tenantId]);

  useEffect(() => { loadAudit(); }, [loadAudit]);
  useEffect(() => { loadReport(); }, [loadReport]);

  const severityColors: Record<string, string> = {
    info: 'var(--accent)',
    warning: 'var(--warning-text, #d97706)',
    critical: 'var(--danger-text, #dc2626)',
  };

  return (
    <div className="mt-panel">
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>审计报表</div>
      {report && (
        <div className="card-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
          <div className="card" style={{ padding: 12, textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{report.totalEntries}</div>
            <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>总日志数</div>
          </div>
          <div className="card" style={{ padding: 12, textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--danger-text)' }}>{report.securityEvents}</div>
            <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>安全事件</div>
          </div>
          <div className="card" style={{ padding: 12, textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{Object.keys(report.byAction).length}</div>
            <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>操作类型</div>
          </div>
          <div className="card" style={{ padding: 12, textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{report.topUsers.length}</div>
            <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>活跃用户</div>
          </div>
        </div>
      )}

      <div className="hrms-toolbar" style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
        <select className="input-ecom" style={{ width: 140 }} value={filter.severity} onChange={(e) => setFilter({ ...filter, severity: e.target.value })}>
          <option value="">全部严重度</option>
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="critical">Critical</option>
        </select>
        <input className="input-ecom" style={{ width: 140 }} placeholder="操作类型筛选" value={filter.action} onChange={(e) => setFilter({ ...filter, action: e.target.value })} />
        <button className="btn-ecom" onClick={loadAudit}>刷新</button>
      </div>

      {loading ? (
        <div className="text-secondary" style={{ padding: 24, textAlign: 'center' }}>加载中...</div>
      ) : (
        <div className="table-wrap" style={{ maxHeight: 500, overflowY: 'auto' }}>
          <table className="table-ecom" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>时间</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>用户</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>操作</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>详情</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>严重度</th>
              </tr>
            </thead>
            <tbody>
              {entries.slice(0, filter.limit).map((entry) => (
                <tr key={entry.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{entry.timestamp.slice(0, 19).replace('T', ' ')}</td>
                  <td style={{ padding: '6px 8px' }}>{entry.userName}</td>
                  <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 11 }}>{entry.action}</td>
                  <td style={{ padding: '6px 8px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{entry.detail}</td>
                  <td style={{ padding: '6px 8px', color: severityColors[entry.severity] || 'inherit' }}>{entry.severity}</td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: 'var(--gray-500)' }}>暂无审计日志</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── 安全事件 ───

function TenantSecurity({ tenantId }: { tenantId: string }) {
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    const { events: e } = await querySecurityEvents({ tenantId, limit: 100 });
    setEvents(e);
    setLoading(false);
  }, [tenantId]);

  const handleResolve = async (eventId: string) => {
    await resolveSecurityEvent(eventId, 'admin');
    loadEvents();
  };

  useEffect(() => { loadEvents(); }, [loadEvents]);

  const eventTypeLabels: Record<string, string> = {
    'cross-tenant-access': '跨租户访问',
    'unauthorized-access': '未授权访问',
    'multiple-tenant-switch': '多租户切换',
    'brute-force': '暴力破解',
    'suspicious-ip': '可疑 IP',
    'file-tamper': '文件篡改',
    'token-replay': 'Token 重放',
    'rate-limit-exceeded': '频率超限',
  };

  return (
    <div className="mt-panel">
      <div className="hrms-toolbar" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <span className="text-secondary" style={{ fontSize: 13 }}>未处理事件: {events.filter((e) => !e.resolved).length}</span>
        <button className="btn-ecom" onClick={loadEvents}>刷新</button>
      </div>

      {loading ? (
        <div className="text-secondary" style={{ padding: 24, textAlign: 'center' }}>加载中...</div>
      ) : (
        events.map((event) => (
          <div key={event.id} className="card" style={{
            padding: 12, marginBottom: 8,
            borderLeft: `4px solid ${event.severity === 'critical' ? 'var(--danger-text)' : event.severity === 'warning' ? '#d97706' : 'var(--accent)'}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {eventTypeLabels[event.type] || event.type}
                  <span className={`badge ${event.severity === 'critical' ? 'badge-warning' : 'badge-info'}`} style={{ marginLeft: 8, fontSize: 10 }}>{event.severity}</span>
                  {event.resolved && <span className="badge badge-success" style={{ marginLeft: 8, fontSize: 10 }}>已处理</span>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 4, maxWidth: 500 }}>{event.detail}</div>
                <div style={{ fontSize: 11, color: 'var(--gray-500)', marginTop: 4 }}>
                  {event.userName} | {event.ip} | {event.timestamp.slice(0, 19).replace('T', ' ')}
                </div>
              </div>
              <div>
                {!event.resolved && (
                  <button className="btn-ecom" style={{ fontSize: 12 }} onClick={() => handleResolve(event.id)}>标记处理</button>
                )}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ─── 文件管理 ───

function TenantFiles({ tenantId }: { tenantId: string }) {
  const [files, setFiles] = useState<Awaited<ReturnType<typeof listTenantFiles>>>([]);
  const [loading, setLoading] = useState(true);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    const f = await listTenantFiles(tenantId);
    setFiles(f);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  return (
    <div className="mt-panel">
      <div className="hrms-toolbar" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <span className="text-secondary" style={{ fontSize: 13 }}>共 {files.length} 个文件</span>
        <button className="btn-ecom" onClick={loadFiles}>刷新</button>
      </div>

      {loading ? (
        <div className="text-secondary" style={{ padding: 24, textAlign: 'center' }}>加载中...</div>
      ) : (
        <div className="table-wrap" style={{ maxHeight: 500, overflowY: 'auto' }}>
          <table className="table-ecom" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>文件名</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>类型</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>大小</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>上传者</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>状态</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>时间</th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr key={file.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>{file.originalName}</td>
                  <td style={{ padding: '6px 8px' }}>{file.type}</td>
                  <td style={{ padding: '6px 8px' }}>{formatFileSize(file.size)}</td>
                  <td style={{ padding: '6px 8px' }}>{file.userName}</td>
                  <td style={{ padding: '6px 8px' }}>
                    <span className={`badge ${file.status === 'ready' ? 'badge-success' : 'badge-warning'}`}>{file.status}</span>
                  </td>
                  <td style={{ padding: '6px 8px', fontSize: 11, color: 'var(--gray-500)' }}>{file.createdAt.slice(0, 10)}</td>
                </tr>
              ))}
              {files.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--gray-500)' }}>暂无文件</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── 合规文档 ───

function TenantCompliance({ tenantId }: { tenantId: string }) {
  const [docs, setDocs] = useState<ComplianceDocument[]>(() => {
    const saved = localStorage.getItem('mt:mock:compliance');
    if (saved) return JSON.parse(saved);
    return [
      {
        id: 'comp-1', tenantId, type: 'user-agreement', title: '用户协议',
        content: '欢迎使用Vorzai电商平台。本协议是您与Vorzai电商之间关于使用本平台服务所订立的协议。用户在使用本平台服务前，应当仔细阅读并同意本协议的全部条款。',
        version: 'v1.0', status: 'published', effectiveDate: '2026-01-01',
        publishedAt: '2026-01-01T00:00:00Z', acceptedBy: [],
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'comp-2', tenantId, type: 'privacy-policy', title: '隐私协议',
        content: 'Vorzai电商重视您的隐私。我们承诺保护您的个人信息安全，严格按照相关法律法规收集、存储、使用和共享您的个人信息。',
        version: 'v1.0', status: 'published', effectiveDate: '2026-01-01',
        publishedAt: '2026-01-01T00:00:00Z', acceptedBy: [],
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'comp-3', tenantId, type: 'disclaimer', title: '免责声明',
        content: 'Vorzai电商不对因使用本平台服务而产生的任何直接或间接损失承担责任。用户应自行评估使用本平台服务的风险。',
        version: 'v1.0', status: 'published', effectiveDate: '2026-01-01',
        publishedAt: '2026-01-01T00:00:00Z', acceptedBy: [],
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      },
    ];
  });
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  useEffect(() => {
    localStorage.setItem('mt:mock:compliance', JSON.stringify(docs));
  }, [docs]);

  const selectedDocData = docs.find((d) => d.id === selectedDoc);

  const saveContent = () => {
    if (!selectedDoc || !editContent) return;
    setDocs((prev) => prev.map((d) => d.id === selectedDoc ? { ...d, content: editContent, updatedAt: new Date().toISOString() } : d));
  };

  const publishDoc = (docId: string) => {
    setDocs((prev) => prev.map((d) => d.id === docId ? { ...d, status: 'published', publishedAt: new Date().toISOString() } : d));
  };

  const typeLabels: Record<string, string> = {
    'user-agreement': '用户协议', 'privacy-policy': '隐私协议', 'disclaimer': '免责声明',
    'terms-of-service': '服务条款', 'data-processing': '数据处理协议', 'sla': '服务等级协议',
  };

  return (
    <div className="mt-panel" style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 16 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>合规文档</div>
        {docs.map((doc) => (
          <div
            key={doc.id}
            className="card"
            style={{
              padding: '10px 12px', marginBottom: 8, cursor: 'pointer',
              border: selectedDoc === doc.id ? '2px solid var(--accent)' : '1px solid var(--border-color)',
            }}
            onClick={() => { setSelectedDoc(doc.id); setEditContent(doc.content); }}
          >
            <div style={{ fontSize: 13, fontWeight: 600 }}>{doc.title}</div>
            <div style={{ fontSize: 11, color: 'var(--gray-500)' }}>{typeLabels[doc.type] || doc.type}</div>
            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
              <span className="badge badge-info" style={{ fontSize: 10 }}>{doc.version}</span>
              <span className={`badge ${doc.status === 'published' ? 'badge-success' : 'badge-warning'}`} style={{ fontSize: 10 }}>
                {doc.status === 'published' ? '已发布' : '草稿'}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div>
        {selectedDocData ? (
          <>
            <div className="hrms-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{selectedDocData.title}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {selectedDocData.status !== 'published' && <button className="btn-ecom" onClick={() => publishDoc(selectedDocData.id)}>发布</button>}
                <button className="btn-ghost" onClick={saveContent}>保存</button>
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--gray-500)', marginBottom: 12 }}>
              {typeLabels[selectedDocData.type]} | {selectedDocData.version} | 生效: {selectedDocData.effectiveDate}
            </div>
            <textarea
              className="input-ecom"
              style={{ width: '100%', minHeight: 300, fontSize: 13, lineHeight: 1.6, fontFamily: 'monospace', padding: 12, resize: 'vertical' }}
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
            />
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--gray-500)' }}>
              已接受用户数: {selectedDocData.acceptedBy.length}
            </div>
          </>
        ) : (
          <div className="text-secondary" style={{ padding: 24, textAlign: 'center' }}>请选择一个文档查看/编辑</div>
        )}
      </div>
    </div>
  );
}

// ─── 告警配置 ───

function TenantAlerts({ tenantId }: { tenantId: string }) {
  const [configs, setConfigs] = useState<AlertConfig[]>(() => {
    const saved = localStorage.getItem('mt:mock:alerts');
    return saved ? JSON.parse(saved) : [];
  });
  const [showAdd, setShowAdd] = useState(false);
  const [newConfig, setNewConfig] = useState<Partial<AlertConfig>>({});

  useEffect(() => {
    localStorage.setItem('mt:mock:alerts', JSON.stringify(configs));
  }, [configs]);

  const addConfig = () => {
    if (!newConfig.name || !newConfig.webhook) return;
    const config: AlertConfig = {
      id: `alert-${Date.now()}`,
      tenantId,
      name: newConfig.name || '新告警',
      channel: newConfig.channel || 'dingtalk',
      webhook: newConfig.webhook,
      secret: newConfig.secret,
      enabled: true,
      events: ['cross-tenant-access', 'unauthorized-access'],
      rateLimit: 10,
      createdAt: new Date().toISOString(),
    };
    setConfigs((prev) => [...prev, config]);
    setShowAdd(false);
    setNewConfig({});
  };

  const toggleConfig = (id: string) => {
    setConfigs((prev) => prev.map((c) => c.id === id ? { ...c, enabled: !c.enabled } : c));
  };

  const channelLabels: Record<AlertChannel, string> = {
    dingtalk: '钉钉', feishu: '飞书', wecom: '企业微信', email: '邮件', sms: '短信',
  };

  return (
    <div className="mt-panel">
      <div className="hrms-toolbar" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <span className="text-secondary" style={{ fontSize: 13 }}>共 {configs.length} 条告警配置</span>
        <button className="btn-ecom" onClick={() => setShowAdd(!showAdd)}>+ 添加告警</button>
      </div>

      {showAdd && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--gray-500)', display: 'block', marginBottom: 4 }}>名称</label>
              <input className="input-ecom" value={newConfig.name || ''} onChange={(e) => setNewConfig({ ...newConfig, name: e.target.value })} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--gray-500)', display: 'block', marginBottom: 4 }}>渠道</label>
              <select className="input-ecom" value={newConfig.channel || 'dingtalk'} onChange={(e) => setNewConfig({ ...newConfig, channel: e.target.value as any })}>
                <option value="dingtalk">钉钉</option>
                <option value="feishu">飞书</option>
                <option value="wecom">企业微信</option>
                <option value="email">邮件</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--gray-500)', display: 'block', marginBottom: 4 }}>Webhook URL</label>
              <input className="input-ecom" value={newConfig.webhook || ''} onChange={(e) => setNewConfig({ ...newConfig, webhook: e.target.value })} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--gray-500)', display: 'block', marginBottom: 4 }}>签名密钥（可选）</label>
              <input className="input-ecom" value={newConfig.secret || ''} onChange={(e) => setNewConfig({ ...newConfig, secret: e.target.value })} />
            </div>
          </div>
          <button className="btn-ecom" onClick={addConfig}>创建告警</button>
        </div>
      )}

      {configs.map((config) => (
        <div className="card" key={config.id} style={{ padding: 12, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              {config.name}
              <span className="badge badge-info" style={{ marginLeft: 8, fontSize: 10 }}>{channelLabels[config.channel]}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 4 }}>
              {config.webhook.substring(0, 60)}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className={`badge ${config.enabled ? 'badge-success' : 'badge-warning'}`}>{config.enabled ? '启用' : '停用'}</span>
            <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => toggleConfig(config.id)}>切换</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── 安全设置 ───

function TenantSettings({ tenant, setTenant }: {
  tenant: TenantConfig; setTenant: React.Dispatch<React.SetStateAction<TenantConfig>>;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ ...tenant });

  const saveSettings = () => {
    setTenant(form);
    setEditing(false);
    writeAuditLog('config:change', '更新安全设置', { resource: 'config', resourceId: tenant.id });
  };

  return (
    <div className="mt-panel">
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>安全策略配置</div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>隔离策略</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--gray-500)', display: 'block', marginBottom: 4 }}>数据库隔离</label>
            <select className="input-ecom" value={form.isolation.db} disabled={!editing} onChange={(e) => setForm({ ...form, isolation: { ...form.isolation, db: e.target.value as any } })}>
              <option value="shared-tenant-id">共享库 + TenantID</option>
              <option value="shared-schema">共享 Schema</option>
              <option value="dedicated-db">独立数据库</option>
              <option value="dedicated-instance">独立实例</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--gray-500)', display: 'block', marginBottom: 4 }}>文件存储隔离</label>
            <select className="input-ecom" value={form.isolation.storage} disabled={!editing} onChange={(e) => setForm({ ...form, isolation: { ...form.isolation, storage: e.target.value as any } })}>
              <option value="directory">租户目录隔离</option>
              <option value="bucket">独立 Bucket</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--gray-500)', display: 'block', marginBottom: 4 }}>缓存隔离</label>
            <select className="input-ecom" value={form.isolation.cache} disabled={!editing} onChange={(e) => setForm({ ...form, isolation: { ...form.isolation, cache: e.target.value as any } })}>
              <option value="namespace">命名空间 + 前缀</option>
              <option value="dedicated">独立缓存</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>资源限制</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--gray-500)', display: 'block', marginBottom: 4 }}>最大用户数</label>
            <input className="input-ecom" type="number" value={form.limits.maxUsers} disabled={!editing} onChange={(e) => setForm({ ...form, limits: { ...form.limits, maxUsers: parseInt(e.target.value) || 0 } })} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--gray-500)', display: 'block', marginBottom: 4 }}>存储空间 (GB)</label>
            <input className="input-ecom" type="number" value={form.limits.maxStorageGB} disabled={!editing} onChange={(e) => setForm({ ...form, limits: { ...form.limits, maxStorageGB: parseInt(e.target.value) || 0 } })} />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        {editing ? (
          <>
            <button className="btn-ecom" onClick={saveSettings}>保存设置</button>
            <button className="btn-ghost" onClick={() => { setEditing(false); setForm({ ...tenant }); }}>取消</button>
          </>
        ) : (
          <button className="btn-ecom" onClick={() => setEditing(true)}>编辑设置</button>
        )}
      </div>
    </div>
  );
}