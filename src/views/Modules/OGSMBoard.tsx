/**
 * OGSM 管理看板 — 数据可视化仪表盘
 *
 * 模块：
 *   1. 顶部统计卡片（CSS Grid）
 *   2. 整体进度环形图 + 目标明细进度条（纯 CSS conic-gradient / linear-gradient）
 *   3. 责任人矩阵（RACI 表格）
 *   4. 激励机制看板
 *
 * 数据源：GET /api/ogsm/stats · /objectives/:id/progress · /raci · /incentives/summary
 */
import React, { useState, useEffect, useMemo } from 'react';
import api from '@api/client';
import './OGSMBoard.css';
import OGSMTimeSeries from './OGSMTimeSeries';
import RACIEnhanced from './RACIEnhanced';

// ─── Types ────────────────────────────────────────────────────────

interface StatsObjectives { total: number; active: number; completed: number; inProgress: number; cancelled: number; }
interface StatsGoals { total: number; achieved: number; inProgress: number; onTimeRate: number | null; }
interface StatsCount { total: number; completed: number; completionRate: number | null; }
interface IncentivesStat { total: number; active: number; totalAmount: number | null; byType: Record<string, number>; byStatus: Record<string, number>; }
interface OGSMStats {
  objectives: StatsObjectives;
  goals: StatsGoals;
  strategies: StatsCount;
  measures: StatsCount;
  averageProgress: number;
  averageAlignment: number | null;
  raciCoverage: number | null;
  incentives: IncentivesStat;
  raciRecords: number;
}

interface RaciOwner { userId: string; userName: string; role: string; }
interface RaciAssignment { user_id: string; user_name: string; responsibility: 'R' | 'A' | 'C' | 'I'; }
interface RaciRow { entityType: string; entityId: string; entityTitle: string; assignedUsers: number; hasA: boolean; hasR: boolean; assignments: RaciAssignment[]; }
interface RACIMatrix { owners: RaciOwner[]; rows: RaciRow[]; }

interface IncentiveByType { type: string; count: number; totalAmount: number; }
interface IncentiveRecords { pending: number; approved: number; paid: number; rejected: number; totalAmount: number; }
interface IncentiveSummary { total: number; active: number; totalAmount: number; currency: string; byType: IncentiveByType[]; records: IncentiveRecords; }

// ─── 环形进度（纯 CSS conic-gradient）────────────────────────────

