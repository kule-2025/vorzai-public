/**
 * 激励规则引擎（V2 · I1-I4）
 *
 * 四件套齐备：
 *   - 后端 service:    server/src/services/incentiveRuleEngine.ts
 *   - 后端路由:        /api/incentives/rules（CRUD）+ /api/incentives/calc/:period
 *   - 前端入口:        HRMS 「激励机制」Tab + 本组件
 *   - 数据写入方:      运营/HR 管理员 + 批量结算引擎
 *
 * I1 规则 CRUD（4 类型：commission/bonus/special/points）
 * I2 批量结算（按月 YYYY-MM 触发，引擎自动产生 incentive_records）
 * I3 审批流（pending→approved→paid）
 * I4 心理激励（积分商城 + 成就徽章 SVG）
 *
 * 工程诚信：所有数据来自后端；不允许用 Math.random() 伪造计算结果。
 */
import { useState, useEffect, useCallback } from 'react';
import { api } from '@api/client';
import { useConfirm } from '@components/Common/Confirm';
import { toast } from '@components/Common/Toast';
import { Modal } from '@components/Common/Modal';
import { Loading } from '@components/Common/Loading';
import { Empty } from '@components/Common/Empty';
import { Table } from '@components/Common/Table';

type RuleType = 'commission' | 'bonus' | 'special' | 'points';
type TriggerType = 'always' | 'order_threshold' | 'achievement_threshold';
type Status = 'active' | 'inactive' | 'draft' | 'archived';

interface IncentiveRule extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  name: string;
  rule_type: RuleType;
  description: string | null;
  trigger_config: { trigger_type: TriggerType; threshold?: number; metric?: string };
  formula: string;
  target_type: string | null;
  target_id: string | null;
  min_payout: number;
  max_payout: number | null;
  priority: number;
  effective_from: string | null;
  effective_to: string | null;
  status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface CalcDetail extends Record<string, unknown> {
  ruleId: string;
  ruleName: string;
  ruleType: RuleType;
  userId: string;
  userName: string;
  computedAmount: number;
  cappedAmount: number;
  triggers: boolean;
}

interface CalcSummary {
  period: string;
  rulesScanned: number;
  rulesTriggered: number;
  employeesEvaluated: number;
  totalPayout: number;
  details: CalcDetail[];
  generatedAt: string;
}

const RULE_TYPE_LABELS: Record<RuleType, string> = {
  commission: '业绩提成',
  bonus: '团队奖金',
  special: '专项激励',
  points: '积分激励',
};

const FORMULA_HINTS = [
  { label: 'GMV 提成 1%', value: '${total_gmv} * 0.01' },
  { label: '订单数 × 10', value: '${order_count} * 10' },
  { label: '利润 30%', value: '${profit} * 0.3' },
  { label: '人均达成奖励', value: '${employee_count} * 100' },
  { label: 'GMV 综合 0.5% + 订单 × 5', value: '${total_gmv} * 0.005 + ${order_count} * 5' },
];

