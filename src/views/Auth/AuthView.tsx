/**
 * Vorzai 电商 Agent — 登录 / 注册 / 找回密码
 * 独立全屏页面，不依赖 AppLayout（无侧边栏）。
 * 解决 P0-1：此前全站无登录入口，所有带鉴权接口返回 401。
 *
 * 认证后端已就绪（/api/auth/login、/api/auth/register），本页负责：
 *   1. 调用 api.auth.login / register
 *   2. 写入 token（localStorage 持久化，刷新不丢）
 *   3. 同步用户/租户到全局 store
 *   4. 回调 onAuthenticated 进入主应用
 */
import { useState } from 'react';
import { Button } from '@components/Common/Button';
import { Input } from '@components/Common/Input';
import { useToast } from '@components/Common/Toast';
import Logo from '@components/Common/Logo';
import { useAppStore } from '@store/appStore';
import { api } from '@api/client';
import type { UserProfile } from '@domain/index';

type Mode = 'login' | 'register';

// 后端 UserProfile（server）与前端 UserProfile（src/types）字段不完全一致，做映射
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

function buildTenant(u: any) {
  return {
    id: u.tenantId || '',
    name: u.tenantName || u.tenantId || '我的团队',
    plan: 'free' as const,
    maxAgents: 10,
    maxConnectors: 10,
    createdAt: new Date().toISOString(),
  };
}

export default function AuthView({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    username: '',
    displayName: '',
    email: '',
    tenantName: '',
    password: '',
    confirm: '',
  });

  const toast = useToast();
  const setUser = useAppStore((s) => s.setUser);
  const setTenant = useAppStore((s) => s.setTenant);

  const update = (k: keyof typeof form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (error) setError('');
  };

  async function finishAuth(user: any, tokens: { accessToken: string; refreshToken: string }) {
    api.setTokens(tokens.accessToken, tokens.refreshToken);
    // 拉取更完整的 profile（含权限等）
    const prof = await api.auth.getProfile();
    const u = prof.success && prof.data ? prof.data : user;
    const fu = toFrontendUser(u);
    setUser(fu);
    setTenant(buildTenant(u));
    onAuthenticated();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!form.username.trim()) {
      setError('请输入用户名');
      return;
    }
    if (!form.password) {
      setError('请输入密码');
      return;
    }
    if (mode === 'register') {
      if (form.password.length < 8) {
        setError('密码至少 8 位');
        return;
      }
      if (form.password !== form.confirm) {
        setError('两次输入的密码不一致');
        return;
      }
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        const res = await api.auth.login({ username: form.username.trim(), password: form.password });
        if (!res.success || !res.data) {
          setError(res.error?.message || '登录失败');
          return;
        }
        await finishAuth(res.data.user, res.data.tokens);
        toast.addToast('success', `欢迎回来，${res.data.user.displayName || form.username}`);
      } else {
        const res = await api.auth.register({
          username: form.username.trim(),
          password: form.password,
          displayName: form.displayName.trim() || form.username.trim(),
          email: form.email.trim() || undefined,
          tenantName: form.tenantName.trim() || undefined,
        });
        if (!res.success || !res.data) {
          setError(res.error?.message || '注册失败');
          return;
        }
        await finishAuth(res.data.user, res.data.tokens);
        toast.addToast('success', '注册成功，已自动登录');
      }
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setLoading(false);
    }
  }

  function handleForgot() {
    toast.addToast('info', '密码重置功能规划中：当前为本地桌面应用，可直接在数据库中重置，或重新注册租户。');
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100vw',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-body)',
        padding: '40px 24px',
        boxSizing: 'border-box',
        backgroundImage:
          'radial-gradient(1200px 600px at 20% -10%, rgba(99,102,241,0.10), transparent), radial-gradient(900px 500px at 100% 110%, rgba(139,92,246,0.10), transparent)',
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-modal)',
          boxShadow: 'var(--shadow-lg)',
          padding: 32,
          boxSizing: 'border-box',
        }}
      >
        {/* 品牌头 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <Logo text="Vorzai" subText="" />
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 22 }}>
          电商 Agent 工作台 · 登录后开始使用
        </div>

        {/* Tab 切换 */}
        <div
          style={{
            display: 'flex',
            background: 'var(--bg-row-hover)',
            borderRadius: 'var(--radius-button)',
            padding: 3,
            marginBottom: 20,
          }}
        >
          {(['login', 'register'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setError(''); }}
              style={{
                flex: 1,
                border: 'none',
                background: mode === m ? 'var(--bg-card)' : 'transparent',
                color: mode === m ? 'var(--primary-600)' : 'var(--text-muted)',
                fontWeight: 600,
                fontSize: 14,
                padding: '8px 0',
                borderRadius: 'var(--radius-button)',
                cursor: 'pointer',
                transition: 'all var(--transition-fast)',
                boxShadow: mode === m ? 'var(--shadow-sm)' : 'none',
              }}
            >
              {m === 'login' ? '登录' : '注册'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Input
              label="用户名"
              placeholder="字母 / 数字 / 下划线 / 中文"
              value={form.username}
              onChange={(e) => update('username', e.target.value)}
              autoComplete="username"
            />

            {mode === 'register' && (
              <>
                <Input
                  label="显示名称"
                  placeholder="如：张三 / 运营组"
                  value={form.displayName}
                  onChange={(e) => update('displayName', e.target.value)}
                />
                <Input
                  label="邮箱（可选）"
                  type="email"
                  placeholder="you@example.com"
                  value={form.email}
                  onChange={(e) => update('email', e.target.value)}
                  autoComplete="email"
                />
                <Input
                  label="团队名称（可选）"
                  placeholder="创建独立租户空间"
                  value={form.tenantName}
                  onChange={(e) => update('tenantName', e.target.value)}
                />
              </>
            )}

            <Input
              label="密码"
              type="password"
              placeholder={mode === 'register' ? '至少 8 位' : '请输入密码'}
              value={form.password}
              onChange={(e) => update('password', e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />

            {mode === 'register' && (
              <Input
                label="确认密码"
                type="password"
                placeholder="再次输入密码"
                value={form.confirm}
                onChange={(e) => update('confirm', e.target.value)}
                autoComplete="new-password"
              />
            )}

            {error && (
              <div
                role="alert"
                style={{
                  fontSize: 13,
                  color: 'var(--danger-600)',
                  background: 'var(--danger-50)',
                  border: '1px solid var(--danger-200)',
                  borderRadius: 'var(--radius-button)',
                  padding: '8px 12px',
                }}
              >
                {error}
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={loading}
              style={{ width: '100%', marginTop: 4 }}
            >
              {mode === 'login' ? '登录' : '注册并登录'}
            </Button>
          </div>
        </form>

        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <button
            type="button"
            onClick={handleForgot}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 12, color: 'var(--text-muted)', textDecoration: 'underline',
            }}
          >
            忘记密码？
          </button>
        </div>
      </div>
    </div>
  );
}
