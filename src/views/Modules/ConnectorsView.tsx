/**
 * 连接器模块视图 — 管理各平台/系统连接配置与状态
 * 覆盖：淘宝/京东/抖音/Amazon/Shopify/ERP/HR/邮箱 等连接器
 * 新增：邮箱连接器（SMTP/IMAP/API）+ 委托权限管理面板
 */
import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '@store/appStore';
import { api } from '@api/client';
import { connectorsModule } from '@modules/connectors';
import type { ConnectorType, ConnectorStatus } from '@domain/index';

// ────────── 通用连接器定义 ──────────

interface ConnectorDef {
  type: ConnectorType;
  label: string;
  description: string;
  icon: string;
  category: 'platform' | 'system' | 'payment' | 'logistics' | 'custom' | 'email';
}

const CONNECTOR_DEFS: ConnectorDef[] = [
  { type: 'platform-taobao', label: '淘宝', description: '订单同步、商品管理、物流追踪', icon: 'T', category: 'platform' },
  { type: 'platform-tmall', label: '天猫', description: '订单同步、活动报名、数据报表', icon: 'M', category: 'platform' },
  { type: 'platform-jd', label: '京东', description: '订单同步、库存管理、售后处理', icon: 'J', category: 'platform' },
  { type: 'platform-pdd', label: '拼多多', description: '订单同步、商品上架、活动报名', icon: 'P', category: 'platform' },
  { type: 'platform-douyin', label: '抖音电商', description: '直播数据、商品橱窗、达人合作', icon: 'D', category: 'platform' },
  { type: 'platform-kuaishou', label: '快手电商', description: '直播数据、商品管理、订单同步', icon: 'K', category: 'platform' },
  { type: 'platform-xiaohongshu', label: '小红书', description: '笔记管理、商品挂链、KOL 合作', icon: 'R', category: 'platform' },
  { type: 'platform-shopify', label: 'Shopify', description: '独立站订单、商品、客户管理', icon: 'S', category: 'platform' },
  { type: 'platform-amazon', label: 'Amazon', description: 'Listing、FBA、广告、订单管理', icon: 'A', category: 'platform' },
  { type: 'hr-system', label: 'HR 系统', description: '员工信息、考勤、绩效对接', icon: 'H', category: 'system' },
  { type: 'erp', label: 'ERP 系统', description: '采购、库存、财务一体化', icon: 'E', category: 'system' },
  { type: 'crm', label: 'CRM 系统', description: '客户管理、销售漏斗、跟进记录', icon: 'C', category: 'system' },
  { type: 'payment', label: '支付系统', description: '支付流水、对账、退款处理', icon: 'P', category: 'payment' },
  { type: 'logistics', label: '物流系统', description: '快递追踪、发货、运费计算', icon: 'L', category: 'logistics' },
  { type: 'custom-webhook', label: '自定义 Webhook', description: '自定义 API 对接，灵活配置', icon: 'W', category: 'custom' },
  { type: 'platform-email', label: '邮箱连接器', description: 'SMTP/IMAP 邮件收发、同步收件箱', icon: '@', category: 'email' },
];

const CATEGORY_LABELS: Record<string, string> = {
  platform: '电商平台', system: '企业系统', payment: '支付', logistics: '物流', custom: '自定义', email: '邮箱',
};

const CATEGORY_COLORS: Record<string, string> = {
  platform: 'var(--ecom-blue-500)', system: 'var(--module-hr)',
  payment: 'var(--success-500)', logistics: 'var(--warning-500)', custom: 'var(--text-muted)', email: 'var(--module-ogsm)',
};

const STATUS_LABELS: Record<ConnectorStatus, string> = {
  connected: '已连接', disconnected: '未连接', syncing: '同步中', error: '异常',
};

const STATUS_COLORS: Record<ConnectorStatus, string> = {
  connected: 'var(--success-500)', disconnected: 'var(--text-muted)', syncing: 'var(--warning-500)', error: 'var(--danger-500)',
};

// ────────── 邮箱连接器状态 ──────────

interface EmailConnector {
  id: string;
  name: string;
  provider: 'smtp' | 'imap' | 'api';
  status: 'connected' | 'disconnected' | 'error' | 'pending';
  email_address: string | null;
}

// ────────── 委托权限状态 ──────────

