/**
 * WorkflowStudio — 工作流编排工作台（B1 修复）
 *
 * 补齐 W5 工作流引擎的前端入口，使已完整的 `/api/workflows` 后端能力对用户可达：
 *   - 工作流列表（按状态过滤）
 *   - 选中工作流查看 DAG 图（节点 + 边）
 *   - 一键触发执行并展示运行结果与日志
 *   - 运行记录列表 + 取消
 *   - 图合法性校验
 *   - 已注册工具查看
 *   - 新建工作流
 *
 * 数据流：前端 → api.workflow.* → Express(/api/workflows) → workflowOrchestrator → 落库 workflow_run_log
 * 风格：对齐 HRMS / OGSMBoard 的内联 style + 主题变量约定，使用 toast 反馈。
 */
import { useState, useEffect, useCallback } from 'react';
import { api } from '@api/client';
import { toast } from '@components/Common/Toast';

interface WfDefinition {
  id: string;
  name: string;
  description?: string;
  status: 'draft' | 'active' | 'archived';
  created_at?: string;
  updated_at?: string;
}

interface WfNode {
  id: string;
  name: string;
  node_type: 'tool' | 'condition' | 'input' | 'output';
  tool_type?: string;
  position?: { x: number; y: number };
  status?: string;
}

interface WfEdge {
  id: string;
  from_node_id: string;
  to_node_id: string;
  condition?: string;
}

interface WfGraph {
  definition: WfDefinition;
  nodes: WfNode[];
  edges: WfEdge[];
}

interface WfRunLog {
  id?: string;
  node_id?: string;
  level?: string;
  message: string;
  created_at?: string;
}

interface WfRun {
  id: string;
  workflow_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  triggered_by_type?: string;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  error?: string;
  started_at?: string;
  finished_at?: string;
  logs?: WfRunLog[];
}

interface WfTool {
  type: string;
  name: string;
  description?: string;
}

const NODE_COLORS: Record<string, string> = {
  tool: '#4f46e5',
  condition: '#d97706',
  input: '#0891b2',
  output: '#16a34a',
};

