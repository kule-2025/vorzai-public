/**
 * Vorzai 电商 Agent — Agent 配置视图（P1 落地）
 * 原版为 100% Mock（MOCK_AGENTS / MOCK_EXPERTS + 5 个死按钮）。
 * 本版接入真实后端 /api/agents：列表、新建、编辑、启动/停止、删除，
 * 专家/连接器以标签形式真实绑定（落库 config_json）。
 */
import { useState, useEffect } from 'react';
import { Button } from '@components/Common/Button';
import { Input } from '@components/Common/Input';
import { useToast } from '@components/Common/Toast';
import { api } from '@api/client';

const ICONS = {
  agent: (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="3.5" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></svg>),
  plus: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>),
  play: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>),
  stop: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>),
  settings: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M12 1v3M12 20v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M1 12h3M20 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" /></svg>),
  link: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>),
  model: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="8" cy="12" r="1.5" fill="currentColor" /><path d="M11 12h6" /></svg>),
  expert: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></svg>),
};

const MODEL_OPTIONS = ['OpenAI GPT-4o', '通义千问 Max', 'DeepSeek V3', 'Claude 3.5 Sonnet', '自定义'];
const TYPE_OPTIONS = [
  { value: 'order-manager', label: '订单管理' },
  { value: 'inventory-analyst', label: '库存分析' },
  { value: 'marketing-agent', label: '营销助手' },
  { value: 'live-stream-host', label: '直播助手' },
  { value: 'cross-border-agent', label: '跨境助手' },
  { value: 'customer-service', label: '客服' },
  { value: 'hr-assistant', label: '人力助手' },
  { value: 'finance-auditor', label: '财务审计' },
  { value: 'custom', label: '自定义' },
];

interface AgentItem {
  id: string;
  name: string;
  description: string | null;
  type: string;
  status: 'idle' | 'running' | 'paused' | 'error' | 'completed';
  model: string | null;
  systemPrompt: string | null;
  temperature: number;
  maxTokens: number;
  skills: string[];
  experts: string[];
  connectors: string[];
}

function emptyAgent(): AgentItem {
  return {
    id: '', name: '', description: '', type: 'custom', status: 'idle',
    model: MODEL_OPTIONS[0], systemPrompt: '', temperature: 0.3, maxTokens: 4096,
    skills: [], experts: [], connectors: [],
  };
}

