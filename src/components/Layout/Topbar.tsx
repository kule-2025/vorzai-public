/**
 * Vorzai 电商 Agent — 顶部栏（维度2：字体字号 / 维度3：色彩方案 / 维度7：左下角布局 / 维度8：右上角布局）
 *
 * WorkBuddy 方案：
 *   高度 44px，纯白背景 + 底部 1px 边框 + 微阴影
 *   左侧：Logo + 项目名 + 项目统计
 *   右侧：侧栏折叠按钮 + 主题切换(三个圆形按钮) + 锁定按钮 + 日期
 *
 * 差异化改进：
 *   1. 顶栏高度从 44px 增至 48px（电商品牌辨识度提升）
 *   2. 左侧增加「业务线标签」显示当前业务上下文（直播/跨境/传统/新媒体）
 *   3. 右侧替换 emoji 按钮为统一 SVG 图标
 *   4. 右上角增加「连接器状态汇总」徽章
 *   5. 日期显示替换为更精确的实时时间
 *
 * 电商适配策略：
 *   电商运营需要时刻感知业务上下文，顶栏左侧的业务线标签
 *   让运营者一眼识别当前操作的业务领域
 */
import { useState, useEffect } from 'react';
import { useAppStore } from '@store/appStore';
import { useToast } from '@components/Common/Toast';
import Logo from '@components/Common/Logo';

// 确认对话框（轻量内联实现，避免引入额外依赖）
function confirmDialog(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(15,23,42,0.45);display:flex;align-items:center;justify-content:center;z-index:9999;';
    const box = document.createElement('div');
    box.style.cssText =
      'background:#fff;color:#0f172a;border-radius:12px;padding:24px;max-width:320px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.25);font-family:system-ui,sans-serif;';
    box.innerHTML = `<div style="font-size:15px;font-weight:600;margin-bottom:8px;">确认操作</div><div style="font-size:13px;color:#475569;line-height:1.5;margin-bottom:18px;">${message}</div>`;
    const cancel = document.createElement('button');
    cancel.textContent = '取消';
    cancel.style.cssText =
      'float:right;margin-left:8px;padding:8px 16px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#334155;font-size:13px;cursor:pointer;';
    const ok = document.createElement('button');
    ok.textContent = '确定';
    ok.style.cssText =
      'float:right;padding:8px 16px;border:none;border-radius:8px;background:#4f46e5;color:#fff;font-size:13px;cursor:pointer;';
    const cleanup = () => overlay.remove();
    cancel.onclick = () => { cleanup(); resolve(false); };
    ok.onclick = () => { cleanup(); resolve(true); };
    box.appendChild(cancel);
    box.appendChild(ok);
    overlay.appendChild(box);
    overlay.onclick = (e) => { if (e.target === overlay) { cleanup(); resolve(false); } };
    document.body.appendChild(overlay);
  });
}

// SVG 图标
const ICONS = {
  sun: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  ),
  moon: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  ),
  monitor: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  ),
  lock: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
  collapse: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  ),
  notification: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
  connector: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M8.2 11l7.4-4M8.2 13l7.4 4" />
    </svg>
  ),
};

// 业务线标签
const BUSINESS_LINE_TAGS: Record<string, { label: string; color: string; bgColor: string }> = {
  'live-stream': { label: '直播电商', color: '#dc2626', bgColor: '#fef2f2' },
  'cross-border': { label: '跨境电商', color: '#2563eb', bgColor: '#eff6ff' },
  'traditional': { label: '传统电商', color: '#16a34a', bgColor: '#f0fdf4' },
  'new-media': { label: '新媒体电商', color: '#7c3aed', bgColor: '#f5f3ff' },
  all: { label: '全业务线', color: '#6366f1', bgColor: '#eff6ff' },
};

