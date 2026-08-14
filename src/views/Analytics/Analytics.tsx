/**
 * Vorzai 数据分析视图（真实数据版）
 *
 * 数据全部来自 analyticsService 的真实 SQL 聚合（经 /api/analytics 暴露），
 * 不保留任何占位或虚构数据。数据不足时如实展示「暂无数据」。
 *
 * 九大区域：控制栏 / 总览 / 趋势 / 漏斗 / 多维拆解 / 商品分析 /
 *          人效分析 / 客户分析 / 经营健康度；外加「导出报告」动作。
 * 每段均含 加载 / 错误 / 空数据 三态处理。
 */
import { useState, useEffect, useCallback } from 'react';
import analyticsApi, {
  type CompareMode,
  type TrendMetric,
  type Granularity,
  type BreakdownDimension,
  type BreakdownMetric,
  type OverviewResult,
  type TrendResult,
  type FunnelResult,
  type BreakdownResult,
  type ProductAnalysisResult,
  type EmployeeEfficiencyResult,
  type CustomerAnalysisResult,
  type HealthScoreResult,
  type ReportResult,
} from '../../api/analytics';
import {
  ChartSkeleton,
  EmptyState,
  ErrorState,
  FormulaTip,
  LineChart,
  HorizontalBarChart,
  DonutChart,
  FunnelChart,
  RadarChart,
  ChangeBadge,
  colorAt,
  type BarItem,
  type DonutSlice,
  type RadarDim,
  tableStyle,
  thStyle,
  tdStyle,
} from './Charts';