export default function AgentConfig() {
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AgentItem | null>(null);
  const [activeTab, setActiveTab] = useState<'config' | 'experts' | 'connectors'>('config');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function load() {
    setLoading(true);
    const res = await api.agents.list();
    const list = (res.data as AgentItem[]) || [];
    if (res.success) {
      setAgents(list);
      setSelected(list.length > 0 ? list[0] : null);
    } else if (!res.success) {
      toast.addToast('error', res.error?.message || '加载 Agent 失败');
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleStartStop(a: AgentItem) {
    const res = a.status === 'running'
      ? await api.agents.stop(a.id)
      : await api.agents.start(a.id);
    if (res.success && res.data) {
      const updated = res.data as AgentItem;
      setAgents((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      setSelected(updated);
      toast.addToast('success', a.status === 'running' ? '已停止' : '已启动');
    } else {
      toast.addToast('error', res.error?.message || '操作失败');
    }
  }

  async function handleSave() {
    if (!selected) return;
    if (!selected.name.trim()) { toast.addToast('warning', '请填写名称'); return; }
    setSaving(true);
    const payload = {
      name: selected.name,
      description: selected.description,
      type: selected.type,
      model: selected.model,
      systemPrompt: selected.systemPrompt,
      temperature: selected.temperature,
      maxTokens: selected.maxTokens,
      skills: selected.skills,
      experts: selected.experts,
      connectors: selected.connectors,
    };
    const res = selected.id
      ? await api.agents.update(selected.id, payload)
      : await api.agents.create(payload);
    if (res.success && res.data) {
      const saved = res.data as AgentItem;
      setAgents((prev) => {
        const idx = prev.findIndex((x) => x.id === saved.id);
        if (idx >= 0) return prev.map((x) => (x.id === saved.id ? saved : x));
        return [saved, ...prev];
      });
      setSelected(saved);
      setEditing(false);
      toast.addToast('success', selected.id ? '已保存' : '已创建 Agent');
    } else {
      toast.addToast('error', res.error?.message || '保存失败');
    }
    setSaving(false);
  }

  async function handleDelete(a: AgentItem) {
    if (!confirm(`确定删除 Agent「${a.name}」？此操作不可恢复。`)) return;
    const res = await api.agents.remove(a.id);
    if (res.success) {
      const next = agents.filter((x) => x.id !== a.id);
      setAgents(next);
      setSelected(next[0] || null);
      setEditing(false);
      toast.addToast('success', '已删除');
    } else {
      toast.addToast('error', res.error?.message || '删除失败');
    }
  }

  // 标签增删
  function toggleTag(kind: 'experts' | 'connectors' | 'skills', value: string) {
    if (!selected) return;
    const cur = selected[kind];
    const exists = cur.includes(value);
    const nextList = exists ? cur.filter((v) => v !== value) : [...cur, value];
    setSelected({ ...selected, [kind]: nextList });
  }

  const sel = selected;

  return (
    <div style={{ display: 'flex', height: '100%', gap: 20 }}>
      {/* 左侧：列表 */}
      <div style={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Agent 列表</span>
          <button
            onClick={() => { setSelected(emptyAgent()); setEditing(true); setActiveTab('config'); }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, background: 'var(--bg-sidebar-active)', color: 'var(--text-light)', border: 'none', fontSize: 11, cursor: 'pointer' }}
          >
            {ICONS.plus} 新建
          </button>
        </div>

        {loading ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 12 }}>加载中…</div>
        ) : agents.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 12, border: '1px dashed var(--border-color)', borderRadius: 8 }}>
            暂无 Agent，点击「新建」创建第一个。
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflow: 'auto' }}>
            {agents.map((a) => (
              <div
                key={a.id}
                style={{
                  padding: 12, borderRadius: 10,
                  background: sel?.id === a.id ? 'var(--bg-row-selected)' : 'var(--bg-card)',
                  border: sel?.id === a.id ? '2px solid var(--ecom-amber-500)' : '1px solid var(--border-card)',
                  cursor: 'pointer', transition: 'all var(--transition-fast)',
                }}
                onClick={() => { setSelected(a); setEditing(false); }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{a.name}</span>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: a.status === 'running' ? 'var(--success-500)' : a.status === 'paused' ? 'var(--warning-500)' : 'var(--text-muted)' }} />
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>{a.description || '（无描述）'}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 右侧：配置面板 */}
      <div style={{ flex: 1, background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-card)', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {!sel ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 14 }}>请选择或新建一个 Agent</div>
        ) : (
          <>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-divider)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{editing ? (sel.id ? '编辑 Agent' : '新建 Agent') : sel.name}</h2>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {TYPE_OPTIONS.find((t) => t.value === sel.type)?.label || sel.type} · {sel.status === 'running' ? '运行中' : sel.status === 'paused' ? '已暂停' : '空闲'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {!editing && (
                  <>
                    <button onClick={() => handleStartStop(sel)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 12px', borderRadius: 6, background: sel.status === 'running' ? 'var(--danger-500)' : 'var(--success-500)', color: '#fff', border: 'none', fontSize: 12, cursor: 'pointer' }}>
                      {sel.status === 'running' ? ICONS.stop : ICONS.play}{sel.status === 'running' ? '停止' : '启动'}
                    </button>
                    <button onClick={() => setEditing(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 12px', borderRadius: 6, background: 'var(--bg-button)', color: 'var(--text-light)', border: 'none', fontSize: 12, cursor: 'pointer' }}>
                      {ICONS.settings} 编辑
                    </button>
                    <button onClick={() => handleDelete(sel)} style={{ padding: '5px 12px', borderRadius: 6, background: 'transparent', color: 'var(--danger-600)', border: '1px solid var(--danger-300)', fontSize: 12, cursor: 'pointer' }}>删除</button>
                  </>
                )}
                {editing && (
                  <>
                    <button onClick={handleSave} disabled={saving} style={{ padding: '5px 14px', borderRadius: 6, background: 'var(--primary-600)', color: '#fff', border: 'none', fontSize: 12, cursor: 'pointer' }}>{saving ? '保存中…' : '保存'}</button>
                    <button onClick={() => { setEditing(false); if (!sel.id) setSelected(agents[0] || null); }} style={{ padding: '5px 12px', borderRadius: 6, background: 'transparent', border: '1px solid var(--border-color)', fontSize: 12, cursor: 'pointer' }}>取消</button>
                  </>
                )}
              </div>
            </div>

            {editing && (
              <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12, borderBottom: '1px solid var(--border-divider)' }}>
                <Input label="名称" value={sel.name} onChange={(e) => setSelected({ ...sel, name: e.target.value })} />
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>类型</label>
                  <select value={sel.type} onChange={(e) => setSelected({ ...sel, type: e.target.value })} style={selInput}>
                    {TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>描述</label>
                  <textarea value={sel.description || ''} onChange={(e) => setSelected({ ...sel, description: e.target.value })} rows={2} style={{ ...selInput, resize: 'vertical' }} />
                </div>
              </div>
            )}

            {!editing && (
              <div style={{ display: 'flex', borderBottom: '1px solid var(--border-divider)', padding: '0 20px' }}>
                {(['config', 'experts', 'connectors'] as const).map((tab) => (
                  <button key={tab} onClick={() => setActiveTab(tab)} style={{ padding: '10px 16px', background: 'transparent', border: 'none', borderBottom: activeTab === tab ? '2px solid var(--ecom-amber-500)' : '2px solid transparent', color: activeTab === tab ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: 12, fontWeight: activeTab === tab ? 600 : 400, cursor: 'pointer' }}>
                    {tab === 'config' ? '基本配置' : tab === 'experts' ? '专家绑定' : '连接器绑定'}
                  </button>
                ))}
              </div>
            )}

            <div style={{ padding: 20, flex: 1, overflow: 'auto' }}>
              {editing ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>{ICONS.model} 大模型</label>
                    <select value={sel.model || ''} onChange={(e) => setSelected({ ...sel, model: e.target.value })} style={selInput}>
                      {MODEL_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>System Prompt</label>
                    <textarea value={sel.systemPrompt || ''} onChange={(e) => setSelected({ ...sel, systemPrompt: e.target.value })} placeholder="你是一个专业的电商运营 Agent…" style={{ ...selInput, height: 110, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Temperature</label>
                      <input type="number" step="0.1" min="0" max="2" value={sel.temperature} onChange={(e) => setSelected({ ...sel, temperature: Number(e.target.value) })} style={selInput} />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Max Tokens</label>
                      <input type="number" step="512" value={sel.maxTokens} onChange={(e) => setSelected({ ...sel, maxTokens: Number(e.target.value) })} style={selInput} />
                    </div>
                  </div>
                </div>
              ) : activeTab === 'config' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <Field label="大模型" icon={ICONS.model} value={sel.model || '—'} />
                  <Field label="Temperature" value={String(sel.temperature)} />
                  <Field label="Max Tokens" value={String(sel.maxTokens)} />
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>System Prompt</label>
                    <div style={{ marginTop: 6, padding: '10px 12px', borderRadius: 8, background: 'var(--bg-row-hover)', fontSize: 13, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{sel.systemPrompt || '（未设置）'}</div>
                  </div>
                </div>
              ) : (
                <TagEditor
                  kind={activeTab === 'experts' ? 'experts' : 'connectors'}
                  title={activeTab === 'experts' ? '已绑定专家' : '已绑定连接器'}
                  icon={activeTab === 'experts' ? ICONS.expert : ICONS.link}
                  items={activeTab === 'experts' ? sel.experts : sel.connectors}
                  onToggle={(v) => toggleTag(activeTab === 'experts' ? 'experts' : 'connectors', v)}
                  onEdit={() => setEditing(true)}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const selInput: React.CSSProperties = {
  marginTop: 6, width: '100%', padding: '8px 12px', borderRadius: 8,
  border: '1px solid var(--border-input)', background: 'var(--bg-input)',
  color: 'var(--text-primary)', fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit',
};

function Field({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>{icon}{label}</label>
      <div style={{ marginTop: 6, fontSize: 13, color: 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}

function TagEditor({ kind, title, icon, items, onToggle, onEdit }: {
  kind: 'experts' | 'connectors';
  title: string;
  icon: React.ReactNode;
  items: string[];
  onToggle: (v: string) => void;
  onEdit: () => void;
}) {
  const [draft, setDraft] = useState('');
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>{title}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
        {items.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>（暂无绑定，点击「编辑」添加）</span>}
        {items.map((it) => (
          <span key={it} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 'var(--radius-pill)', background: 'var(--bg-row-selected)', color: 'var(--text-primary)', fontSize: 12 }}>
            {icon} {it}
            <button onClick={() => onToggle(it)} style={{ width: 14, height: 14, borderRadius: '50%', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim()) { onToggle(draft.trim()); setDraft(''); } }}
          placeholder={`输入${kind === 'experts' ? '专家' : '连接器'}名称后回车添加`}
          style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-input)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 13, boxSizing: 'border-box' }}
        />
        <Button variant="secondary" size="sm" onClick={() => { if (draft.trim()) { onToggle(draft.trim()); setDraft(''); } }}>添加</Button>
        <Button variant="ghost" size="sm" onClick={onEdit}>编辑模式</Button>
      </div>
    </div>
  );
}
