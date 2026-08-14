/**
 * 大模型平台视图（P1 落地）
 * 原版：配置仅存内存（appStore 无 persist）、apiKey 缺省 'sk-demo'、用量用 Math.random()、无后端路由。
 * 本版接入真实后端 /api/llm：连接即落库（AES-256-GCM 加密 key）、列表/删除真实生效。
 * 用量统计属规划中能力，不再伪造随机数，如实标注。
 */
import { useState, useEffect } from 'react';
import { Button } from '@components/Common/Button';
import { Input } from '@components/Common/Input';
import { useToast } from '@components/Common/Toast';
import { api } from '@api/client';

interface ModelProvider {
  id: string;
  name: string;
  baseUrl: string;
  models: { id: string; name: string; context: number; cost: string }[];
  isBuiltin: boolean;
}

const PROVIDERS: ModelProvider[] = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: [
    { id: 'gpt-4o', name: 'GPT-4o', context: 128000, cost: '¥0.15/1K' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', context: 128000, cost: '¥0.03/1K' },
  ], isBuiltin: true },
  { id: 'anthropic', name: 'Anthropic Claude', baseUrl: 'https://api.anthropic.com/v1', models: [
    { id: 'claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', context: 200000, cost: '¥0.20/1K' },
  ], isBuiltin: true },
  { id: 'tongyi', name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: [
    { id: 'qwen-max', name: 'Qwen-Max', context: 32000, cost: '¥0.08/1K' },
  ], isBuiltin: true },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', models: [
    { id: 'deepseek-v3', name: 'DeepSeek-V3', context: 64000, cost: '¥0.04/1K' },
  ], isBuiltin: true },
  { id: 'local', name: '本地模型 (Ollama)', baseUrl: 'http://localhost:11434/v1', models: [
    { id: 'llama3', name: 'Llama 3', context: 8192, cost: '本地免费' },
  ], isBuiltin: false },
];

interface LLMRecord {
  id: string;
  name: string;
  provider: string;
  baseUrl: string | null;
  apiKeyMasked: string | null;
  models: string[];
  isActive: boolean;
}

function ModelCard({ provider, active, onConnect, onDisconnect, connecting }: {
  provider: ModelProvider;
  active: LLMRecord | undefined;
  onConnect: (p: ModelProvider, apiKey: string) => void;
  onDisconnect: (id: string) => void;
  connecting: boolean;
}) {
  const [showConfig, setShowConfig] = useState(false);
  const [apiKey, setApiKey] = useState('');

  return (
    <div className="card" style={{ padding: 16, border: active ? '1px solid var(--accent-500)' : '1px solid var(--border-color)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: provider.isBuiltin ? 'var(--accent-500)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 14 }}>
          {provider.name[0]}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{provider.name}</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{provider.isBuiltin ? '内置' : '自定义'} · {provider.models.length} 个模型</div>
        </div>
        {active && <span className="badge badge-success" style={{ fontSize: 10 }}>已连接</span>}
      </div>

      <div style={{ marginBottom: 10 }}>
        {provider.models.map((model) => (
          <div key={model.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '3px 0', color: 'var(--text-secondary)' }}>
            <span>{model.name}</span>
            <span style={{ color: 'var(--text-muted)' }}>{model.context.toLocaleString()} ctx · {model.cost}</span>
          </div>
        ))}
      </div>

      {active ? (
        <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 10px', width: '100%' }} onClick={() => onDisconnect(active.id)}>
          断开连接
        </button>
      ) : showConfig ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Input placeholder="API Key（留空可稍后填）" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} style={{ fontSize: 11 } as any} />
          <div style={{ display: 'flex', gap: 6 }}>
            <Button variant="primary" size="sm" loading={connecting} onClick={() => onConnect(provider, apiKey)} style={{ flex: 1 }}>连接</Button>
            <Button variant="ghost" size="sm" onClick={() => setShowConfig(false)}>取消</Button>
          </div>
        </div>
      ) : (
        <Button variant="primary" size="sm" onClick={() => setShowConfig(true)} style={{ width: '100%' }}>+ 连接</Button>
      )}
    </div>
  );
}