const PERIOD_PREV = (): string => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export function IncentiveEngine() {
  const confirm = useConfirm();  const [rules, setRules] = useState<IncentiveRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [calcBusy, setCalcBusy] = useState(false);
  const [editing, setEditing] = useState<IncentiveRule | null>(null);
  const [creating, setCreating] = useState(false);
  const [period, setPeriod] = useState<string>(PERIOD_PREV());
  const [summary, setSummary] = useState<CalcSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.incentive.listRules();
      if (res.success && res.data) {
        setRules(Array.isArray(res.data) ? (res.data as IncentiveRule[]) : []);
      } else {
        toast('error', '加载规则失败', res.error?.message);
        setRules([]);
      }
    } catch (e: any) {
      toast('error', '无法连接后端', e?.message);
      setRules([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSummary = useCallback(async (p: string) => {
    setSummaryLoading(true);
    try {
      const res = await api.incentive.getCalcSummary(p);
      if (res.success && res.data) {
        setSummary(res.data as CalcSummary);
      } else {
        setSummary(null);
      }
    } catch (e) {
      console.warn('[IncentiveEngine] 加载摘要失败:', e);
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadSummary(period); }, [period, loadSummary]);

  async function runCalc() {
    const ok = await confirm({
      title: `确认结算 ${period} 周期？`,
      content: '系统将按所有「启用」规则对员工绩效进行批量结算，生成激励记录。已存在记录将按规则幂等更新。',
      confirmText: '开始结算',
      tone: 'warning',
    });
    if (!ok) return;
    setCalcBusy(true);
    try {
      const res = await api.incentive.calcPeriod(period);
      if (res.success) {
        const r = res.data as CalcSummary;
        toast('success', '结算完成', `触发 ${r?.rulesTriggered ?? 0} 条规则，合计 ¥${r?.totalPayout?.toFixed(2) ?? '0.00'}`);
        await loadSummary(period);
      } else {
        toast('error', '结算失败', res.error?.message);
      }
    } catch (e: any) {
      toast('error', '结算异常', e?.message);
    } finally {
      setCalcBusy(false);
    }
  }

  async function archiveRule(r: IncentiveRule) {
    const ok = await confirm({
      title: '归档该规则？',
      content: `规则「${r.name}」将不再参与结算，但历史记录保留。`,
      confirmText: '归档',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const res = await api.incentive.deleteRule(r.id);
      if (res.success) {
        toast('success', '已归档', r.name);
        await load();
      } else {
        toast('error', '归档失败', res.error?.message);
      }
    } catch (e: any) {
      toast('error', '操作失败', e?.message);
    }
  }

  async function toggleStatus(r: IncentiveRule) {
    const next: Status = r.status === 'active' ? 'inactive' : 'active';
    try {
      const res = await api.incentive.updateRule(r.id, { status: next });
      if (res.success) {
        toast('success', next === 'active' ? '已启用' : '已停用', r.name);
        await load();
      } else {
        toast('error', '状态变更失败', res.error?.message);
      }
    } catch (e: any) {
      toast('error', '操作失败', e?.message);
    }
  }

  const activeCount = rules.filter((r) => r.status === 'active').length;
  const archivedCount = rules.filter((r) => r.status === 'archived').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 顶部概览卡 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <StatCard label="规则总数" value={rules.length} sub={`${activeCount} 启用 / ${archivedCount} 归档`} tone="info" />
        <StatCard
          label={summary?.period ?? period}
          value={summary ? `¥${summary.totalPayout.toFixed(2)}` : '—'}
          sub={summary ? `${summary.employeesEvaluated} 人 / ${summary.rulesTriggered} 条规则触发` : '暂无结算'}
          tone="success"
        />
        <StatCard
          label="结算周期"
          value={period}
          sub="YYYY-MM 格式"
          tone="warning"
        />
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-card)',
            borderRadius: 12,
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>操作</div>
          <button
            className="btn-ecom"
            onClick={() => setCreating(true)}
            style={{ minHeight: 36 }}
          >
            + 新建规则
          </button>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="text"
              pattern="\d{4}-\d{2}"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              placeholder="YYYY-MM"
              style={{
                flex: 1, minWidth: 0, padding: '6px 8px', borderRadius: 6,
                border: '1px solid var(--border-card)',
                background: 'var(--bg-input)',
                color: 'var(--text-primary)', fontSize: 12,
              }}
            />
            <button
              className="btn-ecom-secondary"
              onClick={runCalc}
              disabled={calcBusy}
              style={{ minHeight: 36, whiteSpace: 'nowrap' }}
            >
              {calcBusy ? '结算中…' : '▶ 结算'}
            </button>
          </div>
        </div>
      </div>

      {/* 规则列表 */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>激励规则</h3>
        </div>
        {loading ? (
          <Loading text="加载规则..." />
        ) : rules.length === 0 ? (
          <Empty
            title="暂无激励规则"
            description="点击右上「+ 新建规则」配置第一条激励规则。规则支持 4 种类型：业绩提成 / 团队奖金 / 专项激励 / 积分激励。"
            action={
              <button className="btn-ecom" onClick={() => setCreating(true)}>
                + 新建规则
              </button>
            }
          />
        ) : (
          <Table<IncentiveRule>
            columns={[
              {
                key: 'name',
                title: '规则名称',
                render: (r) => (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontWeight: 500 }}>{r.name}</span>
                    {r.description && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.description}</span>}
                  </div>
                ),
              },
              {
                key: 'rule_type',
                title: '类型',
                width: 120,
                render: (r) => (
                  <span style={{
                    padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 500,
                    background: 'var(--bg-sidebar)', color: 'var(--text-secondary)',
                  }}>
                    {RULE_TYPE_LABELS[r.rule_type]}
                  </span>
                ),
              },
              {
                key: 'formula',
                title: '公式',
                render: (r) => (
                  <code style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-primary)' }}>
                    {r.formula}
                  </code>
                ),
              },
              {
                key: 'trigger',
                title: '触发',
                width: 140,
                render: (r) => {
                  const t = r.trigger_config;
                  if (t.trigger_type === 'always') return <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>无条件</span>;
                  if (t.trigger_type === 'order_threshold') return <span style={{ fontSize: 11 }}>订单 GMV ≥ {t.threshold ?? '?'}</span>;
                  return <span style={{ fontSize: 11 }}>达成率 ≥ {t.threshold ?? '?'}%</span>;
                },
              },
              {
                key: 'status',
                title: '状态',
                width: 80,
                render: (r) => (
                  <span style={{
                    padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600,
                    background: r.status === 'active' ? 'var(--success-500)' :
                      r.status === 'archived' ? 'var(--text-muted)' : 'var(--warning-500)',
                    color: '#fff',
                  }}>
                    {r.status}
                  </span>
                ),
              },
              {
                key: 'actions',
                title: '操作',
                width: 200,
                render: (r) => (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      className="btn-ecom-secondary"
                      style={{ fontSize: 11, padding: '4px 8px', minHeight: 28 }}
                      onClick={() => setEditing(r)}
                    >
                      编辑
                    </button>
                    {r.status !== 'archived' && (
                      <button
                        className="btn-ecom-secondary"
                        style={{ fontSize: 11, padding: '4px 8px', minHeight: 28 }}
                        onClick={() => toggleStatus(r)}
                      >
                        {r.status === 'active' ? '停用' : '启用'}
                      </button>
                    )}
                    {r.status !== 'archived' && (
                      <button
                        className="btn-ecom-secondary"
                        style={{ fontSize: 11, padding: '4px 8px', minHeight: 28, color: 'var(--error-500)' }}
                        onClick={() => archiveRule(r)}
                      >
                        归档
                      </button>
                    )}
                  </div>
                ),
              },
            ]}
            data={rules}
            rowKey="id"
          />
        )}
      </div>

      {/* 结算汇总 */}
      <div>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px' }}>
          {period} 结算结果
        </h3>
        {summaryLoading ? (
          <Loading text="加载结算..." />
        ) : !summary ? (
          <Empty
            title="本期尚未结算"
            description="点击右上「▶ 结算」按钮触发批量计算。"
            size="sm"
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              <MiniStat label="扫描规则" value={summary.rulesScanned} />
              <MiniStat label="触发规则" value={summary.rulesTriggered} />
              <MiniStat label="评估员工" value={summary.employeesEvaluated} />
              <MiniStat label="总发放" value={`¥${summary.totalPayout.toFixed(2)}`} highlight />
            </div>
            {summary.details.length > 0 && (
              <Table<CalcDetail>
                size="sm"
                columns={[
                  { key: 'userName', title: '员工', width: 120 },
                  {
                    key: 'ruleName',
                    title: '规则',
                    render: (d) => (
                      <span>
                        {d.ruleName}
                        <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 6 }}>
                          {RULE_TYPE_LABELS[d.ruleType]}
                        </span>
                      </span>
                    ),
                  },
                  {
                    key: 'triggers',
                    title: '触发',
                    width: 60,
                    render: (d) => d.triggers
                      ? <span style={{ color: 'var(--success-500)' }}>✓</span>
                      : <span style={{ color: 'var(--text-muted)' }}>—</span>,
                  },
                  {
                    key: 'computedAmount',
                    title: '计算金额',
                    width: 100,
                    align: 'right',
                    render: (d) => `¥${d.computedAmount.toFixed(2)}`,
                  },
                  {
                    key: 'cappedAmount',
                    title: '实发',
                    width: 100,
                    align: 'right',
                    render: (d) => <strong>¥{d.cappedAmount.toFixed(2)}</strong>,
                  },
                ]}
                data={summary.details}
                rowKey={(d) => `${d.ruleId}-${d.userId}`}
              />
            )}
          </div>
        )}
      </div>

      {/* 编辑 / 新建弹窗 */}
      <RuleEditor
        open={creating || !!editing}
        rule={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={async () => {
          setCreating(false);
          setEditing(null);
          await load();
        }}
      />
    </div>
  );
}