const DonutProgress = ({ value, size = 120, stroke = 12, color }: { value: number; size?: number; stroke?: number; color?: string }) => {
  const v = Math.max(0, Math.min(100, value));
  const pct = v / 100;
  const angle = pct * 360;
  const gradient = color
    ? `conic-gradient(${color} ${angle}deg, var(--bg-row-hover) 0deg)`
    : `conic-gradient(var(--dashboard-primary) ${angle}deg, var(--bg-row-hover) 0deg)`;
  const holeSize = size - stroke * 2;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <div style={{ width: size, height: size, borderRadius: '50%', background: gradient }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-card)' }}>
          <div style={{ width: holeSize, height: holeSize, borderRadius: '50%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>{Math.round(v)}</span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>%</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── 水平进度条 ──────────────────────────────────────────────────

const ProgressLine = ({ value, label, color }: { value: number; label: string; color?: string }) => {
  const v = Math.max(0, Math.min(100, value));
  const grad = color
    ? color
    : `linear-gradient(90deg, var(--dashboard-primary) 0%, var(--dashboard-accent) 100%)`;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 11, color: 'var(--text-secondary)' }}>
        <span>{label}</span>
        <span>{Math.round(v)}%</span>
      </div>
      <div style={{ height: 6, background: 'var(--bg-row-hover)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${v}%`, height: '100%', background: grad, borderRadius: 3, transition: 'width 0.4s ease' }} />
      </div>
    </div>
  );
};

// ─── RACI 色点 ───────────────────────────────────────────────────

const RaciDot = ({ type }: { type: 'R' | 'A' | 'C' | 'I' }) => (
  <span className={`raci-badge ${type}`} title={{ R: '执行', A: '审批', C: '咨询', I: '知会' }[type as string]} />
);

// RACI 表格行（memo：避免父组件重渲染时整表重算）
const RaciTableRow = React.memo(function RaciTableRow({ row, owners }: { row: RaciRow; owners: RaciOwner[] }) {
  return (
    <tr key={row.entityId} className="row-hoverable" style={{ borderBottom: '1px solid var(--border-divider)' }}>
      <td style={{ padding: '8px 10px', fontSize: 12, fontWeight: 500 }}>{row.entityTitle}</td>
      <td style={{ textAlign: 'center', padding: '8px 6px', fontSize: 12 }}>{row.assignedUsers}</td>
      <td style={{ textAlign: 'center', padding: '8px 6px', fontSize: 12 }}>
        {row.hasR ? <RaciDot type="R" /> : <span style={{ color: 'var(--text-muted)' }}>-</span>}
        {' '}
        {row.hasA ? <RaciDot type="A" /> : <span style={{ color: 'var(--text-muted)' }}>-</span>}
      </td>
      {owners.map((o) => {
        const a = row.assignments.find((x) => x.user_id === o.userId);
        return (
          <td key={o.userId} style={{ textAlign: 'center', padding: '8px 6px' }}>
            {a ? <RaciDot type={a.responsibility} /> : <span style={{ color: 'var(--text-muted)' }}>·</span>}
          </td>
        );
      })}
      <td style={{ padding: '8px 6px', fontSize: 10, color: 'var(--text-muted)' }}>
        {row.assignments.map((a) => `${a.user_name}${a.responsibility}`).join(' / ')}
      </td>
    </tr>
  );
});

// ─── 类型标签 ────────────────────────────────────────────────────

const TypeLabel = ({ text }: { text: string }) => {
  const map: Record<string, string> = {
    bonus: '奖金', commission: '提成', promotion: '晋升', recognition: '表彰', penalty: '处罚',
  };
  return map[text] || text;
};

const StatusLabel = ({ text }: { text: string }) => {
  const map: Record<string, string> = {
    draft: '草稿', active: '生效中', expired: '已过期', cancelled: '已取消',
  };
  return map[text] || text;
};

// ─── 主组件 ──────────────────────────────────────────────────────

export default function OGSMBoard() {
  const [stats, setStats] = useState<OGSMStats | null>(null);
  const [raci, setRaci] = useState<RACIMatrix | null>(null);
  const [incentives, setIncentives] = useState<IncentiveSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'stats' | 'raci' | 'raci-enhanced' | 'incentives' | 'timeseries'>('stats');
  const [raciFilter, setRaciFilter] = useState('all');
  const [raciSearch, setRaciSearch] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      try {
        const [sRes, rRes, iRes] = await Promise.all([
          api.ogsm.getOGSMStats(),
          api.ogsm.getRACIMatrix(),
          api.ogsm.getIncentiveSummary(),
        ]);
        if (sRes.success) setStats(sRes.data as OGSMStats);
        else setError(sRes.error?.message || '统计数据获取失败');
        if (rRes.success) setRaci(rRes.data as RACIMatrix);
        if (iRes.success) setIncentives(iRes.data as IncentiveSummary);
      } catch (e) {
        setError(String(e));
      }
      setLoading(false);
    })();
  }, []);

  const obj = stats?.objectives ?? { total: 0, active: 0, completed: 0, inProgress: 0, cancelled: 0 };
  const goals = stats?.goals ?? { total: 0, achieved: 0, inProgress: 0, onTimeRate: null };
  const strategies = stats?.strategies ?? { total: 0, completed: 0, completionRate: null };
  const measures = stats?.measures ?? { total: 0, achieved: 0, completionRate: null };
  const incStat = stats?.incentives ?? { total: 0, active: 0, totalAmount: 0, byType: {}, byStatus: {} };

  // 计算完成率
  const completionRate = useMemo(() => obj.total > 0 ? Math.round(obj.completed / obj.total * 100) : 0, [obj]);

  // 过滤责任人矩阵
  const filteredRows = useMemo(() => {
    if (!raci) return [];
    let rows = raci.rows;
    if (raciFilter === 'missing') rows = rows.filter((r) => !r.hasR || !r.hasA);
    if (raciFilter === 'complete') rows = rows.filter((r) => r.hasR && r.hasA);
    if (raciSearch) rows = rows.filter((r) => r.entityTitle.includes(raciSearch));
    return rows;
  }, [raci, raciFilter, raciSearch]);

  // 卡片定义
  const statCards = [
    { label: '总目标数', value: obj.total, color: 'var(--dashboard-primary)' },
    { label: '已完成目标', value: obj.completed, color: 'var(--success-500)' },
    { label: '总策略数', value: strategies.total, color: 'var(--ecom-blue-500)' },
    { label: '总度量数', value: measures.total, color: 'var(--ecom-violet-500)' },
    { label: '完成率', value: `${completionRate}%`, color: 'var(--success-500)' },
    { label: '平均对齐率', value: stats?.averageAlignment != null ? `${stats.averageAlignment}%` : '—', color: 'var(--dashboard-accent)' },
    { label: '责任人覆盖率', value: stats?.raciCoverage != null ? `${stats.raciCoverage}%` : '—', color: 'var(--module-chain)' },
    { label: 'RACI 记录', value: incStat.total > 0 ? stats?.raciRecords ?? 0 : 0, color: 'var(--module-agent)' },
  ];

  // ─── 渲染 ─────────────────────────────────────────────────────

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
      <span>正在加载 OGSM 看板数据…</span>
    </div>
  );

  if (error) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 24 }}>
      <div className="card" style={{ maxWidth: 400, textAlign: 'center' }}>
        <span style={{ color: 'var(--danger-text)', fontSize: 14 }}>{error}</span>
        <div style={{ marginTop: 12 }}>
          <button className="btn" onClick={() => window.location.reload()}>刷新</button>
        </div>
      </div>
    </div>
  );

  const tabs = [
    { id: 'stats' as const, label: '概览' },
    { id: 'raci' as const, label: '责任人矩阵' },
    { id: 'raci-enhanced' as const, label: 'RACI 增强' },
    { id: 'incentives' as const, label: '激励看板' },
    { id: 'timeseries' as const, label: '时间序列' },
  ];

  return (
    <div className="ogsm-board">
      {/* 顶部统计卡片 */}
      <section className="ogsm-stat-grid">
        {statCards.map((c, i) => (
          <div key={i} className="ogsm-stat-card" style={{ borderLeft: `3px solid ${c.color}` }}>
            <span className="stat-label">{c.label}</span>
            <span className="stat-number" style={{ color: c.color }}>{c.value}</span>
          </div>
        ))}
      </section>

      {/* Tab 导航 */}
      <div className="tab-header">
        {tabs.map((t) => (
          <div
            key={t.id}
            className={`tab-item ${activeTab === t.id ? 'tab-active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >{t.label}</div>
        ))}
      </div>

      {/* ─── 概览 Tab ─── */}
      {activeTab === 'stats' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
          {/* 整体进度环形 */}
          <div className="card">
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>整体进度概览</div>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <DonutProgress value={stats?.averageProgress ?? 0} size={110} />
              <div>
                <ProgressLine value={obj.active > 0 ? Math.round(obj.inProgress / Math.max(obj.active, 1) * 100) : 0} label="进行中目标比例" />
                <ProgressLine value={completionRate} label="目标完成率" />
                <ProgressLine value={strategies.completionRate ?? 0} label="策略完成率" />
                <ProgressLine value={measures.completionRate ?? 0} label="度量完成率" />
                <ProgressLine value={stats?.averageAlignment ?? 0} label="平均对齐率" color="linear-gradient(90deg, var(--dashboard-accent), var(--ecom-violet-500))" />
                <ProgressLine value={stats?.raciCoverage ?? 0} label="责任人覆盖率" color="linear-gradient(90deg, var(--module-chain), var(--ecom-blue-500))" />
              </div>
            </div>
            <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-muted)' }}>
              {goals.onTimeRate != null && `${goals.onTimeRate}% 的目标指标按时完成（共 ${goals.total} 项，已完成 ${goals.achieved}）`}
            </div>
          </div>

          {/* 激励摘要预览 */}
          <div className="card">
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>激励概览</div>
            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <DonutProgress value={incStat.total > 0 ? Math.round(incStat.active / incStat.total * 100) : 0} size={100} color="var(--dashboard-accent)" />
                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>生效中占比</span>
              </div>
              <div style={{ flex: 1, fontSize: 12, color: 'var(--text-secondary)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span>总激励方案</span><span style={{ fontWeight: 600 }}>{incStat.total}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span>当前生效</span><span style={{ fontWeight: 600, color: 'var(--success-text)' }}>{incStat.active}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span>激励总额</span><span style={{ fontWeight: 600 }}>{incStat.totalAmount?.toLocaleString() ?? '0'} CNY</span></div>
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {Object.entries(incStat.byType).map(([t, c]) => (
                    <span key={t} className="badge badge-info" style={{ fontSize: 10 }}>{TypeLabel({ text: t })} {c}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── 责任人矩阵 Tab ─── */}
      {activeTab === 'raci' && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>RACI 责任人矩阵</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              <span className="raci-badge R" style={{ marginRight: 2 }} />R-执行
              <span style={{ marginLeft: 8, marginRight: 2 }} className="raci-badge A" />A-审批
              <span style={{ marginLeft: 8, marginRight: 2 }} className="raci-badge C" />C-咨询
              <span style={{ marginLeft: 8, marginRight: 2 }} className="raci-badge I" />I-知会
            </span>
          </div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            <input
              className="input"
              style={{ width: 220 }}
              placeholder="搜索责任实体…"
              value={raciSearch}
              onChange={(e) => setRaciSearch(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 4 }}>
              {[
                { id: 'all', label: '全部' },
                { id: 'complete', label: '已完整' },
                { id: 'missing', label: '缺责任人' },
              ].map((f) => (
                <button
                  key={f.id}
                  className={`btn-sm ${raciFilter === f.id ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setRaciFilter(f.id)}
                >{f.label}</button>
              ))}
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="raci-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '8px 10px', width: 260 }}>责任实体</th>
                  <th style={{ textAlign: 'center', padding: '8px 10px' }}>人数</th>
                  <th style={{ textAlign: 'center', padding: '8px 10px' }}>R/A</th>
                  {raci?.owners.map((o) => (
                    <th key={o.userId} style={{ textAlign: 'center', padding: '8px 6px', whiteSpace: 'nowrap' }}>
                      <div>{o.userName}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>{o.role}</div>
                    </th>
                  ))}
                  <th style={{ textAlign: 'center', padding: '8px 10px' }}>分配明细</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr><td colSpan={5 + (raci?.owners.length ?? 0)} style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>暂无责任实体</td></tr>
                ) : filteredRows.map((row) => (
                  <RaciTableRow key={row.entityId} row={row} owners={raci?.owners ?? []} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── RACI 增强 Tab ─── */}
      {activeTab === 'raci-enhanced' && <RACIEnhanced />}

      {/* ─── 激励看板 Tab ─── */}
      {activeTab === 'incentives' && incentives && (
        <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* 激励概览卡片 */}
          <div className="card">
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>激励方案总览</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[
                { label: '总方案数', value: incentives.total, color: 'var(--dashboard-primary)' },
                { label: '生效中', value: incentives.active, color: 'var(--success-500)' },
                { label: '激励总额', value: `${incentives.totalAmount.toLocaleString()} ${incentives.currency}`, color: 'var(--ecom-blue-500)' },
                { label: '生效占比', value: `${incentives.total > 0 ? Math.round(incentives.active / incentives.total * 100) : 0}%`, color: 'var(--dashboard-accent)' },
              ].map((c, i) => (
                <div key={i} style={{ padding: 10, background: 'var(--bg-row-hover)', borderRadius: 8, borderLeft: `3px solid ${c.color}` }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.label}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: c.color, marginTop: 4 }}>{c.value}</div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 8 }}>按类型分布</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {incentives.byType.map((b) => (
                  <div key={b.type} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <span style={{ width: 56, color: 'var(--text-secondary)' }}>{TypeLabel({ text: b.type })}</span>
                    <span style={{ width: 36, color: 'var(--text-muted)' }}>{b.count} 项</span>
                    <div style={{ flex: 1, height: 6, background: 'var(--bg-row-hover)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${incentives.total > 0 ? b.count / incentives.total * 100 : 0}%`, height: '100%', background: 'var(--dashboard-accent)', borderRadius: 3 }} />
                    </div>
                    <span style={{ width: 80, textAlign: 'right', color: 'var(--text-secondary)' }}>{b.totalAmount.toLocaleString()} {incentives.currency}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 激励发放记录 */}
          <div className="card">
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>激励发放记录</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              {[
                { label: '待审批', value: incentives.records.pending, color: 'var(--warning-500)', bg: 'var(--warning-50)' },
                { label: '已审批', value: incentives.records.approved, color: 'var(--success-500)', bg: 'var(--success-50)' },
                { label: '已发放', value: incentives.records.paid, color: 'var(--ecom-blue-500)', bg: 'var(--info-50)' },
                { label: '已拒绝', value: incentives.records.rejected, color: 'var(--danger-500)', bg: 'var(--danger-50)' },
              ].map((s, i) => (
                <div key={i} className="badge" style={{ background: s.bg, color: s.color, padding: '8px 4px', textAlign: 'center' }}>
                  <div style={{ fontSize: 11 }}>{s.label}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>{s.value}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
              发放总额：{incentives.records.totalAmount.toLocaleString()} {incentives.currency}
            </div>

            <div style={{ marginTop: 16, padding: 12, background: 'var(--bg-row-hover)', borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>说明</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.6 }}>
                激励方案与 RACI 责任人挂钩，当目标 / 策略完成率达标时自动触发；
                管理审批后进入发放流程。更多详情请在立项 OGSM 模块中查看。
              </div>
            </div>
          </div>
        </div>
      )}
      {activeTab === 'timeseries' && <OGSMTimeSeries />}
    </div>
  );
}
