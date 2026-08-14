/**
 * OGSM 目标树（后端驱动）— V2 O1
 *
 * 数据源：/api/ogsm/objectives + /api/ogsm/objectives/:id/tree
 * 层级：O 目标 → G 指标 → S 策略 → M 度量，全部落库，按 tenant_id 隔离。
 * 取代原 useHRMSStore 本地内存版本（刷新即丢、跨设备不同步）。
 */
import { useState, useEffect, useCallback, memo } from 'react';
import { api } from '@api/client';
import { toast } from '@components/Common/Toast';
import { useConfirm } from '@components/Common/Confirm';

// ---------- 类型 ----------

interface Measure {
  id: string;
  title: string;
  description?: string;
  metric_type?: string;
  target_value?: number;
  current_value?: number;
  unit?: string;
  status?: string;
}

interface Strategy {
  id: string;
  title: string;
  description?: string;
  status?: string;
  measures: Measure[];
}

interface Goal {
  id: string;
  title: string;
  description?: string;
  metric_type?: string;
  target_value?: number;
  current_value?: number;
  unit?: string;
  progress?: number;
  status?: string;
  strategies: Strategy[];
}

interface ObjectiveSummary {
  id: string;
  title: string;
  description?: string;
  level?: string;
  status?: string;
  priority?: string;
  progress?: number;
}

interface ObjectiveTree extends ObjectiveSummary {
  goals: Goal[];
}

const LEVEL_COLOR: Record<string, string> = {
  O: 'var(--module-agent)',
  G: 'var(--ecom-amber-500)',
  S: 'var(--ecom-blue-500)',
  M: 'var(--ecom-violet-500)',
};

const STATUS_COLOR: Record<string, string> = {
  active: 'var(--ecom-blue-500)',
  in_progress: 'var(--ecom-blue-500)',
  achieved: 'var(--success-500)',
  completed: 'var(--success-500)',
  at_risk: 'var(--danger-500)',
  overdue: 'var(--danger-500)',
  draft: 'var(--text-muted)',
  planned: 'var(--text-muted)',
  archived: 'var(--text-muted)',
};

// ---------- 子组件 ----------

const LevelBadge = memo(({ level }: { level: 'O' | 'G' | 'S' | 'M' }) => (
  <span
    style={{
      width: 22, height: 22, borderRadius: 6, display: 'inline-flex',
      alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700,
      background: LEVEL_COLOR[level], color: '#fff', flexShrink: 0,
    }}
  >
    {level}
  </span>
));
LevelBadge.displayName = 'LevelBadge';

const StatusPill = memo(({ status }: { status?: string }) => {
  if (!status) return null;
  return (
    <span
      style={{
        padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600,
        background: STATUS_COLOR[status] || 'var(--text-muted)', color: '#fff', flexShrink: 0,
      }}
    >
      {status}
    </span>
  );
});
StatusPill.displayName = 'StatusPill';

function ProgressBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 110 }}>
      <div style={{ flex: 1, height: 5, borderRadius: 3, background: 'var(--bg-row-selected)', overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: pct >= 80 ? 'var(--success-500)' : pct >= 40 ? 'var(--ecom-blue-500)' : 'var(--ecom-amber-500)',
        }} />
      </div>
      <span style={{ fontSize: 10, color: 'var(--text-muted)', width: 30, textAlign: 'right' }}>{pct}%</span>
    </div>
  );
}

// ---------- 主组件 ----------

