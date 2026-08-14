/**
 * HRMS 子视图集合
 */
import { useState, useCallback } from 'react';
import { useHRMSStore } from '@store/hrStore';
import api from '@api/client';

// ════════════════════════════════════════
// 任务看板 (Kanban)
// ════════════════════════════════════════

export function HRKanban() {
  const { tasks, taskFilter, setTaskFilter, updateTask, deleteTask, addTask } = useHRMSStore();

  const columns = [
    { key: 'backlog', label: '待办池', color: 'var(--text-muted)' },
    { key: 'todo', label: '待执行', color: 'var(--ecom-blue-500)' },
    { key: 'in-progress', label: '进行中', color: 'var(--ecom-amber-500)' },
    { key: 'review', label: '待验收', color: 'var(--ecom-violet-500)' },
    { key: 'blocked', label: '阻塞', color: 'var(--danger-500)' },
    { key: 'completed', label: '已完成', color: 'var(--success-500)' },
  ] as const;

  const priorityColors: Record<string, string> = {
    urgent: 'var(--danger-500)',
    high: 'var(--warning-500)',
    medium: 'var(--ecom-blue-500)',
    low: 'var(--text-muted)',
  };

  const [editingTask, setEditingTask] = useState<string | null>(null);

  // 筛选
  let filtered = tasks;
  if (taskFilter.status) filtered = filtered.filter((t) => t.status === taskFilter.status);
  if (taskFilter.priority) filtered = filtered.filter((t) => t.priority === taskFilter.priority);
  if (taskFilter.assignee) filtered = filtered.filter((t) => t.assigneeName === taskFilter.assignee);
  if (taskFilter.search) filtered = filtered.filter((t) => t.title.toLowerCase().includes((taskFilter.search || '').toLowerCase()));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12 }}>
      {/* 筛选栏 */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="搜索任务..."
          value={taskFilter.search || ''}
          onChange={(e) => setTaskFilter({ ...taskFilter, search: e.target.value })}
          className="input"
          style={{ width: 200 }}
        />
        <select
          className="input"
          style={{ width: 120 }}
          value={taskFilter.status || ''}
          onChange={(e) => setTaskFilter({ ...taskFilter, status: e.target.value as any || undefined })}
        >
          <option value="">全部状态</option>
          {columns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <select
          className="input"
          style={{ width: 100 }}
          value={taskFilter.priority || ''}
          onChange={(e) => setTaskFilter({ ...taskFilter, priority: e.target.value as any || undefined })}
        >
          <option value="">全部优先级</option>
          <option value="urgent">紧急</option>
          <option value="high">高</option>
          <option value="medium">中</option>
          <option value="low">低</option>
        </select>
        <button
          className="btn-ecom"
          onClick={() => {
            const now = new Date().toISOString();
            addTask({
              title: '新任务', description: '', status: 'backlog',
              priority: 'medium', progress: 0, subtasks: [],
            });
          }}
        >
          + 新建任务
        </button>
      </div>

      {/* Kanban 列 */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns.length}, 1fr)`, gap: 10, flex: 1, overflow: 'hidden' }}>
        {columns.map((col) => {
          const colTasks = filtered.filter((t) => t.status === col.key);
          return (
            <div
              key={col.key}
              style={{
                background: 'var(--bg-row-hover)', borderRadius: 10, padding: 8,
                display: 'flex', flexDirection: 'column', gap: 6, overflow: 'hidden',
                borderLeft: `3px solid ${col.color}`,
              }}
            >
              {/* 列头 */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 4px' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: col.color }}>{col.label}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{colTasks.length}</span>
              </div>
              {/* 卡片 */}
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {colTasks.map((task) => (
                  <div
                    key={task.id}
                    onClick={() => setEditingTask(editingTask === task.id ? null : task.id)}
                    style={{
                      background: 'var(--bg-card)', border: '1px solid var(--border-card)',
                      borderRadius: 8, padding: 10, cursor: 'pointer',
                      transition: 'all var(--transition-fast)',
                      borderLeft: `3px solid ${priorityColors[task.priority] || 'var(--text-muted)'}`,
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>{task.title}</div>
                    {task.description && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.description}</div>}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{task.assigneeName || '未指派'}</span>
                      {task.dueDate && (
                        <span style={{ fontSize: 10, color: new Date(task.dueDate) < new Date() && task.status !== 'completed' ? 'var(--danger-text)' : 'var(--text-muted)' }}>
                          {task.dueDate.slice(5)}
                        </span>
                      )}
                    </div>
                    {/* 进度条 */}
                    <div style={{ marginTop: 6, height: 4, background: 'var(--bg-row-hover)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${task.progress}%`, background: col.color, borderRadius: 2, transition: 'width 0.3s ease' }} />
                    </div>
                  </div>
                ))}
                {colTasks.length === 0 && (
                  <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 11 }}>空</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 编辑面板 */}
      {editingTask && (
        <TaskEditPanel taskId={editingTask} onClose={() => setEditingTask(null)} />
      )}
    </div>
  );
}

