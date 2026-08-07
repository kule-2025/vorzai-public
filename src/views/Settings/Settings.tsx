/**
 * Vorzai 电商 Agent — 系统设置视图
 *
 * 工程诚信原则：
 * - 有后端支撑的数据（租户、大模型平台、连接器）一律接真实接口，不再硬编码
 * - 暂无后端支撑的能力（主密码、审计日志、通知、侧边栏宽度等）显式标注「规划中」，
 *   不再用假绿色开关伪装成可用功能
 */
import { useState, useEffect } from 'react';
import { useAppStore } from '@store/appStore';
import { api } from '@api/client';
import { useToast } from '@components/Common/Toast';
import { LLMPlatform, Connector, Tenant, UserProfile } from '@domain/index';

// SVG 图标
const ICONS = {
  user: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  ),
  security: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  ),
  connectors: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M8.2 11l7.4-4M8.2 13l7.4 4" />
    </svg>
  ),
  llm: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <circle cx="8" cy="12" r="1.5" fill="currentColor" />
      <path d="M11 12h6" />
    </svg>
  ),
  appearance: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  notify: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
  help: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <circle cx="12" cy="17" r="0.5" fill="currentColor" />
    </svg>
  ),
  check: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  plus: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
};

const SETTINGS_SECTIONS = [
  { id: 'account', label: '账户与租户', icon: ICONS.user },
  { id: 'security', label: '安全与权限', icon: ICONS.security },
  { id: 'connectors', label: '连接器管理', icon: ICONS.connectors },
  { id: 'llm', label: '大模型平台', icon: ICONS.llm },
  { id: 'appearance', label: '外观与主题', icon: ICONS.appearance },
  { id: 'notify', label: '通知设置', icon: ICONS.notify },
  { id: 'help', label: '帮助与关于', icon: ICONS.help },
];

const PLAN_LABELS: Record<string, string> = { free: '免费版', pro: '专业版', enterprise: '企业版' };
const CONNECTOR_STATUS_TEXT: Record<string, string> = {
  connected: '已连接',
  disconnected: '未连接',
  syncing: '同步中',
  error: '连接异常',
};

// 真实开关：有后端支撑时交互；无后端时显式标注「规划中」，不伪装成可用功能
function Toggle({ on, planned, onToggle, disabled }: { on?: boolean; planned?: boolean; onToggle?: () => void; disabled?: boolean }) {
  if (planned) {
    return (
      <span
        style={{
          fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-row-hover)',
          border: '1px solid var(--border-card)', padding: '3px 10px', borderRadius: 6, whiteSpace: 'nowrap',
        }}
      >
        规划中
      </span>
    );
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onToggle}
      style={{
        width: 40, height: 22, borderRadius: 11, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
        padding: 2, display: 'inline-flex', alignItems: 'center', justifyContent: on ? 'flex-end' : 'flex-start',
        background: on ? 'var(--success-500)' : 'var(--border-card)', opacity: disabled ? 0.6 : 1,
      }}
    >
      <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff' }} />
    </button>
  );
}

// 行内「规划中」徽标
function PlannedBadge() {
  return (
    <span style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-row-hover)', border: '1px solid var(--border-card)', padding: '3px 10px', borderRadius: 6 }}>
      规划中
    </span>
  );
}

// 将后端 profile 映射为前端 Tenant（与登录流程保持一致）
function buildTenantFromProfile(u: any): Tenant {
  return {
    id: u.tenantId || '',
    name: u.tenantName || u.tenantId || '我的团队',
    plan: (u.plan || 'free') as Tenant['plan'],
    maxAgents: u.maxAgents || 10,
    maxConnectors: u.maxConnectors || 10,
    createdAt: u.createdAt || new Date().toISOString(),
  };
}

function toFrontendUser(u: any): UserProfile {
  return {
    id: u.id,
    tenantId: u.tenantId || '',
    name: u.displayName || u.username || u.name || '',
    email: u.email || '',
    avatar: u.avatarUrl || u.avatar,
    role: (u.role || 'viewer') as UserProfile['role'],
    permissions: Array.isArray(u.permissions) ? u.permissions : [],
    createdAt: u.createdAt || new Date().toISOString(),
  };
}