export default function LLMPlatformView() {
  const [platforms, setPlatforms] = useState<LLMRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [activeTab, setActiveTab] = useState<'providers' | 'usage' | 'config'>('providers');
  const toast = useToast();

  async function load() {
    setLoading(true);
    const res = await api.llm.list();
    if (res.success && res.data) setPlatforms(res.data as LLMRecord[]);
    else if (!res.success) toast.addToast('error', res.error?.message || '加载失败');
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleConnect(p: ModelProvider, apiKey: string) {
    setConnecting(true);
    const res = await api.llm.create({
      name: p.name,
      provider: p.id,
      baseUrl: p.baseUrl,
      apiKey: apiKey || undefined,
      models: p.models.map((m) => m.id),
      isActive: true,
    });
    setConnecting(false);
    if (res.success && res.data) {
      setPlatforms((prev) => [res.data as LLMRecord, ...prev]);
      toast.addToast('success', `已连接 ${p.name}`);
    } else {
      toast.addToast('error', res.error?.message || '连接失败');
    }
  }

  async function handleDisconnect(id: string) {
    const res = await api.llm.remove(id);
    if (res.success) {
      setPlatforms((prev) => prev.filter((l) => l.id !== id));
      toast.addToast('success', '已断开');
    } else {
      toast.addToast('error', res.error?.message || '断开失败');
    }
  }

  const totalModels = platforms.reduce((s, l) => s + (l.models?.length || 0), 0);

  return (
    <div className="hrms-container">
      <div className="hrms-header">
        <h2 className="page-title">大模型平台</h2>
        <span className="text-secondary" style={{ fontSize: 12 }}>
          {platforms.length} 个平台已连接 · {totalModels} 个模型可用
        </span>
      </div>

      <div className="kanban-header" style={{ marginBottom: 16 }}>
        <button className={`tab ${activeTab === 'providers' ? 'tab-active' : ''}`} onClick={() => setActiveTab('providers')}>模型提供商</button>
        <button className={`tab ${activeTab === 'usage' ? 'tab-active' : ''}`} onClick={() => setActiveTab('usage')}>用量统计</button>
        <button className={`tab ${activeTab === 'config' ? 'tab-active' : ''}`} onClick={() => setActiveTab('config')}>全局配置</button>
      </div>

      {activeTab === 'providers' && (
        loading ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 12 }}>加载中…</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
            {PROVIDERS.map((p) => (
              <ModelCard
                key={p.id}
                provider={p}
                active={platforms.find((l) => l.provider === p.id)}
                onConnect={handleConnect}
                onDisconnect={handleDisconnect}
                connecting={connecting}
              />
            ))}
          </div>
        )
      )}

      {activeTab === 'usage' && (
        <div className="card" style={{ padding: 16 }}>
          <h3 className="section-title" style={{ marginBottom: 12 }}>用量统计</h3>
          {platforms.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>暂无数据，请先连接模型提供商</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {platforms.map((l) => (
                <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: 'var(--text-primary)' }}>{l.name}</span>
                  <span style={{ color: 'var(--text-muted)' }}>{l.models?.length || 0} 个模型{l.apiKeyMasked ? ' · 密钥已配置' : ' · 未配置密钥'}</span>
                </div>
              ))}
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, borderTop: '1px dashed var(--border-color)', paddingTop: 10 }}>
                调用量/费用明细统计为规划中能力，暂未接入计量埋点，故不实造数据。
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'config' && (
        <div className="card" style={{ padding: 16 }}>
          <h3 className="section-title" style={{ marginBottom: 16 }}>全局模型配置</h3>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            默认模型、温度、最大 Token、重试与超时等全局参数目前由各 Agent 自身配置承载（见 Agent 配置页）。
            全局默认值设置与持久化为规划中能力。
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12, opacity: 0.6, pointerEvents: 'none' }}>
            <div><label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>默认模型</label><select className="input" style={{ width: '100%' }}><option>GPT-4o (推荐)</option><option>Claude 3.5 Sonnet</option><option>DeepSeek-V3</option><option>Qwen-Max</option></select></div>
            <div><label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>默认温度</label><input className="input" type="number" defaultValue="0.3" step="0.1" min="0" max="2" style={{ width: 120 }} /></div>
            <div><label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>最大 Token 数</label><input className="input" type="number" defaultValue="4096" step="1024" style={{ width: 120 }} /></div>
          </div>
        </div>
      )}
    </div>
  );
}
