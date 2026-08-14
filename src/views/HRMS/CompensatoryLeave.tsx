/**
 * 调休工作台（V2 · 调休业务规则完整落地）
 *
 * 完整接入后端 /api/leave/*：
 *   - 调休额度汇总（有效余额 / 即将过期 / 流水账）
 *   - 加班申请 → 审批通过自动 1:1 累积调休额度
 *   - 调休申请（实时校验余额）→ 审批扣减
 *   - 年度结转（结转额度带有效期，年底自动过期）
 *
 * 工程诚信：所有数据来自后端；加载失败显示错误态，绝不伪造数据填充界面。
 */
import { useState, useEffect, useCallback } from 'react';
import { api } from '@api/client';
import { hrApi } from '@api/hr';
import { useToast } from '@components/Common/Toast';
import { useConfirm } from '@components/Common/Confirm';

interface Employee {
  id: string;
  name: string;
  employee_no?: string;
  department_name?: string | null;
}

interface CompSummary {
  employee_id: string;
  year: number;
  totalHours: number;
  usedHours: number;
  effectiveRemaining: number;
  expiringSoon: Array<{ hours: number; expiresAt: string; daysLeft: number }>;
  ledger: Array<{ date: string; type: 'accrual' | 'consume'; hours: number; refId: string; note: string }>;
}

interface OvertimeRec {
  id: string;
  employee_id: string;
  date: string;
  start_time: string;
  end_time: string;
  hours: number;
  reason: string;
  status: string;
}