interface DelegatedPermission {
  id: string;
  scope: string;
  permission_point: string;
  delegator_id: string;
  delegator_name: string;
  delegatee_id: string;
  expires_at: string | null;
  created_at: string;
}

const SCOPE_LABELS: Record<string, string> = {
  orders: '订单', products: '商品', inventory: '库存', ogsm: 'OGSM', hr: '人力', all: '全部',
};

export default function ConnectorsView() {
  const { connectors, addConnector, removeConnector } = useAppStore();
  const [filterCat, setFilterCat] = useState('all');
  const [showAdd, setShowAdd] = useState(false);

  // 邮箱连接器状态
  const [emailConnectors, setEmailConnectors] = useState<EmailConnector[]>([]);
  const [emailLoading, setEmailLoading] = useState(false);
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [showEmailConfig, setShowEmailConfig] = useState(false);
  const [emailForm, setEmailForm] = useState({ name: '', provider: 'smtp' as 'smtp' | 'imap' | 'api', host: '', port: '465', username: '', password: '', ssl: 'true', tls: 'false', emailAddress: '' });
  const [emailMessages, setEmailMessages] = useState<any[]>([]);
  const [showSendForm, setShowSendForm] = useState(false);
  const [sendForm, setSendForm] = useState({ to: '', subject: '', body: '' });
  const [emailLogs, setEmailLogs] = useState<any[]>([]);
  const [showEmailLogs, setShowEmailLogs] = useState(false);

  // 委托权限状态
  const [showDelegatePanel, setShowDelegatePanel] = useState(false);
  const [delegatedPerms, setDelegatedPerms] = useState<DelegatedPermission[]>([]);
  const [delegateTab, setDelegateTab] = useState<'granted' | 'given'>('granted');
  const [delegateForm, setDelegateForm] = useState({ delegateeId: '', scope: 'all', permissionPoint: 'read', expiresAt: '' });

  // ────────── 加载邮箱连接器 ──────────
  const loadEmailConnectors = useCallback(async () => {
    try {
      setEmailLoading(true);
      const res = await api.emailConnectors.list();
      if (res.success && res.data) {
        setEmailConnectors(res.data as EmailConnector[]);
      }
    } catch (e: any) {
      // 邮箱连接器加载失败，保持空状态
      console.warn('[ConnectorsView] 邮箱连接器加载失败:', e?.message);
    } finally {
      setEmailLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEmailConnectors();
  }, []);

  // ────────── 加载委托权限 ──────────
  const loadDelegatedPermissions = useCallback(async (type: 'granted' | 'given') => {
    try {
      const res = await api.delegatedPermissions.list(type);
      if (res.success && res.data) {
        setDelegatedPerms(res.data as DelegatedPermission[]);
      }
    } catch (e: any) {
      // 委托权限加载失败
      console.warn('[ConnectorsView] 委托权限加载失败:', e?.message);
    }
  }, []);

  useEffect(() => {
    if (showDelegatePanel) {
      loadDelegatedPermissions(delegateTab);
    }
  }, [showDelegatePanel, delegateTab, loadDelegatedPermissions]);

  // ────────── 视图挂载时同步连接器注册表 ──────────
  useEffect(() => {
    connectorsModule.getRegistry().then((registry) => {
      const existingTypes = connectors.map((c) => c.type);
      for (const r of registry) {
        const type = r.platform as any as ConnectorType;
        if (['taobao', 'tmall', 'jd', 'pdd', 'douyin', 'kuaishou', 'xiaohongshu', 'shopee', 'lazada', 'amazon', 'dingtalk', 'wecom', 'feishu', 'cainiao', 'yunda', 'zto', 'email-smtp', 'email-imap', 'email-api'].includes(r.platform)) {
          const mappedType = `platform-${r.platform}` as ConnectorType;
          if (!existingTypes.includes(mappedType)) {
            addConnector({
              id: `conn-${r.platform}-${Date.now()}`,
              name: r.name,
              type: mappedType,
              status: 'disconnected',
              config: {},
            });
          }
        }
      }
    });
  }, []);

  // ────────── 通用连接器操作 ──────────
  const filtered = filterCat === 'all' ? CONNECTOR_DEFS : CONNECTOR_DEFS.filter((d) => d.category === filterCat);

  const getConnectorStatus = (type: ConnectorType): ConnectorStatus | undefined => {
    return connectors.find((c) => c.type === type)?.status;
  };

  const handleToggle = (type: ConnectorType, def: ConnectorDef) => {
    const existing = connectors.find((c) => c.type === type);
    if (existing) {
      removeConnector(existing.id);
    } else {
      addConnector({
        id: `conn-${type}-${Date.now()}`,
        name: def.label,
        type,
        status: 'disconnected',
        config: {},
      });
    }
  };

  // ────────── 邮箱连接器操作 ──────────
  const handleCreateEmail = async () => {
    try {
      const res = await api.emailConnectors.create({
        name: emailForm.name,
        provider: emailForm.provider,
        config: {
          host: emailForm.host,
          port: Number(emailForm.port),
          username: emailForm.username,
          password: emailForm.password,
          ssl: emailForm.ssl === 'true',
          tls: emailForm.tls === 'true',
        },
        emailAddress: emailForm.emailAddress || undefined,
      });
      if (res.success && res.data) {
        setEmailConnectors((prev) => [...prev, res.data as EmailConnector]);
        setShowEmailConfig(false);
        setEmailForm({ name: '', provider: 'smtp', host: '', port: '465', username: '', password: '', ssl: 'true', tls: 'false', emailAddress: '' });
      }
    } catch (e: any) {
      // 添加连接器失败
      console.warn('[ConnectorsView] 添加邮箱连接器失败:', e?.message);
    }
  };

  const handleTestConnect = async (id: string) => {
    try {
      const res = await api.emailConnectors.connect(id);
      if (res.success && res.data) {
        setEmailConnectors((prev) => prev.map((c) => c.id === id ? ({ ...c, status: (res.data as any).status } satisfies EmailConnector) : c));
      }
    } catch (e: any) {
      // 添加连接器失败
      console.warn('[ConnectorsView] 添加邮箱连接器失败:', e?.message);
    }
  };

  const handleSyncInbox = async (id: string) => {
    try {
      const res = await api.emailConnectors.sync(id);
      if (res.success && res.data) {
        setEmailMessages(res.data as any[]);
      }
    } catch (e: any) {
      // 添加连接器失败
      console.warn('[ConnectorsView] 添加邮箱连接器失败:', e?.message);
    }
  };

  const handleSendEmail = async () => {
    if (!selectedEmailId) return;
    try {
      const res = await api.emailConnectors.send(selectedEmailId, sendForm);
      if (res.success) {
        setShowSendForm(false);
        setSendForm({ to: '', subject: '', body: '' });
      }
    } catch (e: any) {
      // 添加连接器失败
      console.warn('[ConnectorsView] 添加邮箱连接器失败:', e?.message);
    }
  };

  const handleViewLogs = async (id: string) => {
    try {
      const res = await api.emailConnectors.logs(id);
      if (res.success && res.data) {
        setEmailLogs(res.data as any[]);
        setShowEmailLogs(true);
      }
    } catch (e: any) {
      // 添加连接器失败
      console.warn('[ConnectorsView] 添加邮箱连接器失败:', e?.message);
    }
  };

  // ────────── 委托权限操作 ──────────
  const handleCreateDelegation = async () => {
    try {
      const res = await api.delegatedPermissions.create(delegateForm);
      if (res.success) {
        loadDelegatedPermissions(delegateTab);
        setDelegateForm({ delegateeId: '', scope: 'all', permissionPoint: 'read', expiresAt: '' });
      }
    } catch (e: any) {
      // 添加连接器失败
      console.warn('[ConnectorsView] 添加邮箱连接器失败:', e?.message);
    }
  };

  const handleRevokeDelegation = async (id: string) => {
    try {
      await api.delegatedPermissions.revoke(id);
      loadDelegatedPermissions(delegateTab);
    } catch (e: any) {
      // 添加连接器失败
      console.warn('[ConnectorsView] 添加邮箱连接器失败:', e?.message);
    }
  };

  return (
    <div className="hrms-container">
      <div className="hrms-header">
        <h2 className="page-title">连接器</h2>
        <div className="hrms-header-actions">
          <span className="text-secondary" style={{ fontSize: 12 }}>
            {connectors.filter((c) => c.status === 'connected').length}/{connectors.length} 已连接
          </span>
          <button className="btn-ghost" style={{ marginRight: 6, fontSize: 12, padding: '6px 12px' }} onClick={() => setShowDelegatePanel(!showDelegatePanel)}>
            {showDelegatePanel ? '关闭委托' : '委托权限'}
          </button>
          <button className="btn-ecom" onClick={() => setShowAdd(!showAdd)}>
            {showAdd ? '完成' : '+ 添加连接器'}
          </button>
        </div>
      </div>

      {/* 分类筛选 */}
      <div className="kanban-header" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <button className={`tab ${filterCat === 'all' ? 'tab-active' : ''}`} onClick={() => setFilterCat('all')}>全部</button>
        {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
          <button
            key={key}
            className={`tab ${filterCat === key ? 'tab-active' : ''}`}
            onClick={() => setFilterCat(key)}
            style={{ borderLeft: `3px solid ${CATEGORY_COLORS[key]}` }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 连接器网格 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
        {filtered.map((def) => {
          const status = getConnectorStatus(def.type);
          const isConnected = status === 'connected';

          return (
            <div key={def.type} className="card" style={{
              padding: 16,
              opacity: status ? 1 : showAdd ? 1 : 0.6,
              border: isConnected ? '1px solid var(--success-500)' : '1px solid var(--border-color)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 8,
                  background: CATEGORY_COLORS[def.category],
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontWeight: 700, fontSize: 14,
                }}>
                  {def.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{def.label}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{CATEGORY_LABELS[def.category]}</div>
                </div>
                {status && (
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLORS[status], flexShrink: 0 }} />
                )}
              </div>

              <p style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 10 }}>{def.description}</p>

              {status && (
                <div style={{ fontSize: 11, color: STATUS_COLORS[status], marginBottom: 8 }}>
                  {STATUS_LABELS[status]}
                  {status === 'syncing' && ' ...'}
                </div>
              )}

              <div style={{ display: 'flex', gap: 6 }}>
                {status ? (
                  <>
                    <button
                      className="btn-ghost"
                      style={{ fontSize: 11, padding: '4px 10px', flex: 1 }}
                      onClick={() => handleToggle(def.type, def)}
                    >
                      断开
                    </button>
                    {isConnected && (
                      <button className="btn-ecom" style={{ fontSize: 11, padding: '4px 10px', flex: 1 }}>配置</button>
                    )}
                  </>
                ) : (
                  <button
                    className="btn-ecom"
                    style={{ fontSize: 11, padding: '4px 10px', width: '100%' }}
                    onClick={() => handleToggle(def.type, def)}
                  >
                    + 连接
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ─── 邮箱连接器面板 ─── */}
      <div className="card" style={{ marginTop: 16, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 className="section-title" style={{ margin: 0 }}>邮箱连接器</h3>
          <button className="btn-ecom" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => setShowEmailConfig(!showEmailConfig)}>
            + 新建
          </button>
        </div>

        {/* 新建表单 */}
        {showEmailConfig && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
            <input className="input-field" style={{ width: 120, fontSize: 12 }} placeholder="名称" value={emailForm.name} onChange={(e) => setEmailForm({ ...emailForm, name: e.target.value })} />
            <select className="select-field" style={{ width: 80, fontSize: 12 }} value={emailForm.provider} onChange={(e) => setEmailForm({ ...emailForm, provider: e.target.value as 'smtp' | 'imap' | 'api' })}>
              <option value="smtp">SMTP</option>
              <option value="imap">IMAP</option>
              <option value="api">API</option>
            </select>
            <input className="input-field" style={{ width: 140, fontSize: 12 }} placeholder="Host" value={emailForm.host} onChange={(e) => setEmailForm({ ...emailForm, host: e.target.value })} />
            <input className="input-field" style={{ width: 60, fontSize: 12 }} placeholder="Port" value={emailForm.port} onChange={(e) => setEmailForm({ ...emailForm, port: e.target.value })} />
            <input className="input-field" style={{ width: 120, fontSize: 12 }} placeholder="用户名" value={emailForm.username} onChange={(e) => setEmailForm({ ...emailForm, username: e.target.value })} />
            <input className="input-field" style={{ width: 100, fontSize: 12 }} type="password" placeholder="密码" value={emailForm.password} onChange={(e) => setEmailForm({ ...emailForm, password: e.target.value })} />
            <input className="input-field" style={{ width: 140, fontSize: 12 }} placeholder="邮箱地址" value={emailForm.emailAddress} onChange={(e) => setEmailForm({ ...emailForm, emailAddress: e.target.value })} />
            <button className="btn-ecom" style={{ fontSize: 12 }} onClick={handleCreateEmail}>创建</button>
            <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => setShowEmailConfig(false)}>取消</button>
          </div>
        )}

        {/* 邮箱连接器列表 */}
        {emailLoading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>加载中...</div>
        ) : emailConnectors.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, padding: 12 }}>暂无邮箱连接器，点击上方"新建"添加</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
            {emailConnectors.map((conn) => (
              <div key={conn.id} className="card" style={{
                padding: 10,
                border: conn.status === 'connected' ? '1px solid var(--success-500)' : '1px solid var(--border-color)',
                cursor: 'pointer',
                background: selectedEmailId === conn.id ? 'var(--bg-tertiary)' : 'transparent',
              }} onClick={() => setSelectedEmailId(conn.id)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLORS[conn.status as ConnectorStatus] }} />
                  <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-primary)' }}>{conn.name}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{conn.provider}</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>{conn.email_address || '未设置邮箱地址'}</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn-ghost" style={{ fontSize: 10, padding: '2px 6px', flex: 1 }} onClick={(e) => { e.stopPropagation(); handleTestConnect(conn.id); }}>测试连接</button>
                  <button className="btn-ecom" style={{ fontSize: 10, padding: '2px 6px', flex: 1 }} onClick={(e) => { e.stopPropagation(); handleSyncInbox(conn.id); }}>同步收件箱</button>
                  <button className="btn-ghost" style={{ fontSize: 10, padding: '2px 6px' }} onClick={(e) => { e.stopPropagation(); setShowSendForm(true); }}>发邮件</button>
                  <button className="btn-ghost" style={{ fontSize: 10, padding: '2px 6px' }} onClick={(e) => { e.stopPropagation(); handleViewLogs(conn.id); }}>日志</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 同步结果展示 */}
        {emailMessages.length > 0 && (
          <div style={{ marginTop: 12, padding: 10, background: 'var(--bg-secondary)', borderRadius: 8 }}>
            <h4 style={{ fontSize: 12, marginBottom: 6, color: 'var(--text-primary)' }}>同步到的邮件（{emailMessages.length} 封）</h4>
            <div style={{ display: 'grid', gap: 4 }}>
              {emailMessages.map((msg: any) => (
                <div key={msg.id} style={{ display: 'flex', gap: 8, fontSize: 11, padding: 6, borderLeft: '3px solid var(--ecom-blue-500)', background: 'var(--bg-primary)' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{msg.subject}</div>
                    <div style={{ color: 'var(--text-muted)' }}>{msg.from} → {msg.to}</div>
                    <div style={{ color: 'var(--text-secondary)' }}>{msg.body.slice(0, 80)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 发送邮件表单 */}
        {showSendForm && selectedEmailId && (
          <div style={{ marginTop: 12, padding: 10, background: 'var(--bg-secondary)', borderRadius: 8 }}>
            <h4 style={{ fontSize: 12, marginBottom: 6, color: 'var(--text-primary)' }}>发送新邮件</h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <input className="input-field" style={{ flex: 1, fontSize: 12 }} placeholder="收件人" value={sendForm.to} onChange={(e) => setSendForm({ ...sendForm, to: e.target.value })} />
              <input className="input-field" style={{ flex: 1, fontSize: 12 }} placeholder="主题" value={sendForm.subject} onChange={(e) => setSendForm({ ...sendForm, subject: e.target.value })} />
              <textarea className="textarea-field" style={{ flexBasis: '100%', fontSize: 12, height: 60 }} placeholder="正文" value={sendForm.body} onChange={(e) => setSendForm({ ...sendForm, body: e.target.value })} />
              <button className="btn-ecom" style={{ fontSize: 12 }} onClick={handleSendEmail}>发送</button>
              <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => setShowSendForm(false)}>取消</button>
            </div>
          </div>
        )}

        {/* 日志面板 */}
        {showEmailLogs && (
          <div style={{ marginTop: 12, padding: 10, background: 'var(--bg-secondary)', borderRadius: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <h4 style={{ fontSize: 12, margin: 0, color: 'var(--text-primary)' }}>同步日志（{emailLogs.length} 条）</h4>
              <button className="btn-ghost" style={{ fontSize: 11 }} onClick={() => setShowEmailLogs(false)}>关闭</button>
            </div>
            <div style={{ fontSize: 11, maxHeight: 120, overflow: 'auto' }}>
              {emailLogs.map((log: any) => (
                <div key={log.id} style={{ display: 'flex', gap: 8, padding: '2px 0', borderBottom: '1px solid var(--border-color)' }}>
                  <span style={{ color: log.status === 'success' ? 'var(--success-500)' : 'var(--danger-500)' }}>{log.status}</span>
                  <span style={{ color: 'var(--text-primary)' }}>{log.action}</span>
                  <span style={{ color: 'var(--text-muted)' }}>{log.details || '-'}</span>
                  <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>{log.created_at}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ─── 委托权限管理面板 ─── */}
      {showDelegatePanel && (
        <div className="card" style={{ marginTop: 16, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 className="section-title" style={{ margin: 0 }}>委托权限管理</h3>
          </div>

          {/* 委托权限标签页 */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <button className={`tab ${delegateTab === 'granted' ? 'tab-active' : ''}`} onClick={() => setDelegateTab('granted')}>被授予的权限（{delegatedPerms.filter((p) => p.delegatee_id === (api as any)._userId || true).length}）</button>
            <button className={`tab ${delegateTab === 'given' ? 'tab-active' : ''}`} onClick={() => setDelegateTab('given')}>我授予的权限</button>
          </div>

          {/* 创建委托表单 */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
            <input className="input-field" style={{ width: 140, fontSize: 12 }} placeholder="被委托用户 ID" value={delegateForm.delegateeId} onChange={(e) => setDelegateForm({ ...delegateForm, delegateeId: e.target.value })} />
            <select className="select-field" style={{ width: 90, fontSize: 12 }} value={delegateForm.scope} onChange={(e) => setDelegateForm({ ...delegateForm, scope: e.target.value })}>
              {Object.entries(SCOPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input className="input-field" style={{ width: 120, fontSize: 12 }} placeholder="权限点 (如 orders:read)" value={delegateForm.permissionPoint} onChange={(e) => setDelegateForm({ ...delegateForm, permissionPoint: e.target.value })} />
            <input className="input-field" style={{ width: 160, fontSize: 12 }} placeholder="过期时间 (YYYY-MM-DD)" value={delegateForm.expiresAt} onChange={(e) => setDelegateForm({ ...delegateForm, expiresAt: e.target.value })} />
            <button className="btn-ecom" style={{ fontSize: 12 }} onClick={handleCreateDelegation}>授权</button>
          </div>

          {/* 委托权限列表 */}
          {delegatedPerms.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, padding: 12 }}>暂无委托权限记录</div>
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              {delegatedPerms.map((perm) => (
                <div key={perm.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8, background: 'var(--bg-secondary)', borderRadius: 6, fontSize: 11 }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{perm.delegator_name || perm.delegator_id}</span>
                  <span style={{ color: 'var(--text-muted)' }}>授予 →</span>
                  <span style={{ fontWeight: 600, color: 'var(--ecom-blue-500)' }}>{perm.delegatee_id}</span>
                  <span style={{ padding: '1px 6px', background: 'var(--bg-tertiary)', borderRadius: 4, color: 'var(--text-secondary)' }}>{SCOPE_LABELS[perm.scope] || perm.scope}</span>
                  <span style={{ fontFamily: 'monospace', color: 'var(--text-primary)' }}>{perm.permission_point}</span>
                  {perm.expires_at && <span style={{ color: 'var(--warning-500)' }}>到期 {perm.expires_at.slice(0, 10)}</span>}
                  <button className="btn-ghost" style={{ fontSize: 10, padding: '2px 6px', marginLeft: 'auto' }} onClick={() => handleRevokeDelegation(perm.id)}>撤销</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 已连接概览 */}
      {connectors.length > 0 && (
        <div className="card" style={{ marginTop: 16, padding: 16 }}>
          <h3 className="section-title" style={{ marginBottom: 12 }}>连接状态概览</h3>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {(['connected', 'syncing', 'error', 'disconnected'] as ConnectorStatus[]).map((s) => {
              const count = connectors.filter((c) => c.status === s).length;
              return (
                <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLORS[s] }} />
                  <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>{STATUS_LABELS[s]}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