export default function Topbar() {
  const { currentView, sidebarCollapsed, setSidebarCollapsed, theme, setTheme, tenant, user, logout } = useAppStore();
  const toast = useToast();
  const [currentTime, setCurrentTime] = useState('');
  const [activeBusinessLine] = useState('all');

  // 实时时钟
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // 连接器状态（模拟）
  const connectorCount = 5;
  const onlineCount = 4;

  return (
    <header
      style={{
        height: 48,
        background: 'var(--bg-header)',
        borderBottom: '1px solid var(--bg-header-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        flexShrink: 0,
        position: 'relative',
        zIndex: 10,
        boxShadow: 'var(--shadow-header)',
      }}
    >
      {/* ═══ 左侧：品牌 + 业务上下文 ═══ */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Logo */}
        <Logo text="Vorzai" subText="" />

        {/* 业务线标签 */}
        {BUSINESS_LINE_TAGS[activeBusinessLine] && (
          <span
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '3px 10px',
              borderRadius: 'var(--radius-pill)',
              background: BUSINESS_LINE_TAGS[activeBusinessLine].bgColor,
              color: BUSINESS_LINE_TAGS[activeBusinessLine].color,
              fontSize: 12, fontWeight: 500,
              border: `1px solid ${BUSINESS_LINE_TAGS[activeBusinessLine].color}20`,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: BUSINESS_LINE_TAGS[activeBusinessLine].color }} />
            {BUSINESS_LINE_TAGS[activeBusinessLine].label}
          </span>
        )}

        {/* 页面标题 */}
        <span style={{ fontSize: 14, color: 'var(--text-header-sub)', fontWeight: 500 }}>
          {currentView === 'dashboard' && '工作台概览'}
          {currentView === 'agent-config' && 'Agent 智能体配置'}
          {currentView === 'analytics' && '数据洞察分析'}
          {currentView === 'settings' && '系统设置'}
        </span>
      </div>

      {/* ═══ 右侧：操作区 ═══ */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {/* 连接器状态汇总徽章 */}
        <div
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '4px 8px',
            borderRadius: 'var(--radius-pill)',
            background: 'var(--bg-row-hover)',
            border: '1px solid var(--border-color)',
            cursor: 'pointer',
            transition: 'all var(--transition-fast)',
          }}
          title="连接器状态"
        >
          <span style={{ color: 'var(--connector-status-online)' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--connector-status-online)', display: 'inline-block' }} />
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            {onlineCount}/{connectorCount}
          </span>
          {ICONS.connector}
        </div>

        {/* 通知 */}
        <button
          onClick={() => toast.addToast('info', '通知中心规划中：当前暂无待处理通知。')}
          style={{
            width: 28, height: 28, borderRadius: 6,
            border: '1px solid var(--border-color)',
            background: 'var(--bg-card)',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            position: 'relative',
          }}
          title="通知"
          aria-label="通知（规划中）"
        >
          {ICONS.notification}
          <span
            style={{
              position: 'absolute', top: 4, right: 4,
              width: 7, height: 7, borderRadius: '50%',
              background: 'var(--danger-500)',
            }}
          />
        </button>

        {/* 主题切换 — SVG 图标替代 emoji */}
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 1,
            background: 'var(--bg-toolbar)',
            borderRadius: 'var(--radius-modal)',
            padding: '1px 3px',
            border: '1px solid var(--border-color)',
          }}
        >
          <button
            onClick={() => setTheme('light')}
            title="亮色模式"
            style={{
              width: 26, height: 26, borderRadius: '50%',
              border: 'none',
              background: theme === 'light' ? 'var(--bg-card)' : 'transparent',
              color: theme === 'light' ? 'var(--ecom-amber-500)' : 'var(--text-muted)',
              cursor: 'pointer', fontSize: 12,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {ICONS.sun}
          </button>
          <button
            onClick={() => setTheme('dark')}
            title="护眼暗色"
            style={{
              width: 26, height: 26, borderRadius: '50%',
              border: 'none',
              background: theme === 'dark' ? 'var(--bg-card)' : 'transparent',
              color: theme === 'dark' ? 'var(--ecom-amber-500)' : 'var(--text-muted)',
              cursor: 'pointer', fontSize: 12,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {ICONS.moon}
          </button>
          <button
            onClick={() => setTheme('system')}
            title="跟随系统"
            style={{
              width: 26, height: 26, borderRadius: '50%',
              border: 'none',
              background: theme === 'system' ? 'var(--bg-card)' : 'transparent',
              color: theme === 'system' ? 'var(--ecom-amber-500)' : 'var(--text-muted)',
              cursor: 'pointer', fontSize: 12,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {ICONS.monitor}
          </button>
        </div>

        {/* 侧边栏折叠 */}
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          style={{
            width: 28, height: 28, borderRadius: 6,
            border: '1px solid var(--border-color)',
            background: 'var(--bg-card)',
            color: 'var(--text-secondary)',
            cursor: 'pointer', fontSize: 14,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {ICONS.collapse}
        </button>

        {/* 锁定 / 登出 */}
        <button
          onClick={async () => {
            const ok = await confirmDialog(`确定要以「${user?.name || '当前用户'}」身份退出登录吗？`);
            if (ok) {
              logout();
              toast.addToast('success', '已退出登录');
              window.location.hash = '#/';
              // 触发整页重渲染：清除登录态后需回到登录页
              window.location.reload();
            }
          }}
          style={{
            width: 28, height: 28, borderRadius: 6,
            border: '1px solid var(--border-color)',
            background: 'var(--bg-card)',
            color: 'var(--text-muted)',
            cursor: 'pointer', fontSize: 12,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
          title="退出登录"
          aria-label="退出登录"
        >
          {ICONS.lock}
        </button>

        {/* 实时时间（替代日期） */}
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>
          {currentTime}
        </div>
      </div>
    </header>
  );
}
