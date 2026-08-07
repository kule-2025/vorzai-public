/**
 * Vorzai 直播电商工作台（Live Commerce）
 *
 * 五个工作区：
 *   1. 总览       本月场次 / 总 GMV / 平均 UV 价值 / 平均转化率 + Top 主播榜 + 近期场次
 *   2. 场次管理   列表筛选、新建/编辑、状态机流转
 *   3. 脚本工作台 分段脚本编辑、一键生成、合规检查（违规词高亮 + 修改建议）
 *   4. 选品排期   已选商品、讲解时间轴可视化、总时长超限警告
 *   5. 数据复盘   指标录入、时间序列折线（原生 SVG）、自动复盘报告
 *
 * 数据全部来自 /api/livestream，无任何 Mock 或硬编码业务数据。
 * ⚠ 指标为人工录入/批量导入，界面必须如实标注来源，不得包装成「实时数据」。
 */
import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { api } from '@api/client';
import { livestreamApi } from '@api/livestream';
import type {
  LiveSession, LiveSessionStatus, LiveScript, LiveSessionProduct, LiveMetric,
  LiveReview, LivestreamOverview, ScheduleTimeline, ComplianceReport, LiveSnapshot,
  SessionInput, MetricInput, DiagnosisItem, LiveSegmentType,
} from '@api/livestream';
import { Card } from '@components/Common/Card';
import { Badge } from '@components/Common/Badge';
import { Button } from '@components/Common/Button';

// ─────────────── 常量（UI 文案映射，非业务数据） ───────────────

const TABS = [
  { key: 'overview', label: '总览' },
  { key: 'sessions', label: '场次管理' },
  { key: 'scripts', label: '脚本工作台' },
  { key: 'products', label: '选品排期' },
  { key: 'review', label: '数据复盘' },
] as const;
type TabKey = typeof TABS[number]['key'];

const STATUS_LABEL: Record<LiveSessionStatus, string> = {
  planned: '已排期', ready: '待开播', living: '直播中',
  ended: '已下播', reviewed: '已复盘', cancelled: '已取消',
};

const STATUS_VARIANT: Record<LiveSessionStatus, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  planned: 'neutral', ready: 'info', living: 'danger',
  ended: 'warning', reviewed: 'success', cancelled: 'neutral',
};

/** 状态机允许的下一步（与服务端保持一致，仅用于按钮显示） */
const NEXT_STATUS: Record<LiveSessionStatus, LiveSessionStatus[]> = {
  planned: ['ready', 'cancelled'],
  ready: ['living', 'planned', 'cancelled'],
  living: ['ended'],
  ended: ['reviewed'],
  reviewed: [],
  cancelled: [],
};

const SEGMENT_LABEL: Record<LiveSegmentType, string> = {
  warmup: '暖场', sell: '讲品', interact: '互动',
  flashsale: '秒杀', lottery: '抽奖', closing: '收尾',
};

const SEGMENT_COLOR: Record<LiveSegmentType, string> = {
  warmup: '#0ea5e9', sell: '#4f46e5', interact: '#f59e0b',
  flashsale: '#dc2626', lottery: '#a855f7', closing: '#16a34a',
};

const PLATFORM_OPTIONS = [
  { value: 'douyin', label: '抖音' },
  { value: 'kuaishou', label: '快手' },
  { value: 'taobao', label: '淘宝直播' },
  { value: 'jd', label: '京东直播' },
  { value: 'xhs', label: '小红书' },
  { value: 'shipinhao', label: '视频号' },
];

const SEVERITY_LABEL: Record<string, string> = { high: '高危', medium: '中危', low: '注意' };
const SEVERITY_COLOR: Record<string, string> = {
  high: 'var(--danger-500, #ef4444)',
  medium: 'var(--warning-500, #f59e0b)',
  low: 'var(--text-muted)',
};

// ─────────────── 样式 ───────────────

const pageStyle: React.CSSProperties = {
  padding: 20, display: 'flex', flexDirection: 'column', gap: 16,
  background: 'var(--bg-app, var(--bg-card-hover, #f5f6fa))', minHeight: '100%',
};
const panelStyle: React.CSSProperties = {
  padding: 16, background: 'var(--bg-card)',
  border: '1px solid var(--border-card)', borderRadius: 'var(--radius-card)',
};
const sectionTitleStyle: React.CSSProperties = {
  fontSize: 14, fontWeight: 600, color: 'var(--text-primary)',
  display: 'flex', alignItems: 'center', gap: 8,
};
const kpiGridStyle: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12,
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 8px', fontSize: 12,
  background: 'var(--bg-card)', color: 'var(--text-primary)',
  border: '1px solid var(--border-card)', borderRadius: 6, outline: 'none',
};
const labelStyle: React.CSSProperties = {
  fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, display: 'block',
};
const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600,
  color: 'var(--text-muted)', borderBottom: '1px solid var(--border-card)', whiteSpace: 'nowrap',
};
const tdStyle: React.CSSProperties = {
  padding: '8px 10px', fontSize: 12, color: 'var(--text-primary)',
  borderBottom: '1px solid var(--border-card)', verticalAlign: 'middle',
};

// ─────────────── 工具函数 ───────────────

function formatMoney(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '¥0';
  const abs = Math.abs(v);
  if (abs >= 1_0000_0000) return `¥${(v / 1_0000_0000).toFixed(2)}亿`;
  if (abs >= 1_0000) return `¥${(v / 1_0000).toFixed(2)}万`;
  return `¥${v.toFixed(2)}`;
}
function formatPct(n: number | null | undefined): string {
  const v = Number(n);
  return Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '0%';
}
function formatInt(n: number | null | undefined): string {
  const v = Number(n);
  return Number.isFinite(v) ? new Intl.NumberFormat('zh-CN').format(Math.round(v)) : '0';
}
function shortTime(s: string | null | undefined): string {
  if (!s) return '—';
  return s.replace('T', ' ').slice(5, 16);
}
function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
/** 把 datetime-local 的值（YYYY-MM-DDTHH:mm）转成后端存储格式 */
function toDbTime(v: string): string | undefined {
  if (!v) return undefined;
  return `${v.replace('T', ' ')}:00`.slice(0, 19);
}
/** 反向：后端时间 → datetime-local */
function toInputTime(v: string | null): string {
  if (!v) return '';
  return v.replace(' ', 'T').slice(0, 16);
}

// ─────────────── 通用小组件 ───────────────

function KpiCard({ label, value, sub, tone, icon }: {
  label: string; value: string; sub?: string;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'info'; icon?: string;
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
      <div style={{ ...panelStyle, padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          fontSize: 12, color: 'var(--text-muted)',
        }}>
          <span>{label}</span>
          {icon && <span aria-hidden style={{ fontSize: 14 }}>{icon}</span>}
        </div>
        <div style={{
          fontSize: 22, fontWeight: 700, lineHeight: 1.2,
          color: colorMap[tone || 'default'], fontVariantNumeric: 'tabular-nums',
        }}>{value}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sub}</div>}
      </div>
    </Card>
  );
}

function ProgressBar({ rate, height = 6 }: { rate: number; height?: number }) {
  const pct = Math.max(0, Math.min(1, Number(rate) || 0));
  const color = pct >= 1
    ? 'var(--success-500, #22c55e)'
    : pct >= 0.6 ? 'var(--warning-500, #f59e0b)' : 'var(--danger-500, #ef4444)';
  return (
    <div style={{
      width: '100%', height, background: 'var(--bg-row-hover)',
      borderRadius: height, overflow: 'hidden',
    }}>
      <div style={{ width: `${pct * 100}%`, height: '100%', background: color, transition: 'width .3s' }} />
    </div>
  );
}

function EmptyState({ text, hint }: { text: string; hint?: string }) {
  return (
    <div style={{
      padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13,
      display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center',
    }}>
      <div style={{ fontSize: 26 }} aria-hidden>∅</div>
      <div>{text}</div>
      {hint && <div style={{ fontSize: 11 }}>{hint}</div>}
    </div>
  );
}