// 任务编辑面板
function TaskEditPanel({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const { tasks, updateTask, deleteTask } = useHRMSStore();
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return null;

  const [title, setTitle] = useState(task.title);
  const [desc, setDesc] = useState(task.description || '');
  const [status, setStatus] = useState(task.status);
  const [priority, setPriority] = useState(task.priority);

  return (
    <div
      style={{
        position: 'fixed', right: 0, top: 0, bottom: 0, width: 380,
        background: 'var(--bg-card)', borderLeft: '1px solid var(--border-color)',
        padding: 24, zIndex: 50, overflowY: 'auto',
        boxShadow: '-4px 0 16px rgba(0,0,0,0.06)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>编辑任务</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18 }}>×</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>标题</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} style={{ marginTop: 4 }} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>描述</label>
          <textarea className="input" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} style={{ marginTop: 4, resize: 'vertical' }} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>状态</label>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as any)} style={{ marginTop: 4 }}>
            <option value="backlog">待办池</option>
            <option value="todo">待执行</option>
            <option value="in-progress">进行中</option>
            <option value="review">待验收</option>
            <option value="blocked">阻塞</option>
            <option value="completed">已完成</option>
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>优先级</label>
          <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as any)} style={{ marginTop: 4 }}>
            <option value="urgent">紧急</option>
            <option value="high">高</option>
            <option value="medium">中</option>
            <option value="low">低</option>
          </select>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button className="btn-ecom" onClick={() => { updateTask(taskId, { title, description: desc, status, priority }); onClose(); }}>
            保存
          </button>
          <button className="btn-ghost" onClick={onClose}>取消</button>
          <button className="btn-ghost" style={{ color: 'var(--danger-text)' }} onClick={() => { deleteTask(taskId); onClose(); }}>删除</button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════
// OGSM 目标树
// ════════════════════════════════════════

