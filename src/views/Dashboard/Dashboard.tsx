/**
 * Vorzai 电商 Agent — 工作台视图
 * 数据源：GET /api/cockpit/overview（真实数据，不再硬编码）
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@store/appStore';
import DialogChatPanel from '@views/Dashboard/components/DialogChatPanel';

// 业务线颜色映射
const LINE_COLORS: Record<string, { color: string; bgColor: string }> = {
  'live-stream': { color: '#dc2626', bgColor: '#fef2f2' },
  'cross-border': { color: '#2563eb', bgColor: '#eff6ff' },
  'traditional': { color: '#16a34a', bgColor: '#f0fdf4' },
  'new-media': { color: '#7c3aed', bgColor: '#f5f3ff' },
};
const DEFAULT_COLOR = { color: '#64748b', bgColor: '#f8fafc' };

// 业务线 → 路由映射
const LINE_ROUTES: Record<string, string> = {
  'live-stream': '/business-chain?phase=live',
  'cross-border': '/crossborder',
  'traditional': '/business-chain?phase=wip',
  'new-media': '/live-commerce',
};

interface BizLine {
  id: string;
  label: string;
  gmv: number;
  orderCount: number;
  paidOrderCount: number;
  conversionRate: number;
}

// SVG 图标
const ICONS = {
  chart: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <path d="M7 14l4-4 4 4 5-6" />
    </svg>
  ),
};

export default function Dashboard() {
  const { theme } = useAppStore();
  const navigate = useNavigate();
  const [bizLines, setBizLines] = useState<BizLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  void theme;

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      try {
        const { default: api } = await import('@api/client');
        const resp = await api.call<{ bizLines?: BizLine[] }>('GET', '/cockpit/overview');
        if (cancelled) return;
        if (resp.success && resp.data?.bizLines?.length) {
          setBizLines(resp.data.bizLines);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || '加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, []);

  // 空壳保护：未配置业务线时静默
  const displayLines = bizLines.length > 0 ? bizLines : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Hero 区 */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 36, fontWeight: 700, lineHeight: 1.2, color: 'var(--text-primary)', letterSpacing: -0.5 }}>
          电商智能工作台
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.5 }}>
          打通传统电商、直播电商、新媒体电商、跨境电商的人力系统与业务链，实现业务倍增。
        </p>
      </div>

      {/* 业务线概览矩阵 */}
      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 14, padding: '16px 0' }}>加载中…</div>
      ) : error ? (
        <div style={{ color: 'var(--danger-500)', fontSize: 14, padding: '16px 0' }}>数据加载失败：{error}</div>
      ) : displayLines.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 14, padding: '16px 0' }}>
          暂无业务线数据，请先在「平台对接」中配置平台连接。
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
          {displayLines.map((line) => {
            const clr = LINE_COLORS[line.id] || DEFAULT_COLOR;
            const route = LINE_ROUTES[line.id];
            const convPct = (line.conversionRate * 100).toFixed(1);

            return (
              <div
                key={line.id}
                role="button"
                tabIndex={0}
                aria-label={`查看${line.label}详情`}
                onClick={() => route && navigate(route)}
                onKeyDown={(e) => { if (e.key === 'Enter' && route) navigate(route); }}
                style={{
                  background: 'var(--bg-card)', borderRadius: 12, padding: 16,
                  border: '1px solid var(--border-card)', cursor: route ? 'pointer' : 'default',
                  transition: 'all var(--transition-fast)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = 'var(--shadow-dashboard-hover)';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = 'none';
                  e.currentTarget.style.transform = 'none';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: clr.bgColor, color: clr.color,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {ICONS.chart}
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                    {line.label}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>GMV</span>
                    <div style={{ fontSize: 18, fontWeight: 700, color: clr.color }}>
                      ¥{(line.gmv || 0).toLocaleString()}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <div>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>订单</span>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                        {line.orderCount || 0}
                      </div>
                    </div>
                    <div>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>已支付</span>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                        {line.paidOrderCount || 0}
                      </div>
                    </div>
                    <div>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>转化率</span>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                        {convPct}%
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 智能助手对话面板 */}
      <DialogChatPanel />
    </div>
  );
}