export default function WorkflowStudio() {
  const [definitions, setDefinitions] = useState<WfDefinition[]>([]);
  const [tools, setTools] = useState<WfTool[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [graph, setGraph] = useState<WfGraph | null>(null);
  const [runs, setRuns] = useState<WfRun[]>([]);
  const [activeTab, setActiveTab] = useState<'graph' | 'runs'>('graph');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');

  // 新建工作流表单
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [listRes, toolsRes] = await Promise.all([
        api.workflow.list(statusFilter || undefined),
        api.workflow.tools(),
      ]);
      if (listRes.success) setDefinitions((listRes.data as WfDefinition[]) || []);
      else setError(listRes.error?.message || '加载工作流失败');
      if (toolsRes.success) setTools((toolsRes.data as WfTool[]) || []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { loadList(); }, [loadList]);

  const selectWorkflow = useCallback(async (id: string) => {
    setSelectedId(id);
    setActiveTab('graph');
    setLoading(true);
    setError(null);
    try {
      const [graphRes, runsRes] = await Promise.all([
        api.workflow.getGraph(id),
        api.workflow.listRuns(id),
      ]);
      if (graphRes.success) setGraph(graphRes.data as WfGraph);
      else setError(graphRes.error?.message || '加载工作流图失败');
      if (runsRes.success) setRuns((runsRes.data as WfRun[]) || []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRun = async (id: string) => {
    setLoading(true);
    try {
      const res = await api.workflow.run(id);
      if (res.success) {
        const data = res.data as { run: WfRun; logs: WfRunLog[] };
        toast('success', '已触发执行', `运行 ID: ${data.run.id}`);
        await selectWorkflow(id);
      } else {
        toast('error', '执行失败', res.error?.message);
      }
    } catch (e) {
      toast('error', '执行异常', String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleValidate = async (id: string) => {
    try {
      const res = await api.workflow.validate(id);
      if (res.success) {
        const data = res.data as { valid: boolean; errors?: string[] };
        if (data.valid) toast('success', '图校验通过', '无结构性错误');
        else toast('error', '图校验未通过', (data.errors || []).join('；'));
      } else {
        toast('error', '校验失败', res.error?.message);
      }
    } catch (e) {
      toast('error', '校验异常', String(e));
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) { toast('error', '请填写名称'); return; }
    try {
      const res = await api.workflow.create({ name: newName.trim(), description: newDesc.trim() || undefined });
      if (res.success) {
        toast('success', '工作流已创建');
        setShowCreate(false);
        setNewName('');
        setNewDesc('');
        await loadList();
      } else {
        toast('error', '创建失败', res.error?.message);
      }
    } catch (e) {
      toast('error', '创建异常', String(e));
    }
  };

  const handleCancelRun = async (id: string, runId: string) => {
    try {
      const res = await api.workflow.cancelRun(id, runId);
      if (res.success) { toast('success', '已取消运行'); await selectWorkflow(id); }
      else toast('error', '取消失败', res.error?.message);
    } catch (e) {
      toast('error', '取消异常', String(e));
    }
  };

  return (
    <div style={{ padding: 20, height: '100%', overflowY: 'auto', color: 'var(--text-primary)' }}>
      {/* 头部 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>工作流编排</h2>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            将高频操作固化为自动化流水线，支持对话触发与业务写回
          </div>
        </div>
        <button className="btn-ecom" onClick={() => setShowCreate((v) => !v)}>
          + 新建工作流
        </button>
      </div>

      {showCreate && (
        <div style={{
          border: '1px solid var(--border-color)', borderRadius: 10, padding: 16,
          marginBottom: 16, background: 'var(--bg-card)', display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <input
            className="input-ecom"
            placeholder="工作流名称"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            style={{ fontSize: 14 }}
          />
          <textarea
            className="input-ecom"
            placeholder="描述（可选）"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            rows={2}
            style={{ fontSize: 14, resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-ecom" onClick={handleCreate}>创建</button>
            <button className="btn-ghost" onClick={() => setShowCreate(false)}>取消</button>
          </div>
        </div>
      )}

      {error && (
        <div style={{
          background: 'rgba(239,68,68,0.08)', color: '#dc2626', border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 12,
        }}>{error}</div>
      )}

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        {/* 左侧：工作流列表 */}
        <div style={{ width: 280, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>工作流</span>
            <select
              className="input-ecom"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{ fontSize: 12, padding: '4px 8px', width: 110 }}
            >
              <option value="">全部状态</option>
              <option value="draft">草稿</option>
              <option value="active">启用</option>
              <option value="archived">归档</option>
            </select>
          </div>

          {loading && definitions.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 12 }}>加载中…</div>
          )}
          {!loading && definitions.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 12 }}>暂无工作流，点击右上角新建。</div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {definitions.map((d) => (
              <div
                key={d.id}
                onClick={() => selectWorkflow(d.id)}
                style={{
                  border: `1px solid ${selectedId === d.id ? 'var(--primary-500)' : 'var(--border-color)'}`,
                  borderRadius: 8, padding: '10px 12px', cursor: 'pointer',
                  background: selectedId === d.id ? 'var(--bg-row-hover)' : 'var(--bg-card)',
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {d.name}
                  <span style={{
                    fontSize: 10, padding: '1px 6px', borderRadius: 4, marginLeft: 'auto',
                    background: d.status === 'active' ? 'rgba(34,197,94,0.15)' : 'var(--bg-row-hover)',
                    color: d.status === 'active' ? '#16a34a' : 'var(--text-muted)',
                  }}>{d.status}</span>
                </div>
                {d.description && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{d.description}</div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 右侧：详情 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {!selectedId && (
            <div style={{
              border: '1px dashed var(--border-color)', borderRadius: 10, padding: 48,
              textAlign: 'center', color: 'var(--text-muted)', fontSize: 14,
            }}>从左侧选择一个工作流查看编排图与运行记录</div>
          )}

          {selectedId && graph && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <strong style={{ fontSize: 15 }}>{graph.definition.name}</strong>
                <button className="btn-ecom" disabled={loading} onClick={() => handleRun(selectedId)}>▶ 运行</button>
                <button className="btn-ghost" onClick={() => handleValidate(selectedId)}>校验图</button>
                {activeTab === 'runs' && (
                  <button className="btn-ghost" onClick={() => selectWorkflow(selectedId)}>刷新</button>
                )}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                  {(['graph', 'runs'] as const).map((t) => (
                    <button
                      key={t}
                      className="btn-ghost"
                      onClick={() => setActiveTab(t)}
                      style={{
                        background: activeTab === t ? 'var(--bg-row-hover)' : 'transparent',
                        fontWeight: activeTab === t ? 600 : 400,
                      }}
                    >{t === 'graph' ? '编排图' : '运行记录'}</button>
                  ))}
                </div>
              </div>

              {activeTab === 'graph' && (
                <WorkflowCanvas graph={graph} />
              )}

              {activeTab === 'runs' && (
                <RunsTable runs={runs} onCancel={(runId) => handleCancelRun(selectedId, runId)} />
              )}
            </>
          )}
        </div>
      </div>

      {/* 工具注册表 */}
      <div style={{ marginTop: 24 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', margin: '0 0 8px' }}>
          已注册工具（{tools.length}）
        </h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {tools.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>无</span>}
          {tools.map((t) => (
            <span key={t.type} style={{
              fontSize: 12, padding: '4px 10px', borderRadius: 6,
              background: 'var(--bg-card)', border: '1px solid var(--border-color)',
            }} title={t.description}>{t.name}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** DAG 画布：节点按 position 绝对定位，边以 SVG 连线 */
function WorkflowCanvas({ graph }: { graph: WfGraph }) {
  const W = 180, H = 56;
  const nodes = graph.nodes;
  const posOf = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    if (n?.position) return { x: n.position.x, y: n.position.y };
    const idx = nodes.indexOf(n as WfNode);
    return { x: (idx % 4) * (W + 40) + 20, y: Math.floor(idx / 4) * (H + 40) + 20 };
  };

  const maxX = nodes.reduce((m, n) => {
    const p = posOf(n.id); return Math.max(m, p.x);
  }, 0);
  const maxY = nodes.reduce((m, n) => {
    const p = posOf(n.id); return Math.max(m, p.y);
  }, 0);
  const canvasW = Math.max(maxX + W + 40, 320);
  const canvasH = Math.max(maxY + H + 40, 160);

  if (nodes.length === 0) {
    return <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 24 }}>该工作流暂无节点，请通过对话或 API 编排。</div>;
  }

  return (
    <div style={{
      position: 'relative', border: '1px solid var(--border-color)', borderRadius: 10,
      background: 'var(--bg-card)', overflow: 'auto', padding: 4,
    }}>
      <div style={{ position: 'relative', width: canvasW, height: canvasH }}>
        <svg width={canvasW} height={canvasH} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
          {graph.edges.map((e) => {
            const a = posOf(e.from_node_id);
            const b = posOf(e.to_node_id);
            return (
              <line
                key={e.id}
                x1={a.x + W / 2} y1={a.y + H / 2}
                x2={b.x + W / 2} y2={b.y + H / 2}
                stroke="var(--border-strong)" strokeWidth={1.5}
              />
            );
          })}
        </svg>
        {nodes.map((n) => {
          const p = posOf(n.id);
          const color = NODE_COLORS[n.node_type] || 'var(--text-muted)';
          return (
            <div key={n.id} style={{
              position: 'absolute', left: p.x, top: p.y, width: W, height: H,
              border: `1px solid ${color}`, borderRadius: 8, background: 'var(--bg-elevated)',
              padding: '6px 10px', boxSizing: 'border-box',
              display: 'flex', flexDirection: 'column', justifyContent: 'center',
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {n.name}
              </div>
              <div style={{ fontSize: 11, color }}>
                {n.node_type}{n.tool_type ? ` · ${n.tool_type}` : ''}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 运行记录表 */
function RunsTable({ runs, onCancel }: { runs: WfRun[]; onCancel: (runId: string) => void }) {
  if (runs.length === 0) {
    return <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 24 }}>暂无运行记录，点击「运行」触发。</div>;
  }
  const statusColor: Record<string, string> = {
    completed: '#16a34a', failed: '#dc2626', running: '#d97706', pending: '#6b7280', cancelled: '#9ca3af',
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {runs.map((r) => (
        <div key={r.id} style={{
          border: '1px solid var(--border-color)', borderRadius: 8, padding: 12, background: 'var(--bg-card)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-muted)' }}>{r.id.slice(0, 8)}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: statusColor[r.status] || 'var(--text-muted)' }}>
              {r.status}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.triggered_by_type}</span>
            {r.status === 'running' || r.status === 'pending' ? (
              <button className="btn-ghost" style={{ marginLeft: 'auto', fontSize: 12 }} onClick={() => onCancel(r.id)}>
                取消
              </button>
            ) : null}
          </div>
          {r.error && <div style={{ fontSize: 12, color: '#dc2626', marginTop: 6 }}>{r.error}</div>}
          {r.logs && r.logs.length > 0 && (
            <div style={{
              marginTop: 8, fontSize: 11, fontFamily: 'monospace', color: 'var(--text-secondary)',
              background: 'var(--bg-code)', borderRadius: 6, padding: 8, maxHeight: 140, overflowY: 'auto',
            }}>
              {r.logs.map((l, i) => (
                <div key={i}>[{l.level || 'log'}] {l.message}</div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