export function OGSMTree() {
  const { ogsmItems, addOgsmItem, updateOgsmItem, deleteOgsmItem } = useHRMSStore();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);

  const levelLabels: Record<string, string> = {
    objective: 'O', strategy: 'S', goal: 'G', measurement: 'M',
  };
  const levelColors: Record<string, string> = {
    objective: 'var(--module-agent)', strategy: 'var(--ecom-blue-500)',
    goal: 'var(--ecom-amber-500)', measurement: 'var(--ecom-violet-500)',
  };
  const statusColors: Record<string, string> = {
    'planned': 'var(--text-muted)', 'in-progress': 'var(--ecom-blue-500)',
    'achieved': 'var(--success-500)', 'overdue': 'var(--danger-500)', 'archived': 'var(--text-muted)',
  };

  function toggleExpand(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function renderChildren(parentId: string | null, depth: number = 0) {
    const children = ogsmItems
      .filter((i) => i.parentId === parentId)
      .sort((a, b) => a.orderIndex - b.orderIndex);

    return children.map((item) => {
      const hasChildren = ogsmItems.some((i) => i.parentId === item.id);
      const isExpanded = expanded[item.id];
      const paddingLeft = depth * 20;

      return (
        <div key={item.id} style={{ paddingLeft }}>
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
              borderRadius: 8, cursor: 'pointer', transition: 'all var(--transition-fast)',
              borderLeft: `3px solid ${levelColors[item.level]}`,
              background: editingId === item.id ? 'var(--bg-row-selected)' : 'transparent',
            }}
            onClick={() => toggleExpand(item.id)}
          >
            {/* 展开/折叠图标 */}
            {hasChildren ? (
              <span style={{ width: 14, height: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', flexShrink: 0 }}>
                {isExpanded ? '▾' : '▸'}
              </span>
            ) : (
              <span style={{ width: 14, flexShrink: 0 }} />
            )}

            {/* 层级标签 */}
            <span
              style={{
                width: 24, height: 24, borderRadius: 6, display: 'inline-flex',
                alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700,
                background: levelColors[item.level], color: '#fff', flexShrink: 0,
              }}
            >
              {levelLabels[item.level]}
            </span>

            {/* 标题 */}
            <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>
              {item.title}
            </span>

            {/* 状态徽章 */}
            <span
              style={{
                padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600,
                background: statusColors[item.status] || 'var(--text-muted)',
                color: item.status === 'overdue' ? '#fff' : item.status === 'achieved' ? '#fff' : 'var(--text-muted)',
              }}
            >
              {item.status}
            </span>

            {/* 编辑/删除按钮 */}
            {editingId === item.id && (
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn-ghost" style={{ padding: '2px 6px', fontSize: 11 }} onClick={(e) => { e.stopPropagation(); setEditingId(null); }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              </div>
            )}
          </div>

          {/* 子节点 */}
          {hasChildren && isExpanded && (
            <div>{renderChildren(item.id, depth + 1)}</div>
          )}
        </div>
      );
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12 }}>
      {/* 顶部操作 */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          className="btn-ecom"
          onClick={() => {
            const now = new Date().toISOString();
            addOgsmItem({
              parentId: null, level: 'objective',
              title: '新目标', description: '',
              status: 'planned', orderIndex: ogsmItems.filter((i) => i.level === 'objective').length,
              objective: '',
            });
          }}
        >
          + 添加 O 目标
        </button>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {ogsmItems.length} 个 OGSM 项 · 展开查看层级结构
        </span>
      </div>

      {/* 树形列表 */}
      <div style={{ flex: 1, overflowY: 'auto', background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-card)', padding: 8 }}>
        {renderChildren(null, 0)}
      </div>
    </div>
  );
}

// ════════════════════════════════════════
// RACI 矩阵
// ════════════════════════════════════════

export function HRRACIMatrix() {
  const { tasks, raciEntries, employees, addRACIEntry, removeRACIEntry } = useHRMSStore();
  const [selectedTaskId, setSelectedTaskId] = useState(tasks[0]?.id || '');

  const roles = ['R', 'A', 'C', 'I'] as const;
  const roleLabels: Record<string, string> = { R: '负责人', A: '审批人', C: '咨询人', I: '知情人' };
  const roleColors: Record<string, string> = { R: 'var(--module-agent)', A: 'var(--ecom-blue-500)', C: 'var(--ecom-violet-500)', I: 'var(--text-muted)' };

  const selectedTask = tasks.find((t) => t.id === selectedTaskId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12 }}>
      {/* 任务选择 */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>选择任务:</label>
        <select
          className="input"
          style={{ width: 240 }}
          value={selectedTaskId}
          onChange={(e) => setSelectedTaskId(e.target.value)}
        >
          {tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
      </div>

      {/* RACI 矩阵表格 */}
      <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-card)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg-table-header)' }}>
              <th style={{ textAlign: 'left', padding: '10px 16px', fontSize: 12, color: 'var(--text-table-header)', borderBottom: '1px solid var(--border-table)', width: 200 }}>
                {selectedTask?.title || '请选择任务'}
              </th>
              {roles.map((role) => (
                <th key={role} style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-table-header)', borderBottom: '1px solid var(--border-table)', textAlign: 'center' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: roleColors[role] }} />
                    {role} - {roleLabels[role]}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-divider)' }}>
                负责人
              </td>
              {roles.map((role) => {
                const entry = raciEntries.find((e) => e.taskId === selectedTaskId && e.role === role);
                return (
                  <td key={role} style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-divider)', textAlign: 'center' }}>
                    {entry ? (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{entry.employeeName}</span>
                        <button
                          onClick={() => removeRACIEntry(selectedTaskId, role)}
                          style={{ background: 'none', border: 'none', color: 'var(--danger-text)', cursor: 'pointer', fontSize: 12 }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                        </button>
                      </div>
                    ) : (
                      <select
                        className="input"
                        style={{ padding: '4px 8px', fontSize: 12 }}
                        value=""
                        onChange={(e) => {
                          if (e.target.value) {
                            addRACIEntry({ taskId: selectedTaskId, employeeId: e.target.value, employeeName: employees.find((emp) => emp.id === e.target.value)?.name || '', role, roleLabel: role === 'R' ? '负责人' : role === 'A' ? '审批人' : role === 'C' ? '咨询人' : '知情人' });
                          }
                        }}
                      >
                        <option value="">指派...</option>
                        {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                      </select>
                    )}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {/* RACI 图例 */}
      <div style={{ display: 'flex', gap: 16, padding: '12px 16px', background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-card)' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>RACI 模型:</span>
        {roles.map((role) => (
          <span key={role} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: roleColors[role] }} />
            <strong>{role}</strong> = {roleLabels[role]}
          </span>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════
// 风险预警
// ════════════════════════════════════════

export function HRRisk() {
  const { risks, riskFilter, setRiskFilter, addRisk, updateRisk, deleteRisk } = useHRMSStore();

  const severityColors: Record<string, string> = {
    critical: 'var(--danger-500)', high: 'var(--warning-500)',
    medium: 'var(--ecom-blue-500)', low: 'var(--text-muted)',
  };
  const statusColors: Record<string, string> = {
    open: 'var(--danger-500)', mitigating: 'var(--warning-500)',
    resolved: 'var(--success-500)', accepted: 'var(--text-muted)',
  };

  let filtered = risks;
  if (riskFilter.severity) filtered = filtered.filter((r) => r.severity === riskFilter.severity);
  if (riskFilter.status) filtered = filtered.filter((r) => r.status === riskFilter.status);
  if (riskFilter.assignee) filtered = filtered.filter((r) => r.assigneeName === riskFilter.assignee);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12 }}>
      {/* 筛选 + 新建 */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select className="input" style={{ width: 120 }} value={riskFilter.severity || ''}
          onChange={(e) => setRiskFilter({ ...riskFilter, severity: e.target.value as any || undefined })}>
          <option value="">全部严重度</option>
          <option value="critical">严重</option>
          <option value="high">高</option>
          <option value="medium">中</option>
          <option value="low">低</option>
        </select>
        <select className="input" style={{ width: 120 }} value={riskFilter.status || ''}
          onChange={(e) => setRiskFilter({ ...riskFilter, status: e.target.value as any || undefined })}>
          <option value="">全部状态</option>
          <option value="open">开放</option>
          <option value="mitigating">缓解中</option>
          <option value="resolved">已解决</option>
        </select>
        <button className="btn-ecom" onClick={() => addRisk({ title: '新风险', severity: 'medium', status: 'open', likelihood: 0.5 })}>
          + 添加风险
        </button>
      </div>

      {/* 风险列表 */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map((risk) => (
          <div key={risk.id} style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-card)', padding: 14, borderLeft: `4px solid ${severityColors[risk.severity]}` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{risk.title}</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600, background: severityColors[risk.severity], color: '#fff' }}>{risk.severity}</span>
                <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600, background: statusColors[risk.status], color: '#fff' }}>{risk.status}</span>
              </div>
            </div>
            {risk.description && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{risk.description}</div>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 11, color: 'var(--text-muted)' }}>
              <span>风险值: {risk.score.toFixed(1)}/10</span>
              {risk.assigneeName && <span>负责人: {risk.assigneeName}</span>}
              <span>发现: {risk.detectedAt.slice(0, 10)}</span>
            </div>
            {risk.mitigationPlan && (
              <div style={{ marginTop: 8, padding: '6px 10px', background: 'var(--bg-row-hover)', borderRadius: 6, fontSize: 11, color: 'var(--text-secondary)' }}>
                缓解方案: {risk.mitigationPlan}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button className="btn-ghost" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => updateRisk(risk.id, { status: 'mitigating' as any })}>标记缓解中</button>
              <button className="btn-ghost" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => updateRisk(risk.id, { status: 'resolved' as any })}>标记已解决</button>
              <button className="btn-ghost" style={{ fontSize: 11, padding: '3px 10px', color: 'var(--danger-text)' }} onClick={() => deleteRisk(risk.id)}>删除</button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>暂无风险记录</div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════
// 激励机制
// ════════════════════════════════════════

export function HRIncentive() {
  const { incentives, incentiveResults, addIncentive, deleteIncentive, calculateIncentive, employees } = useHRMSStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [newType, setNewType] = useState('completion');
  const [newRule, setNewRule] = useState('');
  const [newRewardAmount, setNewRewardAmount] = useState('');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12 }}>
      {/* 新建激励 */}
      <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-card)', padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>新建激励规则</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 8 }}>
          <select className="input" value={newType} onChange={(e) => setNewType(e.target.value as any)}>
            <option value="completion">完成任务</option>
            <option value="milestone">里程碑达成</option>
            <option value="quality">质量优秀</option>
            <option value="extra-mile">超预期表现</option>
          </select>
          <input className="input" placeholder="规则描述（如：完成紧急任务奖励200积分）" value={newRule} onChange={(e) => setNewRule(e.target.value)} />
          <input className="input" placeholder="奖励金额/积分" value={newRewardAmount} onChange={(e) => setNewRewardAmount(e.target.value)} />
          <button
            className="btn-ecom"
            onClick={() => {
              addIncentive({
                type: newType as any, rule: newRule,
                reward: { type: 'cash', amount: parseFloat(newRewardAmount) || 0 },
                eligible: [], autoCalculate: true, status: 'active',
              });
              setNewRule('');
              setNewRewardAmount('');
            }}
          >
            + 添加
          </button>
        </div>
      </div>

      {/* 激励列表 */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {incentives.map((inc) => (
          <div key={inc.id} style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-card)', padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{inc.rule || '未命名规则'}</span>
              <span
                style={{
                  padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600,
                  background: inc.status === 'active' ? 'var(--success-500)' : 'var(--text-muted)',
                  color: '#fff',
                }}
              >
                {inc.status}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--text-muted)' }}>
              <span>类型: {inc.type}</span>
              <span>奖励: {inc.reward.amount || 0}</span>
              <span>自动计算: {inc.autoCalculate ? '是' : '否'}</span>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {employees.slice(0, 3).map((emp) => (
                <button
                  key={emp.id}
                  className="btn-ghost"
                  style={{ fontSize: 11, padding: '3px 8px' }}
                  onClick={() => calculateIncentive(inc.id, emp.id)}
                >
                  给 {emp.name} 计算
                </button>
              ))}
              <button className="btn-ghost" style={{ fontSize: 11, padding: '3px 8px', color: 'var(--danger-text)' }} onClick={() => deleteIncentive(inc.id)}>删除</button>
            </div>
          </div>
        ))}
        {incentives.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>暂无激励规则</div>
        )}
      </div>

      {/* 激励结果 */}
      {incentiveResults.length > 0 && (
        <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-card)', padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>激励公示 ({incentiveResults.length})</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {incentiveResults.slice(-6).map((r) => (
              <div key={r.employeeId + r.calculatedAt} style={{ padding: 10, background: 'var(--bg-row-hover)', borderRadius: 8, fontSize: 12 }}>
                <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{r.employeeName}</div>
                <div style={{ color: 'var(--success-500)', marginTop: 2 }}>+{r.reward.amount || 0} {r.reward.type === 'cash' ? '元' : '积分'}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>{r.calculatedAt.slice(0, 10)} · {r.status}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════
// 试点推广
// ════════════════════════════════════════

export function HRPilot() {
  const { pilots, addPilot, updatePilot, deletePilot } = useHRMSStore();

  const statusColors: Record<string, string> = {
    planning: 'var(--text-muted)', running: 'var(--ecom-blue-500)',
    completed: 'var(--success-500)', failed: 'var(--danger-500)',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12 }}>
      {/* 新建试点 */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn-ecom" onClick={() => addPilot({
          name: '新试点', ogsmIds: [],
          scope: { scenarios: ['platform-ecom'] as any },
          startDate: new Date().toISOString().slice(0, 10),
          status: 'planning', metrics: [],
        })}>
          + 新建试点
        </button>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>共 {pilots.length} 个试点项目</span>
      </div>

      {/* 试点列表 */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        {pilots.map((pilot) => (
          <div key={pilot.id} style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-card)', padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{pilot.name}</span>
              <span
                style={{
                  padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600,
                  background: statusColors[pilot.status], color: '#fff',
                }}
              >
                {pilot.status}
              </span>
            </div>

            {/* 指标 */}
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>跟踪指标:</div>
            {pilot.metrics.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
                {pilot.metrics.map((m, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', background: 'var(--bg-row-hover)', borderRadius: 4 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>{m.name}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {m.actualValue} / {m.targetValue} {m.unit || ''}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>无指标</div>
            )}

            {/* 推广阶段 */}
            {pilot.rolloutPlan && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>推广进度</div>
                <div style={{ height: 6, background: 'var(--bg-row-hover)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pilot.rolloutPlan.coverageRate}%`, background: 'var(--ecom-amber-500)', borderRadius: 3 }} />
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{pilot.rolloutPlan.coverageRate}% 覆盖率</div>
              </div>
            )}

            {/* 操作 */}
            <div style={{ display: 'flex', gap: 6 }}>
              {pilot.status === 'planning' && (
                <button className="btn-ghost" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => updatePilot(pilot.id, { status: 'running' })}>启动试点</button>
              )}
              {pilot.status === 'running' && (
                <button className="btn-ghost" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => updatePilot(pilot.id, { status: 'completed' })}>完成试点</button>
              )}
              <button className="btn-ghost" style={{ fontSize: 11, padding: '3px 10px', color: 'var(--danger-text)' }} onClick={() => deletePilot(pilot.id)}>删除</button>
            </div>
          </div>
        ))}
        {pilots.length === 0 && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>暂无试点项目</div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════
// 制度文档
// ════════════════════════════════════════

export function HRPolicy() {
  const { policies, addPolicy, updatePolicy, versionPolicy, deletePolicy } = useHRMSStore();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn-ecom" onClick={() => addPolicy({
          title: '新制度', category: 'other', version: 'v1.0',
          status: 'draft', changeLog: [],
        })}>
          + 新建制度
        </button>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>共 {policies.length} 份文档</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {policies.map((p) => (
          <div key={p.id} style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-card)', padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{p.title}</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600, background: p.status === 'published' ? 'var(--success-500)' : 'var(--text-muted)', color: '#fff' }}>{p.status}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>v{p.version}</span>
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>分类: {p.category} · 更新于 {p.updatedAt.slice(0, 10)}</div>
            {p.changeLog && p.changeLog.length > 0 && (
              <div style={{ marginTop: 6, fontSize: 10, color: 'var(--text-muted)' }}>
                变更: {p.changeLog.map((c) => `${c.version} ${c.change}`).join(' · ')}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button className="btn-ghost" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => versionPolicy(p.id, '更新内容')}>版本升级</button>
              <button className="btn-ghost" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => updatePolicy(p.id, { status: 'published' })}>发布</button>
              <button className="btn-ghost" style={{ fontSize: 11, padding: '3px 10px', color: 'var(--danger-text)' }} onClick={() => deletePolicy(p.id)}>删除</button>
            </div>
          </div>
        ))}
        {policies.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>暂无制度文档</div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════
// 业务场景配置
// ════════════════════════════════════════

export function HRScenario() {
  const { scenarios, addScenario } = useHRMSStore();

  const scenarioLabels: Record<string, string> = {
    'platform-ecom': '平台电商', 'live-stream': '直播电商',
    'social-ecom': '社交电商', 'independent-site': '独立站',
  };
  const scenarioIcons: Record<string, JSX.Element> = {
    'platform-ecom': (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--ecom-amber-500)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        <path d="M9 22V12h6v10"/>
      </svg>
    ),
    'live-stream': (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--ecom-red-500)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="6" width="14" height="12" rx="2"/>
        <path d="M22 8v8M22 8l-4-2v8l4-2"/>
        <path d="M12 12l4-3" stroke="currentColor"/>
      </svg>
    ),
    'social-ecom': (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--ecom-violet-500)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
      </svg>
    ),
    'independent-site': (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--ecom-blue-500)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9"/>
        <path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>
      </svg>
    ),
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>业务场景适配</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>选择业务形态，系统自动适配对应任务模板、指标和 OGSM 结构</div>

      {/* 场景卡片 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {['platform-ecom', 'live-stream', 'social-ecom', 'independent-site'].map((key) => (
          <div
            key={key}
            style={{
              background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-card)',
              padding: 20, textAlign: 'center', cursor: 'pointer',
              transition: 'all var(--transition-fast)',
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 8 }}>{scenarioIcons[key]}</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{scenarioLabels[key]}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              {key === 'platform-ecom' && '淘宝/天猫/京东/拼多多'}
              {key === 'live-stream' && '抖音/快手/视频号'}
              {key === 'social-ecom' && '小红书/微信社群'}
              {key === 'independent-site' && 'Shopify/自建站'}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
              {scenarios.filter((s) => s.scenario === key).length} 个配置
            </div>
          </div>
        ))}
      </div>

      {/* 说明 */}
      <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-card)', padding: 16, marginTop: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>场景适配说明</div>
        <ul style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.8, paddingLeft: 16 }}>
          <li><strong>平台电商</strong>: 适配选品→上架→促销→物流→客服全链路，指标侧重转化率、客单价、退货率</li>
          <li><strong>直播电商</strong>: 适配主播排期→直播间搭建→带货转化→达人管理，指标侧重 GMV、观看量、转化率</li>
          <li><strong>社交电商</strong>: 适配社群运营→内容种草→私域转化→复购提升，指标侧重留存率、裂变率、客单值</li>
          <li><strong>独立站</strong>: 适配 SEO 优化→广告投放→用户旅程→LTV 提升，指标侧重流量成本、LTV、复购率</li>
        </ul>
      </div>
    </div>
  );
}