export default function OGSMTreeLive() {
  const confirm = useConfirm();
  const [objectives, setObjectives] = useState<ObjectiveSummary[]>([]);
  const [trees, setTrees] = useState<Record<string, ObjectiveTree>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 新建表单：null 表示不展开；否则记录目标层级与父 ID
  const [creating, setCreating] = useState<
    | { kind: 'objective' }
    | { kind: 'goal'; objectiveId: string }
    | { kind: 'strategy'; goalId: string }
    | { kind: 'measure'; strategyId: string }
    | null
  >(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftTarget, setDraftTarget] = useState('');

  const loadObjectives = useCallback(async () => {
    setLoading(true);
    const res = await api.ogsm.listObjectives({ limit: 100 });
    if (res.success && res.data) {
      setObjectives(res.data as ObjectiveSummary[]);
      setError(null);
    } else {
      setError(res.error?.message || '加载目标列表失败');
    }
    setLoading(false);
  }, []);

  useEffect(() => { void loadObjectives(); }, [loadObjectives]);

  const loadTree = useCallback(async (objectiveId: string) => {
    const res = await api.ogsm.getObjectiveTree(objectiveId);
    if (res.success && res.data) {
      setTrees((prev) => ({ ...prev, [objectiveId]: res.data as ObjectiveTree }));
    } else {
      toast('error', '加载目标树失败', res.error?.message);
    }
  }, []);

  const toggleObjective = useCallback(async (id: string) => {
    const next = !expanded[id];
    setExpanded((prev) => ({ ...prev, [id]: next }));
    if (next && !trees[id]) await loadTree(id);
  }, [expanded, trees, loadTree]);

  function openCreate(target: NonNullable<typeof creating>) {
    setCreating(target);
    setDraftTitle('');
    setDraftTarget('');
  }

  async function submitCreate() {
    if (!creating) return;
    const title = draftTitle.trim();
    if (!title) {
      toast('warning', '请输入标题');
      return;
    }
    const targetValue = draftTarget.trim() ? Number(draftTarget) : undefined;
    if (targetValue !== undefined && Number.isNaN(targetValue)) {
      toast('warning', '目标值必须是数字');
      return;
    }

    setBusy(true);
    let res;
    let refreshObjectiveId: string | null = null;

    switch (creating.kind) {
      case 'objective':
        res = await api.ogsm.createObjective({ title, level: 'company', priority: 'medium' });
        break;
      case 'goal':
        res = await api.ogsm.createGoal({
          objectiveId: creating.objectiveId, title,
          metricType: targetValue !== undefined ? 'number' : undefined,
          targetValue,
        });
        refreshObjectiveId = creating.objectiveId;
        break;
      case 'strategy':
        res = await api.ogsm.createStrategy({ goalId: creating.goalId, title });
        refreshObjectiveId = findObjectiveIdByGoal(creating.goalId);
        break;
      case 'measure':
        res = await api.ogsm.createMeasure({
          strategyId: creating.strategyId, title,
          metricType: targetValue !== undefined ? 'number' : undefined,
          targetValue,
        });
        refreshObjectiveId = findObjectiveIdByStrategy(creating.strategyId);
        break;
    }
    setBusy(false);

    if (res?.success) {
      toast('success', '已创建');
      setCreating(null);
      setDraftTitle('');
      setDraftTarget('');
      if (creating.kind === 'objective') {
        await loadObjectives();
      } else if (refreshObjectiveId) {
        await loadTree(refreshObjectiveId);
      }
    } else {
      toast('error', '创建失败', res?.error?.message);
    }
  }

  function findObjectiveIdByGoal(goalId: string): string | null {
    for (const [objId, tree] of Object.entries(trees)) {
      if (tree.goals?.some((g) => g.id === goalId)) return objId;
    }
    return null;
  }

  function findObjectiveIdByStrategy(strategyId: string): string | null {
    for (const [objId, tree] of Object.entries(trees)) {
      for (const goal of tree.goals || []) {
        if (goal.strategies?.some((s) => s.id === strategyId)) return objId;
      }
    }
    return null;
  }

  async function removeObjective(obj: ObjectiveSummary) {
    const ok = await confirm({
      title: `确认删除目标「${obj.title}」？`,
      content: '其下的指标、策略与度量将一并移除，操作不可恢复。',
      tone: 'danger',
    });
    if (!ok) return;

    setBusy(true);
    const res = await api.ogsm.deleteObjective(obj.id);
    setBusy(false);
    if (res.success) {
      toast('success', '目标已删除');
      setTrees((prev) => {
        const next = { ...prev };
        delete next[obj.id];
        return next;
      });
      await loadObjectives();
    } else {
      toast('error', '删除失败', res.error?.message);
    }
  }

  async function updateProgress(objectiveId: string, goal: Goal) {
    const raw = window.prompt(`更新「${goal.title}」当前值${goal.unit ? `（${goal.unit}）` : ''}`, String(goal.current_value ?? 0));
    if (raw === null) return;
    const value = Number(raw);
    if (Number.isNaN(value)) {
      toast('warning', '请输入数字');
      return;
    }
    setBusy(true);
    const res = await api.ogsm.updateGoalProgress(goal.id, value);
    setBusy(false);
    if (res.success) {
      toast('success', '进度已更新');
      await loadTree(objectiveId);
    } else {
      toast('error', '更新失败', res.error?.message);
    }
  }

  // ---------- 渲染 ----------

  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
    borderRadius: 8, transition: 'background var(--transition-fast)',
  };

  function renderCreateForm(placeholder: string, withTarget: boolean) {
    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '6px 10px' }}>
        <input
          className="input"
          style={{ flex: 1, maxWidth: 260, fontSize: 12 }}
          value={draftTitle}
          placeholder={placeholder}
          onChange={(e) => setDraftTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submitCreate(); }}
        />
        {withTarget && (
          <input
            className="input"
            style={{ width: 110, fontSize: 12 }}
            value={draftTarget}
            placeholder="目标值(选填)"
            onChange={(e) => setDraftTarget(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submitCreate(); }}
          />
        )}
        <button className="btn-ecom" style={{ fontSize: 11, padding: '4px 10px' }} disabled={busy} onClick={() => void submitCreate()}>
          确定
        </button>
        <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => setCreating(null)}>
          取消
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn-ecom" disabled={busy} onClick={() => openCreate({ kind: 'objective' })}>
          + 添加 O 目标
        </button>
        <button className="btn-ghost" onClick={() => void loadObjectives()}>刷新</button>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {objectives.length} 个 O 目标 · 数据存于后端（按租户隔离）
        </span>
      </div>

      {error && (
        <div style={{ padding: 12, borderRadius: 8, background: 'var(--bg-card)', border: '1px solid var(--danger-500)', color: 'var(--danger-text)', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-card)', padding: 8 }}>
        {creating?.kind === 'objective' && renderCreateForm('新目标标题', false)}

        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>加载中…</div>
        ) : objectives.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            暂无 O 目标，点击上方按钮创建第一个。
          </div>
        ) : objectives.map((obj) => {
          const tree = trees[obj.id];
          const isOpen = expanded[obj.id];
          return (
            <div key={obj.id} style={{ marginBottom: 4 }}>
              {/* O 层 */}
              <div style={{ ...rowStyle, borderLeft: `3px solid ${LEVEL_COLOR.O}`, cursor: 'pointer' }} onClick={() => void toggleObjective(obj.id)}>
                <span style={{ width: 14, color: 'var(--text-muted)', flexShrink: 0 }}>{isOpen ? '▾' : '▸'}</span>
                <LevelBadge level="O" />
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{obj.title}</span>
                {typeof obj.progress === 'number' && <ProgressBar value={obj.progress} />}
                <StatusPill status={obj.status} />
                <button
                  className="btn-ghost"
                  style={{ fontSize: 11, padding: '2px 8px' }}
                  onClick={(e) => { e.stopPropagation(); openCreate({ kind: 'goal', objectiveId: obj.id }); if (!isOpen) void toggleObjective(obj.id); }}
                >
                  + G
                </button>
                <button
                  className="btn-ghost"
                  style={{ fontSize: 11, padding: '2px 8px', color: 'var(--danger-text)' }}
                  disabled={busy}
                  onClick={(e) => { e.stopPropagation(); void removeObjective(obj); }}
                >
                  删除
                </button>
              </div>

              {isOpen && (
                <div style={{ paddingLeft: 22 }}>
                  {creating?.kind === 'goal' && creating.objectiveId === obj.id && renderCreateForm('新指标标题', true)}

                  {!tree ? (
                    <div style={{ padding: '6px 10px', fontSize: 12, color: 'var(--text-muted)' }}>加载中…</div>
                  ) : (tree.goals || []).length === 0 ? (
                    <div style={{ padding: '6px 10px', fontSize: 12, color: 'var(--text-muted)' }}>暂无 G 指标</div>
                  ) : tree.goals.map((goal) => (
                    <div key={goal.id}>
                      {/* G 层 */}
                      <div style={{ ...rowStyle, borderLeft: `3px solid ${LEVEL_COLOR.G}` }}>
                        <span style={{ width: 14, flexShrink: 0 }} />
                        <LevelBadge level="G" />
                        <span style={{ flex: 1, fontSize: 12.5 }}>{goal.title}</span>
                        {goal.target_value != null && (
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {goal.current_value ?? 0} / {goal.target_value}{goal.unit || ''}
                          </span>
                        )}
                        {typeof goal.progress === 'number' && <ProgressBar value={goal.progress} />}
                        <StatusPill status={goal.status} />
                        <button className="btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }} disabled={busy} onClick={() => void updateProgress(obj.id, goal)}>
                          进度
                        </button>
                        <button className="btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => openCreate({ kind: 'strategy', goalId: goal.id })}>
                          + S
                        </button>
                      </div>

                      <div style={{ paddingLeft: 22 }}>
                        {creating?.kind === 'strategy' && creating.goalId === goal.id && renderCreateForm('新策略标题', false)}

                        {(goal.strategies || []).map((strategy) => (
                          <div key={strategy.id}>
                            {/* S 层 */}
                            <div style={{ ...rowStyle, borderLeft: `3px solid ${LEVEL_COLOR.S}` }}>
                              <span style={{ width: 14, flexShrink: 0 }} />
                              <LevelBadge level="S" />
                              <span style={{ flex: 1, fontSize: 12.5 }}>{strategy.title}</span>
                              <StatusPill status={strategy.status} />
                              <button className="btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => openCreate({ kind: 'measure', strategyId: strategy.id })}>
                                + M
                              </button>
                            </div>

                            <div style={{ paddingLeft: 22 }}>
                              {creating?.kind === 'measure' && creating.strategyId === strategy.id && renderCreateForm('新度量标题', true)}

                              {(strategy.measures || []).map((measure) => (
                                <div key={measure.id} style={{ ...rowStyle, borderLeft: `3px solid ${LEVEL_COLOR.M}` }}>
                                  <span style={{ width: 14, flexShrink: 0 }} />
                                  <LevelBadge level="M" />
                                  <span style={{ flex: 1, fontSize: 12 }}>{measure.title}</span>
                                  {measure.target_value != null && (
                                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                      {measure.current_value ?? 0} / {measure.target_value}{measure.unit || ''}
                                    </span>
                                  )}
                                  <StatusPill status={measure.status} />
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