// ════════════════ 工具函数 ═══════════════

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function shiftDays(s: string, delta: number): string {
  const d = new Date(`${s}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return toISODate(d);
}

function presetRange(days: number): { from: string; to: string } {
  const today = toISODate(new Date());
  return { from: shiftDays(today, -(days - 1)), to: today };
}

/** 金额：整数 + 千分位 */
function fmtMoney(n: number): string {
  return `¥${Math.round(n).toLocaleString('zh-CN')}`;
}

/** 百分比：入参为小数（0.038 → 3.8%） */
function fmtPct(frac: number): string {
  return `${(frac * 100).toFixed(1)}%`;
}

function fmtCount(n: number): string {
  return Math.round(n).toLocaleString('zh-CN');
}

/** 按单位格式化（currency/count/percent） */
function fmtByUnit(n: number, unit: 'currency' | 'count' | 'percent'): string {
  if (unit === 'currency') return fmtMoney(n);
  if (unit === 'count') return fmtCount(n);
  return fmtPct(n);
}

// ════════════════ 通用异步 Hook（三态）══════════════

interface AsyncState<T> {
  loading: boolean;
  data: T | null;
  error: string | null;
  reload: () => void;
}

function useAsync<T>(fetcher: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<{ loading: boolean; data: T | null; error: string | null }>({
    loading: true,
    data: null,
    error: null,
  });
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ loading: true, data: s.data, error: null }));
    fetcher()
      .then((d) => {
        if (!cancelled) setState({ loading: false, data: d, error: null });
      })
      .catch((e) => {
        if (!cancelled) {
          const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : '请求失败';
          setState({ loading: false, data: null, error: msg });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [...deps, nonce]);

  return { ...state, reload };
}

// ════════════════ 面板容器 ═══════════════

function Panel({
  title,
  tip,
  extra,
  children,
}: {
  title: string;
  tip?: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: 'var(--bg-card)',
        borderRadius: 12,
        padding: 16,
        border: '1px solid var(--border-card)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>{title}</h3>
        {tip && <FormulaTip text={tip} label="口径" />}
        <div style={{ flex: 1 }} />
        {extra}
      </div>
      {children}
    </section>
  );
}

/** 区块级三态包装：loading→骨架；error→错误重试；否则渲染内容 */
function SectionState<T>({
  state,
  skeletonHeight = 220,
  children,
}: {
  state: AsyncState<T>;
  skeletonHeight?: number;
  children: (data: T) => React.ReactNode;
}) {
  if (state.loading) return <ChartSkeleton height={skeletonHeight} />;
  if (state.error) return <ErrorState message={state.error} onRetry={state.reload} height={skeletonHeight} />;
  if (state.data === null) return <EmptyState title="暂无数据" height={skeletonHeight} />;
  return <>{children(state.data)}</>;
}

// ════════════════ 主组件 ═══════════════

type CompareKey = CompareMode;

const TREND_METRICS: Array<{ key: TrendMetric; label: string }> = [
  { key: 'gmv', label: '营收' },
  { key: 'orders', label: '订单' },
  { key: 'aov', label: '客单价' },
  { key: 'gross_profit', label: '毛利' },
  { key: 'conversion', label: '转化率' },
  { key: 'refund_rate', label: '退款率' },
];

const DIMENSIONS: Array<{ key: BreakdownDimension; label: string }> = [
  { key: 'platform', label: '平台' },
  { key: 'category', label: '品类' },
  { key: 'product', label: '商品' },
  { key: 'employee', label: '员工' },
  { key: 'department', label: '部门' },
  { key: 'business_line', label: '业务线' },
  { key: 'live_session', label: '直播场次' },
];

export default function Analytics() {
  const [range, setRange] = useState<{ from: string; to: string }>(() => presetRange(30));
  const [compare, setCompare] = useState<CompareKey>('prev');
  const [trendMetric, setTrendMetric] = useState<TrendMetric>('gmv');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [dimension, setDimension] = useState<BreakdownDimension>('platform');
  const [breakdownMetric, setBreakdownMetric] = useState<BreakdownMetric>('gmv');
  const [reportBusy, setReportBusy] = useState(false);
  const [reportErr, setReportErr] = useState<string | null>(null);
  const [snapshotBusy, setSnapshotBusy] = useState(false);

  // ── 各区块数据 ──
  const overview = useAsync<OverviewResult>(
    () => analyticsApi.getOverview(range.from, range.to, compare),
    [range.from, range.to, compare],
  );
  const trend = useAsync<TrendResult>(
    () => analyticsApi.getTrend(trendMetric, granularity, range.from, range.to),
    [trendMetric, granularity, range.from, range.to],
  );
  const funnel = useAsync<FunnelResult>(() => analyticsApi.getFunnel(range.from, range.to), [range.from, range.to]);
  const breakdown = useAsync<BreakdownResult>(
    () => analyticsApi.getBreakdown(dimension, breakdownMetric, range.from, range.to, 10),
    [dimension, breakdownMetric, range.from, range.to],
  );
  const products = useAsync<ProductAnalysisResult>(() => analyticsApi.getProducts(range.from, range.to), [range.from, range.to]);
  const employees = useAsync<EmployeeEfficiencyResult>(
    () => analyticsApi.getEmployees(range.to.slice(0, 7)),
    [range.to],
  );
  const customers = useAsync<CustomerAnalysisResult>(
    () => analyticsApi.getCustomers(range.from, range.to),
    [range.from, range.to],
  );
  const health = useAsync<HealthScoreResult>(() => analyticsApi.getHealth(), []);

  // ── 导出报告 ──
  const exportReport = useCallback(async () => {
    setReportBusy(true);
    setReportErr(null);
    try {
      const report: ReportResult = await analyticsApi.getReport(range.from, range.to);
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vorzai-analytics-report-${range.from}_${range.to}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : '导出失败';
      setReportErr(msg);
    } finally {
      setReportBusy(false);
    }
  }, [range.from, range.to]);

  // ── 固化快照（写入 analytics_snapshots 缓存表）──
  const computeSnapshot = useCallback(async () => {
    setSnapshotBusy(true);
    try {
      await analyticsApi.computeSnapshots('month', range.to);
    } catch (e) {
      console.warn('[Analytics] 快照计算失败:', e);
    } finally {
      setSnapshotBusy(false);
    }
  }, [range.to]);

  // ════════ 渲染辅助 ════════

  const overviewCards = (o: OverviewResult) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
      {o.metrics.map((m) => (
        <div
          key={m.key}
          style={{
            background: 'var(--bg-row-hover)',
            borderRadius: 10,
            padding: 14,
            border: '1px solid var(--border-card)',
          }}
        >
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.label}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginTop: 6 }}>
            {fmtByUnit(m.value, m.unit)}
          </div>
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
            <ChangeBadge changeRate={m.changeRate} invert={m.key === 'refund_rate'} />
            {m.formula && <FormulaTip text={m.formula} label="公式" />}
          </div>
        </div>
      ))}
    </div>
  );

  const trendView = (t: TrendResult) => (
    <>
      <LineChart
        points={t.points.map((p) => ({ label: p.label, value: p.value }))}
        format={(n) => fmtByUnit(n, t.unit)}
        height={260}
      />
      {!t.hasData && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
          所选区间内无有效数据，趋势曲线为空（未虚构任何数值）。
        </div>
      )}
    </>
  );

  const breakdownView = (b: BreakdownResult) => {
    if (!b.available) {
      return <EmptyState title="该维度暂无数据" reason={b.reason} height={200} />;
    }
    const bars: BarItem[] = b.items.map((it) => ({
      key: it.key,
      label: it.label,
      value: it.value,
      share: it.share,
      color: it.isOther ? '#94a3b8' : undefined,
    }));
    const slices: DonutSlice[] = b.items.map((it, i) => ({
      key: it.key,
      label: it.label,
      value: it.value,
      color: it.isOther ? '#94a3b8' : colorAt(i),
    }));
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, alignItems: 'center' }}>
        <HorizontalBarChart items={bars} format={(n) => fmtByUnit(n, b.unit)} />
        <DonutChart slices={slices} format={(n) => fmtByUnit(n, b.unit)} centerTitle={b.metric} centerValue={fmtByUnit(b.total, b.unit)} />
      </div>
    );
  };

  const productsView = (p: ProductAnalysisResult) => {
    if (!p.available) {
      return <EmptyState title="商品分析暂无数据" reason={p.reason} height={200} />;
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* ABC 概览 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {p.abcSummary.map((tier) => (
            <div
              key={tier.tier}
              style={{ background: 'var(--bg-row-hover)', borderRadius: 8, padding: 12, border: '1px solid var(--border-card)' }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
                {tier.tier} 类（{tier.skuCount} SKU）
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>{tier.desc}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ecom-amber-500)', marginTop: 6 }}>
                {fmtMoney(tier.gmv)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>占比 {fmtPct(tier.gmvShare)}</div>
            </div>
          ))}
        </div>

        {/* 毛利率 Top / Bottom 10 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>毛利率 Top 10</div>
            <HorizontalBarChart
              items={p.marginTop.map((r) => ({ key: r.productId, label: r.name, value: r.marginRate, color: colorAt(1) }))}
              format={(n) => fmtPct(n)}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>毛利率 Bottom 10</div>
            <HorizontalBarChart
              items={p.marginBottom.map((r) => ({ key: r.productId, label: r.name, value: r.marginRate, color: colorAt(3) }))}
              format={(n) => fmtPct(n)}
            />
          </div>
        </div>

        {/* 动销率 + 滞销 */}
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            动销率：
            <strong style={{ color: 'var(--text-primary)' }}>
              {p.sellThroughRate === null ? '无数据' : fmtPct(p.sellThroughRate)}
            </strong>
            （有动销 {p.soldSkuCount} / 总 SKU {p.totalSkuCount}）
          </div>
          {p.formulas.sellThrough && <FormulaTip text={p.formulas.sellThrough} label="动销率公式" />}
        </div>
        {p.slowMoving.length > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
              滞销商品（{p.slowMoving.length} 件，库存长期未动）
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {p.slowMoving.slice(0, 12).map((s) => (
                <span
                  key={s.productId}
                  style={{
                    fontSize: 11,
                    padding: '3px 8px',
                    borderRadius: 6,
                    background: 'var(--bg-row-hover)',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border-card)',
                  }}
                  title={`库存 ${s.stock} · 更新于 ${s.lastUpdatedAt}`}
                >
                  {s.name}（{s.stock}）
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const employeesView = (e: EmployeeEfficiencyResult) => {
    if (!e.available) {
      return <EmptyState title="人效分析暂无数据" reason={e.reason} height={200} />;
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-secondary)' }}>
          <span>归因员工 {e.attributedEmployeeCount} / 在职 {e.headcount}</span>
          <span>人效 GMV <strong style={{ color: 'var(--text-primary)' }}>{e.gmvPerCapita === null ? '—' : fmtMoney(e.gmvPerCapita)}</strong></span>
          <span>人效毛利 <strong style={{ color: 'var(--text-primary)' }}>{e.profitPerCapita === null ? '—' : fmtMoney(e.profitPerCapita)}</strong></span>
          <FormulaTip text={e.formulas.gmvPerCapita} label="人效公式" />
        </div>

        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>员工</th>
              <th style={thStyle}>部门</th>
              <th style={thStyle}>GMV</th>
              <th style={thStyle}>毛利</th>
              <th style={thStyle}>订单</th>
              <th style={thStyle}>工单</th>
            </tr>
          </thead>
          <tbody>
            {e.employees.map((emp) => (
              <tr key={emp.employeeId}>
                <td style={tdStyle}>{emp.employeeName}</td>
                <td style={tdStyle}>{emp.departmentName}</td>
                <td style={tdStyle}>{fmtMoney(emp.gmv)}</td>
                <td style={tdStyle}>{fmtMoney(emp.grossProfit)}</td>
                <td style={tdStyle}>{fmtCount(emp.orderCount)}</td>
                <td style={tdStyle}>{fmtCount(emp.ticketCount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {e.departments.length > 0 && (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>部门</th>
                <th style={thStyle}>人数</th>
                <th style={thStyle}>GMV</th>
                <th style={thStyle}>人均 GMV</th>
                <th style={thStyle}>人均毛利</th>
              </tr>
            </thead>
            <tbody>
              {e.departments.map((d) => (
                <tr key={d.departmentId}>
                  <td style={tdStyle}>{d.departmentName}</td>
                  <td style={tdStyle}>{fmtCount(d.headcount)}</td>
                  <td style={tdStyle}>{fmtMoney(d.gmv)}</td>
                  <td style={tdStyle}>{fmtMoney(d.gmvPerCapita)}</td>
                  <td style={tdStyle}>{fmtMoney(d.profitPerCapita)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  };

  const customersView = (c: CustomerAnalysisResult) => {
    if (!c.available) {
      return <EmptyState title="客户分析暂无数据" reason={c.reason} height={200} />;
    }
    const slices: DonutSlice[] = c.tiers.map((t, i) => ({ key: t.tier, label: t.tier, value: t.totalSpend, color: colorAt(i) }));
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          <div style={{ background: 'var(--bg-row-hover)', borderRadius: 8, padding: 10, border: '1px solid var(--border-card)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>识别客户</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>{fmtCount(c.identifiedCustomers)}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>匿名订单 {fmtCount(c.anonymousOrders)}</div>
          </div>
          <div style={{ background: 'var(--bg-row-hover)', borderRadius: 8, padding: 10, border: '1px solid var(--border-card)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>新客 / 老客</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
              {fmtCount(c.newCustomers)} / {fmtCount(c.returningCustomers)}
            </div>
            <FormulaTip text={c.formulas.newVsReturning} label="口径" />
          </div>
          <div style={{ background: 'var(--bg-row-hover)', borderRadius: 8, padding: 10, border: '1px solid var(--border-card)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>复购率</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
              {c.repurchaseRate === null ? '—' : fmtPct(c.repurchaseRate)}
            </div>
          </div>
          <div style={{ background: 'var(--bg-row-hover)', borderRadius: 8, padding: 10, border: '1px solid var(--border-card)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>复购周期(中位)</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
              {c.repurchaseCycleMedianDays === null ? '—' : `${c.repurchaseCycleMedianDays}天`}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>样本 {fmtCount(c.repurchaseSampleSize)}</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'center' }}>
          <DonutChart slices={slices} format={(n) => fmtMoney(n)} centerTitle="客户价值分层" centerValue={fmtMoney(slices.reduce((s, x) => s + x.value, 0))} />
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>价值层</th>
                <th style={thStyle}>人数</th>
                <th style={thStyle}>消费额</th>
                <th style={thStyle}>区间</th>
              </tr>
            </thead>
            <tbody>
              {c.tiers.map((t) => (
                <tr key={t.tier}>
                  <td style={tdStyle}>{t.tier}</td>
                  <td style={tdStyle}>{fmtCount(t.customerCount)}</td>
                  <td style={tdStyle}>{fmtMoney(t.totalSpend)}</td>
                  <td style={tdStyle}>{fmtMoney(t.minSpend)}~{fmtMoney(t.maxSpend)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const healthView = (h: HealthScoreResult) => {
    const dims: RadarDim[] = h.dimensions.map((d) => ({ key: d.key, label: d.label, score: d.score }));
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 36, fontWeight: 800, color: 'var(--text-primary)' }}>
              {h.overallScore === null ? '—' : h.overallScore}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              综合健康度 · {h.grade}（{h.evaluatedDimensions}/{h.totalDimensions} 维度）
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 260 }}>
            <RadarChart dims={dims} size={300} />
          </div>
        </div>

        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>维度</th>
              <th style={thStyle}>评分</th>
              <th style={thStyle}>原始值</th>
              <th style={thStyle}>诊断</th>
              <th style={thStyle}>建议</th>
            </tr>
          </thead>
          <tbody>
            {h.dimensions.map((d) => (
              <tr key={d.key}>
                <td style={tdStyle}>{d.label}</td>
                <td style={tdStyle}>{d.score === null ? '无数据' : d.score}</td>
                <td style={tdStyle}>{d.rawLabel}</td>
                <td style={tdStyle}>{d.diagnosis}</td>
                <td style={tdStyle}>{d.suggestion}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  // ════════ 控制栏 ════════
  const presetBtns: Array<{ label: string; days: number }> = [
    { label: '近7天', days: 7 },
    { label: '近30天', days: 30 },
    { label: '近90天', days: 90 },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* 控制栏 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>数据分析中心</h2>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 2, background: 'var(--bg-toolbar)', borderRadius: 8, padding: 2 }}>
            {presetBtns.map((b) => {
              const active = range.from === presetRange(b.days).from && range.to === presetRange(b.days).to;
              return (
                <button
                  key={b.days}
                  onClick={() => setRange(presetRange(b.days))}
                  style={{
                    padding: '5px 12px', borderRadius: 6, border: 'none', fontSize: 12, cursor: 'pointer',
                    background: active ? 'var(--bg-sidebar-active)' : 'transparent',
                    color: active ? 'var(--text-light)' : 'var(--text-muted)',
                    fontWeight: active ? 500 : 400,
                  }}
                >
                  {b.label}
                </button>
              );
            })}
          </div>

          <input
            type="date" value={range.from}
            onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
            style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border-card)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 12 }}
          />
          <span style={{ color: 'var(--text-muted)' }}>至</span>
          <input
            type="date" value={range.to}
            onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
            style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border-card)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 12 }}
          />

          <select
            value={compare}
            onChange={(e) => setCompare(e.target.value as CompareKey)}
            style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border-card)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 12 }}
          >
            <option value="prev">环比上一周期</option>
            <option value="yoy">同比去年</option>
            <option value="none">不对比</option>
          </select>

          <button
            onClick={computeSnapshot}
            disabled={snapshotBusy}
            style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border-card)', background: 'var(--bg-toolbar)', color: 'var(--text-primary)', fontSize: 12, cursor: 'pointer' }}
          >
            {snapshotBusy ? '固化中…' : '固化快照'}
          </button>
          <button
            onClick={exportReport}
            disabled={reportBusy}
            style={{ padding: '5px 14px', borderRadius: 6, border: 'none', background: 'var(--accent, #2563eb)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >
            {reportBusy ? '导出中…' : '导出报告'}
          </button>
        </div>
      </div>
      {reportErr && <div style={{ fontSize: 12, color: 'var(--error-text, #dc2626)' }}>导出失败：{reportErr}</div>}

      {/* 总览区 */}
      <Panel title="经营总览" tip="营收=Σ已付(paid_amount>0?paid_amount:total_amount)；毛利=营收−成本(Σ数量×成本单价)；成本仅统计已付款订单。">
        <SectionState state={overview} skeletonHeight={120}>
          {overviewCards}
        </SectionState>
      </Panel>

      {/* 趋势区 */}
      <Panel
        title="趋势分析"
        extra={
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <select value={trendMetric} onChange={(e) => setTrendMetric(e.target.value as TrendMetric)} style={selectStyle}>
              {TREND_METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
            <select value={granularity} onChange={(e) => setGranularity(e.target.value as Granularity)} style={selectStyle}>
              <option value="day">按日</option>
              <option value="week">按周</option>
              <option value="month">按月</option>
            </select>
          </div>
        }
      >
        <SectionState state={trend} skeletonHeight={260}>{trendView}</SectionState>
      </Panel>

      {/* 漏斗区 */}
      <Panel title="全链路漏斗" tip="项目→选择→加购→下单→付款→复购；转化率为相对上一环节的比例，右侧红色标注流失量。">
        <SectionState state={funnel} skeletonHeight={300}>
          {(f) => (f.hasData ? <FunnelChart stages={f.stages} /> : <EmptyState title="暂无漏斗数据" reason="区间内没有可追踪的项目/订单链路" height={200} />)}
        </SectionState>
      </Panel>

      {/* 多维拆解 */}
      <Panel
        title="多维拆解"
        extra={
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <select value={dimension} onChange={(e) => setDimension(e.target.value as BreakdownDimension)} style={selectStyle}>
              {DIMENSIONS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
            <select value={breakdownMetric} onChange={(e) => setBreakdownMetric(e.target.value as BreakdownMetric)} style={selectStyle}>
              <option value="gmv">按营收</option>
              <option value="orders">按订单</option>
              <option value="gross_profit">按毛利</option>
            </select>
          </div>
        }
      >
        <SectionState state={breakdown} skeletonHeight={240}>{breakdownView}</SectionState>
      </Panel>

      {/* 商品分析 */}
      <Panel title="商品分析" tip="ABC 按累计 GMV 70/90 分界；动销率=有销售SKU/总SKU；毛利率=(GMV−成本)/GMV。">
        <SectionState state={products} skeletonHeight={320}>{productsView}</SectionState>
      </Panel>

      {/* 人效分析 */}
      <Panel title="人效分析" tip="数据来自 performance_attributions 归因表；若该表为空则如实提示暂无数据。">
        <SectionState state={employees} skeletonHeight={200}>{employeesView}</SectionState>
      </Panel>

      {/* 客户分析 */}
      <Panel title="客户分析" tip="客户身份优先级：手机号>邮箱>姓名；新客=区间首购，老客=期内有历史订单。复购率=复购客户/有订单客户。">
        <SectionState state={customers} skeletonHeight={240}>{customersView}</SectionState>
      </Panel>

      {/* 经营健康度 */}
      <Panel title="经营健康度" tip="六维评分(增长/盈利/库存/客户/履约/组织)，每维0-100；综合分=有效维度算术均值，无数据维度不计入。">
        <SectionState state={health} skeletonHeight={340}>{healthView}</SectionState>
      </Panel>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border-card)',
  background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 12,
};
