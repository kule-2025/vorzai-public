/**
 * OGSM 时间序列追踪视图（V2 · O2-O4）
 *
 * 四件套齐备：
 *   - 后端 service:    server/src/services/ogsmTrackingService.ts
 *   - 后端路由:        /api/ogsm/snapshots/* + /api/ogsm/deviations/* + /api/ogsm/metric-links/*
 *   - 前端入口:        OGSMBoard 旁的「时间序列追踪」Tab
 *   - 数据写入方:      管理员手动打点 + 自动每日 capture (createSnapshot / captureDailySnapshots)
 *
 * 能力：
 *   - 选择目标查看 90 天进度曲线（内联 SVG 折线）
 *   - 偏离告警列表（pending/ack）+ 确认
 *   - 经营对标（GMV/订单/毛利 等标的对目标完成度）
 *   - 一键批量打点
 *
 * 工程诚信：所有数据来自后端；曲线由真实 snapshot 数据绘制。
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '@api/client';
import { useToast } from '@components/Common/Toast';
import { Loading } from '@components/Common/Loading';
import { Empty } from '@components/Common/Empty';
import { Table } from '@components/Common/Table';

interface OgsmObjective {
  id: string;
  title: string;
  progress: number;
  status: string;
}

interface Snapshot {
  date: string;
  progress: number;
  alignment: number | null;
}

interface TimeSeries {
  objectiveId: string;
  objectiveTitle: string;
  snapshots: Snapshot[];
}

interface Deviation extends Record<string, unknown> {
  id: string;
  objective_id: string;
  detected_date: string;
  severity: 'info' | 'warning' | 'critical';
  expected_progress: number;
  actual_progress: number;
  message: string;
  acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
}

interface MetricLink extends Record<string, unknown> {
  id: string;
  goal_id: string;
  metric_key: string;
  period_type: string;
  scale_factor: number;
  auto_sync: number;
  status: string;
  last_value: number | null;
  last_synced_at: string | null;
}

const TODAY = (): string => new Date().toISOString().slice(0, 10);
const DAYS_AGO = (d: number): string => {
  const x = new Date();
  x.setDate(x.getDate() - d);
  return x.toISOString().slice(0, 10);
};

const METRIC_LABELS: Record<string, string> = {
  gmv: 'GMV', orders: '订单数', aov: '客单价', gross_profit: '毛利',
  gross_margin_rate: '毛利率', conversion: '转化率', refund_rate: '退款率',
  paid_orders: '支付订单', cost: '成本', active_sku: '在售SKU',
};
const PERIOD_LABELS: Record<string, string> = {
  day: '日', week: '周', month: '月', quarter: '季', year: '年',
};

export function OGSMTimeSeries() {
  const toastApi = useToast();
  const toast = (t: 'success' | 'error' | 'warning' | 'info', title: string, msg?: string) =>
    toastApi.addToast(t, title, msg);

  const [objectives, setObjectives] = useState<OgsmObjective[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [series, setSeries] = useState<TimeSeries | null>(null);
  const [deviations, setDeviations] = useState<Deviation[]>([]);
  const [metricLinks, setMetricLinks] = useState<MetricLink[]>([]);
  const [goalOptions, setGoalOptions] = useState<{ id: string; title: string; objectiveTitle: string }[]>([]);
  const [linkForm, setLinkForm] = useState<{ goalId: string; metricKey: string; periodType: string }>({ goalId: '', metricKey: 'gmv', periodType: 'month' });
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [capturing, setCapturing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [oRes, dRes, mlRes] = await Promise.all([
        api.ogsm.listObjectives(),
        api.ogsm.listDeviations({ acknowledged: false }),
        api.ogsm.listMetricLinks(),
      ]);
      if (oRes.success && oRes.data) {
        const data = Array.isArray(oRes.data) ? (oRes.data as OgsmObjective[]) : [];
        setObjectives(data);
        if (data.length > 0 && !selectedId) setSelectedId(data[0].id);
      }
      if (dRes.success && dRes.data) setDeviations(Array.isArray(dRes.data) ? (dRes.data as Deviation[]) : []);
      if (mlRes.success && mlRes.data) setMetricLinks(Array.isArray(mlRes.data) ? (mlRes.data as MetricLink[]) : []);
    } catch (e: any) {
      toast('error', '加载失败', e?.message);
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  const loadSeries = useCallback(async (id: string) => {
    if (!id) return;
    setSeriesLoading(true);
    try {
      const res = await api.ogsm.getTimeSeries(id, DAYS_AGO(90), TODAY());
      if (res.success && res.data) {
        setSeries(res.data as TimeSeries);
      } else {
        setSeries(null);
      }
    } catch (e) {
      console.warn('[OGSMTimeSeries] 加载时间序列失败:', e);
      setSeries(null);
    } finally {
      setSeriesLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (selectedId) loadSeries(selectedId); }, [selectedId, loadSeries]);

  // 加载目标列表（含各 O 目标下的 G 子目标），供「新建对标」选择
  useEffect(() => {
    if (objectives.length === 0) { setGoalOptions([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const results = await Promise.all(objectives.map(async (o) => {
          const gRes = await api.ogsm.listGoals(o.id);
          const gs = (gRes.success && gRes.data) ? (Array.isArray(gRes.data) ? (gRes.data as any[]) : []) : [];
          return gs.map((g: any) => ({ id: g.id, title: g.title ?? '目标', objectiveTitle: o.title }));
        }));
        if (!cancelled) {
          const flat = results.flat();
          setGoalOptions(flat);
          setLinkForm((f) => (f.goalId || flat.length === 0 ? f : { ...f, goalId: flat[0].id }));
        }
      } catch (e) {
        console.warn('[OGSMTimeSeries] 加载目标列表失败:', e);
        /* 目标列表加载失败不影响主流程 */
      }
    })();
    return () => { cancelled = true; };
  }, [objectives]);

  async function captureDaily() {
    setCapturing(true);
    try {
      const res = await api.ogsm.captureDailySnapshots(TODAY());
      if (res.success) {
        const r = res.data as { captured: number; updated: number };
        toast('success', '打点完成', `新增 ${r.captured} 条，更新 ${r.updated} 条`);
        await loadSeries(selectedId);
      } else {
        toast('error', '打点失败', res.error?.message);
      }
    } catch (e: any) {
      toast('error', '打点异常', e?.message);
    } finally {
      setCapturing(false);
    }
  }

  async function scanDeviations() {
    try {
      const res = await api.ogsm.scanDeviations(TODAY());
      if (res.success) {
        const r = res.data as Deviation[];
        toast('success', '扫描完成', `发现 ${r?.length ?? 0} 条偏离`);
        await load();
      }
    } catch (e: any) {
      toast('error', '扫描失败', e?.message);
    }
  }

  async function ack(id: string) {
    try {
      const res = await api.ogsm.acknowledgeDeviation(id);
      if (res.success) {
        toast('success', '已确认');
        await load();
      } else {
        toast('error', '确认失败', res.error?.message);
      }
    } catch (e: any) {
      toast('error', '操作失败', e?.message);
    }
  }

  async function createLink() {
    if (!linkForm.goalId) { toast('warning', '请先选择目标'); return; }
    setCreating(true);
    try {
      const res = await api.ogsm.createMetricLink({
        goal_id: linkForm.goalId,
        metric_key: linkForm.metricKey as any,
        period_type: linkForm.periodType as any,
      });
      if (res.success) { toast('success', '已创建经营对标'); await load(); }
      else toast('error', '创建失败', res.error?.message);
    } catch (e: any) {
      toast('error', '创建异常', e?.message);
    } finally {
      setCreating(false);
    }
  }

  async function syncLink(id: string) {
    try {
      const res = await api.ogsm.syncMetricLink(id);
      if (res.success) { toast('success', '已同步对标数据'); await load(); }
      else toast('error', '同步失败', res.error?.message);
    } catch (e: any) {
      toast('error', '同步异常', e?.message);
    }
  }

  async function deleteLink(id: string) {
    try {
      const res = await api.ogsm.deleteMetricLink(id);
      if (res.success) { toast('success', '已删除对标'); await load(); }
      else toast('error', '删除失败', res.error?.message);
    } catch (e: any) {
      toast('error', '删除异常', e?.message);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 顶部控制条 */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>选择目标:</label>
        <select
          className="input"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          style={{ minWidth: 240, maxWidth: 360 }}
        >
          {objectives.length === 0 && <option value="">（暂无目标）</option>}
          {objectives.map((o) => (
            <option key={o.id} value={o.id}>
              {o.title} · {o.progress}%
            </option>
          ))}
        </select>
        <button
          className="btn-ecom-secondary"
          onClick={captureDaily}
          disabled={capturing || objectives.length === 0}
          style={{ minHeight: 36 }}
        >
          {capturing ? '打点中...' : '📸 批量打点'}
        </button>
        <button
          className="btn-ecom-secondary"
          onClick={scanDeviations}
          disabled={loading}
          style={{ minHeight: 36 }}
        >
          🔍 扫描偏离
        </button>
      </div>

      {/* 进度曲线 */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 12, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
            {series?.objectiveTitle ?? '目标进度'}
          </h3>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>近 90 天</span>
        </div>
        {seriesLoading ? (
          <Loading text="加载曲线..." />
        ) : !series || series.snapshots.length === 0 ? (
          <Empty
            title="暂无快照数据"
            description="首次打点后才会出现曲线。点击右上「📸 批量打点」可立即生成今日快照。"
            size="sm"
          />
        ) : (
          <ProgressLineChart snapshots={series.snapshots} />
        )}
      </div>

      {/* 偏离告警 */}
      <div>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px' }}>
          偏离告警（{deviations.length}）
        </h3>
        {loading ? (
          <Loading text="加载告警..." />
        ) : deviations.length === 0 ? (
          <Empty title="暂无偏离告警" size="sm" />
        ) : (
          <Table<Deviation>
            size="sm"
            columns={[
              { key: 'detected_date', title: '日期', width: 100 },
              {
                key: 'severity',
                title: '严重度',
                width: 80,
                render: (d) => (
                  <span style={{
                    padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600,
                    background: d.severity === 'critical' ? 'var(--error-500)' :
                      d.severity === 'warning' ? 'var(--warning-500)' : 'var(--info-500)',
                    color: '#fff',
                  }}>
                    {d.severity}
                  </span>
                ),
              },
              { key: 'message', title: '描述' },
              {
                key: 'gap',
                title: '差距',
                width: 100,
                align: 'right',
                render: (d) => (
                  <span style={{ color: d.actual_progress < d.expected_progress ? 'var(--error-500)' : 'var(--text-muted)' }}>
                    {(d.actual_progress - d.expected_progress).toFixed(1)}%
                  </span>
                ),
              },
              {
                key: 'actions',
                title: '操作',
                width: 80,
                render: (d) => (
                  <button
                    className="btn-ecom-secondary"
                    style={{ fontSize: 11, padding: '4px 8px', minHeight: 28 }}
                    onClick={() => ack(d.id)}
                  >
                    确认
                  </button>
                ),
              },
            ]}
            data={deviations}
            rowKey="id"
          />
        )}
      </div>

      {/* 经营对标（O3） */}
      <div>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px' }}>
          经营对标（{metricLinks.length}）
        </h3>

        {/* 新建对标 */}
        <div style={{ background: 'var(--bg-row-hover)', border: '1px solid var(--border-card)', borderRadius: 10, padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
            新建对标（将目标关联到经营指标，自动回填实际值）
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <label htmlFor="link-goal" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>目标</label>
            <select
              id="link-goal"
              className="input"
              value={linkForm.goalId}
              onChange={(e) => setLinkForm((f) => ({ ...f, goalId: e.target.value }))}
              style={{ minWidth: 200, maxWidth: 300 }}
            >
              {goalOptions.length === 0 && <option value="">（暂无 G 目标，请先在 OGSM 看板创建）</option>}
              {goalOptions.map((g) => (
                <option key={g.id} value={g.id}>{g.title} · {g.objectiveTitle}</option>
              ))}
            </select>
            <label htmlFor="link-metric" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>指标</label>
            <select
              id="link-metric"
              className="input"
              value={linkForm.metricKey}
              onChange={(e) => setLinkForm((f) => ({ ...f, metricKey: e.target.value }))}
              style={{ minWidth: 120 }}
            >
              {Object.entries(METRIC_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <label htmlFor="link-period" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>周期</label>
            <select
              id="link-period"
              className="input"
              value={linkForm.periodType}
              onChange={(e) => setLinkForm((f) => ({ ...f, periodType: e.target.value }))}
              style={{ minWidth: 90 }}
            >
              {Object.entries(PERIOD_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <button
              className="btn-ecom"
              onClick={createLink}
              disabled={creating || goalOptions.length === 0}
              style={{ minHeight: 36 }}
            >
              {creating ? '创建中…' : '＋ 创建对标'}
            </button>
          </div>
        </div>

        {metricLinks.length === 0 ? (
          <Empty title="暂无对标配置" size="sm" />
        ) : (
          <Table<MetricLink>
            size="sm"
            columns={[
              { key: 'metric_key', title: '指标', width: 110, render: (l) => METRIC_LABELS[l.metric_key] || l.metric_key },
              { key: 'period_type', title: '周期', width: 70, render: (l) => PERIOD_LABELS[l.period_type] || l.period_type },
              { key: 'scale_factor', title: '缩放', width: 70, align: 'right', render: (l) => l.scale_factor.toFixed(2) },
              { key: 'last_value', title: '最新值', width: 100, align: 'right', render: (l) => l.last_value != null ? String(l.last_value) : '—' },
              {
                key: 'status',
                title: '状态',
                width: 80,
                render: (l) => (
                  <span style={{
                    padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600,
                    background: l.status === 'active' ? 'var(--success-500)' : 'var(--text-muted)',
                    color: '#fff',
                  }}>
                    {l.status}
                  </span>
                ),
              },
              {
                key: 'actions',
                title: '操作',
                width: 130,
                render: (l) => (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      className="btn-ecom-secondary"
                      style={{ fontSize: 11, padding: '4px 8px', minHeight: 28 }}
                      onClick={() => syncLink(l.id)}
                    >
                      同步
                    </button>
                    <button
                      className="btn-ecom-secondary"
                      style={{ fontSize: 11, padding: '4px 8px', minHeight: 28, color: 'var(--danger-600)' }}
                      onClick={() => deleteLink(l.id)}
                    >
                      删除
                    </button>
                  </div>
                ),
              },
            ]}
            data={metricLinks}
            rowKey="id"
          />
        )}
      </div>
    </div>
  );
}

// =============== ProgressLineChart (内联 SVG) ===============

interface ProgressLineChartProps {
  snapshots: Snapshot[];
}

function ProgressLineChart({ snapshots }: ProgressLineChartProps) {
  const W = 720;
  const H = 220;
  const padding = { top: 16, right: 16, bottom: 28, left: 36 };

  const { points, xTicks, yTicks } = useMemo(() => {
    if (snapshots.length === 0) return { points: '', xTicks: [], yTicks: [] };

    const innerW = W - padding.left - padding.right;
    const innerH = H - padding.top - padding.bottom;

    const dates = snapshots.map((s) => s.date);
    const minDate = dates[0];
    const maxDate = dates[dates.length - 1];
    const t0 = new Date(minDate).getTime();
    const t1 = new Date(maxDate).getTime();
    const span = Math.max(t1 - t0, 1);

    const xFor = (date: string) => padding.left + ((new Date(date).getTime() - t0) / span) * innerW;
    const yFor = (v: number) => padding.top + innerH - (v / 100) * innerH;

    const pts = snapshots.map((s) => `${xFor(s.date).toFixed(1)},${yFor(s.progress).toFixed(1)}`).join(' ');

    // X 轴刻度：5 个均匀点
    const tickCount = 5;
    const xT: { x: number; label: string }[] = [];
    for (let i = 0; i < tickCount; i++) {
      const t = t0 + (span * i) / (tickCount - 1);
      const d = new Date(t).toISOString().slice(5, 10); // MM-DD
      xT.push({ x: xFor(new Date(t).toISOString().slice(0, 10)), label: d });
    }

    // Y 轴刻度：0/25/50/75/100
    const yT = [0, 25, 50, 75, 100].map((v) => ({ y: yFor(v), label: String(v) }));

    return { points: pts, xTicks: xT, yTicks: yT };
  }, [snapshots]);

  if (snapshots.length === 0) return null;

  const innerH = H - padding.top - padding.bottom;
  const innerW = W - padding.left - padding.right;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
      {/* Y 轴网格线 + 标签 */}
      {yTicks.map((t, i) => (
        <g key={i}>
          <line
            x1={padding.left}
            x2={padding.left + innerW}
            y1={t.y}
            y2={t.y}
            stroke="var(--border-divider)"
            strokeDasharray="2,2"
          />
          <text x={padding.left - 6} y={t.y + 3} fontSize={10} fill="var(--text-muted)" textAnchor="end">
            {t.label}
          </text>
        </g>
      ))}

      {/* X 轴刻度 */}
      {xTicks.map((t, i) => (
        <text key={i} x={t.x} y={H - 8} fontSize={10} fill="var(--text-muted)" textAnchor="middle">
          {t.label}
        </text>
      ))}

      {/* 进度多边形填充 */}
      <polygon
        points={`${padding.left},${padding.top + innerH} ${points} ${padding.left + innerW},${padding.top + innerH}`}
        fill="var(--ecom-blue-500)"
        opacity="0.08"
      />

      {/* 进度折线 */}
      <polyline
        points={points}
        fill="none"
        stroke="var(--ecom-blue-500)"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* 数据点 */}
      {snapshots.map((s, i) => {
        const x = padding.left + ((new Date(s.date).getTime() - new Date(snapshots[0].date).getTime()) /
          Math.max(new Date(snapshots[snapshots.length - 1].date).getTime() - new Date(snapshots[0].date).getTime(), 1)) * innerW;
        const y = padding.top + innerH - (s.progress / 100) * innerH;
        return (
          <circle key={i} cx={x} cy={y} r={3} fill="var(--ecom-blue-500)">
            <title>{s.date}: {s.progress}%</title>
          </circle>
        );
      })}

      {/* Y 轴线 */}
      <line x1={padding.left} x2={padding.left} y1={padding.top} y2={padding.top + innerH} stroke="var(--border-card)" />
      {/* X 轴线 */}
      <line x1={padding.left} x2={padding.left + innerW} y1={padding.top + innerH} y2={padding.top + innerH} stroke="var(--border-card)" />
    </svg>
  );
}

export default OGSMTimeSeries;
