/**
 * Vorzai 执行监控面板（Execution Monitor）
 *
 * V2 方案 M3 交付：把散落在采购 / 库存 / 订单 / 售后四个模块里的「今天该干什么」
 * 一次性聚合到一屏。顶部四张业务线指标卡，下方「今日要处理」清单按紧急度排序，
 * 每条都能点击直达源头页面。
 *
 * 数据全部来自 monitorApi.getOverview() 真实接口，严禁任何 Mock / 硬编码业务数据。
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@components/Common/Card';
import { Badge } from '@components/Common/Badge';
import { Button } from '@components/Common/Button';
import monitorApi, {
  type MonitorOverview,
  type TodoItem,
  type TodoSource,
  type TodoSeverity,
} from '@api/monitor';

// ─────────────── 常量（UI 文案，非业务数据）───────────────

// 后端 route 字段里，订单 / 售后两线暂指向尚未独立建页的路由，
// 这里兜底到业务链对应子环节，保证点击一定能落地（不出现空白页）。
const ROUTE_FALLBACK: Record<string, string> = {
  '/orders': '/business-chain?phase=order',
  '/service': '/business-chain?phase=service',
};

const SOURCE_META: Record<TodoSource, { label: string; color: string }> = {
  procurement: { label: '采购', color: '#16a34a' },
  inventory: { label: '库存', color: '#f59e0b' },
  order: { label: '订单', color: '#2563eb' },
  ticket: { label: '售后', color: '#7c3aed' },
};

function severityBadge(s: TodoSeverity): { variant: 'danger' | 'warning' | 'neutral'; label: string } {
  if (s === 'overdue') return { variant: 'danger', label: '逾期' };
  if (s === 'high') return { variant: 'warning', label: '紧急' };
  return { variant: 'neutral', label: '待办' };
}

// ─────────────── 样式 ───────────────

const pageStyle: React.CSSProperties = {
  padding: 20, display: 'flex', flexDirection: 'column', gap: 16,
  background: 'var(--bg-app, #f5f6fa)', minHeight: '100%',
};
const sectionTitleStyle: React.CSSProperties = {
  fontSize: 14, fontWeight: 600, color: 'var(--text-primary)',
  display: 'flex', alignItems: 'center', gap: 8,
};
const statGridStyle: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12,
};
const panelStyle: React.CSSProperties = {
  padding: 14, background: 'var(--bg-card)',
  border: '1px solid var(--border-card)', borderRadius: 'var(--radius-card)',
  display: 'flex', flexDirection: 'column', gap: 10,
};
const emptyStyle: React.CSSProperties = {
  padding: 28, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12,
  lineHeight: 1.6,
};

function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return '¥0';
  const abs = Math.abs(n);
  if (abs >= 1_0000_0000) return `¥${(n / 1_0000_0000).toFixed(2)}亿`;
  if (abs >= 1_0000) return `¥${(n / 1_0000).toFixed(2)}万`;
  return `¥${n.toFixed(2)}`;
}
function formatDate(s: string | null | undefined): string {
  if (!s) return '—';
  return s.slice(0, 10);
}
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ─────────────── 子组件 ───────────────

function StatCard({
  label, value, sub, tone,
}: {
  label: string; value: string; sub?: string;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'info';
}) {
  const colorMap: Record<string, string> = {
    default: 'var(--text-primary)',
    success: 'var(--success-500, #22c55e)',
    warning: 'var(--warning-500, #f59e0b)',
    danger: 'var(--danger-500, #ef4444)',
    info: 'var(--text-link, #4f46e5)',
  };
  return (
    <Card hoverable>
      <div style={{ ...panelStyle, gap: 6 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</div>
        <div style={{
          fontSize: 22, fontWeight: 700, lineHeight: 1.2,
          color: colorMap[tone || 'default'], fontVariantNumeric: 'tabular-nums',
        }}>
          {value}
        </div>
        {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sub}</div>}
      </div>
    </Card>
  );
}

function PillarCard({
  title, accent, stats,
}: {
  title: string; accent: string;
  stats: Array<{ label: string; value: string; tone?: 'default' | 'success' | 'warning' | 'danger' | 'info' }>;
}) {
  return (
    <Card hoverable>
      <div style={{ ...panelStyle, gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 4, height: 14, borderRadius: 2, background: accent, display: 'inline-block',
          }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {stats.map((s) => (
            <div key={s.label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.label}</span>
              <span style={{
                fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                color: s.tone === 'danger'
                  ? 'var(--danger-500, #ef4444)'
                  : s.tone === 'warning'
                    ? 'var(--warning-500, #f59e0b)'
                    : 'var(--text-primary)',
              }}>{s.value}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function TodoRow({ item, onOpen }: { item: TodoItem; onOpen: (route: string) => void }) {
  const sev = severityBadge(item.severity);
  const meta = SOURCE_META[item.source];
  return (
    <div
      onClick={() => onOpen(item.route)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px',
        borderBottom: '1px solid var(--border-card)', cursor: 'pointer',
        background: item.severity === 'overdue' ? 'var(--bg-danger-soft, rgba(239,68,68,0.06))' : 'transparent',
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(item.route); }}
    >
      <Badge variant={sev.variant}>{sev.label}</Badge>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{item.title}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.5 }}>{item.detail}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{
            fontSize: 10, padding: '1px 6px', borderRadius: 4, color: meta.color,
            background: 'var(--bg-row-hover)', fontWeight: 600,
          }}>{meta.label}</span>
          {item.refNo && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>单号 {item.refNo}</span>}
          {item.amount !== undefined && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>金额 {formatMoney(item.amount)}</span>
          )}
          {item.dueDate && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>时间 {formatDate(item.dueDate)}</span>}
        </div>
      </div>
      <span style={{ color: 'var(--text-muted)', fontSize: 16, lineHeight: 1 }}>›</span>
    </div>
  );
}

// ─────────────── 主组件 ───────────────

export default function ExecutionMonitor() {
  const navigate = useNavigate();
  const [overview, setOverview] = useState<MonitorOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await monitorApi.getOverview();
      setOverview(data);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openRoute = useCallback((route: string) => {
    navigate(ROUTE_FALLBACK[route] || route);
  }, [navigate]);

  const p = overview?.pillars;

  return (
    <div style={pageStyle}>
      {/* ═══ 页头 ═══ */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>执行监控面板</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            采购 · 库存 · 订单 · 售后 四线聚合｜{overview ? `数据日期 ${overview.today}` : '—'}
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? '刷新中…' : '刷新'}
        </Button>
      </div>

      {error && (
        <div style={{ ...panelStyle, borderColor: 'var(--danger-500, #ef4444)', color: 'var(--danger-500, #ef4444)' }}>
          加载失败：{error}
        </div>
      )}

      {loading && !overview ? (
        <div style={emptyStyle}>加载中…</div>
      ) : (
        <>
          {/* ═══ 四线指标卡 ═══ */}
          <div style={statGridStyle}>
            <PillarCard
              title="采购供应链"
              accent={SOURCE_META.procurement.color}
              stats={[
                { label: '待审批', value: formatIntS(p?.procurement.pendingApproval), tone: (p?.procurement.pendingApproval || 0) > 0 ? 'warning' : 'default' },
                { label: '在途', value: formatIntS(p?.procurement.inProgress) },
                { label: '逾期未到货', value: formatIntS(p?.procurement.overdue), tone: (p?.procurement.overdue || 0) > 0 ? 'danger' : 'default' },
                { label: '在途金额', value: formatMoney(p?.procurement.openAmount || 0) },
              ]}
            />
            <PillarCard
              title="库存预警"
              accent={SOURCE_META.inventory.color}
              stats={[
                { label: '未处理预警', value: formatIntS(p?.inventory.openAlerts), tone: (p?.inventory.openAlerts || 0) > 0 ? 'warning' : 'default' },
                { label: '严重', value: formatIntS(p?.inventory.criticalAlerts), tone: (p?.inventory.criticalAlerts || 0) > 0 ? 'danger' : 'default' },
                { label: '建议补货量', value: formatIntS(p?.inventory.suggestedQty) },
                { label: '', value: '' },
              ]}
            />
            <PillarCard
              title="订单履约"
              accent={SOURCE_META.order.color}
              stats={[
                { label: '待发货', value: formatIntS(p?.orders.pendingShip), tone: (p?.orders.pendingShip || 0) > 0 ? 'warning' : 'default' },
                { label: '待收款', value: formatIntS(p?.orders.unpaid), tone: (p?.orders.unpaid || 0) > 0 ? 'warning' : 'default' },
                { label: '今日成交', value: formatIntS(p?.orders.todayCount) },
                { label: '今日金额', value: formatMoney(p?.orders.todayAmount || 0) },
              ]}
            />
            <PillarCard
              title="售后工单"
              accent={SOURCE_META.ticket.color}
              stats={[
                { label: '未关闭', value: formatIntS(p?.service.openTickets), tone: (p?.service.openTickets || 0) > 0 ? 'warning' : 'default' },
                { label: '高优', value: formatIntS(p?.service.urgentTickets), tone: (p?.service.urgentTickets || 0) > 0 ? 'danger' : 'default' },
                { label: '未响应', value: formatIntS(p?.service.noResponseTickets), tone: (p?.service.noResponseTickets || 0) > 0 ? 'danger' : 'default' },
                { label: '', value: '' },
              ]}
            />
          </div>

          {/* ═══ 今日要处理 ═══ */}
          <div style={panelStyle}>
            <div style={{ ...sectionTitleStyle, justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                今日要处理
                {overview && overview.todoSummary.total > 0 && (
                  <Badge variant="danger">{overview.todoSummary.total}</Badge>
                )}
              </span>
              {overview && overview.todoSummary.total > 0 && (
                <span style={{ display: 'flex', gap: 6 }}>
                  {overview.todoSummary.overdue > 0 && <Badge variant="danger">逾期 {overview.todoSummary.overdue}</Badge>}
                  {overview.todoSummary.high > 0 && <Badge variant="warning">紧急 {overview.todoSummary.high}</Badge>}
                </span>
              )}
            </div>

            {!overview || overview.todo.length === 0 ? (
              <div style={emptyStyle}>当前没有需要处理的紧急事项，节奏正常 ✅</div>
            ) : (
              <div style={{ margin: '0 -14px -14px', overflowX: 'auto' }}>
                {overview.todo.map((t) => (
                  <TodoRow key={t.id} item={t} onOpen={openRoute} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function formatIntS(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '0';
  return new Intl.NumberFormat('zh-CN').format(Math.round(n));
}
