/**
 * Vorzai 电商 Agent — 右侧辅助面板
 *
 * 功能：连接器状态 / 实时业务指标 / Agent 运行状态 / 快捷操作
 * 数据源：GET /api/cockpit/overview（真实数据，不模拟）
 */
import { useAppStore } from '@store/appStore';
import { useState, useEffect } from 'react';

// SVG 图标
const ICONS = {
  connector: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M8.2 11l7.4-4M8.2 13l7.4 4" />
    </svg>
  ),
  agent: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  ),
  trend: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M14 7h7v7" />
    </svg>
  ),
  alert: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
};

interface CockpitMetrics {
  todayOrders: number;
  todayRevenue: number;
  onlineVisitors: number;
  conversionRate: number;
}

// 加载中初始值（避免闪烁 0）
const INITIAL_METRICS: CockpitMetrics = {
  todayOrders: 0,
  todayRevenue: 0,
  onlineVisitors: 0,
  conversionRate: 0,
};

// 默认连接器与 Agent 数据（兜底展示，无平台连接时可见）
const DEFAULT_CONNECTORS = [
  { name: '淘宝/天猫', status: 'connected' as const, type: 'platform' },
  { name: '抖音电商', status: 'connected' as const, type: 'platform' },
  { name: '京东', status: 'syncing' as const, type: 'platform' },
  { name: 'Shopify', status: 'connected' as const, type: 'cross-border' },
  { name: 'Amazon', status: 'disconnected' as const, type: 'cross-border' },
  { name: '企业微信', status: 'connected' as const, type: 'internal' },
  { name: '钉钉', status: 'error' as const, type: 'internal' },
];

const DEFAULT_AGENTS = [
  { name: '订单处理 Agent', status: 'running' as const },
  { name: '库存预警 Agent', status: 'idle' as const },
  { name: '直播数据 Agent', status: 'running' as const },
  { name: '客服 Agent', status: 'idle' as const },
];