interface LeaveApp {
  id: string;
  employee_id: string;
  leave_type_id: string;
  start_datetime: string;
  end_datetime: string;
  total_hours: number;
  reason: string;
  status: string;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function CompensatoryLeave() {
  const toastApi = useToast();
  const confirm = useConfirm();
  const toast = (type: 'success' | 'error' | 'info' | 'warning', title: string, message?: string) =>
    toastApi.addToast(type, title, message);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState<string>('');
  const [summary, setSummary] = useState<CompSummary | null>(null);
  const [overtime, setOvertime] = useState<OvertimeRec[]>([]);
  const [pendingOvertime, setPendingOvertime] = useState<OvertimeRec[]>([]);
  const [applications, setApplications] = useState<LeaveApp[]>([]);
  const [pendingLeave, setPendingLeave] = useState<LeaveApp[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [otForm, setOtForm] = useState({ date: todayStr(), start_time: '18:00', end_time: '21:00', hours: 3, reason: '' });
  const [lvForm, setLvForm] = useState({ start_datetime: '', end_datetime: '', total_hours: 8, reason: '', balanceCheck: null as { sufficient: boolean; remaining: number; deficit: number } | null });
  const [busy, setBusy] = useState(false);

  // 加载员工列表（一次）
  useEffect(() => {
    (async () => {
      try {
        const { items } = await hrApi.listEmployees({ limit: 200 });
        setEmployees(items);
        if (items.length && !employeeId) setEmployeeId(items[0].id);
      } catch (e) {
        setErr(`加载员工列表失败：${String(e)}`);
      }
    })();
  }, [employeeId]);

  const reload = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true);
    setErr(null);
    try {
      const [s, ot, pot, apps, plat] = await Promise.all([
        api.leave.getCompensatorySummary(employeeId),
        api.leave.listOvertime(employeeId),
        api.leave.listPendingOvertime(),
        api.leave.listApplications(employeeId),
        api.leave.listPendingApplications(),
      ]);
      setSummary(s.data || null);
      setOvertime((ot.data as OvertimeRec[]) || []);
      setPendingOvertime((pot.data as OvertimeRec[]) || []);
      setApplications((apps.data as LeaveApp[]) || []);
      setPendingLeave((plat.data as LeaveApp[]) || []);
    } catch (e) {
      setErr(`加载调休数据失败：${String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    if (employeeId) reload();
  }, [employeeId, reload]);

  async function submitOvertime() {
    if (!employeeId) return;
    if (!otForm.date || !otForm.hours || otForm.hours <= 0) {
      toast('warning', '请填写完整的加班信息');
      return;
    }
    setBusy(true);
    try {
      const res = await api.leave.createOvertime({ employee_id: employeeId, ...otForm });
      if (res.success) {
        toast('success', '加班申请已提交', '等待审批通过后自动累积调休额度');
        setOtForm({ date: todayStr(), start_time: '18:00', end_time: '21:00', hours: 3, reason: '' });
        await reload();
      } else {
        toast('error', '提交失败', res.error?.message);
      }
    } catch (e) {
      toast('error', '提交失败', String(e));
    } finally {
      setBusy(false);
    }
  }

  async function approveOvertime(id: string, status: 'approved' | 'rejected') {
    const ok = await confirm({
      title: status === 'approved' ? '确认通过该加班申请？' : '确认驳回该加班申请？',
      content: status === 'approved'
        ? '通过后系统将按加班时长 1:1 自动累积调休额度。'
        : '驳回后该加班记录将不再发放调休额度。',
      confirmText: status === 'approved' ? '通过' : '驳回',
      tone: status === 'approved' ? 'info' : 'warning',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await api.leave.approveOvertime(id, status);
      if (res.success) {
        toast('success', status === 'approved' ? '已通过，调休额度已累积' : '已驳回');
        await reload();
      } else {
        toast('error', '操作失败', res.error?.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function checkBalance() {
    if (!employeeId || !lvForm.total_hours) {
      setLvForm((f) => ({ ...f, balanceCheck: null }));
      return;
    }
    try {
      const res = await api.leave.checkCompensatory(employeeId, Number(lvForm.total_hours));
      setLvForm((f) => ({ ...f, balanceCheck: res.data || null }));
    } catch (e) {
      console.warn('[CompensatoryLeave] 检查余额失败:', e);
      setLvForm((f) => ({ ...f, balanceCheck: null }));
    }
  }

  useEffect(() => {
    if (employeeId) checkBalance();
  }, [lvForm.total_hours, employeeId]);

  async function submitLeave() {
    if (!employeeId) return;
    if (!lvForm.start_datetime || !lvForm.end_datetime || !lvForm.total_hours) {
      toast('warning', '请填写完整的调休申请');
      return;
    }
    const check = lvForm.balanceCheck;
    if (check && !check.sufficient) {
      toast('error', '调休余额不足', `需要 ${lvForm.total_hours}h，有效剩余 ${check.remaining}h`);
      return;
    }
    setBusy(true);
    try {
      const res = await api.leave.applyLeave({
        employee_id: employeeId,
        leave_type_id: 'lt_compensatory',
        start_datetime: lvForm.start_datetime,
        end_datetime: lvForm.end_datetime,
        total_hours: Number(lvForm.total_hours),
        reason: lvForm.reason,
      });
      if (res.success) {
        toast('success', '调休申请已提交', '等待审批');
        setLvForm({ start_datetime: '', end_datetime: '', total_hours: 8, reason: '', balanceCheck: null });
        await reload();
      } else {
        toast('error', '提交失败', res.error?.message);
      }
    } catch (e) {
      toast('error', '提交失败', String(e));
    } finally {
      setBusy(false);
    }
  }

  async function approveLeave(id: string, status: 'approved' | 'rejected') {
    const ok = await confirm({
      title: status === 'approved' ? '确认批准该调休申请？' : '确认驳回该调休申请？',
      content: status === 'approved'
        ? '批准后系统将立即扣减员工对应调休额度。此操作不可撤销。'
        : '驳回后该调休申请将退回员工，且不扣减额度。',
      confirmText: status === 'approved' ? '批准' : '驳回',
      tone: status === 'approved' ? 'info' : 'warning',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await api.leave.approveLeave(id, status);
      if (res.success) {
        toast('success', status === 'approved' ? '已批准，额度已扣减' : '已驳回');
        await reload();
      } else {
        toast('error', '操作失败', res.error?.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function runCarryOver() {
    const ok = await confirm({
      title: '确认执行年度调休结转？',
      content: '未使用的结转额度将按上限结转到下一年（年底自动过期）。',
      confirmText: '开始结转',
      tone: 'warning',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await api.leave.carryOver();
      if (res.success) {
        toast('success', '年度结转完成', `涉及 ${res.data?.carried_over_count ?? 0} 名员工`);
        await reload();
      } else {
        toast('error', '结转失败', res.error?.message);
      }
    } finally {
      setBusy(false);
    }
  }

  const statusLabel: Record<string, string> = {
    pending: '待审批', approved: '已通过', rejected: '已驳回', converted: '已转调休', cancelled: '已取消', taken: '已休',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 顶部：员工选择 + 结转 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <select
          className="input"
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          style={{ minWidth: 220 }}
        >
          {employees.length === 0 && <option value="">（无员工数据）</option>}
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.name}（{emp.employee_no || emp.id.slice(0, 6)}）
              {emp.department_name ? ` · ${emp.department_name}` : ''}
            </option>
          ))}
        </select>
        <button className="btn-ghost" onClick={runCarryOver} disabled={busy}>年度调休结转</button>
        <button className="btn-ghost" onClick={reload} disabled={loading}>刷新</button>
        {loading && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>加载中…</span>}
      </div>

      {err && (
        <div style={{ padding: 12, borderRadius: 8, background: 'var(--bg-danger-subtle)', color: 'var(--danger-text)', fontSize: 13 }}>
          {err}
        </div>
      )}

      {/* 调休额度总览 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <Card label="有效调休余额" value={summary ? `${summary.effectiveRemaining}h` : '—'} color="var(--ecom-amber-500)" />
        <Card label="累计额度" value={summary ? `${summary.totalHours}h` : '—'} color="var(--ecom-blue-500)" />
        <Card label="已使用" value={summary ? `${summary.usedHours}h` : '—'} color="var(--text-secondary)" />
      </div>

      {summary && summary.expiringSoon.length > 0 && (
        <div style={{ padding: 12, borderRadius: 8, background: 'var(--bg-warning-subtle)', color: 'var(--warning-text)', fontSize: 13 }}>
          ⚠️ 即将过期：{summary.expiringSoon.map((e) => `${e.hours}h（${e.expiresAt} 剩 ${e.daysLeft} 天）`).join('；')}
        </div>
      )}

      {/* 两栏：加班 / 调休申请 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* 加班申请 */}
        <Section title="加班申请（审批通过自动累积 1:1 调休）">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input className="input" type="date" value={otForm.date} onChange={(e) => setOtForm({ ...otForm, date: e.target.value })} />
              <input className="input" type="number" style={{ width: 90 }} value={otForm.hours} onChange={(e) => setOtForm({ ...otForm, hours: Number(e.target.value) })} placeholder="小时" />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input className="input" type="time" value={otForm.start_time} onChange={(e) => setOtForm({ ...otForm, start_time: e.target.value })} />
              <input className="input" type="time" value={otForm.end_time} onChange={(e) => setOtForm({ ...otForm, end_time: e.target.value })} />
            </div>
            <input className="input" value={otForm.reason} onChange={(e) => setOtForm({ ...otForm, reason: e.target.value })} placeholder="加班事由" />
            <button className="btn-ecom" onClick={submitOvertime} disabled={busy}>提交加班申请</button>
          </div>
          <ListEmpty data={overtime} empty="暂无加班记录">
            {overtime.map((o) => (
              <Row key={o.id} title={`${o.date} · ${o.hours}h`} sub={o.reason} tag={statusLabel[o.status] || o.status} tagColor={o.status === 'approved' || o.status === 'converted' ? 'var(--success-500)' : 'var(--warning-500)'} />
            ))}
          </ListEmpty>
        </Section>

        {/* 调休申请 */}
        <Section title="申请调休（实时校验余额）">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input className="input" type="datetime-local" value={lvForm.start_datetime} onChange={(e) => setLvForm({ ...lvForm, start_datetime: e.target.value })} />
              <input className="input" type="datetime-local" value={lvForm.end_datetime} onChange={(e) => setLvForm({ ...lvForm, end_datetime: e.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input className="input" type="number" style={{ width: 90 }} value={lvForm.total_hours} onChange={(e) => setLvForm({ ...lvForm, total_hours: Number(e.target.value) })} placeholder="小时" />
              {lvForm.balanceCheck && (
                <span style={{ fontSize: 12, color: lvForm.balanceCheck.sufficient ? 'var(--success-text)' : 'var(--danger-text)' }}>
                  {lvForm.balanceCheck.sufficient ? `余额充足（剩 ${lvForm.balanceCheck.remaining}h）` : `余额不足（缺 ${lvForm.balanceCheck.deficit}h）`}
                </span>
              )}
            </div>
            <input className="input" value={lvForm.reason} onChange={(e) => setLvForm({ ...lvForm, reason: e.target.value })} placeholder="调休事由" />
            <button className="btn-ecom" onClick={submitLeave} disabled={busy}>提交调休申请</button>
          </div>
          <ListEmpty data={applications} empty="暂无调休申请">
            {applications.map((a) => (
              <Row key={a.id} title={`${String(a.start_datetime).slice(0, 16).replace('T', ' ')} · ${a.total_hours}h`} sub={a.reason} tag={statusLabel[a.status] || a.status} tagColor={a.status === 'approved' || a.status === 'taken' ? 'var(--success-500)' : 'var(--warning-500)'} />
            ))}
          </ListEmpty>
        </Section>
      </div>

      {/* 待审批（管理视角） */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Section title={`待审批加班（${pendingOvertime.length}）`}>
          <ListEmpty data={pendingOvertime} empty="无待审批加班">
            {pendingOvertime.map((o) => (
              <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--border-card)' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>{o.employee_id} · {o.date} · {o.hours}h</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{o.reason}</div>
                </div>
                <button className="btn-ecom" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => approveOvertime(o.id, 'approved')} disabled={busy}>通过</button>
                <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => approveOvertime(o.id, 'rejected')} disabled={busy}>驳回</button>
              </div>
            ))}
          </ListEmpty>
        </Section>

        <Section title={`待审批调休（${pendingLeave.length}）`}>
          <ListEmpty data={pendingLeave} empty="无待审批调休">
            {pendingLeave.map((a) => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--border-card)' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>{a.employee_id} · {String(a.start_datetime).slice(0, 16).replace('T', ' ')} · {a.total_hours}h</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{a.reason}</div>
                </div>
                <button className="btn-ecom" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => approveLeave(a.id, 'approved')} disabled={busy}>批准</button>
                <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => approveLeave(a.id, 'rejected')} disabled={busy}>驳回</button>
              </div>
            ))}
          </ListEmpty>
        </Section>
      </div>

      {/* 流水账 */}
      {summary && summary.ledger.length > 0 && (
        <Section title="调休流水账（加班累积 / 调休消耗）">
          <ListEmpty data={summary.ledger} empty="暂无流水">
            {summary.ledger.map((l, i) => (
              <Row
                key={`${l.refId}-${i}`}
                title={`${l.date} · ${l.type === 'accrual' ? '+' : '-'}${l.hours}h`}
                sub={l.note}
                tag={l.type === 'accrual' ? '累积' : '消耗'}
                tagColor={l.type === 'accrual' ? 'var(--success-500)' : 'var(--ecom-violet-500)'}
              />
            ))}
          </ListEmpty>
        </Section>
      )}
    </div>
  );
}

function Card({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 12, padding: 16, borderLeft: `3px solid ${color}` }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-primary)', marginTop: 4, fontFamily: 'ui-monospace, monospace' }}>{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  );
}

function ListEmpty({ data, empty, children }: { data: unknown[]; empty: string; children: React.ReactNode }) {
  if (!data || data.length === 0) {
    return <div style={{ textAlign: 'center', padding: 16, color: 'var(--text-muted)', fontSize: 13 }}>{empty}</div>;
  }
  return <div style={{ display: 'flex', flexDirection: 'column' }}>{children}</div>;
}

function Row({ title, sub, tag, tagColor }: { title: string; sub?: string; tag?: string; tagColor?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border-card)' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>{title}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sub}</div>}
      </div>
      {tag && (
        <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: tagColor || 'var(--bg-row-hover)', color: '#fff' }}>{tag}</span>
      )}
    </div>
  );
}
