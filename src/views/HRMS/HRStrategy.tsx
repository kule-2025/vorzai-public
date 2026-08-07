/**
 * HR 差异化智能视图（V2 H3-H6）
 * H3: 岗位绩效模型库  H4: 行业日历  H5: 离职风险分析  H6: HR 战略看板
 */
import { useState, useEffect, useCallback } from 'react';
import { api } from '@api/client';
import { hrApi } from '@api/hr';
import { Card } from '@components/Common/Card';
import { Badge } from '@components/Common/Badge';
import { Button } from '@components/Common/Button';
import { Loading } from '@components/Common/Loading';
import { Empty } from '@components/Common/Empty';
import { toast } from '@components/Common/Toast';
import { useConfirm } from '@components/Common/Confirm';

type SubTab = 'job-models' | 'calendars' | 'retention' | 'dashboard';

interface JobModel {
  id: string;
  job_category: string;
  name: string;
  description: string | null;
  dimension_weights: Record<string, number>;
  kpi_template: { name: string; type: string; target: number; unit: string; weight: number }[];
  rating_scale: Record<string, number>;
  is_default: number;
}

interface HRCalendar {
  id: string;
  name: string;
  calendar_type: string;
  start_date: string | null;
  end_date: string | null;
  payload: Record<string, unknown>;
  is_recurring: number;
}

interface RetentionRisk {
  id: string;
  employee_id: string;
  employee_name?: string;
  assessment_date: string;
  attendance_risk: number;
  performance_risk: number;
  overtime_risk: number;
  total_risk_score: number;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  factors: string[];
  is_acknowledged: number;
  note: string | null;
}

interface StrategyDashboard {
  employeeCount: number;
  avgAttendanceRate: number;
  avgPerformanceScore: number;
  turnoverRiskCount: { low: number; medium: number; high: number; critical: number };
  activeCalendars: number;
  jobModels: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  operator: '运营岗', cs: '客服岗', live: '主播岗',
  crossborder: '跨境岗', hr: 'HR岗', media: '内容岗',
};

const CALENDAR_LABELS: Record<string, string> = {
  campaign: '大促', livestream: '直播', shift: '排班',
  crossborder_timezone: '跨时区', holiday: '节假日', training: '培训',
};

const RISK_COLORS: Record<string, string> = {
  low: 'var(--success-500)', medium: 'var(--warning-500)',
  high: 'var(--danger-500)', critical: 'var(--danger-600)',
};