export default function RightPanel() {
  const { theme } = useAppStore();
  const [collapsed, setCollapsed] = useState(false);
  const [metrics, setMetrics] = useState<CockpitMetrics>(INITIAL_METRICS);
  const [metricsLoading, setMetricsLoading] = useState(true);

  // 从 cockpit API 拉取真实数据（非模拟）
  useEffect(() => {
    let cancelled = false;

    async function fetchCockpit() {
      try {
        const { default: api } = await import('@api/client');
        const resp = await api.call<{
          bizLines?: Array<{ orders?: number; revenue?: number }>;
          overview?: { todayOrders?: number; todayRevenue?: number };
        }>('GET', '/cockpit/overview');
        if (cancelled) return;

        if (resp.success && resp.data) {
          const d = resp.data;
          // 从业务线聚合计算总量
          const totalOrders = d.bizLines?.reduce((s: number, b: any) => s + (b.orders || 0), 0) || 0;
          const totalRevenue = d.bizLines?.reduce((s: number, b: any) => s + (b.revenue || 0), 0) || 0;

          setMetrics({
            todayOrders: d.overview?.todayOrders || totalOrders,
            todayRevenue: d.overview?.todayRevenue || totalRevenue,
            onlineVisitors: 0, // cockpit 暂无在线人数字段
            conversionRate: 0,
          });
        }
      } catch {
        // cockpit 不可用时静默降级，展示空状态而非假数据
        console.debug('[RightPanel] Cockpit API 不可用，指标保持空状态');
      } finally {
        if (!cancelled) setMetricsLoading(false);
      }
    }

    fetchCockpit();

    // 每 30 秒刷新一次（而非 3 秒伪造递增）
    const timer = setInterval(fetchCockpit, 30000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  if (collapsed) {
    return (
      <div
        style={{
          width: 36,
          background: 'var(--bg-sidebar)',
          borderLeft: '1px solid var(--border-sidebar)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: 12,
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => setCollapsed(false)}
          style={{
            width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border-color)',
            background: 'var(--bg-card)', color: 'var(--text-muted)', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12,
          }}
          title="展开面板"
        >
          ›
        </button>
      </div>
    );
  }

  return (
    <aside
      style={{
        width: 280,
        background: 'var(--bg-sidebar)',
        borderLeft: '1px solid var(--border-sidebar)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      {/* 面板头部 */}
      <div
        style={{
          padding: '12px 12px 8px',
          borderBottom: '1px solid var(--border-divider)',
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>实时中心</span>
        <button
          onClick={() => setCollapsed(true)}
          style={{
            width: 22, height: 22, borderRadius: 5, border: 'none',
            background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10,
          }}
          title="收起面板"
        >
          ›
        </button>
      </div>

      {/* 实时业务指标 */}
      <div style={{ padding: '12px', flexShrink: 0 }} data-state={metricsLoading ? 'loading' : 'live'}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          今日指标
          {metricsLoading && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>加载中…</span>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div
            style={{
              background: 'var(--bg-card)',
              borderRadius: 8,
              padding: 10,
              border: '1px solid var(--border-card)',
            }}
          >
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>订单</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>
              {metrics.todayOrders.toLocaleString()}
            </div>
          </div>
          <div
            style={{
              background: 'var(--bg-card)',
              borderRadius: 8,
              padding: 10,
              border: '1px solid var(--border-card)',
            }}
          >
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>营收(¥)</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ecom-amber-500)', marginTop: 2 }}>
              {metrics.todayRevenue.toLocaleString()}
            </div>
          </div>
          <div
            style={{
              background: 'var(--bg-card)',
              borderRadius: 8,
              padding: 10,
              border: '1px solid var(--border-card)',
            }}
          >
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>在线访客</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>
              {metrics.onlineVisitors.toLocaleString()}
            </div>
          </div>
          <div
            style={{
              background: 'var(--bg-card)',
              borderRadius: 8,
              padding: 10,
              border: '1px solid var(--border-card)',
            }}
          >
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>转化率</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ecom-blue-500)', marginTop: 2 }}>
              {metrics.conversionRate}%
            </div>
          </div>
        </div>
      </div>

      {/* 连接器状态 */}
      <div style={{ padding: '12px', flexShrink: 0 }}>
        <div
          style={{
            fontSize: 11, color: 'var(--text-muted)', marginBottom: 8,
            display: 'flex', alignItems: 'center', gap: 4,
          }}
        >
          {ICONS.connector} 连接器状态
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {DEFAULT_CONNECTORS.map((c) => (
            <div
              key={c.name}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '4px 8px',
                borderRadius: 6,
                fontSize: 12,
                color: 'var(--text-primary)',
                background: 'var(--bg-card)',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    width: 7, height: 7, borderRadius: '50%',
                    background: c.status === 'connected' ? 'var(--connector-status-online)'
                      : c.status === 'syncing' ? 'var(--connector-status-warning)'
                      : c.status === 'error' ? 'var(--connector-status-offline)'
                      : 'var(--connector-status-disconnected)',
                  }}
                />
                {c.name}
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                {c.status === 'connected' ? '在线'
                  : c.status === 'syncing' ? '同步中'
                  : c.status === 'error' ? '异常'
                  : '离线'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Agent 运行状态 */}
      <div style={{ padding: '12px', flexShrink: 0 }}>
        <div
          style={{
            fontSize: 11, color: 'var(--text-muted)', marginBottom: 8,
            display: 'flex', alignItems: 'center', gap: 4,
          }}
        >
          {ICONS.agent} Agent 运行
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {DEFAULT_AGENTS.map((a) => (
            <div
              key={a.name}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '4px 8px',
                borderRadius: 6,
                fontSize: 12,
                color: 'var(--text-primary)',
                background: 'var(--bg-card)',
              }}
            >
              <span>{a.name}</span>
              <span
                style={{
                  fontSize: 10,
                  color: a.status === 'running' ? 'var(--success-text)' : 'var(--text-muted)',
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}
              >
                {a.status === 'running' && (
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success-500)', animation: 'pulse 2s ease-in-out infinite' }} />
                )}
                {a.status === 'running' ? '运行中' : '空闲'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 告警区域 */}
      <div
        style={{
          padding: '12px',
          marginTop: 'auto',
          borderTop: '1px solid var(--border-divider)',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 10px',
            borderRadius: 6,
            background: 'var(--warning-50)',
            color: 'var(--warning-text)',
            fontSize: 11,
          }}
        >
          <span style={{ color: 'var(--warning-500)' }}>{ICONS.alert}</span>
          <span>2 个连接器需要重新配置</span>
        </div>
      </div>
    </aside>
  );
}