function ErrorBar({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div style={{
      padding: 12, borderRadius: 8, background: 'var(--bg-row-hover)',
      border: '1px solid var(--danger-500, #ef4444)',
      color: 'var(--danger-500, #ef4444)', fontSize: 13,
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <span style={{ flex: 1 }}>{message}</span>
      {onRetry && <Button variant="ghost" size="sm" onClick={onRetry}>重试</Button>}
    </div>
  );
}

function LoadingBlock({ text = '加载中…' }: { text?: string }) {
  return <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>{text}</div>;
}

/** 数据来源提示条 —— 明确告知用户这不是实时数据 */
function SourceNotice({ text }: { text: string }) {
  return (
    <div style={{
      padding: '8px 10px', fontSize: 11, lineHeight: 1.6,
      color: 'var(--text-secondary)', background: 'var(--bg-row-hover)',
      borderRadius: 6, border: '1px dashed var(--border-card)',
    }}>
      {text}
    </div>
  );
}

/** 把话术里命中的违禁词高亮成红色 */
function HighlightedText({ text, words }: { text: string; words: string[] }) {
  const nodes = useMemo(() => {
    if (!text) return [<span key="empty" style={{ color: 'var(--text-muted)' }}>（暂无话术内容）</span>];
    const uniq = Array.from(new Set(words.filter(Boolean))).sort((a, b) => b.length - a.length);
    if (uniq.length === 0) return [<span key="plain">{text}</span>];

    const out: React.ReactNode[] = [];
    let rest = text;
    let key = 0;
    while (rest.length > 0) {
      let hitIdx = -1;
      let hitWord = '';
      for (const w of uniq) {
        const i = rest.indexOf(w);
        if (i !== -1 && (hitIdx === -1 || i < hitIdx)) { hitIdx = i; hitWord = w; }
      }
      if (hitIdx === -1) { out.push(<span key={key++}>{rest}</span>); break; }
      if (hitIdx > 0) out.push(<span key={key++}>{rest.slice(0, hitIdx)}</span>);
      out.push(
        <mark key={key++} style={{
          background: 'rgba(239,68,68,0.18)', color: 'var(--danger-500, #ef4444)',
          fontWeight: 700, padding: '0 2px', borderRadius: 3,
        }}>{hitWord}</mark>
      );
      rest = rest.slice(hitIdx + hitWord.length);
    }
    return out;
  }, [text, words]);

  return (
    <div style={{
      whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.8,
      color: 'var(--text-primary)', fontFamily: 'inherit',
    }}>{nodes}</div>
  );
}

// ═══════════════════════════════════════════════════
// 主组件
// ═══════════════════════════════════════════════════

export default function LiveCommerce() {
  const [tab, setTab] = useState<TabKey>('overview');
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const notify = useCallback((type: 'ok' | 'err', text: string) => {
    setToast({ type, text });
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  // ── 全局：场次列表（多个 Tab 共用） ──
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [filters, setFilters] = useState<{ status: string; platform: string; anchorId: string; from: string; to: string }>(
    { status: '', platform: '', anchorId: '', from: '', to: '' }
  );
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true); setSessionsError(null);
    try {
      const res = await livestreamApi.listSessions({
        status: (filters.status || undefined) as LiveSessionStatus | undefined,
        platform: filters.platform || undefined,
        anchorId: filters.anchorId || undefined,
        from: filters.from ? `${filters.from} 00:00:00` : undefined,
        to: filters.to ? `${filters.to} 23:59:59` : undefined,
        page, limit: 20,
      });
      setSessions(res.data);
      setTotalPages(res.pagination.totalPages);
      setTotal(res.pagination.total);
      // 首次加载后自动选中第一场，避免其他 Tab 一片空白
      setSelectedSessionId((cur) => cur || (res.data[0]?.id ?? ''));
    } catch (e) {
      setSessionsError(errText(e));
    } finally {
      setSessionsLoading(false);
    }
  }, [filters, page]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  // ── 员工列表（主播下拉）──
  const [employees, setEmployees] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.hr.listEmployees({ limit: 200 });
        if (!alive) return;
        const list = Array.isArray(res?.data) ? res.data : [];
        setEmployees(list.map((e: Record<string, unknown>) => ({
          id: String(e.id), name: String(e.name || e.employee_no || e.id),
        })));
      } catch (e) {
        console.warn('[LiveCommerce] 加载员工列表失败:', e);
        if (alive) setEmployees([]);
      }
    })();
    return () => { alive = false; };
  }, []);

  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) || null,
    [sessions, selectedSessionId]
  );

  const jumpTo = useCallback((key: TabKey, sessionId?: string) => {
    if (sessionId) setSelectedSessionId(sessionId);
    setTab(key);
  }, []);

  return (
    <div style={pageStyle}>
      {/* ── 标题栏 ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
            直播电商工作台
          </h1>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            场次排期 · 脚本教练 · 选品时间轴 · 数据复盘
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={loadSessions} disabled={sessionsLoading}>
          {sessionsLoading ? '刷新中…' : '刷新'}
        </Button>
      </div>

      {/* ── 全局提示 ── */}
      {toast && (
        <div style={{
          padding: '10px 12px', borderRadius: 8, fontSize: 13,
          background: 'var(--bg-row-hover)',
          border: `1px solid ${toast.type === 'ok' ? 'var(--success-500, #22c55e)' : 'var(--danger-500, #ef4444)'}`,
          color: toast.type === 'ok' ? 'var(--success-500, #22c55e)' : 'var(--danger-500, #ef4444)',
        }}>{toast.text}</div>
      )}

      {/* ── Tab 栏（受控，便于跨 Tab 跳转） ── */}
      <div style={{
        display: 'flex', gap: 4, borderBottom: '1px solid var(--border-card)', flexWrap: 'wrap',
      }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '8px 16px', fontSize: 13, cursor: 'pointer',
              background: 'transparent', border: 'none',
              borderBottom: `2px solid ${tab === t.key ? 'var(--text-link, #4f46e5)' : 'transparent'}`,
              color: tab === t.key ? 'var(--text-link, #4f46e5)' : 'var(--text-secondary)',
              fontWeight: tab === t.key ? 600 : 400,
            }}
          >{t.label}</button>
        ))}
      </div>

      {/* ── Tab 内容 ── */}
      {tab === 'overview' && (
        <OverviewTab onOpenSession={(id) => jumpTo('sessions', id)} />
      )}

      {tab === 'sessions' && (
        <SessionsTab
          sessions={sessions}
          loading={sessionsLoading}
          error={sessionsError}
          filters={filters}
          setFilters={(f) => { setFilters(f); setPage(1); }}
          page={page}
          totalPages={totalPages}
          total={total}
          setPage={setPage}
          employees={employees}
          selectedSessionId={selectedSessionId}
          onSelect={setSelectedSessionId}
          onReload={loadSessions}
          notify={notify}
          onJump={jumpTo}
        />
      )}

      {tab === 'scripts' && (
        <ScriptsTab
          sessions={sessions}
          session={selectedSession}
          sessionId={selectedSessionId}
          onSelectSession={setSelectedSessionId}
          notify={notify}
        />
      )}

      {tab === 'products' && (
        <ProductsTab
          sessions={sessions}
          sessionId={selectedSessionId}
          onSelectSession={setSelectedSessionId}
          notify={notify}
        />
      )}

      {tab === 'review' && (
        <ReviewTab
          sessions={sessions}
          session={selectedSession}
          sessionId={selectedSessionId}
          onSelectSession={setSelectedSessionId}
          notify={notify}
          onReloadSessions={loadSessions}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
// Tab 1 · 总览
// ═══════════════════════════════════════════════════

function OverviewTab({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const [data, setData] = useState<LivestreamOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setData(await livestreamApi.getOverview());
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <Card><div style={panelStyle}><LoadingBlock /></div></Card>;
  if (error) return <ErrorBar message={error} onRetry={load} />;
  if (!data) return null;

  return (
    <Fragment>
      <div style={kpiGridStyle}>
        <KpiCard
          label={`本月场次（${data.month}）`}
          value={formatInt(data.sessionCount)}
          sub={data.livingCount > 0 ? `其中 ${data.livingCount} 场正在直播` : '当前无直播中场次'}
          tone={data.livingCount > 0 ? 'danger' : 'info'}
          icon="🎬"
        />
        <KpiCard
          label="本月总 GMV"
          value={formatMoney(data.totalGmv)}
          sub={`累计 ${formatInt(data.totalOrders)} 单`}
          tone="success"
          icon="💰"
        />
        <KpiCard
          label="平均 UV 价值"
          value={`¥${data.avgUvValue.toFixed(2)}`}
          sub={data.avgUvValue >= 3 ? '高于 3 元，流量承接良好' : data.avgUvValue >= 1 ? '1-3 元及格区间' : '低于 1 元，需优化选品或流量'}
          tone={data.avgUvValue >= 3 ? 'success' : data.avgUvValue >= 1 ? 'warning' : 'danger'}
          icon="📊"
        />
        <KpiCard
          label="平均转化率"
          value={formatPct(data.avgConversionRate)}
          sub="订单数 ÷ 累计观看人数"
          tone={data.avgConversionRate >= 0.05 ? 'success' : data.avgConversionRate >= 0.01 ? 'warning' : 'danger'}
          icon="🎯"
        />
      </div>

      <SourceNotice text="指标口径：UV 价值 = GMV ÷ 累计观看人数（UV）；转化率 = 订单数 ÷ UV。所有原始数据来自人工录入或批量导入，系统未接入直播平台实时接口。" />

      {/* Top 主播榜 */}
      <Card>
        <div style={panelStyle}>
          <div style={{ ...sectionTitleStyle, marginBottom: 12 }}>本月 Top 主播</div>
          {data.topAnchors.length === 0 ? (
            <EmptyState text="本月还没有已下播的场次" hint="完成「开播 → 下播」流程后，主播榜会自动生成" />
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>排名</th>
                  <th style={thStyle}>主播</th>
                  <th style={thStyle}>场次数</th>
                  <th style={thStyle}>累计 GMV</th>
                  <th style={thStyle}>平均评分</th>
                </tr>
              </thead>
              <tbody>
                {data.topAnchors.map((a, i) => (
                  <tr key={a.employeeId}>
                    <td style={tdStyle}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 20, height: 20, borderRadius: 4, fontSize: 11, fontWeight: 700,
                        background: i === 0 ? 'rgba(245,158,11,.18)' : 'var(--bg-row-hover)',
                        color: i === 0 ? 'var(--warning-500, #f59e0b)' : 'var(--text-muted)',
                      }}>{i + 1}</span>
                    </td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{a.name}</td>
                    <td style={tdStyle}>{formatInt(a.sessionCount)}</td>
                    <td style={{ ...tdStyle, fontVariantNumeric: 'tabular-nums' }}>{formatMoney(a.gmv)}</td>
                    <td style={tdStyle}>
                      {a.avgScore > 0
                        ? <Badge variant={a.avgScore >= 85 ? 'success' : a.avgScore >= 60 ? 'info' : 'warning'}>
                            {a.avgScore.toFixed(1)} 分
                          </Badge>
                        : <span style={{ color: 'var(--text-muted)' }}>未复盘</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {/* 近期场次 */}
      <Card>
        <div style={panelStyle}>
          <div style={{ ...sectionTitleStyle, marginBottom: 12 }}>近期场次</div>
          {data.recentSessions.length === 0 ? (
            <EmptyState text="还没有任何直播场次" hint="到「场次管理」新建第一场直播" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {data.recentSessions.map((s) => (
                <div
                  key={s.id}
                  onClick={() => onOpenSession(s.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px',
                    borderRadius: 6, background: 'var(--bg-row-hover)', cursor: 'pointer',
                  }}
                >
                  <Badge variant={STATUS_VARIANT[s.status]}>{STATUS_LABEL[s.status]}</Badge>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{s.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {s.anchorName || '未指定主播'} · {shortTime(s.plannedStart)}
                    </div>
                  </div>
                  <div style={{ minWidth: 130, textAlign: 'right' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                      {formatMoney(s.actualGmv)}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      目标 {formatMoney(s.targetGmv)} · 达成 {formatPct(s.gmvAchievementRate)}
                    </div>
                  </div>
                  <div style={{ width: 90 }}><ProgressBar rate={s.gmvAchievementRate} /></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </Fragment>
  );
}

// ═══════════════════════════════════════════════════
// Tab 2 · 场次管理
// ═══════════════════════════════════════════════════

function SessionsTab(props: {
  sessions: LiveSession[];
  loading: boolean;
  error: string | null;
  filters: { status: string; platform: string; anchorId: string; from: string; to: string };
  setFilters: (f: { status: string; platform: string; anchorId: string; from: string; to: string }) => void;
  page: number; totalPages: number; total: number; setPage: (p: number) => void;
  employees: Array<{ id: string; name: string }>;
  selectedSessionId: string;
  onSelect: (id: string) => void;
  onReload: () => void;
  notify: (t: 'ok' | 'err', s: string) => void;
  onJump: (key: TabKey, sessionId?: string) => void;
}) {
  const {
    sessions, loading, error, filters, setFilters, page, totalPages, total, setPage,
    employees, selectedSessionId, onSelect, onReload, notify, onJump,
  } = props;

  const [editing, setEditing] = useState<LiveSession | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string>('');

  const handleAdvance = useCallback(async (s: LiveSession, to: LiveSessionStatus) => {
    setBusyId(s.id);
    try {
      await livestreamApi.advanceStatus(s.id, to);
      notify('ok', `「${s.title}」已流转为「${STATUS_LABEL[to]}」`);
      onReload();
    } catch (e) {
      notify('err', errText(e));
    } finally {
      setBusyId('');
    }
  }, [notify, onReload]);

  const handleDelete = useCallback(async (s: LiveSession) => {
    setBusyId(s.id);
    try {
      await livestreamApi.deleteSession(s.id);
      notify('ok', `场次「${s.title}」已删除`);
      onReload();
    } catch (e) {
      notify('err', errText(e));
    } finally {
      setBusyId('');
    }
  }, [notify, onReload]);

  return (
    <Fragment>
      {/* 筛选栏 */}
      <Card>
        <div style={{ ...panelStyle, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ minWidth: 110 }}>
            <label style={labelStyle}>状态</label>
            <select
              style={inputStyle}
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            >
              <option value="">全部</option>
              {(Object.keys(STATUS_LABEL) as LiveSessionStatus[]).map((k) => (
                <option key={k} value={k}>{STATUS_LABEL[k]}</option>
              ))}
            </select>
          </div>
          <div style={{ minWidth: 110 }}>
            <label style={labelStyle}>平台</label>
            <select
              style={inputStyle}
              value={filters.platform}
              onChange={(e) => setFilters({ ...filters, platform: e.target.value })}
            >
              <option value="">全部</option>
              {PLATFORM_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 130 }}>
            <label style={labelStyle}>主播</label>
            <select
              style={inputStyle}
              value={filters.anchorId}
              onChange={(e) => setFilters({ ...filters, anchorId: e.target.value })}
            >
              <option value="">全部</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>开始日期</label>
            <input type="date" style={inputStyle} value={filters.from}
              onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
          </div>
          <div>
            <label style={labelStyle}>结束日期</label>
            <input type="date" style={inputStyle} value={filters.to}
              onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
          </div>
          <Button variant="ghost" size="sm"
            onClick={() => setFilters({ status: '', platform: '', anchorId: '', from: '', to: '' })}>
            重置
          </Button>
          <div style={{ flex: 1 }} />
          <Button variant="primary" size="sm" onClick={() => { setCreating(true); setEditing(null); }}>
            新建场次
          </Button>
        </div>
      </Card>

      {/* 新建 / 编辑表单 */}
      {(creating || editing) && (
        <SessionForm
          session={editing}
          employees={employees}
          onCancel={() => { setCreating(false); setEditing(null); }}
          onSaved={(s) => {
            setCreating(false); setEditing(null);
            notify('ok', `场次「${s.title}」已保存`);
            onReload();
          }}
          onError={(m) => notify('err', m)}
        />
      )}

      {error && <ErrorBar message={error} onRetry={onReload} />}

      {/* 列表 */}
      <Card>
        <div style={panelStyle}>
          <div style={{ ...sectionTitleStyle, marginBottom: 12, justifyContent: 'space-between' }}>
            <span>场次列表</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>共 {total} 场</span>
          </div>

          {loading && sessions.length === 0 ? <LoadingBlock /> : sessions.length === 0 ? (
            <EmptyState text="没有符合条件的直播场次" hint="调整筛选条件，或点击右上角「新建场次」" />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
                <thead>
                  <tr>
                    <th style={thStyle}>状态</th>
                    <th style={thStyle}>场次标题</th>
                    <th style={thStyle}>主播 / 助播</th>
                    <th style={thStyle}>计划时间</th>
                    <th style={thStyle}>GMV（实际 / 目标）</th>
                    <th style={thStyle}>达成率</th>
                    <th style={thStyle}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id} style={{
                      background: s.id === selectedSessionId ? 'var(--bg-row-hover)' : 'transparent',
                    }}>
                      <td style={tdStyle}><Badge variant={STATUS_VARIANT[s.status]}>{STATUS_LABEL[s.status]}</Badge></td>
                      <td style={tdStyle}>
                        <div
                          onClick={() => onSelect(s.id)}
                          style={{ fontWeight: 600, cursor: 'pointer', color: 'var(--text-link, #4f46e5)' }}
                        >{s.title}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                          {PLATFORM_OPTIONS.find((p) => p.value === s.platform)?.label || s.platform}
                          {s.roomId ? ` · 房间号 ${s.roomId}` : ''}
                        </div>
                      </td>
                      <td style={tdStyle}>
                        <div>{s.anchorName || '—'}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{s.assistantName || '无助播'}</div>
                      </td>
                      <td style={tdStyle}>
                        <div>{shortTime(s.plannedStart)}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                          {s.durationMinutes > 0 ? `实播 ${s.durationMinutes} 分钟` : `至 ${shortTime(s.plannedEnd)}`}
                        </div>
                      </td>
                      <td style={{ ...tdStyle, fontVariantNumeric: 'tabular-nums' }}>
                        <div style={{ fontWeight: 700 }}>{formatMoney(s.actualGmv)}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>目标 {formatMoney(s.targetGmv)}</div>
                      </td>
                      <td style={{ ...tdStyle, minWidth: 110 }}>
                        <div style={{ fontSize: 11, marginBottom: 3 }}>{formatPct(s.gmvAchievementRate)}</div>
                        <ProgressBar rate={s.gmvAchievementRate} />
                      </td>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {NEXT_STATUS[s.status].map((to) => (
                            <Button
                              key={to}
                              size="sm"
                              variant={to === 'cancelled' ? 'ghost' : 'secondary'}
                              disabled={busyId === s.id}
                              onClick={() => handleAdvance(s, to)}
                            >{STATUS_LABEL[to]}</Button>
                          ))}
                          <Button size="sm" variant="ghost" onClick={() => { setEditing(s); setCreating(false); }}>编辑</Button>
                          <Button size="sm" variant="ghost" onClick={() => onJump('scripts', s.id)}>脚本</Button>
                          <Button size="sm" variant="ghost" onClick={() => onJump('products', s.id)}>选品</Button>
                          <Button size="sm" variant="danger" disabled={busyId === s.id} onClick={() => handleDelete(s)}>删除</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {totalPages > 1 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: 12 }}>
              <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{page} / {totalPages}</span>
              <Button size="sm" variant="ghost" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>下一页</Button>
            </div>
          )}
        </div>
      </Card>
    </Fragment>
  );
}

/** 场次新建/编辑表单 */
function SessionForm({ session, employees, onCancel, onSaved, onError }: {
  session: LiveSession | null;
  employees: Array<{ id: string; name: string }>;
  onCancel: () => void;
  onSaved: (s: LiveSession) => void;
  onError: (msg: string) => void;
}) {
  const [form, setForm] = useState({
    title: session?.title || '',
    platform: session?.platform || 'douyin',
    roomId: session?.roomId || '',
    anchorEmployeeId: session?.anchorEmployeeId || '',
    assistantEmployeeId: session?.assistantEmployeeId || '',
    plannedStart: toInputTime(session?.plannedStart ?? null),
    plannedEnd: toInputTime(session?.plannedEnd ?? null),
    targetGmv: session?.targetGmv ? String(session.targetGmv) : '',
    targetOrders: session?.targetOrders ? String(session.targetOrders) : '',
    remark: session?.remark || '',
  });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!form.title.trim()) { onError('请填写场次标题'); return; }
    setSaving(true);
    try {
      const payload: SessionInput = {
        title: form.title.trim(),
        platform: form.platform,
        roomId: form.roomId || undefined,
        anchorEmployeeId: form.anchorEmployeeId || undefined,
        assistantEmployeeId: form.assistantEmployeeId || undefined,
        plannedStart: toDbTime(form.plannedStart),
        plannedEnd: toDbTime(form.plannedEnd),
        targetGmv: form.targetGmv ? Number(form.targetGmv) : undefined,
        targetOrders: form.targetOrders ? Number(form.targetOrders) : undefined,
        remark: form.remark || undefined,
      };
      const saved = session
        ? await livestreamApi.updateSession(session.id, payload)
        : await livestreamApi.createSession(payload);
      onSaved(saved);
    } catch (e) {
      onError(errText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <div style={panelStyle}>
        <div style={{ ...sectionTitleStyle, marginBottom: 12 }}>
          {session ? `编辑场次 · ${session.title}` : '新建直播场次'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <div>
            <label style={labelStyle}>场次标题 *</label>
            <input style={inputStyle} value={form.title} placeholder="例：周三晚间家居专场"
              onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div>
            <label style={labelStyle}>直播平台</label>
            <select style={inputStyle} value={form.platform}
              onChange={(e) => setForm({ ...form, platform: e.target.value })}>
              {PLATFORM_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>直播间房间号</label>
            <input style={inputStyle} value={form.roomId} placeholder="选填"
              onChange={(e) => setForm({ ...form, roomId: e.target.value })} />
          </div>
          <div>
            <label style={labelStyle}>主播</label>
            <select style={inputStyle} value={form.anchorEmployeeId}
              onChange={(e) => setForm({ ...form, anchorEmployeeId: e.target.value })}>
              <option value="">未指定</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>助播</label>
            <select style={inputStyle} value={form.assistantEmployeeId}
              onChange={(e) => setForm({ ...form, assistantEmployeeId: e.target.value })}>
              <option value="">未指定</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>计划开播时间</label>
            <input type="datetime-local" style={inputStyle} value={form.plannedStart}
              onChange={(e) => setForm({ ...form, plannedStart: e.target.value })} />
          </div>
          <div>
            <label style={labelStyle}>计划结束时间</label>
            <input type="datetime-local" style={inputStyle} value={form.plannedEnd}
              onChange={(e) => setForm({ ...form, plannedEnd: e.target.value })} />
          </div>
          <div>
            <label style={labelStyle}>目标 GMV（元）</label>
            <input type="number" min={0} style={inputStyle} value={form.targetGmv} placeholder="0"
              onChange={(e) => setForm({ ...form, targetGmv: e.target.value })} />
          </div>
          <div>
            <label style={labelStyle}>目标订单数</label>
            <input type="number" min={0} style={inputStyle} value={form.targetOrders} placeholder="0"
              onChange={(e) => setForm({ ...form, targetOrders: e.target.value })} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>备注</label>
            <input style={inputStyle} value={form.remark} placeholder="选填，例如本场主题、投流预算"
              onChange={(e) => setForm({ ...form, remark: e.target.value })} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
          <Button variant="ghost" size="sm" onClick={onCancel}>取消</Button>
          <Button variant="primary" size="sm" onClick={submit} loading={saving}>
            {session ? '保存修改' : '创建场次'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** 场次选择器（脚本 / 选品 / 复盘 三个 Tab 共用） */
function SessionPicker({ sessions, value, onChange }: {
  sessions: LiveSession[]; value: string; onChange: (id: string) => void;
}) {
  return (
    <Card>
      <div style={{ ...panelStyle, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>当前场次</span>
        <select
          style={{ ...inputStyle, width: 'auto', minWidth: 260, flex: '0 1 360px' }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">请选择一个场次</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              [{STATUS_LABEL[s.status]}] {s.title} · {shortTime(s.plannedStart)}
            </option>
          ))}
        </select>
        {sessions.length === 0 && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            还没有场次，请先到「场次管理」创建
          </span>
        )}
      </div>
    </Card>
  );
}

// ═══════════════════════════════════════════════════
// Tab 3 · 脚本工作台
// ═══════════════════════════════════════════════════

function ScriptsTab({ sessions, session, sessionId, onSelectSession, notify }: {
  sessions: LiveSession[];
  session: LiveSession | null;
  sessionId: string;
  onSelectSession: (id: string) => void;
  notify: (t: 'ok' | 'err', s: string) => void;
}) {
  const [scripts, setScripts] = useState<LiveScript[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [generating, setGenerating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [tone, setTone] = useState<'professional' | 'warm' | 'energetic'>('professional');
  const [expandedId, setExpandedId] = useState<string>('');

  const load = useCallback(async () => {
    if (!sessionId) { setScripts([]); setReport(null); return; }
    setLoading(true); setError(null);
    try {
      setScripts(await livestreamApi.listScripts(sessionId));
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { setReport(null); load(); }, [load]);

  const handleGenerate = async () => {
    if (!sessionId) return;
    setGenerating(true);
    try {
      const list = await livestreamApi.generateScript(sessionId, { tone, overwrite: true });
      setScripts(list);
      setReport(null);
      notify('ok', `已生成 ${list.length} 段脚本，请逐段核对话术后再开播`);
    } catch (e) {
      notify('err', errText(e));
    } finally {
      setGenerating(false);
    }
  };

  const handleCheck = async () => {
    if (!sessionId) return;
    setChecking(true);
    try {
      const r = await livestreamApi.checkCompliance(sessionId);
      setReport(r);
      await load();
      notify(r.passed ? 'ok' : 'err',
        r.passed
          ? `合规检查通过，扫描 ${r.scannedSegments} 段脚本，未发现高危表述`
          : `发现 ${r.highCount} 处高危违禁表述，开播前必须整改`);
    } catch (e) {
      notify('err', errText(e));
    } finally {
      setChecking(false);
    }
  };

  const totalMinutes = useMemo(
    () => scripts.reduce((s, x) => s + (x.durationMinutes || 0), 0),
    [scripts]
  );

  const flaggedWords = useMemo(() => {
    const set = new Set<string>();
    for (const s of scripts) for (const f of s.complianceFlags || []) set.add(f.word);
    if (report) for (const i of report.issues) set.add(i.word);
    return Array.from(set);
  }, [scripts, report]);

  return (
    <Fragment>
      <SessionPicker sessions={sessions} value={sessionId} onChange={onSelectSession} />

      {!sessionId ? (
        <Card><div style={panelStyle}><EmptyState text="请先选择一个直播场次" /></div></Card>
      ) : (
        <Fragment>
          <Card>
            <div style={{ ...panelStyle, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {session?.title || '脚本工作台'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  共 {scripts.length} 段 · 合计 {totalMinutes} 分钟
                  {session?.plannedStart && session?.plannedEnd ? ' · 计划时长以场次排期为准' : ''}
                </div>
              </div>
              <div>
                <label style={labelStyle}>话术口吻</label>
                <select style={{ ...inputStyle, width: 120 }} value={tone}
                  onChange={(e) => setTone(e.target.value as typeof tone)}>
                  <option value="professional">专业理性</option>
                  <option value="warm">亲和邻家</option>
                  <option value="energetic">高能带节奏</option>
                </select>
              </div>
              <Button variant="primary" size="sm" loading={generating} onClick={handleGenerate}>
                一键生成脚本
              </Button>
              <Button variant="secondary" size="sm" loading={checking} onClick={handleCheck}>
                合规检查
              </Button>
            </div>
          </Card>

          <SourceNotice text="脚本由系统按「暖场 → 秒杀引流 → 讲品循环 → 互动抽奖 → 收尾」的节奏模型生成，话术为通用模板，务必结合真实商品参数逐段修改后再上播。合规检查只做文本命中提示，不替代法务审核。" />

          {report && <ComplianceReportPanel report={report} />}

          {error && <ErrorBar message={error} onRetry={load} />}

          {loading ? (
            <Card><div style={panelStyle}><LoadingBlock /></div></Card>
          ) : scripts.length === 0 ? (
            <Card>
              <div style={panelStyle}>
                <EmptyState
                  text="该场次还没有脚本"
                  hint="先到「选品排期」加入商品，再点「一键生成脚本」"
                />
              </div>
            </Card>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {scripts.map((s) => (
                <ScriptCard
                  key={s.id}
                  script={s}
                  flaggedWords={flaggedWords}
                  expanded={expandedId === s.id}
                  onToggle={() => setExpandedId(expandedId === s.id ? '' : s.id)}
                  onSaved={() => { load(); notify('ok', '话术已保存'); }}
                  onError={(m) => notify('err', m)}
                  onDeleted={() => { load(); notify('ok', '分段已删除'); }}
                />
              ))}
            </div>
          )}
        </Fragment>
      )}
    </Fragment>
  );
}

function ComplianceReportPanel({ report }: { report: ComplianceReport }) {
  return (
    <Card>
      <div style={{
        ...panelStyle,
        borderLeft: `3px solid ${report.passed ? 'var(--success-500, #22c55e)' : 'var(--danger-500, #ef4444)'}`,
      }}>
        <div style={{ ...sectionTitleStyle, marginBottom: 10, justifyContent: 'space-between' }}>
          <span>合规检查结果</span>
          <Badge variant={report.passed ? 'success' : 'danger'}>
            {report.passed ? '通过' : `${report.highCount} 处高危`}
          </Badge>
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
          <span>扫描分段：{report.scannedSegments}</span>
          <span>问题总数：{report.totalIssues}</span>
          <span style={{ color: SEVERITY_COLOR.high }}>高危 {report.highCount}</span>
          <span style={{ color: SEVERITY_COLOR.medium }}>中危 {report.mediumCount}</span>
          <span style={{ color: SEVERITY_COLOR.low }}>注意 {report.lowCount}</span>
        </div>

        {report.byCategory.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {report.byCategory.map((c) => (
              <Badge key={c.category} variant="warning">{c.category} × {c.count}</Badge>
            ))}
          </div>
        )}

        {report.issues.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--success-500, #22c55e)' }}>
            未发现违禁表述。仍建议开播前由运营复核一遍商品资质与宣传口径。
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto' }}>
            {report.issues.map((i, idx) => (
              <div key={`${i.scriptId}-${i.word}-${idx}`} style={{
                padding: 10, borderRadius: 6, background: 'var(--bg-row-hover)',
                borderLeft: `3px solid ${SEVERITY_COLOR[i.severity]}`,
              }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    第 {i.segmentNo} 段 · {i.segmentTitle}
                  </span>
                  <span style={{
                    fontSize: 10, padding: '1px 6px', borderRadius: 3,
                    background: SEVERITY_COLOR[i.severity], color: '#fff',
                  }}>{SEVERITY_LABEL[i.severity]}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{i.category}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    {i.field === 'cta_text' ? '行动号召' : '话术正文'}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-primary)', marginBottom: 4 }}>
                  命中：<strong style={{ color: 'var(--danger-500, #ef4444)' }}>{i.word}</strong>
                  <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>…{i.context}…</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  修改建议：{i.suggestion}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function ScriptCard({ script, flaggedWords, expanded, onToggle, onSaved, onError, onDeleted }: {
  script: LiveScript;
  flaggedWords: string[];
  expanded: boolean;
  onToggle: () => void;
  onSaved: () => void;
  onError: (m: string) => void;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [talk, setTalk] = useState(script.talkTrack);
  const [cta, setCta] = useState(script.ctaText);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setTalk(script.talkTrack); setCta(script.ctaText); }, [script.talkTrack, script.ctaText]);

  const color = SEGMENT_COLOR[script.segmentType] || 'var(--text-link, #4f46e5)';
  const flagCount = (script.complianceFlags || []).length;

  const save = async () => {
    setSaving(true);
    try {
      await livestreamApi.updateScript(script.id, { talkTrack: talk, ctaText: cta });
      setEditing(false);
      onSaved();
    } catch (e) {
      onError(errText(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await livestreamApi.deleteScript(script.id);
      onDeleted();
    } catch (e) {
      onError(errText(e));
    }
  };

  return (
    <Card>
      <div style={{ ...panelStyle, borderLeft: `3px solid ${color}`, padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 11, fontWeight: 700, color: '#fff', background: color,
            padding: '2px 8px', borderRadius: 4,
          }}>{SEGMENT_LABEL[script.segmentType]}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>第 {script.segmentNo} 段</span>
          <span
            onClick={onToggle}
            style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', cursor: 'pointer', flex: 1, minWidth: 120 }}
          >{script.title}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{script.durationMinutes} 分钟</span>
          {flagCount > 0 && <Badge variant="danger">{flagCount} 处待整改</Badge>}
          <Button size="sm" variant="ghost" onClick={onToggle}>{expanded ? '收起' : '展开'}</Button>
        </div>

        {expanded && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* 话术 */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>话术正文</span>
                {!editing && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>编辑</Button>}
              </div>
              {editing ? (
                <textarea
                  style={{ ...inputStyle, minHeight: 260, lineHeight: 1.7, resize: 'vertical', fontFamily: 'inherit' }}
                  value={talk}
                  onChange={(e) => setTalk(e.target.value)}
                />
              ) : (
                <div style={{
                  padding: 10, borderRadius: 6, background: 'var(--bg-row-hover)',
                  maxHeight: 420, overflowY: 'auto',
                }}>
                  <HighlightedText text={talk} words={flaggedWords} />
                </div>
              )}
            </div>

            {/* CTA */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                行动号召（CTA）
              </div>
              {editing ? (
                <textarea
                  style={{ ...inputStyle, minHeight: 60, resize: 'vertical', fontFamily: 'inherit' }}
                  value={cta}
                  onChange={(e) => setCta(e.target.value)}
                />
              ) : (
                <div style={{ padding: 10, borderRadius: 6, background: 'var(--bg-row-hover)' }}>
                  <HighlightedText text={cta} words={flaggedWords} />
                </div>
              )}
            </div>

            {/* 卖点 */}
            {script.sellingPoints.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>核心卖点</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.9 }}>
                  {script.sellingPoints.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              </div>
            )}

            {/* 异议应对 */}
            {script.objectionHandling.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>异议应对</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {script.objectionHandling.map((o, i) => (
                    <div key={i} style={{ padding: 10, borderRadius: 6, background: 'var(--bg-row-hover)' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--warning-500, #f59e0b)', marginBottom: 4 }}>
                        Q：{o.objection}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                        A：{o.response}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 合规标记 */}
            {flagCount > 0 && (
              <div style={{
                padding: 10, borderRadius: 6,
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid var(--danger-500, #ef4444)',
              }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--danger-500, #ef4444)', marginBottom: 6 }}>
                  本段合规风险（{flagCount} 处）
                </div>
                {script.complianceFlags.map((f, i) => (
                  <div key={i} style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                    ·「{f.word}」（{f.category}／{SEVERITY_LABEL[f.severity]}）→ {f.suggestion}
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              {editing ? (
                <Fragment>
                  <Button size="sm" variant="ghost"
                    onClick={() => { setEditing(false); setTalk(script.talkTrack); setCta(script.ctaText); }}>
                    取消
                  </Button>
                  <Button size="sm" variant="primary" loading={saving} onClick={save}>保存话术</Button>
                </Fragment>
              ) : (
                <Button size="sm" variant="danger" onClick={remove}>删除本段</Button>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

// ═══════════════════════════════════════════════════
// Tab 4 · 选品排期
// ═══════════════════════════════════════════════════

function ProductsTab({ sessions, sessionId, onSelectSession, notify }: {
  sessions: LiveSession[];
  sessionId: string;
  onSelectSession: (id: string) => void;
  notify: (t: 'ok' | 'err', s: string) => void;
}) {
  const [items, setItems] = useState<LiveSessionProduct[]>([]);
  const [timeline, setTimeline] = useState<ScheduleTimeline | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<Array<{ id: string; sku: string; name: string; sellingPrice: number }>>([]);
  const [picking, setPicking] = useState<string>('');

  const load = useCallback(async () => {
    if (!sessionId) { setItems([]); setTimeline(null); return; }
    setLoading(true); setError(null);
    try {
      const [list, tl] = await Promise.all([
        livestreamApi.listProducts(sessionId),
        livestreamApi.getTimeline(sessionId),
      ]);
      setItems(list); setTimeline(tl);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { load(); }, [load]);

  // 商品库（来自业务模块，用于加品下拉）
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.business.listProducts({ limit: 200 });
        if (!alive) return;
        const list = Array.isArray(res?.data) ? res.data : [];
        setCatalog(list.map((p: Record<string, unknown>) => ({
          id: String(p.id),
          sku: String(p.sku || ''),
          name: String(p.name || ''),
          sellingPrice: Number(p.selling_price || 0),
        })));
      } catch (e) {
        console.warn('[LiveCommerce] 加载商品库失败:', e);
        if (alive) setCatalog([]);
      }
    })();
    return () => { alive = false; };
  }, []);

  const addProduct = async () => {
    if (!picking || !sessionId) return;
    try {
      const r = await livestreamApi.addProducts(sessionId, [{ productId: picking }]);
      setPicking('');
      notify('ok', r.added > 0 ? '商品已加入本场' : '该商品已在本场选品中');
      load();
    } catch (e) {
      notify('err', errText(e));
    }
  };

  const removeProduct = async (productId: string) => {
    try {
      await livestreamApi.removeProduct(sessionId, productId);
      notify('ok', '商品已移除');
      load();
    } catch (e) {
      notify('err', errText(e));
    }
  };

  const move = async (index: number, dir: -1 | 1) => {
    const next = [...items];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    try {
      await livestreamApi.reorderProducts(sessionId, next.map((p) => p.productId));
      load();
    } catch (e) {
      notify('err', errText(e));
    }
  };

  const updateSlot = async (
    productId: string,
    patch: { livePrice?: number; plannedDurationMinutes?: number; stockLocked?: number }
  ) => {
    try {
      await livestreamApi.updateSlot(sessionId, productId, patch);
      load();
    } catch (e) {
      notify('err', errText(e));
    }
  };

  const available = useMemo(
    () => catalog.filter((c) => !items.some((i) => i.productId === c.id)),
    [catalog, items]
  );

  return (
    <Fragment>
      <SessionPicker sessions={sessions} value={sessionId} onChange={onSelectSession} />

      {!sessionId ? (
        <Card><div style={panelStyle}><EmptyState text="请先选择一个直播场次" /></div></Card>
      ) : (
        <Fragment>
          {/* 加品 */}
          <Card>
            <div style={{ ...panelStyle, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 240 }}>
                <label style={labelStyle}>从商品库选品加入本场</label>
                <select style={inputStyle} value={picking} onChange={(e) => setPicking(e.target.value)}>
                  <option value="">
                    {catalog.length === 0 ? '商品库暂无数据，请先到「业务链 · 选品」创建商品' : '请选择商品'}
                  </option>
                  {available.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.sku ? `${c.sku} · ` : ''}{c.name}{c.sellingPrice > 0 ? ` · ¥${c.sellingPrice}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <Button variant="primary" size="sm" disabled={!picking} onClick={addProduct}>加入本场</Button>
            </div>
          </Card>

          {/* 时长警告 */}
          {timeline && timeline.warnings.length > 0 && (
            <Card>
              <div style={{
                ...panelStyle,
                borderLeft: `3px solid ${timeline.overflow ? 'var(--danger-500, #ef4444)' : 'var(--warning-500, #f59e0b)'}`,
              }}>
                <div style={{ ...sectionTitleStyle, marginBottom: 8 }}>
                  排期校验
                  {timeline.overflow
                    ? <Badge variant="danger">总时长超限</Badge>
                    : <Badge variant="warning">建议调整</Badge>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {timeline.warnings.map((w, i) => (
                    <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>· {w}</div>
                  ))}
                </div>
              </div>
            </Card>
          )}

          {/* 时间轴 */}
          {timeline && timeline.slots.length > 0 && (
            <Card>
              <div style={panelStyle}>
                <div style={{ ...sectionTitleStyle, marginBottom: 12, justifyContent: 'space-between' }}>
                  <span>讲解时间轴</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
                    讲品 {timeline.scheduledMinutes} 分钟
                    {timeline.plannedTotalMinutes > 0
                      ? ` / 场次计划 ${timeline.plannedTotalMinutes} 分钟`
                      : '（场次未设置计划时间）'}
                  </span>
                </div>
                <TimelineBar timeline={timeline} />
              </div>
            </Card>
          )}

          {error && <ErrorBar message={error} onRetry={load} />}

          {/* 选品表 */}
          <Card>
            <div style={panelStyle}>
              <div style={{ ...sectionTitleStyle, marginBottom: 12 }}>本场选品（{items.length}）</div>
              {loading && items.length === 0 ? <LoadingBlock /> : items.length === 0 ? (
                <EmptyState text="本场还没有选品" hint="从上方商品库下拉选择并加入" />
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
                    <thead>
                      <tr>
                        <th style={thStyle}>顺序</th>
                        <th style={thStyle}>商品</th>
                        <th style={thStyle}>日常售价</th>
                        <th style={thStyle}>直播价</th>
                        <th style={thStyle}>讲解时长</th>
                        <th style={thStyle}>锁库存</th>
                        <th style={thStyle}>讲解次数 / 成交</th>
                        <th style={thStyle}>产出 GMV</th>
                        <th style={thStyle}>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((p, idx) => (
                        <tr key={p.id}>
                          <td style={tdStyle}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span style={{ fontWeight: 700 }}>{idx + 1}</span>
                              <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <button onClick={() => move(idx, -1)} disabled={idx === 0}
                                  style={{
                                    background: 'transparent', border: 'none', cursor: 'pointer',
                                    color: 'var(--text-muted)', fontSize: 9, lineHeight: 1, padding: 0,
                                  }}>▲</button>
                                <button onClick={() => move(idx, 1)} disabled={idx === items.length - 1}
                                  style={{
                                    background: 'transparent', border: 'none', cursor: 'pointer',
                                    color: 'var(--text-muted)', fontSize: 9, lineHeight: 1, padding: 0,
                                  }}>▼</button>
                              </div>
                            </div>
                          </td>
                          <td style={tdStyle}>
                            <div style={{ fontWeight: 600 }}>{p.productName || p.productId}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                              {p.sku || '无 SKU'}{p.category ? ` · ${p.category}` : ''} · 库存 {formatInt(p.stock)}
                            </div>
                          </td>
                          <td style={tdStyle}>{p.sellingPrice ? formatMoney(p.sellingPrice) : '—'}</td>
                          <td style={tdStyle}>
                            <input
                              type="number" min={0} style={{ ...inputStyle, width: 90 }}
                              defaultValue={p.livePrice ?? ''}
                              placeholder="未设置"
                              onBlur={(e) => {
                                const v = e.target.value;
                                if (v === '' || Number(v) === p.livePrice) return;
                                updateSlot(p.productId, { livePrice: Number(v) });
                              }}
                            />
                          </td>
                          <td style={tdStyle}>
                            <input
                              type="number" min={1} style={{ ...inputStyle, width: 70 }}
                              defaultValue={p.plannedDurationMinutes}
                              onBlur={(e) => {
                                const v = Number(e.target.value);
                                if (!v || v === p.plannedDurationMinutes) return;
                                updateSlot(p.productId, { plannedDurationMinutes: v });
                              }}
                            />
                          </td>
                          <td style={tdStyle}>
                            <input
                              type="number" min={0} style={{ ...inputStyle, width: 80 }}
                              defaultValue={p.stockLocked}
                              onBlur={(e) => {
                                const v = Number(e.target.value);
                                if (v === p.stockLocked) return;
                                updateSlot(p.productId, { stockLocked: v });
                              }}
                            />
                          </td>
                          <td style={tdStyle}>
                            {formatInt(p.explainedCount)} 次 / {formatInt(p.soldQty)} 件
                            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                              转化 {formatPct(p.conversionRate)}
                            </div>
                          </td>
                          <td style={{ ...tdStyle, fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                            {formatMoney(p.gmv)}
                          </td>
                          <td style={tdStyle}>
                            <Button size="sm" variant="danger" onClick={() => removeProduct(p.productId)}>移除</Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </Card>
        </Fragment>
      )}
    </Fragment>
  );
}

/** 讲解时间轴条形可视化 */
function TimelineBar({ timeline }: { timeline: ScheduleTimeline }) {
  const totalSpan = Math.max(
    timeline.plannedTotalMinutes,
    timeline.slots.reduce((s, x) => s + x.durationMinutes, 0) + 9,
    1
  );
  const palette = ['#4f46e5', '#0ea5e9', '#16a34a', '#f59e0b', '#a855f7', '#dc2626', '#0891b2'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* 条形 */}
      <div style={{
        display: 'flex', width: '100%', height: 30, borderRadius: 6,
        overflow: 'hidden', background: 'var(--bg-row-hover)',
      }}>
        {timeline.slots.map((s, i) => (
          <div
            key={s.productId}
            title={`${s.productName || s.productId}｜第 ${s.offsetMinutes}-${s.offsetMinutes + s.durationMinutes} 分钟｜${s.durationMinutes} 分钟`}
            style={{
              width: `${(s.durationMinutes / totalSpan) * 100}%`,
              background: palette[i % palette.length],
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 10, fontWeight: 600,
              borderRight: '1px solid var(--bg-card)', minWidth: 2, overflow: 'hidden',
            }}
          >
            {(s.durationMinutes / totalSpan) > 0.06 ? `${s.durationMinutes}′` : ''}
          </div>
        ))}
        {timeline.remainingMinutes > 0 && (
          <div
            title={`剩余空档 ${timeline.remainingMinutes} 分钟`}
            style={{
              width: `${(timeline.remainingMinutes / totalSpan) * 100}%`,
              background: 'repeating-linear-gradient(45deg, var(--bg-row-hover), var(--bg-row-hover) 4px, transparent 4px, transparent 8px)',
            }}
          />
        )}
      </div>

      {/* 明细 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6 }}>
        {timeline.slots.map((s, i) => (
          <div key={s.productId} style={{
            display: 'flex', alignItems: 'center', gap: 6, fontSize: 11,
            padding: '4px 6px', borderRadius: 4, background: 'var(--bg-row-hover)',
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: 2, flexShrink: 0,
              background: palette[i % palette.length],
            }} />
            <span style={{
              flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              color: 'var(--text-primary)',
            }}>{s.productName || s.productId}</span>
            <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
              {s.slotStart ? shortTime(s.slotStart) : `+${s.offsetMinutes}′`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// Tab 5 · 数据复盘
// ═══════════════════════════════════════════════════

function ReviewTab({ sessions, session, sessionId, onSelectSession, notify, onReloadSessions }: {
  sessions: LiveSession[];
  session: LiveSession | null;
  sessionId: string;
  onSelectSession: (id: string) => void;
  notify: (t: 'ok' | 'err', s: string) => void;
  onReloadSessions: () => void;
}) {
  const [metrics, setMetrics] = useState<LiveMetric[]>([]);
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [review, setReview] = useState<LiveReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    if (!sessionId) { setMetrics([]); setSnapshot(null); setReview(null); return; }
    setLoading(true); setError(null);
    try {
      const [m, s, r] = await Promise.all([
        livestreamApi.getMetrics(sessionId),
        livestreamApi.getSnapshot(sessionId),
        livestreamApi.getReview(sessionId),
      ]);
      setMetrics(m); setSnapshot(s); setReview(r);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { load(); }, [load]);

  const handleGenerate = async () => {
    if (!sessionId) return;
    setGenerating(true);
    try {
      const r = await livestreamApi.generateReview(sessionId);
      setReview(r);
      notify('ok', `复盘已生成，主播评分 ${r.anchorScore} 分`);
      onReloadSessions();
      load();
    } catch (e) {
      notify('err', errText(e));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Fragment>
      <SessionPicker sessions={sessions} value={sessionId} onChange={onSelectSession} />

      {!sessionId ? (
        <Card><div style={panelStyle}><EmptyState text="请先选择一个直播场次" /></div></Card>
      ) : (
        <Fragment>
          {/* 快照 KPI */}
          {snapshot && (
            <Fragment>
              <div style={kpiGridStyle}>
                <KpiCard
                  label="GMV 达成率"
                  value={formatPct(snapshot.gmvAchievementRate)}
                  sub={`${formatMoney(snapshot.latest?.gmv ?? session?.actualGmv ?? 0)} / 目标 ${formatMoney(snapshot.targetGmv)}`}
                  tone={snapshot.gmvAchievementRate >= 1 ? 'success' : snapshot.gmvAchievementRate >= 0.6 ? 'warning' : 'danger'}
                  icon="💰"
                />
                <KpiCard
                  label="UV 价值"
                  value={`¥${snapshot.uvValue.toFixed(2)}`}
                  sub="GMV ÷ 累计观看人数"
                  tone={snapshot.uvValue >= 3 ? 'success' : snapshot.uvValue >= 1 ? 'warning' : 'danger'}
                  icon="📊"
                />
                <KpiCard
                  label="转化率"
                  value={formatPct(snapshot.conversionRate)}
                  sub={`${formatInt(snapshot.latest?.orders ?? 0)} 单 / ${formatInt(snapshot.latest?.cumulativeUv ?? 0)} UV`}
                  tone={snapshot.conversionRate >= 0.05 ? 'success' : snapshot.conversionRate >= 0.01 ? 'warning' : 'danger'}
                  icon="🎯"
                />
                <KpiCard
                  label="平均停留"
                  value={`${Math.round(snapshot.latest?.avgStaySeconds ?? 0)} 秒`}
                  sub={(snapshot.latest?.avgStaySeconds ?? 0) >= 120 ? '高于 2 分钟，节奏健康' : '不足 2 分钟，留人待优化'}
                  tone={(snapshot.latest?.avgStaySeconds ?? 0) >= 120 ? 'success' : 'warning'}
                  icon="⏱"
                />
              </div>
              <SourceNotice text={snapshot.dataSourceNote} />
            </Fragment>
          )}

          {error && <ErrorBar message={error} onRetry={load} />}

          {/* 指标录入 */}
          <MetricForm
            sessionId={sessionId}
            onSaved={() => { notify('ok', '指标快照已记录'); load(); onReloadSessions(); }}
            onError={(m) => notify('err', m)}
          />

          {/* 时间序列 */}
          <Card>
            <div style={panelStyle}>
              <div style={{ ...sectionTitleStyle, marginBottom: 12, justifyContent: 'space-between' }}>
                <span>指标时间序列</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
                  共 {metrics.length} 条快照
                </span>
              </div>
              {loading && metrics.length === 0 ? <LoadingBlock /> : metrics.length === 0 ? (
                <EmptyState text="还没有录入任何指标快照" hint="用上方表单手工录入，建议每 15-30 分钟记一次" />
              ) : (
                <MetricsChart metrics={metrics} />
              )}
            </div>
          </Card>

          {/* 复盘 */}
          <Card>
            <div style={panelStyle}>
              <div style={{ ...sectionTitleStyle, marginBottom: 12, justifyContent: 'space-between' }}>
                <span>复盘报告</span>
                <Button variant="primary" size="sm" loading={generating} onClick={handleGenerate}>
                  {review ? '重新生成复盘' : '生成复盘'}
                </Button>
              </div>
              {!review ? (
                <EmptyState
                  text="尚未生成复盘"
                  hint="场次下播且录入至少一条指标后，点击右上角「生成复盘」"
                />
              ) : (
                <ReviewPanel review={review} />
              )}
            </div>
          </Card>
        </Fragment>
      )}
    </Fragment>
  );
}

function MetricForm({ sessionId, onSaved, onError }: {
  sessionId: string;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const empty = {
    onlineUsers: '', cumulativeUv: '', newFollowers: '', comments: '',
    likes: '', shares: '', cartClicks: '', orders: '', gmv: '', avgStaySeconds: '',
  };
  const [form, setForm] = useState<Record<string, string>>(empty);
  const [saving, setSaving] = useState(false);

  const fields: Array<{ key: keyof typeof empty; label: string; hint?: string }> = [
    { key: 'onlineUsers', label: '当前在线人数' },
    { key: 'cumulativeUv', label: '累计观看人数 UV' },
    { key: 'gmv', label: '累计 GMV（元）' },
    { key: 'orders', label: '累计订单数' },
    { key: 'cartClicks', label: '购物车点击数' },
    { key: 'avgStaySeconds', label: '平均停留（秒）' },
    { key: 'newFollowers', label: '新增粉丝' },
    { key: 'comments', label: '公屏评论数' },
    { key: 'likes', label: '点赞数' },
    { key: 'shares', label: '分享数' },
  ];

  const submit = async () => {
    const payload: MetricInput = {};
    for (const f of fields) {
      const v = form[f.key];
      if (v !== '' && v !== undefined) {
        (payload as Record<string, number>)[f.key] =
          f.key === 'gmv' || f.key === 'avgStaySeconds' ? Number(v) : Math.round(Number(v));
      }
    }
    if (Object.keys(payload).length === 0) { onError('请至少填写一项指标'); return; }
    setSaving(true);
    try {
      await livestreamApi.recordMetric(sessionId, payload);
      setForm(empty);
      onSaved();
    } catch (e) {
      onError(errText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <div style={panelStyle}>
        <div style={{ ...sectionTitleStyle, marginBottom: 4 }}>录入指标快照</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
          从直播后台读数后手工填写，留空的字段按 0 处理。数据来源标记为「人工录入」。
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          {fields.map((f) => (
            <div key={f.key}>
              <label style={labelStyle}>{f.label}</label>
              <input
                type="number" min={0} style={inputStyle} placeholder="0"
                value={form[f.key]}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
              />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
          <Button variant="ghost" size="sm" onClick={() => setForm(empty)}>清空</Button>
          <Button variant="primary" size="sm" loading={saving} onClick={submit}>记录快照</Button>
        </div>
      </div>
    </Card>
  );
}

/** 原生 SVG 折线图：GMV（左轴）与累计 UV（右轴）双线 */
function MetricsChart({ metrics }: { metrics: LiveMetric[] }) {
  const W = 680, H = 220, PAD_L = 52, PAD_R = 52, PAD_T = 16, PAD_B = 30;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const n = metrics.length;
  const maxGmv = Math.max(1, ...metrics.map((m) => m.gmv));
  const maxUv = Math.max(1, ...metrics.map((m) => m.cumulativeUv));

  const x = (i: number) => PAD_L + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yGmv = (v: number) => PAD_T + innerH - (v / maxGmv) * innerH;
  const yUv = (v: number) => PAD_T + innerH - (v / maxUv) * innerH;

  const pathGmv = metrics.map((m, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${yGmv(m.gmv).toFixed(1)}`).join(' ');
  const pathUv = metrics.map((m, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${yUv(m.cumulativeUv).toFixed(1)}`).join(' ');
  const areaGmv = n > 1
    ? `${pathGmv} L${x(n - 1).toFixed(1)},${(PAD_T + innerH).toFixed(1)} L${x(0).toFixed(1)},${(PAD_T + innerH).toFixed(1)} Z`
    : '';

  const gridLines = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--text-secondary)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 12, height: 3, background: '#4f46e5', display: 'inline-block' }} /> 累计 GMV
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 12, height: 3, background: '#16a34a', display: 'inline-block' }} /> 累计 UV
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="直播指标时间序列折线图">
        {/* 网格 */}
        {gridLines.map((g) => (
          <g key={g}>
            <line
              x1={PAD_L} x2={W - PAD_R}
              y1={PAD_T + innerH * (1 - g)} y2={PAD_T + innerH * (1 - g)}
              stroke="var(--border-card)" strokeWidth={1} strokeDasharray="3 3"
            />
            <text x={PAD_L - 6} y={PAD_T + innerH * (1 - g) + 3}
              textAnchor="end" fontSize={9} fill="var(--text-muted)">
              {(maxGmv * g >= 10000 ? `${(maxGmv * g / 10000).toFixed(1)}万` : Math.round(maxGmv * g))}
            </text>
            <text x={W - PAD_R + 6} y={PAD_T + innerH * (1 - g) + 3}
              textAnchor="start" fontSize={9} fill="var(--text-muted)">
              {(maxUv * g >= 10000 ? `${(maxUv * g / 10000).toFixed(1)}万` : Math.round(maxUv * g))}
            </text>
          </g>
        ))}

        {/* GMV 面积 + 折线 */}
        {areaGmv && <path d={areaGmv} fill="rgba(79,70,229,0.12)" stroke="none" />}
        <path d={pathGmv} fill="none" stroke="#4f46e5" strokeWidth={2} strokeLinejoin="round" />
        <path d={pathUv} fill="none" stroke="#16a34a" strokeWidth={2} strokeDasharray="5 3" strokeLinejoin="round" />

        {/* 数据点 */}
        {metrics.map((m, i) => (
          <g key={m.id}>
            <circle cx={x(i)} cy={yGmv(m.gmv)} r={2.5} fill="#4f46e5">
              <title>{`${shortTime(m.capturedAt)}｜GMV ${m.gmv} 元｜${m.orders} 单`}</title>
            </circle>
            <circle cx={x(i)} cy={yUv(m.cumulativeUv)} r={2.5} fill="#16a34a">
              <title>{`${shortTime(m.capturedAt)}｜累计 UV ${m.cumulativeUv}`}</title>
            </circle>
          </g>
        ))}

        {/* X 轴时间（最多 6 个刻度，避免拥挤） */}
        {metrics.map((m, i) => {
          const step = Math.max(1, Math.ceil(n / 6));
          if (i % step !== 0 && i !== n - 1) return null;
          return (
            <text key={`t-${m.id}`} x={x(i)} y={H - 10} textAnchor="middle" fontSize={9} fill="var(--text-muted)">
              {m.capturedAt.slice(11, 16) || shortTime(m.capturedAt)}
            </text>
          );
        })}
      </svg>

      {/* 快照明细 */}
      <div style={{ overflowX: 'auto', maxHeight: 200, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
          <thead>
            <tr>
              <th style={thStyle}>采集时间</th>
              <th style={thStyle}>在线</th>
              <th style={thStyle}>累计 UV</th>
              <th style={thStyle}>GMV</th>
              <th style={thStyle}>订单</th>
              <th style={thStyle}>加购</th>
              <th style={thStyle}>停留</th>
              <th style={thStyle}>涨粉</th>
              <th style={thStyle}>来源</th>
            </tr>
          </thead>
          <tbody>
            {[...metrics].reverse().map((m) => (
              <tr key={m.id}>
                <td style={tdStyle}>{shortTime(m.capturedAt)}</td>
                <td style={tdStyle}>{formatInt(m.onlineUsers)}</td>
                <td style={tdStyle}>{formatInt(m.cumulativeUv)}</td>
                <td style={tdStyle}>{formatMoney(m.gmv)}</td>
                <td style={tdStyle}>{formatInt(m.orders)}</td>
                <td style={tdStyle}>{formatInt(m.cartClicks)}</td>
                <td style={tdStyle}>{Math.round(m.avgStaySeconds)} 秒</td>
                <td style={tdStyle}>{formatInt(m.newFollowers)}</td>
                <td style={tdStyle}>
                  <Badge variant="neutral">{m.source === 'import' ? '批量导入' : '人工录入'}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReviewPanel({ review }: { review: LiveReview }) {
  const scoreColor = review.anchorScore >= 85
    ? 'var(--success-500, #22c55e)'
    : review.anchorScore >= 60 ? 'var(--warning-500, #f59e0b)' : 'var(--danger-500, #ef4444)';

  const groups: Array<{ title: string; items: DiagnosisItem[]; color: string; icon: string }> = [
    { title: '亮点', items: review.highlights, color: 'var(--success-500, #22c55e)', icon: '✓' },
    { title: '问题', items: review.problems, color: 'var(--danger-500, #ef4444)', icon: '!' },
    { title: '行动项', items: review.actions, color: 'var(--text-link, #4f46e5)', icon: '→' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* 核心指标 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        <MiniStat label="GMV 达成率" value={formatPct(review.gmvAchievementRate)} />
        <MiniStat label="UV 价值" value={`¥${review.uvValue.toFixed(2)}`} />
        <MiniStat label="转化率" value={formatPct(review.conversionRate)} />
        <MiniStat label="平均停留" value={`${Math.round(review.avgStaySeconds)} 秒`} />
        <div style={{
          padding: 10, borderRadius: 6, background: 'var(--bg-row-hover)',
          display: 'flex', flexDirection: 'column', gap: 2,
        }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>主播评分</span>
          <span style={{ fontSize: 20, fontWeight: 700, color: scoreColor, fontVariantNumeric: 'tabular-nums' }}>
            {review.anchorScore.toFixed(1)}
            <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 3 }}>/ 100</span>
          </span>
        </div>
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        评分权重：GMV 达成率 35% + UV 价值 25% + 转化率 20% + 平均停留 20%
      </div>

      {/* 单品 */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {review.bestProductName && (
          <div style={{
            flex: '1 1 220px', padding: 10, borderRadius: 6,
            background: 'var(--bg-row-hover)', borderLeft: '3px solid var(--success-500, #22c55e)',
          }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>产出最高单品</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{review.bestProductName}</div>
          </div>
        )}
        {review.worstProductName && (
          <div style={{
            flex: '1 1 220px', padding: 10, borderRadius: 6,
            background: 'var(--bg-row-hover)', borderLeft: '3px solid var(--danger-500, #ef4444)',
          }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>产出最低单品</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{review.worstProductName}</div>
          </div>
        )}
      </div>

      {/* 诊断 */}
      {groups.map((g) => (
        <div key={g.title}>
          <div style={{ ...sectionTitleStyle, marginBottom: 8 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 16, height: 16, borderRadius: 3, fontSize: 10,
              background: g.color, color: '#fff',
            }}>{g.icon}</span>
            {g.title}（{g.items.length}）
          </div>
          {g.items.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', paddingLeft: 24 }}>暂无</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {g.items.map((it, i) => (
                <div key={`${it.rule}-${i}`} style={{
                  padding: 10, borderRadius: 6, background: 'var(--bg-row-hover)',
                  borderLeft: `3px solid ${g.color}`,
                }}>
                  <div style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.7 }}>{it.text}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                    规则 {it.rule}{it.metric ? ` · 实测 ${it.metric}` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        复盘生成时间：{shortTime(review.createdAt)}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      padding: 10, borderRadius: 6, background: 'var(--bg-row-hover)',
      display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </span>
    </div>
  );
}
