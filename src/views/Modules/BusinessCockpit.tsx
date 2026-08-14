/**
 * Vorzai 业务驾驶舱（Business Cockpit）
 *
 * COO / CEO 一屏看全局：
 *   1. 顶部 5 张 KPI 卡（今日 GMV / 本月毛利 / 活跃订单 / 待处理客诉 / 库存预警 SKU）
 *   2. 业务链漏斗 5 段（立项 → 选品 → 组盘 → 订单 → 客服）
 *   3. Top 5 异常监控（滞销 SKU / 退款率 / 投诉类别 / 离职风险 / 库存告急）
 *   4. 业务线 4 切片（直播 / 跨境 / 传统 / 新媒体）
 *
 * 数据全部来自 api.cockpit.getOverview() — 严禁硬编码常量。
 * 所有现有模块（business / hr / ogsm / chat …）完全不受影响。
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@api/client';
import { Card } from '@components/Common/Card';
import { Badge } from '@components/Common/Badge';
import { Button } from '@components/Common/Button';

// ─────────────── 严格类型 ───────────────
interface KpiCards {
  todayGmv: number;
  todayOrderCount: number;
  monthlyGrossProfit: number;
  monthlyRevenue: number;
  monthlyCost: number;
  activeOrderCount: number;
  openTicketCount: number;
  lowStockSkuCount: number;
}
interface FunnelStage { id: string; label: string; count: number; conversionRate: number }
interface AbnormalItem { id: string; name: string; value: number; meta?: string; href?: string }
interface TopAbnormalGroup {
  id: string; label: string; empty?: boolean; reason?: string; items: AbnormalItem[];
}
interface BizLineSlice {
  id: string; label: string; gmv: number;
  orderCount: number; paidOrderCount: number; conversionRate: number; platformValue: string;
}
interface CockpitOverview {
  generatedAt: string;
  kpi: KpiCards;
  funnel: FunnelStage[];
  topAbnormal: TopAbnormalGroup[];
  bizLines: BizLineSlice[];
}

// ─────────────── 通用样式 ───────────────

const pageStyle: React.CSSProperties = {
  padding: 20, display: 'flex', flexDirection: 'column', gap: 16,
  background: 'var(--bg-app, var(--bg-card-hover, #f5f6fa))',
  minHeight: '100%',
};
const sectionTitleStyle: React.CSSProperties = {
  fontSize: 14, fontWeight: 600, color: 'var(--text-primary)',
  display: 'flex', alignItems: 'center', gap: 8,
};
const kpiGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 12,
};
const funnelRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(5, 1fr)',
  gap: 10, alignItems: 'stretch',
};
const bizGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 12,
};
const abnormalGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: 12,
};

// 业务线配色（不偏离主题，遵循 var(--xxx) 主色系）
const BIZ_LINE_COLOR: Record<string, string> = {
  live:  '#dc2626', // 直播 红
  cross: '#2563eb', // 跨境 蓝
  trad:  '#16a34a', // 传统 绿
  media: '#7c3aed', // 新媒体 紫
};

// ─────────────── 工具函数 ───────────────

function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return '¥0';
  const abs = Math.abs(n);
  if (abs >= 1_0000_0000) return `¥${(n / 1_0000_0000).toFixed(2)}亿`;
  if (abs >= 1_0000) return `¥${(n / 1_0000).toFixed(2)}万`;
  return `¥${n.toFixed(2)}`;
}
function formatPct(n: number): string {
  if (!Number.isFinite(n)) return '0%';
  return `${(n * 100).toFixed(1)}%`;
}
function formatInt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return new Intl.NumberFormat('zh-CN').format(Math.round(n));
}
function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', { hour12: false });
  } catch { return iso; }
}

// ─────────────── 子组件 ───────────────

function KpiCard({
  label, value, suffix, sub, tone, icon,
}: {
  label: string;
  value: string;
  suffix?: string;
  sub?: string;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  icon?: string;
}) {
  const colorMap: Record<string, string> = {
    default: 'var(--text-primary)',
    success: 'var(--success-500, #22c55e)',
    warning: 'var(--warning-500, #f59e0b)',
    danger:  'var(--danger-500, #ef4444)',
    info:    'var(--text-link, #4f46e5)',
  };
  return (
    <Card hoverable>
      <div style={{
        padding: 14, display: 'flex', flexDirection: 'column', gap: 6,
        background: 'var(--bg-card)', border: '1px solid var(--border-card)',
        borderRadius: 'var(--radius-card)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          fontSize: 12, color: 'var(--text-muted)',
        }}>
          <span>{label}</span>
          {icon && <span aria-hidden style={{ fontSize: 14 }}>{icon}</span>}
        </div>
        <div style={{
          fontSize: 22, fontWeight: 700, color: colorMap[tone || 'default'] || colorMap.default,
          fontVariantNumeric: 'tabular-nums', lineHeight: 1.2,
        }}>
          {value}{suffix && <span style={{ fontSize: 12, fontWeight: 500, marginLeft: 4, color: 'var(--text-muted)' }}>{suffix}</span>}
        </div>
        {sub && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sub}</div>
        )}
      </div>
    </Card>
  );
}

function FunnelBlock({
  stage, maxCount, isLast, prevCount,
}: {
  stage: FunnelStage; maxCount: number; isLast: boolean; prevCount: number;
}) {
  const ratio = maxCount > 0 ? stage.count / maxCount : 0;
  // 漏斗条形高度：按比例
  const heightPx = Math.max(38, Math.min(160, Math.round(40 + ratio * 120)));
  const isFirst = stage.id === 'project';
  return (
    <div style={{
      position: 'relative',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 8,
    }}>
      <div style={{
        fontSize: 12, color: 'var(--text-muted)', fontWeight: 500,
      }}>{stage.label}</div>
      <div
        title={`${stage.label}: ${stage.count}`}
        style={{
          width: '78%',
          height: heightPx,
          background: 'linear-gradient(180deg, rgba(79,70,229,0.85), rgba(139,92,246,0.65))',
          borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontWeight: 700, fontSize: 18,
          fontVariantNumeric: 'tabular-nums',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        }}
      >
        {formatInt(stage.count)}
      </div>
      <div style={{
        fontSize: 11, color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.4,
      }}>
        {isFirst ? (
          <Badge variant="info">起点</Badge>
        ) : (
          <>
            <div>转化率</div>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
              {formatPct(stage.conversionRate)}
            </div>
          </>
        )}
      </div>
      {!isLast && (
        <div aria-hidden style={{
          position: 'absolute', right: -10, top: 36,
          color: 'var(--text-muted)', fontSize: 16, zIndex: 1,
        }}>›</div>
      )}
    </div>
  );
}

function AbnormalCard({
  group, onDrill,
}: {
  group: TopAbnormalGroup;
  onDrill: (href?: string) => void;
}) {
  return (
    <Card>
      <div style={{
        padding: 14, background: 'var(--bg-card)',
        border: '1px solid var(--border-card)', borderRadius: 'var(--radius-card)',
        display: 'flex', flexDirection: 'column', gap: 8, minHeight: 200,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={sectionTitleStyle}>{group.label}</span>
          {group.empty
            ? <Badge variant="neutral">暂无</Badge>
            : <Badge variant="info">{group.items.length}</Badge>}
        </div>
        {group.empty ? (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', padding: 12,
          }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>∅</div>
            <div>{group.reason || '暂无相关数据'}</div>
          </div>
        ) : group.items.length === 0 ? (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted)', fontSize: 12,
          }}>
            暂无数据
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {group.items.map((it) => (
              <li
                key={`${group.id}-${it.id}`}
                onClick={() => it.href && onDrill(it.href)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '6px 8px', borderRadius: 6,
                  background: 'var(--bg-row-hover)', cursor: it.href ? 'pointer' : 'default',
                  fontSize: 12, gap: 8,
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                  <div style={{
                    color: 'var(--text-primary)', fontWeight: 500,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{it.name}</div>
                  {it.meta && (
                    <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{it.meta}</div>
                  )}
                </div>
                <div style={{
                  fontWeight: 700, color: 'var(--text-link, #4f46e5)',
                  fontVariantNumeric: 'tabular-nums', flexShrink: 0,
                }}>
                  {group.id === 'refund_rate' ? `${it.value.toFixed(1)}%` : formatInt(it.value)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function BizLineCard({ line, onDrill }: { line: BizLineSlice; onDrill: (path: string) => void }) {
  const color = BIZ_LINE_COLOR[line.id] || 'var(--text-primary)';
  const hasData = line.orderCount > 0;
  return (
    <Card hoverable onClick={() => onDrill(`/business-chain?phase=order`)}>
      <div style={{
        padding: 14, background: 'var(--bg-card)',
        border: '1px solid var(--border-card)', borderRadius: 'var(--radius-card)',
        display: 'flex', flexDirection: 'column', gap: 8,
        borderTop: `3px solid ${color}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            {line.label}
          </span>
          <Badge variant={hasData ? 'success' : 'neutral'}>
            {hasData ? '运营中' : '未启动'}
          </Badge>
        </div>
        <div style={{
          fontSize: 20, fontWeight: 700, color,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {formatMoney(line.gmv)}
        </div>
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
          gap: 6, fontSize: 11, color: 'var(--text-muted)',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span>订单数</span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
              {formatInt(line.orderCount)}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span>已支付</span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
              {formatInt(line.paidOrderCount)}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span>转化率</span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
              {formatPct(line.conversionRate)}
            </span>
          </div>
        </div>
        <div style={{
          fontSize: 10, color: 'var(--text-muted)',
          borderTop: '1px dashed var(--border-color)', paddingTop: 6,
        }} title="实际 orders.platform 聚合 key">
          platform: <code style={{ color: 'var(--text-secondary)' }}>{line.platformValue}</code>
        </div>
      </div>
    </Card>
  );
}

// ─────────────── 主组件 ───────────────

export default function BusinessCockpit() {
  const [data, setData] = useState<CockpitOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await api.cockpit.getOverview();
      if (res.success && res.data) {
        setData(res.data);
      } else {
        setError(res.error?.message || '加载失败');
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDrill = useCallback((href?: string) => {
    if (!href) return;
    // href 形如 "/business-chain?phase=order&..."
    const [path, search] = href.split('?');
    navigate({ pathname: path, search: search ? `?${search}` : '' });
  }, [navigate]);

  // 漏斗最大段用于归一化
  const maxFunnelCount = useMemo(
    () => Math.max(1, ...(data?.funnel.map((s) => s.count) || [1])),
    [data]
  );

  // 顶部 KPI 排序后的色阶
  const kpi = data?.kpi;

  return (
    <div style={pageStyle}>
      {/* ── 标题栏 ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 8,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <h1 style={{
            margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-primary)',
          }}>
            业务驾驶舱
          </h1>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            全局经营指标 · 一屏看全公司
            {data && (
              <span style={{ marginLeft: 8 }}>
                数据时间：{formatTime(data.generatedAt)}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
            {loading ? '加载中…' : '刷新'}
          </Button>
        </div>
      </div>

      {/* ── 错误态 ── */}
      {error && (
        <div style={{
          padding: 12, borderRadius: 8,
          background: 'var(--bg-row-hover)',
          border: '1px solid var(--danger-500, #ef4444)',
          color: 'var(--danger-500, #ef4444)', fontSize: 13,
        }}>
          {error}
          <Button variant="ghost" size="sm" onClick={load} style={{ marginLeft: 12 }}>
            重试
          </Button>
        </div>
      )}

      {/* ── 顶部 5 张 KPI 卡 ── */}
      <section>
        <div style={{ ...sectionTitleStyle, marginBottom: 10 }}>核心 KPI</div>
        <div style={kpiGridStyle}>
          <KpiCard
            label="今日 GMV"
            value={formatMoney(kpi?.todayGmv ?? 0)}
            sub={`今日订单 ${formatInt(kpi?.todayOrderCount ?? 0)} 单`}
            tone="info"
            icon="💰"
          />
          <KpiCard
            label="本月毛利"
            value={formatMoney(kpi?.monthlyGrossProfit ?? 0)}
            sub={`营收 ${formatMoney(kpi?.monthlyRevenue ?? 0)} − 成本 ${formatMoney(kpi?.monthlyCost ?? 0)}`}
            tone={(kpi?.monthlyGrossProfit ?? 0) >= 0 ? 'success' : 'danger'}
            icon="📈"
          />
          <KpiCard
            label="活跃订单"
            value={formatInt(kpi?.activeOrderCount ?? 0)}
            sub="待处理 / 确认 / 发货"
            tone="info"
            icon="🧾"
          />
          <KpiCard
            label="待处理客诉"
            value={formatInt(kpi?.openTicketCount ?? 0)}
            sub="status = open"
            tone={(kpi?.openTicketCount ?? 0) > 0 ? 'warning' : 'default'}
            icon="🎧"
          />
          <KpiCard
            label="库存预警 SKU"
            value={formatInt(kpi?.lowStockSkuCount ?? 0)}
            sub="stock < 10"
            tone={(kpi?.lowStockSkuCount ?? 0) > 0 ? 'warning' : 'default'}
            icon="📦"
          />
        </div>
      </section>

      {/* ── 业务链漏斗 5 段 ── */}
      <section>
        <div style={{ ...sectionTitleStyle, marginBottom: 10 }}>业务链漏斗</div>
        <Card>
          <div style={{
            padding: 16, background: 'var(--bg-card)',
            border: '1px solid var(--border-card)', borderRadius: 'var(--radius-card)',
          }}>
            {loading && !data ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
                加载中…
              </div>
            ) : (
              <div style={funnelRowStyle}>
                {(data?.funnel || []).map((s, idx, arr) => (
                  <FunnelBlock
                    key={s.id}
                    stage={s}
                    maxCount={maxFunnelCount}
                    isLast={idx === arr.length - 1}
                    prevCount={idx === 0 ? 0 : arr[idx - 1].count}
                  />
                ))}
              </div>
            )}
            <div style={{
              marginTop: 10, fontSize: 11, color: 'var(--text-muted)',
              display: 'flex', gap: 16, flexWrap: 'wrap',
            }}>
              <span>立项：status ∈ {`{planning, approved, in_progress, paused}`}</span>
              <span>选品：status ∈ {`{candidate, selected, listed}`}</span>
              <span>组盘：active</span>
              <span>订单：paid / partial</span>
              <span>客服：resolved / closed</span>
            </div>
          </div>
        </Card>
      </section>

      {/* ── Top 5 异常监控 ── */}
      <section>
        <div style={{
          ...sectionTitleStyle, marginBottom: 10,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>Top 5 异常监控</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            点击条目可下钻到业务链对应阶段
          </span>
        </div>
        <div style={abnormalGridStyle}>
          {(data?.topAbnormal || []).map((g) => (
            <AbnormalCard key={g.id} group={g} onDrill={handleDrill} />
          ))}
        </div>
      </section>

      {/* ── 业务线 4 切片 ── */}
      <section>
        <div style={{ ...sectionTitleStyle, marginBottom: 10 }}>业务线切片</div>
        <div style={bizGridStyle}>
          {(data?.bizLines || []).map((line) => (
            <BizLineCard key={line.id} line={line} onDrill={(p) => navigate(p)} />
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
          数据来源：orders.platform 字段聚合（产品表无 platform 字段，故采用订单维度）
        </div>
      </section>

      {/* ── 底部 — 数据来源说明 ── */}
      <Card>
        <div style={{
          padding: 12, fontSize: 11, color: 'var(--text-muted)',
          background: 'var(--bg-card)', border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-card)', lineHeight: 1.7,
        }}>
          <strong style={{ color: 'var(--text-secondary)' }}>数据口径说明：</strong>
          本月毛利 = 营收(revenue) − 成本(cost)；营收取本月已支付订单的 paid_amount，
          成本按订单 items[].quantity × products.cost_price 在应用层聚合。所有指标按 tenant_id 隔离。
        </div>
      </Card>
    </div>
  );
}
