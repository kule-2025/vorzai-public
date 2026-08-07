/**
 * Vorzai 电商 Agent — 侧边栏（重构版 · workbuddy 风格）
 *
 * 设计理念：对齐 workbuddy 助手定位 + 电商行业专项
 * ┌─────────────────────────────────────────┐
 * │ 品牌区  Vorzai 电商  v0.1.1   [收起]    │
 * │ 业务线筛选  全部 / 直播 / 跨境 / 传统 / 新媒体 │
 * ├─────────────────────────────────────────┤
 * │  💬 智能助手           Ctrl+2           │  ← 置顶高亮
 * │ ─── 业务闭环 ───                       │
 * │   📂 立项 OGSM                          │
 * │   🛒 选品                              │
 * │   📦 组盘                              │
 * │   🧾 订单                              │
 * │   🎧 客服                              │
 * │ ─── 组织管理 ───                       │
 * │   👥 HR 管理                            │
 * │ ─── 配套能力 ───                       │
 * │   📚 知识库                            │
 * │   ✨ 技能 / 专家                        │
 * │   🔌 连接器                            │
 * │   📊 数据分析                          │
 * │ ─── 系统 ───                           │
 * │   🏢 多租户管理                        │
 * │   ⚙️ 系统设置                          │
 * │   📥 数据导入导出                       │
 * ├─────────────────────────────────────────┤
 * │ 连接器  4/5 在线  ●                    │
 * │ 用户 / 租户                            │
 * └─────────────────────────────────────────┘
 */
import { useState, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppStore } from '@store/appStore';
import type { CurrentView } from '@domain/index';

// ─── SVG 图标（统一 16px 描边风） ───
const ICON = (path: React.ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {path}
  </svg>
);