// ════════════════════════════════════════
// 设置
// ════════════════════════════════════════

export function HRSettings() {
  const { exportHRMS, importHRMS, employees, addEmployee, deleteEmployee } = useHRMSStore();
  const [importText, setImportText] = useState('');

  const [newName, setNewName] = useState('');
  const [newDept, setNewDept] = useState('');
  const [newPillar, setNewPillar] = useState('coe');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 16 }}>
      {/* 数据导入导出 */}
      <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-card)', padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>数据导入 / 导出</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-ecom" onClick={async () => {
            const data = await exportHRMS();
            const blob = new Blob([data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `vorzai-hrms-export-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }}>
            导出 JSON
          </button>
          <div style={{ display: 'flex', gap: 4, flex: 1 }}>
            <input className="input" placeholder="粘贴 JSON 数据导入..." value={importText} onChange={(e) => setImportText(e.target.value)} style={{ flex: 1 }} />
            <button className="btn-ghost" onClick={async () => {
              if (importText.trim()) await importHRMS(importText);
              setImportText('');
            }}>导入</button>
          </div>
        </div>
      </div>

      {/* 员工管理 */}
      <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-card)', padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>员工管理 ({employees.length})</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 8 }}>
          <input className="input" placeholder="姓名" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <input className="input" placeholder="部门" value={newDept} onChange={(e) => setNewDept(e.target.value)} />
          <select className="input" value={newPillar} onChange={(e) => setNewPillar(e.target.value as any)}>
            <option value="coe">COE 专家中心</option>
            <option value="hrbp">HRBP 业务伙伴</option>
            <option value="ssc">SSC 共享服务中心</option>
          </select>
          <button className="btn-ecom" onClick={() => {
            if (newName.trim()) {
              addEmployee({ name: newName.trim(), department: newDept, position: '', pillar: newPillar as any, status: 'active', pillarLabel: newPillar === 'coe' ? 'COE 专家中心' : newPillar === 'hrbp' ? 'HRBP 业务伙伴' : 'SSC 共享服务中心' });
              setNewName('');
              setNewDept('');
            }
          }}>
            + 添加
          </button>
        </div>

        {/* 员工列表 */}
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {employees.map((emp) => (
            <div key={emp.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-row-hover)', borderRadius: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{emp.name}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{emp.department} · {emp.pillarLabel}</span>
              <button className="btn-ghost" style={{ fontSize: 11, color: 'var(--danger-text)' }} onClick={() => deleteEmployee(emp.id)}>删除</button>
            </div>
          ))}
          {employees.length === 0 && <div style={{ textAlign: 'center', padding: 16, color: 'var(--text-muted)', fontSize: 12 }}>暂无员工</div>}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════
// 人效分析
// ════════════════════════════════════════

export function HREfficiency() {
  const { employees } = useHRMSStore();
  const [startDate, setStartDate] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; });
  const [endDate, setEndDate] = useState(() => { const d = new Date(); return d.toISOString().slice(0, 10); });
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // 基于本地 store 数据的估算（无需后端）
  const headcount = employees.length || 1;
  const mockGmvPerCapita = 85000;
  const mockSalaryPerCapita = 12000;
  const costEfficiency = headcount > 0 ? mockGmvPerCapita / mockSalaryPerCapita : 0;

  const handleCalculate = async () => {
    setLoading(true);
    try {
      const res = await api.hr.calculateEfficiency({ startDate, endDate });
      if (res.success) setResult(res.data);
    } catch (e) {
      console.warn('[HRMS] 计算人效失败，使用本地估算:', e);
      /* use local estimation */
    }
    setLoading(false);
  };

  const metrics = result || {
    headcount,
    gmvPerCapita: mockGmvPerCapita,
    salaryPerCapita: mockSalaryPerCapita,
    costEfficiency,
    ordersPerCapita: Math.round(mockGmvPerCapita / 350),
  };

  // 趋势数据（模拟近 6 个月）
  const trendMonths = ['1月', '2月', '3月', '4月', '5月', '6月'];
  const trendData = [72000, 78000, 81000, 84000, 85000, 87000];
  const maxTrend = Math.max(...trendData);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 日期选择 + 计算 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ width: 160 }} />
        <span style={{ color: 'var(--text-muted)' }}>至</span>
        <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ width: 160 }} />
        <button className="btn-ecom" onClick={handleCalculate} disabled={loading}>{loading ? '计算中...' : '计算人效'}</button>
      </div>

      {/* 核心指标 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
        {[
          { label: '活跃员工', value: metrics.headcount, color: 'var(--module-agent)', unit: '人' },
          { label: '人均 GMV', value: metrics.gmvPerCapita.toLocaleString(), color: 'var(--ecom-amber-500)', unit: '元' },
          { label: '人均薪酬', value: metrics.salaryPerCapita.toLocaleString(), color: 'var(--ecom-blue-500)', unit: '元' },
          { label: '成本效率', value: metrics.costEfficiency.toFixed(2), color: 'var(--success-500)', unit: 'x' },
          { label: '人均订单', value: metrics.ordersPerCapita.toFixed(1), color: 'var(--ecom-violet-500)', unit: '单' },
        ].map((m) => (
          <div key={m.label} style={{ background: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border-card)', borderLeft: `3px solid ${m.color}`, padding: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: m.color, fontFamily: 'ui-monospace, monospace', marginTop: 2 }}>
              {m.value}<span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400, marginLeft: 2 }}>{m.unit}</span>
            </div>
          </div>
        ))}
      </div>

      {/* 人效趋势图 */}
      <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-card)', padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>人效趋势（人均 GMV）</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 140 }}>
          {trendData.map((v, i) => (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{(v / 1000).toFixed(0)}k</span>
              <div style={{ width: '70%', background: `linear-gradient(180deg, var(--ecom-amber-500), var(--ecom-amber-500)88)`, borderRadius: '4px 4px 0 0', height: `${(v / maxTrend) * 80}px`, transition: 'height 0.4s ease' }} />
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{trendMonths[i]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 公式说明 */}
      <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-card)', padding: 12, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7 }}>
        <strong style={{ color: 'var(--text-primary)' }}>计算公式:</strong>{' '}
        人效 = 团队总 GMV / 活跃员工数 | 成本效率 = 人均产出 / 人均薪酬成本
      </div>
    </div>
  );
}

// ════════════════════════════════════════
// 薪酬计算
// ════════════════════════════════════════

export function HRPayrollCalc() {
  const [period, setPeriod] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });
  const [baseSalary, setBaseSalary] = useState(15000);
  const [attendanceRate, setAttendanceRate] = useState(0.95);
  const [performanceBonus, setPerformanceBonus] = useState(3000);
  const [performanceCoefficient, setPerformanceCoefficient] = useState(1.0);
  const [allowance, setAllowance] = useState(500);
  const [deductions, setDeductions] = useState(0);
  const [overtimeRate, setOvertimeRate] = useState(1.5);
  const [overtimeHours, setOvertimeHours] = useState(8);
  const [result, setResult] = useState<any>(null);

  // 前端实时计算（与后端公式一致）
  const calc = () => {
    const attendanceSalary = baseSalary * attendanceRate;
    const performanceSalary = performanceBonus * performanceCoefficient;
    const hourlyRate = baseSalary / 174;
    const overtimePay = overtimeHours * hourlyRate * overtimeRate;
    const grossSalary = attendanceSalary + performanceSalary + overtimePay + allowance;
    const totalDeductions = deductions;
    const netSalary = Math.max(0, grossSalary - totalDeductions);
    const socialInsurance = grossSalary * 0.105;
    const housingFund = grossSalary * 0.12;
    const finalDeductions = totalDeductions + socialInsurance + housingFund;
    const taxableIncome = Math.max(0, grossSalary - finalDeductions - 5000);
    const finalNet = grossSalary - finalDeductions - Math.max(0, (taxableIncome * 0.03)); // 简化税率

    setResult({ attendanceSalary, performanceSalary, overtimePay, grossSalary, totalDeductions, socialInsurance, housingFund, netSalary: netSalary, finalNet });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>发薪周期:</span>
        <input className="input" value={period} onChange={(e) => setPeriod(e.target.value)} style={{ width: 120 }} />
        <button className="btn-ecom" onClick={calc}>计算</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* 输入参数 */}
        <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-card)', padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>计算参数</div>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px 12px', fontSize: 12 }}>
            <span style={{ color: 'var(--text-muted)' }}>基本工资</span>
            <input className="input" type="number" value={baseSalary} onChange={(e) => setBaseSalary(Number(e.target.value)) } />
            <span style={{ color: 'var(--text-muted)' }}>出勤率</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input className="input" type="range" min="0" max="1" step="0.05" value={attendanceRate} onChange={(e) => setAttendanceRate(Number(e.target.value)) } />
              <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--text-primary)' }}>{attendanceRate.toFixed(2)}</span>
            </div>
            <span style={{ color: 'var(--text-muted)' }}>绩效奖金基数</span>
            <input className="input" type="number" value={performanceBonus} onChange={(e) => setPerformanceBonus(Number(e.target.value)) } />
            <span style={{ color: 'var(--text-muted)' }}>绩效系数</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input className="input" type="range" min="0" max="2" step="0.1" value={performanceCoefficient} onChange={(e) => setPerformanceCoefficient(Number(e.target.value)) } />
              <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--text-primary)' }}>{performanceCoefficient.toFixed(2)}</span>
            </div>
            <span style={{ color: 'var(--text-muted)' }}>津贴</span>
            <input className="input" type="number" value={allowance} onChange={(e) => setAllowance(Number(e.target.value)) } />
            <span style={{ color: 'var(--text-muted)' }}>加班小时</span>
            <input className="input" type="number" value={overtimeHours} onChange={(e) => setOvertimeHours(Number(e.target.value)) } />
            <span style={{ color: 'var(--text-muted)' }}>加班倍率</span>
            <input className="input" type="number" step="0.1" value={overtimeRate} onChange={(e) => setOvertimeRate(Number(e.target.value)) } />
            <span style={{ color: 'var(--text-muted)' }}>其他扣除</span>
            <input className="input" type="number" value={deductions} onChange={(e) => setDeductions(Number(e.target.value)) } />
          </div>
        </div>

        {/* 计算结果 */}
        <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-card)', padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>计算结果</div>
          {result ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
              {[
                { label: '基本工资 × 出勤率', value: result.attendanceSalary, color: 'var(--ecom-blue-500)' },
                { label: '绩效奖金 × 绩效系数', value: result.performanceSalary, color: 'var(--ecom-amber-500)' },
                { label: '加班工资', value: result.overtimePay, color: 'var(--ecom-violet-500)' },
                { label: '应发总额', value: result.grossSalary, color: 'var(--text-primary)' },
                { label: '社保', value: -result.socialInsurance, color: 'var(--danger-text)' },
                { label: '公积金', value: -result.housingFund, color: 'var(--danger-text)' },
                { label: '其他扣除', value: -result.totalDeductions, color: 'var(--danger-text)' },
              ].map((item, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', background: i === 3 ? 'var(--bg-row-hover)' : 'transparent', borderRadius: 4 }}>
                  <span style={{ color: i === 3 ? 'var(--text-primary)' : 'var(--text-muted)' }}>{item.label}</span>
                  <span style={{ color: item.color, fontFamily: 'ui-monospace, monospace', fontWeight: item.value < 0 ? 600 : 400 }}>
                    {item.value < 0 ? '-' : '+'}{Math.abs(item.value).toFixed(2)}
                  </span>
                </div>
              ))}
              <div style={{ marginTop: 4, padding: '8px 12px', background: 'var(--bg-row-hover)', borderRadius: 8, display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>实发工资</span>
                <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--success-500)', fontFamily: 'ui-monospace, monospace' }}>
                  ¥ {result.finalNet.toFixed(2)}
                </span>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>调整参数后点击"计算"</div>
          )}
        </div>
      </div>

      <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-card)', padding: 12, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7 }}>
        <strong style={{ color: 'var(--text-primary)' }}>计算公式:</strong>{' '}
        应发 = 基本工资 × 出勤率 + 绩效奖金 × 绩效系数 + 加班工资 + 津贴 − 扣除项 | 加班工资 = 加班时 × (基本工资/174) × 加班倍率
      </div>
    </div>
  );
}

// ════════════════════════════════════════
// 绩效评分
// ════════════════════════════════════════

export function HRPerformanceScore() {
  const [scores, setScores] = useState({ achievement: 80, collaboration: 75, innovation: 70, learning: 85 });
  const [result, setResult] = useState<any>(null);

  const weights = { achievement: 0.40, collaboration: 0.25, innovation: 0.20, learning: 0.15 };
  const weightLabels: Record<string, string> = { achievement: '业绩 40%', collaboration: '协作 25%', innovation: '创新 20%', learning: '学习 15%' };
  const weightColors: Record<string, string> = { achievement: 'var(--ecom-amber-500)', collaboration: 'var(--ecom-blue-500)', innovation: 'var(--ecom-violet-500)', learning: 'var(--success-500)' };

  const handleCalculate = () => {
    const weighted = scores.achievement * 0.40 + scores.collaboration * 0.25 + scores.innovation * 0.20 + scores.learning * 0.15;
    const rating = weighted >= 90 ? 'S' : weighted >= 80 ? 'A' : weighted >= 65 ? 'B' : weighted >= 50 ? 'C' : 'D';
    const contributions = {
      achievement: Math.round(scores.achievement * 0.40 * 100) / 100,
      collaboration: Math.round(scores.collaboration * 0.25 * 100) / 100,
      innovation: Math.round(scores.innovation * 0.20 * 100) / 100,
      learning: Math.round(scores.learning * 0.15 * 100) / 100,
    };
    setResult({ weightedScore: Math.round(weighted * 100) / 100, rating, contributions });
  };

  const ratingColor = (r: string) => r === 'S' ? 'var(--success-500)' : r === 'A' ? 'var(--ecom-blue-500)' : r === 'B' ? 'var(--ecom-amber-500)' : r === 'C' ? 'var(--warning-500)' : 'var(--danger-500)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn-ecom" onClick={handleCalculate}>计算绩效</button>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>加权平均: 业绩 40% + 协作 25% + 创新 20% + 学习 15%</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* 评分输入 */}
        <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-card)', padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>各维度评分（0-100）</div>
          {(['achievement', 'collaboration', 'innovation', 'learning'] as const).map((dim) => (
            <div key={dim} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <div style={{ width: 90, fontSize: 12, color: 'var(--text-muted)' }}>
                <span style={{ color: weightColors[dim] }}>{weightLabels[dim]}</span>
              </div>
              <input className="input" type="range" min="0" max="100" value={scores[dim]}
                onChange={(e) => setScores({ ...scores, [dim]: Number(e.target.value) }) }
                style={{ flex: 1 }} />
              <span style={{ width: 40, textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 600, color: weightColors[dim] }}>
                {scores[dim]}
              </span>
            </div>
          ))}
        </div>

        {/* 结果展示 */}
        <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-card)', padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>计算结果</div>
          {result ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <div style={{ width: 80, height: 80, borderRadius: '50%', background: `conic-gradient(${ratingColor(result.rating)} ${(result.weightedScore / 100) * 360}deg, var(--bg-row-hover) 0)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--bg-card)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: ratingColor(result.rating), fontFamily: 'ui-monospace, monospace' }}>{result.weightedScore}</span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>加权总分</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: ratingColor(result.rating) }}>
                    等级 <span className="badge" style={{ background: ratingColor(result.rating), color: '#fff' }}>{result.rating}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    S ≥90 · A ≥80 · B ≥65 · C ≥50 · D &lt;50
                  </div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {(['achievement', 'collaboration', 'innovation', 'learning'] as const).map((dim) => (
                  <div key={dim} style={{ padding: 8, background: 'var(--bg-row-hover)', borderRadius: 6, borderLeft: `3px solid ${weightColors[dim]}` }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{weightLabels[dim]}</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: weightColors[dim], fontFamily: 'ui-monospace, monospace' }}>
                      {result.contributions[dim].toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>调整评分后点击"计算绩效"</div>
          )}
        </div>
      </div>
    </div>
  );
}