export default function Settings() {
  const { theme, setTheme, tenant, setTenant, setUser } = useAppStore();
  const [activeSection, setActiveSection] = useState('account');
  const toastApi = useToast();
  const toast = (type: 'success' | 'error' | 'warning' | 'info', title: string, message?: string) =>
    toastApi.addToast(type, title, message);

  // 真实数据：大模型平台 + 连接器（从后端拉取，不再硬编码）
  const [llmList, setLlmList] = useState<LLMPlatform[]>([]);
  const [connList, setConnList] = useState<Connector[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  // 刷新后 tenant/user 可能未重新加载（登录态在 localStorage，但状态未恢复），此处兜底补全
  useEffect(() => {
    if (!tenant) {
      api.auth.getProfile().then((res) => {
        if (res.success && res.data) {
          const u = res.data;
          setTenant(buildTenantFromProfile(u));
          setUser(toFrontendUser(u));
        }
      }).catch(() => { /* 静默：登录态异常时由路由层统一处理 */ });
    }
  }, [tenant, setTenant, setUser]);

  // 拉取大模型平台与连接器真实列表
  useEffect(() => {
    let cancelled = false;
    setLoadingData(true);
    Promise.all([api.llm.list(), api.connectors.list()])
      .then(([llmRes, connRes]) => {
        if (cancelled) return;
        if (llmRes.success && llmRes.data) setLlmList((llmRes.data as LLMPlatform[]) || []);
        if (connRes.success && connRes.data) setConnList((connRes.data as Connector[]) || []);
      })
      .catch(() => { /* 静默失败，UI 显示空态 */ })
      .finally(() => { if (!cancelled) setLoadingData(false); });
    return () => { cancelled = true; };
  }, []);

  const removeLlm = async (id: string) => {
    const res = await api.llm.remove(id);
    if (res.success) {
      setLlmList((list) => list.filter((p) => p.id !== id));
      toast('success', '已移除平台');
    } else {
      toast('error', '移除失败', res.error?.message || '请稍后重试');
    }
  };

  const plan = tenant?.plan || 'free';

  return (
    <div style={{ display: 'flex', height: '100%', gap: 20 }}>
      {/* 左侧设置导航 */}
      <div style={{ width: 200, flexShrink: 0 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 16 }}>
          系统设置
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {SETTINGS_SECTIONS.map((section) => (
            <button
              key={section.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
                borderRadius: 8,
                background: activeSection === section.id ? 'var(--bg-row-selected)' : 'transparent',
                color: activeSection === section.id ? 'var(--text-primary)' : 'var(--text-muted)',
                border: 'none',
                fontSize: 13,
                cursor: 'pointer',
                transition: 'all var(--transition-fast)',
                fontWeight: activeSection === section.id ? 500 : 400,
                textAlign: 'left',
              }}
              onClick={() => setActiveSection(section.id)}
            >
              {section.icon}
              {section.label}
            </button>
          ))}
        </div>
      </div>

      {/* 右侧设置内容 */}
      <div
        style={{
          flex: 1,
          background: 'var(--bg-card)',
          borderRadius: 12,
          border: '1px solid var(--border-card)',
          padding: 24,
          overflow: 'auto',
        }}
      >
        {/* ============ 账户与租户（真实数据） ============ */}
        {activeSection === 'account' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>账户与租户</h3>
            <div>
              <label htmlFor="tenant-name" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>企业名称</label>
              <input
                id="tenant-name"
                value={tenant?.name || ''}
                className="input"
                style={{ marginTop: 6 }}
                readOnly
              />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>只读 · 由登录租户决定</div>
            </div>
            <div>
              <label htmlFor="tenant-id" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>租户 ID</label>
              <input
                id="tenant-id"
                value={tenant?.id || ''}
                className="input"
                style={{ marginTop: 6, color: 'var(--text-muted)' }}
                readOnly
              />
            </div>
            <div>
              <label htmlFor="tenant-plan-group" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>订阅计划</label>
              <div id="tenant-plan-group" style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                {(['free', 'pro', 'enterprise'] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => {
                      if (p !== plan) toast('info', '套餐变更规划中', '当前仅支持查看，变更能力即将上线');
                    }}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 8,
                      background: p === plan ? 'var(--ecom-amber-500)' : 'var(--bg-row-hover)',
                      color: p === plan ? '#0f172a' : 'var(--text-muted)',
                      border: 'none',
                      fontSize: 12,
                      cursor: p === plan ? 'default' : 'pointer',
                      fontWeight: p === plan ? 600 : 400,
                    }}
                  >
                    {PLAN_LABELS[p]}{p === plan ? ' ✓' : ''}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 24, marginTop: 4 }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Agent 上限</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>{tenant?.maxAgents ?? '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>连接器上限</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>{tenant?.maxConnectors ?? '—'}</div>
              </div>
            </div>
          </div>
        )}

        {/* ============ 安全与权限（无后端支撑项诚实标注） ============ */}
        {activeSection === 'security' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>安全与权限</h3>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderRadius: 10, background: 'var(--bg-row-hover)' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>主密码锁定</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>使用主密码保护敏感操作</div>
              </div>
              <Toggle planned />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderRadius: 10, background: 'var(--bg-row-hover)' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>API Key 管理</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>管理第三方平台 API 密钥</div>
              </div>
              <PlannedBadge />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderRadius: 10, background: 'var(--bg-row-hover)' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>操作审计日志</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>记录所有敏感操作</div>
              </div>
              <Toggle planned />
            </div>
          </div>
        )}

        {/* ============ 连接器管理（真实数据） ============ */}
        {activeSection === 'connectors' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>连接器管理</h3>
              <button
                className="btn-ecom"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                onClick={() => toast('info', '连接器管理', '请前往「连接器」模块添加与配置')}
              >
                {ICONS.plus} 添加连接器
              </button>
            </div>
            {loadingData && connList.length === 0 && (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '12px 0' }}>加载中…</div>
            )}
            {!loadingData && connList.length === 0 && (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '12px 0' }}>
                暂无已配置的连接器。请前往「连接器」模块添加。
              </div>
            )}
            {connList.map((c) => {
              const online = c.status === 'connected' || c.status === 'syncing';
              return (
                <div
                  key={c.id}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderRadius: 10, background: 'var(--bg-row-hover)' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: online ? 'var(--connector-status-online)' : c.status === 'error' ? 'var(--danger-text)' : 'var(--connector-status-offline)' }} />
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{c.name}</span>
                  </div>
                  <span style={{ fontSize: 11, color: online ? 'var(--success-text)' : c.status === 'error' ? 'var(--danger-text)' : 'var(--text-muted)' }}>
                    {CONNECTOR_STATUS_TEXT[c.status] || c.status}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* ============ 大模型平台（真实数据） ============ */}
        {activeSection === 'llm' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>大模型平台</h3>
              <button
                className="btn-ghost"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                onClick={() => toast('info', '平台管理', '请前往「大模型平台」模块添加与编辑')}
              >
                {ICONS.plus} 添加平台
              </button>
            </div>
            {loadingData && llmList.length === 0 && (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '12px 0' }}>加载中…</div>
            )}
            {!loadingData && llmList.length === 0 && (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '12px 0' }}>
                暂无大模型平台。请前往「大模型平台」模块配置。
              </div>
            )}
            {llmList.map((p) => (
              <div
                key={p.id}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderRadius: 10, background: 'var(--bg-row-hover)' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.isActive ? 'var(--connector-status-online)' : 'var(--connector-status-offline)' }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.provider}{p.models?.length ? ` · ${p.models.length} 个模型` : ''}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="btn-ghost"
                    style={{ fontSize: 11 }}
                    onClick={() => toast('info', '编辑平台', '请前往「大模型平台」模块编辑')}
                  >
                    编辑
                  </button>
                  <button
                    className="btn-ghost"
                    style={{ fontSize: 11, color: 'var(--danger-text)' }}
                    onClick={() => removeLlm(p.id)}
                  >
                    移除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ============ 外观与主题（主题真实生效） ============ */}
        {activeSection === 'appearance' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>外观与主题</h3>
            <div>
              <label htmlFor="theme-select" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>主题</label>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                {(['light', 'dark', 'system'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTheme(t)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 8,
                      background: theme === t ? 'var(--bg-sidebar-active)' : 'var(--bg-row-hover)',
                      color: theme === t ? 'var(--text-light)' : 'var(--text-muted)',
                      border: 'none',
                      fontSize: 12,
                      cursor: 'pointer',
                      fontWeight: theme === t ? 600 : 400,
                    }}
                  >
                    {t === 'light' ? '亮色' : t === 'dark' ? '暗色' : '跟随系统'}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderRadius: 10, background: 'var(--bg-row-hover)' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>侧边栏宽度</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>紧凑 / 标准 / 宽屏</div>
              </div>
              <PlannedBadge />
            </div>
          </div>
        )}

        {/* ============ 通知设置（无后端支撑，诚实标注） ============ */}
        {activeSection === 'notify' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>通知设置</h3>
            {['订单异常通知', '库存预警通知', 'Agent 完成通知', '连接器状态变更', '数据日报推送'].map((item) => (
              <div
                key={item}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderRadius: 10, background: 'var(--bg-row-hover)' }}
              >
                <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{item}</span>
                <Toggle planned />
              </div>
            ))}
          </div>
        )}

        {/* ============ 帮助与关于 ============ */}
        {activeSection === 'help' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>帮助与关于</h3>
            <div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>版本</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>v0.1.1</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {['使用文档', 'API 参考', '常见问题', '反馈与建议'].map((item) => (
                <button
                  key={item}
                  onClick={() => toast('info', `${item} 规划中`, '该入口即将上线')}
                  style={{
                    padding: '10px 16px',
                    borderRadius: 8,
                    background: 'var(--bg-row-hover)',
                    border: 'none',
                    fontSize: 13,
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  {item}
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>→</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