const ICONS = {
  assistant: ICON(<><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></>),
  ogsm: ICON(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /></>),
  select: ICON(<><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" /></>),
  package: ICON(<><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" /></>),
  order: ICON(<><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>),
  service: ICON(<><path d="M3 18v-6a9 9 0 0 1 18 0v6" /><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" /></>),
  hr: ICON(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>),
  knowledge: ICON(<><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></>),
  skill: ICON(<><path d="M12 2l2.5 6.5L21 9l-5 4.5L17.5 21 12 17l-5.5 4L8 13.5 3 9l6.5-.5z" /></>),
  connector: ICON(<><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8.2 11l7.4-4M8.2 13l7.4 4" /></>),
  chart: ICON(<><path d="M3 3v18h18" /><path d="M7 14l4-4 4 4 5-6" /></>),
  tenant: ICON(<><rect x="2" y="3" width="9" height="7" rx="1.5" /><rect x="13" y="3" width="9" height="4" rx="1.5" /><rect x="2" y="14" width="9" height="7" rx="1.5" /><rect x="13" y="14" width="9" height="7" rx="1.5" /></>),
  settings: ICON(<><circle cx="12" cy="12" r="3" /><path d="M12 1v3M12 20v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M1 12h3M20 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" /></>),
  import: ICON(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></>),
  collapse: ICON(<><path d="M15 18l-6-6 6-6" /></>),
  expand: ICON(<><path d="M9 18l6-6-6-6" /></>),
  search: ICON(<><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" /></>),
  // 业务线图标
  live: ICON(<><rect x="2" y="6" width="14" height="12" rx="2" /><path d="M22 8v8M22 8l-4-2v8l4-2M12 12l4-3" /></>),
  globe: ICON(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></>),
  traditional: ICON(<><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M9 22V12h6v10" /></>),
  media: ICON(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 9l6 3-6 3z" fill="currentColor" /></>),
  all: ICON(<><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="4" rx="1.5" /><rect x="14" y="9" width="7" height="12" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /></>),
  // 业务驾驶舱（速度表 / 仪表盘）
  cockpit: ICON(<><circle cx="12" cy="12" r="9" /><path d="M12 12l4-4" /><path d="M3 12h2M19 12h2M12 3v2M12 19v2" /></>),
  // 平台对接（插头）
  plug: ICON(<><path d="M9 2v6M15 2v6" /><path d="M6 8h12v3a6 6 0 0 1-12 0z" /><path d="M12 17v5" /></>),
  // 库存预警（警示三角）
  alert: ICON(<><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4M12 17h.01" /></>),
  // 工作流编排（节点 + 连线）
  workflow: ICON(<><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="12" cy="18" r="2.5" /><path d="M7.7 7.7L11 16M16.3 7.7L13 16M8.5 6h7" /></>),
  // 执行监控（心电脉冲线）
  monitor: ICON(<><path d="M3 12h4l3 8 4-16 3 8h4" /></>),
};

// ─── 业务线定义（多端电商行业 4 场景） ───
const BIZ_LINES: { id: string; label: string; icon: JSX.Element; color: string }[] = [
  { id: 'all', label: '全部', icon: ICONS.all, color: 'var(--text-muted)' },
  { id: 'live', label: '直播', icon: ICONS.live, color: '#dc2626' },
  { id: 'cross', label: '跨境', icon: ICONS.globe, color: '#2563eb' },
  { id: 'trad', label: '传统', icon: ICONS.traditional, color: '#16a34a' },
  { id: 'media', label: '新媒体', icon: ICONS.media, color: '#7c3aed' },
];

// ─── 导航项定义（业务环节为主线） ───
type NavLeaf = {
  kind: 'leaf';
  id: CurrentView;
  label: string;
  path: string;        // 路由路径
  icon: JSX.Element;
  shortcut?: string;
  highlighted?: boolean; // 智能助手置顶高亮
  viewParam?: string;   // 业务链子环节 query: phase
};

type NavGroup = {
  kind: 'group';
  label: string;
  children: NavLeaf[];
};

const NAV_STRUCTURE: (NavLeaf | NavGroup)[] = [
  // 智能助手：置顶高亮，体现"workbuddy 助手"定位
  {
    kind: 'leaf', id: 'agent-config', label: '智能助手',
    path: '/agent-config', icon: ICONS.assistant, shortcut: 'Ctrl+2', highlighted: true,
  },
  // 业务闭环：五环节子项（默认展开）
  {
    kind: 'group', label: '业务闭环',
    children: [
      { kind: 'leaf', id: 'business-chain', label: '立项 OGSM',  path: '/business-chain', icon: ICONS.ogsm,    viewParam: 'project' },
      { kind: 'leaf', id: 'business-chain', label: '选品',        path: '/business-chain', icon: ICONS.select,  viewParam: 'select' },
      { kind: 'leaf', id: 'business-chain', label: '组盘',        path: '/business-chain', icon: ICONS.package, viewParam: 'package' },
      { kind: 'leaf', id: 'business-chain', label: '订单',        path: '/business-chain', icon: ICONS.order,   viewParam: 'order' },
      { kind: 'leaf', id: 'business-chain', label: '客服',        path: '/business-chain', icon: ICONS.service, viewParam: 'service' },
      { kind: 'leaf', id: 'ogsm-board',   label: 'OGSM 看板',  path: '/ogsm-board',    icon: ICONS.chart,   viewParam: undefined },
      { kind: 'leaf', id: 'business-cockpit', label: '业务驾驶舱', path: '/business-cockpit', icon: ICONS.cockpit, viewParam: undefined },
    ],
  },
  // 行业场景：直播 / 跨境 / 平台对接 / 库存预警
  {
    kind: 'group', label: '行业场景',
    children: [
      { kind: 'leaf', id: 'livestream',       label: '直播电商',   path: '/livestream',       icon: ICONS.live },
      { kind: 'leaf', id: 'crossborder',      label: '跨境电商',   path: '/crossborder',      icon: ICONS.globe },
      { kind: 'leaf', id: 'platform-hub',     label: '平台对接',   path: '/platform-hub',     icon: ICONS.plug },
      { kind: 'leaf', id: 'inventory-alerts', label: '库存预警',   path: '/inventory-alerts', icon: ICONS.alert },
      { kind: 'leaf', id: 'procurement',      label: '采购供应链', path: '/procurement',      icon: ICONS.package },
      { kind: 'leaf', id: 'aftersales',       label: '售后闭环',   path: '/aftersales',       icon: ICONS.service },
      { kind: 'leaf', id: 'execution-monitor', label: '执行监控',  path: '/execution-monitor', icon: ICONS.monitor },
    ],
  },
  // 组织管理
  {
    kind: 'group', label: '组织管理',
    children: [
      { kind: 'leaf', id: 'hrms', label: 'HR 管理', path: '/hrms', icon: ICONS.hr },
    ],
  },
  // 配套能力
  {
    kind: 'group', label: '配套能力',
    children: [
      { kind: 'leaf', id: 'skill-center', label: '知识库',     path: '/skill-center', icon: ICONS.knowledge },
      { kind: 'leaf', id: 'skill-center', label: '技能 / 专家', path: '/skill-center', icon: ICONS.skill },
      { kind: 'leaf', id: 'connectors',   label: '连接器',     path: '/connectors',   icon: ICONS.connector },
      { kind: 'leaf', id: 'growth-engine', label: '增长引擎',   path: '/growth-engine', icon: ICONS.chart },
      { kind: 'leaf', id: 'analytics',    label: '数据分析',   path: '/analytics',    icon: ICONS.chart },
      { kind: 'leaf', id: 'conversion',   label: '转化与运营', path: '/conversion',   icon: ICONS.chart },
      { kind: 'leaf', id: 'workflow-studio', label: '工作流编排', path: '/workflow-studio', icon: ICONS.workflow },
    ],
  },
  // 系统
  {
    kind: 'group', label: '系统',
    children: [
      { kind: 'leaf', id: 'tenant-admin',  label: '多租户管理',     path: '/tenant-admin',  icon: ICONS.tenant },
      { kind: 'leaf', id: 'settings',      label: '系统设置',       path: '/settings',      icon: ICONS.settings },
      { kind: 'leaf', id: 'import-export', label: '数据导入导出',   path: '/import-export', icon: ICONS.import },
    ],
  },
];

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    sidebarCollapsed, setSidebarCollapsed,
    setCurrentView,
    currentView, connectors, user, tenant,
  } = useAppStore();

  // 业务线筛选（局部状态，可与 store 后续打通）
  const [activeBiz, setActiveBiz] = useState('all');
  // 业务闭环分组默认展开
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ '业务闭环': true });

  // 折叠态下隐藏业务线筛选与分组标题
  const showExpanded = !sidebarCollapsed;

  // 连接器在线统计
  const onlineCount = useMemo(
    () => connectors.filter((c) => c.status === 'connected').length,
    [connectors],
  );
  const totalCount = connectors.length;

  // 当前路径是否匹配某导航项
  const isActive = (item: NavLeaf): boolean => {
    if (item.path === location.pathname) {
      // 业务链子项：按 phase 进一步匹配
      if (item.path === '/business-chain' && item.viewParam) {
        return new URLSearchParams(location.search).get('phase') === item.viewParam;
      }
      return true;
    }
    return false;
  };

  // 点击导航项：路由跳转 + 同步 store
  const handleNav = (item: NavLeaf) => {
    setCurrentView(item.id);
    if (item.viewParam) {
      navigate(`${item.path}?phase=${item.viewParam}`);
    } else {
      navigate(item.path);
    }
  };

  // 切换分组展开
  const toggleGroup = (label: string) => {
    setOpenGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  return (
    <nav
      style={{
        width: sidebarCollapsed ? 56 : 240,
        flexShrink: 0,
        background: 'var(--bg-sidebar)',
        borderRight: '1px solid var(--border-sidebar)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 15,
        transition: 'width var(--transition-normal)',
        overflow: 'hidden',
        height: '100%',
        position: 'relative',
      }}
    >
      {/* ═══ 品牌区 ═══ */}
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: sidebarCollapsed ? '12px 6px' : '12px 12px',
          borderBottom: '1px solid var(--border-divider)',
          flexShrink: 0, gap: 6,
        }}
      >
        {showExpanded ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
              <div
                style={{
                  width: 26, height: 26, borderRadius: 6,
                  background: 'linear-gradient(135deg, #4f46e5, #8b5cf6)',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: 13, fontWeight: 700, flexShrink: 0,
                }}
              >
                电
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2, overflow: 'hidden' }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: -0.2, whiteSpace: 'nowrap' }}>
                  Vorzai 电商
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  行业专项 · workbuddy
                </span>
              </div>
            </div>
            <button
              className="sidebar-icon-btn"
              title="搜索"
              style={{
                width: 24, height: 24, border: 'none', background: 'transparent',
                color: 'var(--text-muted)', borderRadius: 4, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}
            >
              {ICONS.search}
            </button>
          </>
        ) : (
          <div
            style={{
              width: 28, height: 28, borderRadius: 7,
              background: 'linear-gradient(135deg, #4f46e5, #8b5cf6)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 14, fontWeight: 700, margin: '0 auto',
            }}
          >
            电
          </div>
        )}
      </div>

      {/* ═══ 业务线快速筛选（仅展开态） ═══ */}
      {showExpanded && (
        <div
          style={{
            display: 'flex', gap: 4, padding: '8px 8px',
            borderBottom: '1px solid var(--border-divider)',
            flexShrink: 0, flexWrap: 'wrap',
          }}
        >
          {BIZ_LINES.map((line) => (
            <button
              key={line.id}
              onClick={() => setActiveBiz(line.id)}
              title={line.label}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 28, height: 28, borderRadius: 6,
                background: activeBiz === line.id ? 'var(--bg-sidebar-active)' : 'transparent',
                color: activeBiz === line.id ? 'var(--text-sidebar-active)' : line.color,
                border: 'none', cursor: 'pointer', transition: 'all var(--transition-fast)',
                flexShrink: 0,
              }}
            >
              <span style={{ display: 'inline-flex' }}>{line.icon}</span>
            </button>
          ))}
        </div>
      )}

      {/* ═══ 导航主体 ═══ */}
      <div
        style={{
          display: 'flex', flexDirection: 'column',
          padding: sidebarCollapsed ? '8px 6px' : '8px 4px',
          overflowY: 'auto', overflowX: 'hidden',
          flex: 1, minHeight: 0,
        }}
      >
        {NAV_STRUCTURE.map((node, idx) => {
          if (node.kind === 'leaf') {
            const active = isActive(node);
            return (
              <div
                key={`leaf-${node.id}-${idx}`}
                className="sidebar-item"
                title={sidebarCollapsed ? node.label : undefined}
                onClick={() => handleNav(node)}
                style={{
                  height: 36, padding: sidebarCollapsed ? 0 : '0 10px',
                  justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                  background: node.highlighted
                    ? 'linear-gradient(90deg, rgba(79,70,229,0.10), transparent)'
                    : (active ? 'var(--bg-sidebar-active)' : 'transparent'),
                  color: node.highlighted
                    ? '#4f46e5'
                    : (active ? 'var(--text-sidebar-active)' : 'var(--text-sidebar)'),
                  fontWeight: node.highlighted || active ? 500 : 400,
                  borderLeft: node.highlighted ? '2px solid #4f46e5' : '2px solid transparent',
                  marginBottom: 2,
                }}
              >
                <span className="sidebar-item-icon" style={{ color: 'currentColor' }}>{node.icon}</span>
                {showExpanded && (
                  <>
                    <span className="sidebar-item-label" style={{ flex: 1 }}>{node.label}</span>
                    {node.shortcut && (
                      <span style={{
                        fontSize: 10, color: 'var(--text-muted)',
                        padding: '1px 5px', borderRadius: 3,
                        background: 'var(--bg-row-hover)', fontFamily: 'monospace',
                      }}>{node.shortcut}</span>
                    )}
                  </>
                )}
              </div>
            );
          }

          // 分组
          const isOpen = openGroups[node.label] !== false;
          return (
            <div key={`group-${node.label}`} style={{ marginTop: 6, marginBottom: 2 }}>
              {/* 分组标题（仅展开态显示，折叠态隐藏） */}
              {showExpanded && (
                <div
                  onClick={() => toggleGroup(node.label)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '6px 10px 4px',
                    fontSize: 10, fontWeight: 600, letterSpacing: 0.5,
                    color: 'var(--text-muted)', textTransform: 'uppercase',
                    cursor: 'pointer', userSelect: 'none',
                  }}
                >
                  <span>{node.label}</span>
                  <span style={{ fontSize: 10, opacity: 0.6, transition: 'transform 0.15s', transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
                    ▾
                  </span>
                </div>
              )}
              {/* 子项（折叠态下也显示，但缩进对齐图标列） */}
              {(isOpen || !showExpanded) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {node.children.map((child, ci) => {
                    const active = isActive(child);
                    return (
                      <div
                        key={`${node.label}-${ci}`}
                        className="sidebar-item"
                        title={sidebarCollapsed ? child.label : undefined}
                        onClick={() => handleNav(child)}
                        style={{
                          height: 32, padding: sidebarCollapsed ? 0 : '0 10px 0 24px',
                          justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                          background: active ? 'var(--bg-sidebar-active)' : 'transparent',
                          color: active ? 'var(--text-sidebar-active)' : 'var(--text-sidebar)',
                          fontWeight: active ? 500 : 400,
                          fontSize: 13,
                        }}
                      >
                        <span className="sidebar-item-icon" style={{ color: 'currentColor' }}>{child.icon}</span>
                        {showExpanded && <span className="sidebar-item-label">{child.label}</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ═══ 底部：连接器状态 + 用户 ═══ */}
      {showExpanded ? (
        <div
          style={{
            padding: '8px 12px',
            borderTop: '1px solid var(--border-divider)',
            display: 'flex', flexDirection: 'column', gap: 6,
            flexShrink: 0, fontSize: 11, color: 'var(--text-muted)',
          }}
        >
          {totalCount > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                width: 7, height: 7, borderRadius: '50%',
                background: onlineCount > 0 ? '#22c55e' : '#9ca3af',
                boxShadow: onlineCount > 0 ? '0 0 0 3px rgba(34,197,94,0.15)' : 'none',
              }} />
              <span>连接器 {onlineCount}/{totalCount} 在线</span>
            </div>
          )}
          {tenant && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--text-muted)' }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {tenant.name}
              </span>
            </div>
          )}
          {user && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{
                width: 18, height: 18, borderRadius: '50%',
                background: 'linear-gradient(135deg, #4f46e5, #8b5cf6)',
                color: '#fff', fontSize: 10, fontWeight: 600,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {user.name?.slice(0, 1) || 'U'}
              </div>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.name || '未登录用户'}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div
          style={{
            padding: '8px 0', borderTop: '1px solid var(--border-divider)',
            display: 'flex', justifyContent: 'center', flexShrink: 0,
          }}
        >
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: onlineCount > 0 ? '#22c55e' : '#9ca3af',
          }} />
        </div>
      )}

      {/* ═══ 收起/展开按钮（浮动在右上）═══ */}
      <button
        className="sidebar-icon-btn"
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
        style={{
          position: 'absolute',
          top: 14, right: -10,
          width: 20, height: 20,
          border: '1px solid var(--border-color)',
          background: 'var(--bg-card)',
          color: 'var(--text-muted)',
          borderRadius: 4,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', zIndex: 5,
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}
      >
        {sidebarCollapsed ? ICONS.expand : ICONS.collapse}
      </button>
    </nav>
  );
}