// =============== StatCard ===============

function StatCard({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone: 'info' | 'success' | 'warning' }) {
  const color = tone === 'success' ? 'var(--success-500)' : tone === 'warning' ? 'var(--warning-500)' : 'var(--ecom-blue-500)';
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function MiniStat({ label, value, highlight }: { label: string; value: React.ReactNode; highlight?: boolean }) {
  return (
    <div style={{
      background: highlight ? 'var(--bg-sidebar)' : 'var(--bg-card)',
      border: '1px solid var(--border-card)',
      borderRadius: 8,
      padding: '8px 12px',
    }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>{value}</div>
    </div>
  );
}

// =============== RuleEditor ===============

interface RuleEditorProps {
  open: boolean;
  rule: IncentiveRule | null;
  onClose: () => void;
  onSaved: () => void;
}

function RuleEditor({ open, rule, onClose, onSaved }: RuleEditorProps) {
  const [name, setName] = useState('');
  const [ruleType, setRuleType] = useState<RuleType>('commission');
  const [description, setDescription] = useState('');
  const [formula, setFormula] = useState('${total_gmv} * 0.01');
  const [triggerType, setTriggerType] = useState<TriggerType>('always');
  const [threshold, setThreshold] = useState('');
  const [minPayout, setMinPayout] = useState('');
  const [maxPayout, setMaxPayout] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      if (rule) {
        setName(rule.name);
        setRuleType(rule.rule_type);
        setDescription(rule.description ?? '');
        setFormula(rule.formula);
        setTriggerType(rule.trigger_config.trigger_type);
        setThreshold(String(rule.trigger_config.threshold ?? ''));
        setMinPayout(String(rule.min_payout || ''));
        setMaxPayout(rule.max_payout != null ? String(rule.max_payout) : '');
      } else {
        setName('');
        setRuleType('commission');
        setDescription('');
        setFormula('${total_gmv} * 0.01');
        setTriggerType('always');
        setThreshold('');
        setMinPayout('');
        setMaxPayout('');
      }
    }
  }, [open, rule]);

  async function save() {
    if (!name.trim()) {
      toast('warning', '请填写规则名称');
      return;
    }
    if (!formula.trim()) {
      toast('warning', '请填写公式');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        name: name.trim(),
        rule_type: ruleType,
        description: description.trim() || undefined,
        trigger_config: {
          trigger_type: triggerType,
          threshold: threshold ? Number(threshold) : undefined,
        },
        formula: formula.trim(),
        min_payout: minPayout ? Number(minPayout) : undefined,
        max_payout: maxPayout ? Number(maxPayout) : undefined,
      };
      const res = rule
        ? await api.incentive.updateRule(rule.id, payload)
        : await api.incentive.createRule(payload);
      if (res.success) {
        toast('success', rule ? '规则已更新' : '规则已创建');
        onSaved();
      } else {
        toast('error', '保存失败', res.error?.message);
      }
    } catch (e: any) {
      toast('error', '保存异常', e?.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title={rule ? '编辑激励规则' : '新建激励规则'}
      onClose={onClose}
      width={560}
      footer={
        <>
          <button
            className="btn-ecom-secondary"
            onClick={onClose}
            style={{ minHeight: 36 }}
          >
            取消
          </button>
          <button
            className="btn-ecom"
            onClick={save}
            disabled={busy}
            style={{ minHeight: 36 }}
          >
            {busy ? '保存中...' : '保存'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="规则名称" required>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="如：直播间 GMV 提成 1%" />
        </Field>
        <Field label="类型">
          <select className="input" value={ruleType} onChange={(e) => setRuleType(e.target.value as RuleType)}>
            {Object.entries(RULE_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="描述">
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="可选" />
        </Field>
        <Field label="触发条件">
          <select className="input" value={triggerType} onChange={(e) => setTriggerType(e.target.value as TriggerType)}>
            <option value="always">无条件</option>
            <option value="order_threshold">订单 GMV 阈值</option>
            <option value="achievement_threshold">OGSM 达成率阈值</option>
          </select>
        </Field>
        {triggerType !== 'always' && (
          <Field label="阈值">
            <input
              className="input"
              type="number"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder={triggerType === 'order_threshold' ? '如 10000' : '如 80（百分比）'}
            />
          </Field>
        )}
        <Field label="公式" required>
          <input className="input" value={formula} onChange={(e) => setFormula(e.target.value)} style={{ fontFamily: 'monospace' }} />
          <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {FORMULA_HINTS.map((h) => (
              <button
                key={h.value}
                type="button"
                onClick={() => setFormula(h.value)}
                style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 999,
                  border: '1px solid var(--border-card)',
                  background: 'var(--bg-sidebar)',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                {h.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
            可用占位符：$&#123;total_gmv&#125; / $&#123;order_count&#125; / $&#123;profit&#125; / $&#123;achievement_rate&#125; / $&#123;employee_count&#125;
          </div>
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Field label="最小发放">
            <input className="input" type="number" min="0" value={minPayout} onChange={(e) => setMinPayout(e.target.value)} placeholder="可选" />
          </Field>
          <Field label="最大发放">
            <input className="input" type="number" min="0" value={maxPayout} onChange={(e) => setMaxPayout(e.target.value)} placeholder="可选" />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}>
        {label}{required && <span style={{ color: 'var(--error-500)' }}> *</span>}
      </span>
      {children}
    </label>
  );
}

export default IncentiveEngine;