export default function HRStrategy() {
  const [subTab, setSubTab] = useState<SubTab>('dashboard');
  const [loading, setLoading] = useState(true);

  if (loading) {
    return <Loading text="加载 HR 智能数据..." />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 子标签 */}
      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border-divider)', paddingBottom: 0 }}>
        {([
          { key: 'dashboard' as const, label: '战略看板' },
          { key: 'job-models' as const, label: '岗位模型' },
          { key: 'calendars' as const, label: '行业日历' },
          { key: 'retention' as const, label: '离职风险' },
        ]).map((t) => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            style={{
              padding: '8px 14px', background: 'transparent', border: 'none',
              color: subTab === t.key ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontWeight: subTab === t.key ? 600 : 500, fontSize: 13, cursor: 'pointer',
              borderBottom: subTab === t.key ? '2px solid var(--ecom-amber-500)' : '2px solid transparent',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === 'dashboard' && <StrategyDashboardView onNavigate={setSubTab} onLoading={setLoading} />}
      {subTab === 'job-models' && <JobModelsView onLoading={setLoading} />}
      {subTab === 'calendars' && <CalendarsView onLoading={setLoading} />}
      {subTab === 'retention' && <RetentionView onLoading={setLoading} />}
    </div>
  );
}

// ─── H6: 战略看板 ─────────────────────────────────
function StrategyDashboardView({ onNavigate, onLoading }: { onNavigate: (t: SubTab) => void; onLoading: (b: boolean) => void }) {
  const [data, setData] = useState<StrategyDashboard | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    onLoading(true);
    try {
      const res = await api.hr.getStrategyDashboard();
      setData((res as any).data ?? res);
      setErr(null);
    } catch (e: any) {
      setErr(e?.message || '加载失败');
      toast('error', '战略看板加载失败');
    } finally {
      onLoading(false);
    }
  }, [onLoading]);

  useEffect(() => { load(); }, [load]);

  if (err) return <Empty title="加载失败" description={err} />;
  if (!data) return <Loading text="加载中..." />;

  const riskTotal = data.turnoverRiskCount.low + data.turnoverRiskCount.medium + data.turnoverRiskCount.high + data.turnoverRiskCount.critical;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <Card style={{ padding: 16, borderLeft: '3px solid var(--ecom-blue-500)' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>在职员工</div>
          <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>{data.employeeCount}</div>
        </Card>
        <Card style={{ padding: 16, borderLeft: '3px solid var(--success-500)' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>平均出勤率(30天)</div>
          <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>{data.avgAttendanceRate}%</div>
        </Card>
        <Card style={{ padding: 16, borderLeft: '3px solid var(--ecom-violet-500)' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>平均绩效分(90天)</div>
          <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>{data.avgPerformanceScore}</div>
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Card style={{ padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>离职风险分布</div>
          {riskTotal === 0 ? (
            <Empty title="暂无风险记录" description="前往「离职风险」标签评估员工" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(['critical', 'high', 'medium', 'low'] as const).map((lv) => (
                <div key={lv} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 48, fontSize: 12, color: RISK_COLORS[lv] }}>
                    {lv === 'critical' ? '危急' : lv === 'high' ? '高' : lv === 'medium' ? '中' : '低'}
                  </span>
                  <div style={{ flex: 1, height: 8, background: 'var(--bg-row-hover)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(data.turnoverRiskCount[lv] / riskTotal) * 100}%`, background: RISK_COLORS[lv], borderRadius: 4 }} />
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 600, fontFamily: 'ui-monospace, monospace' }}>{data.turnoverRiskCount[lv]}</span>
                </div>
              ))}
            </div>
          )}
          <button className="btn-ghost" style={{ marginTop: 12 }} onClick={() => onNavigate('retention')}>查看详情 →</button>
        </Card>

        <Card style={{ padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>资源概览</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>岗位模型</div>
              <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>{data.jobModels}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>行业日历</div>
              <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>{data.activeCalendars}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button className="btn-ghost" onClick={() => onNavigate('job-models')}>管理岗位模型</button>
            <button className="btn-ghost" onClick={() => onNavigate('calendars')}>管理日历</button>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ─── H3: 岗位绩效模型库 ───────────────────────────
function JobModelsView({ onLoading }: { onLoading: (b: boolean) => void }) {
  const [models, setModels] = useState<JobModel[]>([]);
  const [filter, setFilter] = useState<string>('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<JobModel | null>(null);
  const [form, setForm] = useState({ job_category: 'operator', name: '', description: '', achievement: 0.4, collaboration: 0.25, innovation: 0.2, growth: 0.15 });
  const confirm = useConfirm();

  const load = useCallback(async () => {
    onLoading(true);
    try {
      const m = await api.hr.listJobModels();
      setModels(((m as any).data ?? m) || []);
    } catch (err: any) {
      toast('error', '岗位模型加载失败');
    } finally {
      onLoading(false);
    }
  }, [onLoading]);

  useEffect(() => { load(); }, [load]);

  async function seedDefaults() {
    if (!await confirm({ title: '确认灌入 5 类默认岗位模型模板？已存在时自动跳过。' })) return;
    try {
      await api.hr.seedJobModels();
      toast('success', '默认岗位模型已就绪');
      load();
    } catch (e: any) {
      toast('error', '操作失败：' + (e?.message || ''));
    }
  }

  async function save() {
    const sum = form.achievement + form.collaboration + form.innovation + form.growth;
    if (Math.abs(sum - 1) > 0.01) {
      toast('warning', '维度权重之和需为 1（当前 ' + sum.toFixed(2) + '）');
      return;
    }
    const payload = {
      job_category: form.job_category,
      name: form.name,
      description: form.description,
      dimension_weights: {
        achievement: form.achievement,
        collaboration: form.collaboration,
        innovation: form.innovation,
        growth: form.growth,
      },
      kpi_template: [],
    };
    try {
      if (editing) {
        await api.hr.updateJobModel(editing.id, payload);
        toast('success', '已更新');
      } else {
        await api.hr.createJobModel(payload);
        toast('success', '已创建');
      }
      setShowForm(false);
      setEditing(null);
      setForm({ job_category: 'operator', name: '', description: '', achievement: 0.4, collaboration: 0.25, innovation: 0.2, growth: 0.15 });
      load();
    } catch (e: any) {
      toast('error', '保存失败：' + (e?.message || ''));
    }
  }

  async function remove(m: JobModel) {
    if (!await confirm({ title: `确认删除岗位模型「${m.name}」？` })) return;
    try {
      await api.hr.deleteJobModel(m.id);
      toast('success', '已删除');
      load();
    } catch (e: any) {
      toast('error', '删除失败：' + (e?.message || ''));
    }
  }

  const filtered = filter ? models.filter((m) => m.job_category === filter) : models;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button variant="primary" size="sm" onClick={() => { setEditing(null); setShowForm(true); }}>新建模型</Button>
        <Button variant="secondary" size="sm" onClick={seedDefaults}>灌入默认模板</Button>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="select-ecom" style={{ minWidth: 120 }}>
          <option value="">全部类别</option>
          {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {showForm && (
        <Card style={{ padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{editing ? '编辑岗位模型' : '新建岗位模型'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>类别</label>
              <select value={form.job_category} onChange={(e) => setForm({ ...form, job_category: e.target.value })} className="select-ecom">
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>名称</label>
              <input className="input-ecom" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：高级运营岗" />
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>说明</label>
            <input className="input-ecom" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>维度权重（合计=1）</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 4 }}>
              {(['achievement', 'collaboration', 'innovation', 'growth'] as const).map((dim) => (
                <div key={dim}>
                  <span style={{ fontSize: 11 }}>{dim === 'achievement' ? '业绩' : dim === 'collaboration' ? '协作' : dim === 'innovation' ? '创新' : '成长'}</span>
                  <input
                    type="number" step="0.05" min="0" max="1"
                    className="input-ecom" value={form[dim]}
                    onChange={(e) => setForm({ ...form, [dim]: parseFloat(e.target.value) || 0 })}
                  />
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Button variant="primary" size="sm" onClick={save}>保存</Button>
            <Button variant="ghost" size="sm" onClick={() => { setShowForm(false); setEditing(null); }}>取消</Button>
          </div>
        </Card>
      )}

      {filtered.length === 0 ? (
        <Empty title="暂无岗位模型" description="点击「灌入默认模板」或「新建模型」" />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {filtered.map((m) => (
            <Card key={m.id} style={{ padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{m.name}</div>
                {m.is_default === 1 && <Badge variant="info">默认</Badge>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{CATEGORY_LABELS[m.job_category] || m.job_category}</div>
              {m.description && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>{m.description}</div>}
              <div style={{ marginTop: 10, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {Object.entries(m.dimension_weights).map(([k, v]) => (
                  <span key={k} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'var(--bg-row-hover)', color: 'var(--text-muted)' }}>
                    {k === 'achievement' ? '业绩' : k === 'collaboration' ? '协作' : k === 'innovation' ? '创新' : '成长'}: {(v * 100).toFixed(0)}%
                  </span>
                ))}
              </div>
              {m.kpi_template.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                  KPI: {m.kpi_template.map((k) => k.name).join('、')}
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                <Button variant="ghost" size="sm" onClick={() => { setEditing(m); setShowForm(true); }}>编辑</Button>
                <Button variant="ghost" size="sm" onClick={() => remove(m)}>删除</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── H4: 行业日历 ─────────────────────────────────
function CalendarsView({ onLoading }: { onLoading: (b: boolean) => void }) {
  const [calendars, setCalendars] = useState<HRCalendar[]>([]);
  const [upcoming, setUpcoming] = useState<HRCalendar[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', calendar_type: 'campaign', start_date: '', end_date: '', is_recurring: false });
  const confirm = useConfirm();

  const load = useCallback(async () => {
    onLoading(true);
    try {
      const [all, up] = await Promise.all([
        api.hr.listCalendars(),
        api.hr.listUpcomingCalendars(30),
      ]);
      setCalendars(((all as any).data ?? all) || []);
      setUpcoming(((up as any).data ?? up) || []);
    } catch (e: any) {
      toast('error', '日历加载失败');
    } finally {
      onLoading(false);
    }
  }, [onLoading]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!form.name.trim()) { toast('warning', '请填写名称'); return; }
    try {
      await api.hr.createCalendar({
        name: form.name,
        calendar_type: form.calendar_type,
        start_date: form.start_date || undefined,
        end_date: form.end_date || undefined,
        is_recurring: form.is_recurring,
      });
      toast('success', '已创建日历事件');
      setShowForm(false);
      setForm({ name: '', calendar_type: 'campaign', start_date: '', end_date: '', is_recurring: false });
      load();
    } catch (e: any) {
      toast('error', '创建失败：' + (e?.message || ''));
    }
  }

  async function remove(c: HRCalendar) {
    if (!await confirm({ title: `确认删除「${c.name}」？` })) return;
    try {
      await api.hr.deleteCalendar(c.id);
      toast('success', '已删除');
      load();
    } catch (e: any) {
      toast('error', '删除失败：' + (e?.message || ''));
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="primary" size="sm" onClick={() => setShowForm(true)}>新建日历事件</Button>
      </div>

      {upcoming.length > 0 && (
        <Card style={{ padding: 14, borderLeft: '3px solid var(--ecom-amber-500)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>未来 30 天即将到来</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {upcoming.slice(0, 5).map((c) => (
              <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
                <Badge variant="warning">{CALENDAR_LABELS[c.calendar_type] || c.calendar_type}</Badge>
                <span style={{ flex: 1 }}>{c.name}</span>
                {c.start_date && <span style={{ color: 'var(--text-muted)' }}>{c.start_date}{c.end_date ? ` ~ ${c.end_date}` : ''}</span>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {showForm && (
        <Card style={{ padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>新建日历事件</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>名称</label>
              <input className="input-ecom" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：双11大促" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>类型</label>
              <select value={form.calendar_type} onChange={(e) => setForm({ ...form, calendar_type: e.target.value })} className="select-ecom">
                {Object.entries(CALENDAR_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>开始日期</label>
              <input type="date" className="input-ecom" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>结束日期</label>
              <input type="date" className="input-ecom" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 12 }}>
            <input type="checkbox" checked={form.is_recurring} onChange={(e) => setForm({ ...form, is_recurring: e.target.checked })} />
            每年重复
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Button variant="primary" size="sm" onClick={save}>创建</Button>
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>取消</Button>
          </div>
        </Card>
      )}

      {calendars.length === 0 ? (
        <Empty title="暂无日历事件" description="点击「新建日历事件」添加大促/直播/排班" />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {calendars.map((c) => (
            <Card key={c.id} style={{ padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</div>
                <Badge variant="info">{CALENDAR_LABELS[c.calendar_type] || c.calendar_type}</Badge>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                {c.start_date || '未设开始'}{c.end_date ? ` ~ ${c.end_date}` : ''}
                {c.is_recurring === 1 && ' · 每年重复'}
              </div>
              <div style={{ marginTop: 10 }}>
                <Button variant="ghost" size="sm" onClick={() => remove(c)}>删除</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── H5: 离职风险分析 ─────────────────────────────
function RetentionView({ onLoading }: { onLoading: (b: boolean) => void }) {
  const [risks, setRisks] = useState<RetentionRisk[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [selectedEmp, setSelectedEmp] = useState<string>('');
  const [filter, setFilter] = useState<string>('');
  const confirm = useConfirm();

  const load = useCallback(async () => {
    onLoading(true);
    try {
      const [r, e] = await Promise.all([
        api.hr.listRetentionRisks(filter ? { risk_level: filter } : undefined),
        hrApi.listEmployees(),
      ]);
      setRisks(((r as any).data ?? r) || []);
      setEmployees(((e as any).data ?? e) || []);
    } catch (err: any) {
      toast('error', '风险数据加载失败');
    } finally {
      onLoading(false);
    }
  }, [onLoading, filter]);

  useEffect(() => { load(); }, [load]);

  async function assess() {
    if (!selectedEmp) { toast('warning', '请选择员工'); return; }
    try {
      await api.hr.assessRetention(selectedEmp);
      toast('success', '评估完成');
      setSelectedEmp('');
      load();
    } catch (e: any) {
      toast('error', '评估失败：' + (e?.message || ''));
    }
  }

  async function acknowledge(r: RetentionRisk) {
    if (!await confirm({ title: '确认标记该风险已处理？' })) return;
    try {
      await api.hr.acknowledgeRetentionRisk(r.id);
      toast('success', '已确认');
      load();
    } catch (e: any) {
      toast('error', '操作失败：' + (e?.message || ''));
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={selectedEmp} onChange={(e) => setSelectedEmp(e.target.value)} className="select-ecom" style={{ minWidth: 160 }}>
          <option value="">选择员工评估</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <Button variant="primary" size="sm" onClick={assess}>执行评估</Button>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="select-ecom" style={{ minWidth: 120 }}>
          <option value="">全部等级</option>
          <option value="critical">危急</option>
          <option value="high">高</option>
          <option value="medium">中</option>
          <option value="low">低</option>
        </select>
      </div>

      {risks.length === 0 ? (
        <Empty title="暂无离职风险记录" description="选择员工点击「执行评估」生成风险评分" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {risks.map((r) => (
            <Card key={r.id} style={{ padding: 14, borderLeft: `3px solid ${RISK_COLORS[r.risk_level]}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  {r.employee_name || employees.find((e) => e.id === r.employee_id)?.name || '未知员工'}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 20, fontWeight: 700, fontFamily: 'ui-monospace, monospace', color: RISK_COLORS[r.risk_level] }}>
                    {r.total_risk_score}
                  </span>
                  <Badge variant={r.risk_level === 'low' ? 'success' : r.risk_level === 'medium' ? 'warning' : 'danger'}>
                    {r.risk_level === 'critical' ? '危急' : r.risk_level === 'high' ? '高' : r.risk_level === 'medium' ? '中' : '低'}
                  </Badge>
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>评估日期: {r.assessment_date}</div>
              <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 12 }}>
                <span>考勤: {r.attendance_risk}</span>
                <span>绩效: {r.performance_risk}</span>
                <span>加班: {r.overtime_risk}</span>
              </div>
              {r.factors.length > 0 && (
                <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {r.factors.map((f, i) => (
                    <span key={i} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'var(--bg-row-hover)', color: 'var(--text-muted)' }}>{f}</span>
                  ))}
                </div>
              )}
              <div style={{ marginTop: 8 }}>
                {r.is_acknowledged === 1 ? (
                  <Badge variant="success">已处理</Badge>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => acknowledge(r)}>标记已处理</Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
