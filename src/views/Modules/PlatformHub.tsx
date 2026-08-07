/**
 * 平台对接中心（Platform Hub）
 *
 * 四块内容：
 *   1. 沙箱横幅 —— 只要存在沙箱连接就常驻黄色警示：沙箱数据非真实平台数据
 *   2. 平台卡片墙 —— 内联 SVG 图标 + 状态徽标 + 能力标签 + 真实签名算法说明
 *   3. 配置抽屉 —— 按 catalog.credentialFields 动态渲染凭据表单、测试连接、沙箱开关
 *   4. 同步中心 —— 手动触发同步、任务列表与进度、展开查看日志；顶部统计区
 *
 * 诚实性原则（本模块最重要的产品约束）：
 *   没有真实凭据时进入沙箱模式，界面必须明确写出「演练数据」，
 *   绝不用假数据冒充真实平台对接结果。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import {
  platformApi,
  type PlatformCatalogEntry,
  type PlatformConnection,
  type PlatformStats,
  type SyncJob,
  type SyncLog,
  type PlatformCode,
  type ResourceType,
} from '@api/platform';

// ────────────────── 平台图标（内联 SVG，避免外链依赖） ──────────────────

const PLATFORM_COLORS: Record<string, string> = {
  douyin: '#161823',
  taobao: '#FF5000',
  jd: '#E1251B',
  pdd: '#E22E1F',
  kuaishou: '#FF3B5C',
  amazon: '#FF9900',
  shopify: '#5E8E3E',
  shopee: '#EE4D2D',
  tiktok: '#000000',
};

function PlatformLogo({ platform, size = 40 }: { platform: string; size?: number }) {
  const color = PLATFORM_COLORS[platform] || 'var(--text-muted)';
  const glyph: Record<string, ReactElement> = {
    douyin: (
      <path
        d="M20 8c1.3 2.6 3.3 4 6 4.2v3.9c-1.9.1-3.7-.4-5.3-1.4v6.6c0 3.9-2.9 6.7-6.7 6.7-3.7 0-6.7-2.9-6.7-6.6 0-3.8 3-6.7 6.8-6.7.4 0 .8 0 1.2.1v4c-.4-.1-.8-.2-1.2-.2-1.6 0-2.9 1.3-2.9 2.8 0 1.6 1.3 2.9 2.9 2.9 1.6 0 2.9-1.2 2.9-2.8V8h3z"
        fill="#fff"
      />
    ),
    taobao: <text x="20" y="26" textAnchor="middle" fontSize="16" fontWeight="700" fill="#fff">淘</text>,
    jd: <text x="20" y="26" textAnchor="middle" fontSize="16" fontWeight="700" fill="#fff">京</text>,
    pdd: <text x="20" y="26" textAnchor="middle" fontSize="16" fontWeight="700" fill="#fff">拼</text>,
    kuaishou: <text x="20" y="26" textAnchor="middle" fontSize="16" fontWeight="700" fill="#fff">快</text>,
    amazon: (
      <g fill="#fff">
        <path d="M10 24c4 3 12 3.5 19 0" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" />
        <text x="20" y="20" textAnchor="middle" fontSize="13" fontWeight="700">a</text>
      </g>
    ),
    shopify: <text x="20" y="26" textAnchor="middle" fontSize="16" fontWeight="700" fill="#fff">S</text>,
    shopee: <text x="20" y="26" textAnchor="middle" fontSize="16" fontWeight="700" fill="#fff">虾</text>,
    tiktok: <text x="20" y="26" textAnchor="middle" fontSize="14" fontWeight="700" fill="#fff">TT</text>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label={platform}>
      <rect width="40" height="40" rx="10" fill={color} />
      {glyph[platform] || <text x="20" y="26" textAnchor="middle" fontSize="16" fontWeight="700" fill="#fff">?</text>}
    </svg>
  );
}

// ────────────────── 状态映射 ──────────────────

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  connected: { label: '已连接', color: 'var(--success-500)', bg: 'rgba(34,197,94,0.12)' },
  sandbox: { label: '沙箱演练', color: 'var(--warning-500)', bg: 'rgba(245,158,11,0.14)' },
  disconnected: { label: '未连接', color: 'var(--text-muted)', bg: 'rgba(148,163,184,0.14)' },
  expired: { label: '令牌过期', color: 'var(--danger-500)', bg: 'rgba(239,68,68,0.12)' },
  error: { label: '异常', color: 'var(--danger-500)', bg: 'rgba(239,68,68,0.12)' },
};

const JOB_STATUS_META: Record<string, { label: string; color: string }> = {
  pending: { label: '待执行', color: 'var(--text-muted)' },
  running: { label: '执行中', color: 'var(--warning-500)' },
  success: { label: '成功', color: 'var(--success-500)' },
  partial: { label: '部分成功', color: 'var(--warning-500)' },
  failed: { label: '失败', color: 'var(--danger-500)' },
};

const RESOURCE_LABELS: Record<string, string> = {
  orders: '订单', products: '商品', inventory: '库存',
  finance: '财务', reviews: '评价', logistics: '物流',
};

const LOG_LEVEL_COLORS: Record<string, string> = {
  info: 'var(--text-muted)', warn: 'var(--warning-500)', error: 'var(--danger-500)',
};

// ────────────────── 表单状态 ──────────────────

interface DrawerState {
  platform: PlatformCatalogEntry;
  connection: PlatformConnection | null;
  values: Record<string, string>;
  sandbox: boolean;
}

function fmtTime(v: string | null): string {
  if (!v) return '—';
  const d = new Date(v.includes('T') ? v : v.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString('zh-CN', { hour12: false });
}

function fmtMoney(v: number): string {
  return `¥${(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ────────────────── 主组件 ──────────────────

export default function PlatformHub() {
  const [catalog, setCatalog] = useState<PlatformCatalogEntry[]>([]);
  const [connections, setConnections] = useState<PlatformConnection[]>([]);
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ level: 'info' | 'error'; text: string } | null>(null);

  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [jobLogs, setJobLogs] = useState<Record<string, SyncLog[]>>({});
  const [syncResource, setSyncResource] = useState<ResourceType>('orders');

  // ────────── 数据加载 ──────────

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [cat, conns, jobPage, st] = await Promise.all([
        platformApi.getCatalog(),
        platformApi.listConnections(),
        platformApi.listJobs({ limit: 15 }),
        platformApi.getStats(),
      ]);
      setCatalog(cat);
      setConnections(conns);
      setJobs(jobPage.data);
      setStats(st);
      setBanner(null);
    } catch (e) {
      setBanner({ level: 'error', text: `加载平台对接数据失败：${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const refreshLight = useCallback(async () => {
    try {
      const [conns, jobPage, st] = await Promise.all([
        platformApi.listConnections(),
        platformApi.listJobs({ limit: 15 }),
        platformApi.getStats(),
      ]);
      setConnections(conns);
      setJobs(jobPage.data);
      setStats(st);
    } catch (e) {
      console.warn('[PlatformHub] 刷新数据失败:', e);
      // 静默：不打断当前操作反馈
    }
  }, []);

  const connByPlatform = useMemo(() => {
    const m = new Map<string, PlatformConnection>();
    for (const c of connections) if (!m.has(c.platform)) m.set(c.platform, c);
    return m;
  }, [connections]);

  const hasSandbox = connections.some((c) => c.sandbox);

  // ────────── 抽屉操作 ──────────

  const openDrawer = (entry: PlatformCatalogEntry) => {
    if (!entry.supported) {
      setBanner({ level: 'info', text: `${entry.displayName} 适配器尚未实现，我们不会用假接口冒充已接入。` });
      return;
    }
    const conn = connByPlatform.get(entry.platform) || null;
    const values: Record<string, string> = {};
    for (const f of entry.credentialFields) {
      if (f.key === 'shopId') values[f.key] = conn?.shopId || '';
      else if (f.key === 'region') values[f.key] = conn?.region || (f.options?.[0]?.value ?? '');
      else if (f.key === 'appKey') values[f.key] = '';
      else values[f.key] = '';
    }
    setDrawer({ platform: entry, connection: conn, values, sandbox: conn ? conn.sandbox : true });
  };

  const handleSave = async () => {
    if (!drawer) return;
    setSaving(true);
    try {
      const v = drawer.values;
      const known = ['appKey', 'appSecret', 'accessToken', 'refreshToken', 'shopId', 'region'];
      const extra: Record<string, string> = {};
      for (const [k, val] of Object.entries(v)) {
        if (!known.includes(k) && val) extra[k] = val;
      }

      const payload = {
        shopName: drawer.connection?.shopName || `${drawer.platform.displayName}店铺`,
        shopId: v.shopId || undefined,
        region: v.region || undefined,
        authMode: drawer.platform.authMode,
        appKey: v.appKey || undefined,
        appSecret: v.appSecret || undefined,
        accessToken: v.accessToken || undefined,
        refreshToken: v.refreshToken || undefined,
        sandbox: drawer.sandbox,
        extra: Object.keys(extra).length ? extra : undefined,
      };

      const saved = drawer.connection
        ? await platformApi.updateConnection(drawer.connection.id, payload)
        : await platformApi.createConnection({ platform: drawer.platform.platform, ...payload });

      setDrawer({ ...drawer, connection: saved, values: { ...v, appSecret: '', accessToken: '', refreshToken: '' } });
      setBanner({
        level: 'info',
        text: saved.sandbox
          ? `${saved.platformName} 连接已保存（沙箱模式）：后续同步产出的是本地演练数据，非真实平台数据。`
          : `${saved.platformName} 连接已保存，请执行「测试连接」验证凭据。`,
      });
      await refreshLight();
    } catch (e) {
      setBanner({ level: 'error', text: `保存失败：${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!drawer?.connection) {
      setBanner({ level: 'error', text: '请先保存连接配置，再执行测试。' });
      return;
    }
    setTesting(true);
    try {
      const result = await platformApi.testConnection(drawer.connection.id);
      setBanner({ level: result.success ? 'info' : 'error', text: `${result.message}（端点：${result.endpoint}）` });
      const fresh = await platformApi.getConnection(drawer.connection.id);
      setDrawer((d) => (d ? { ...d, connection: fresh, sandbox: fresh.sandbox } : d));
      await refreshLight();
    } catch (e) {
      setBanner({ level: 'error', text: `测试失败：${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setTesting(false);
    }
  };

  const handleDelete = async () => {
    if (!drawer?.connection) return;
    setSaving(true);
    try {
      await platformApi.deleteConnection(drawer.connection.id);
      setDrawer(null);
      setBanner({ level: 'info', text: '连接已删除（历史订单的来源追溯记录保留）。' });
      await refreshLight();
    } catch (e) {
      setBanner({ level: 'error', text: `删除失败：${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setSaving(false);
    }
  };

  // ────────── 同步操作 ──────────

  const handleSync = async (conn: PlatformConnection) => {
    setSyncingId(conn.id);
    try {
      const job = await platformApi.sync(conn.id, { resource: syncResource });
      setBanner({
        level: job.status === 'failed' ? 'error' : 'info',
        text: job.sandbox
          ? `${conn.platformName} 沙箱演练同步完成：共 ${job.totalCount} 条，成功 ${job.successCount} 条。以上为演练数据，非真实平台数据。`
          : `${conn.platformName} 同步完成：共 ${job.totalCount} 条，成功 ${job.successCount} 条，失败 ${job.failedCount} 条。`,
      });
      await refreshLight();
    } catch (e) {
      setBanner({ level: 'error', text: `同步失败：${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setSyncingId(null);
    }
  };

  const toggleJobLogs = async (jobId: string) => {
    if (expandedJob === jobId) {
      setExpandedJob(null);
      return;
    }
    setExpandedJob(jobId);
    if (!jobLogs[jobId]) {
      try {
        const logs = await platformApi.getJobLogs(jobId, 100);
        setJobLogs((prev) => ({ ...prev, [jobId]: logs }));
      } catch (e) {
        console.warn('[PlatformHub] 获取作业日志失败:', e);
        setJobLogs((prev) => ({ ...prev, [jobId]: [] }));
      }
    }
  };

  const handleCancelJob = async (jobId: string) => {
    try {
      await platformApi.cancelJob(jobId);
      await refreshLight();
    } catch (e) {
      setBanner({ level: 'error', text: `取消失败：${e instanceof Error ? e.message : String(e)}` });
    }
  };

  // ────────── 渲染 ──────────

  if (loading) {
    return <div style={{ padding: 24, color: 'var(--text-secondary)' }}>平台对接数据加载中…</div>;
  }

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 标题 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>平台对接中心</h2>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
            统一适配抖店 / 淘宝 / 京东 / 拼多多 / 快手 / Amazon / Shopify —— 真实端点、真实签名算法、统一订单归一化
          </p>
        </div>
        <button onClick={loadAll} className="btn btn-secondary btn-sm" style={btnStyle('secondary')}>刷新</button>
      </div>

      {/* 沙箱全局横幅 */}
      {hasSandbox && (
        <div style={{
          padding: '12px 16px', borderRadius: 10, display: 'flex', gap: 12, alignItems: 'flex-start',
          background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.45)',
        }}>
          <span style={{ fontSize: 16, lineHeight: '20px' }} aria-hidden>⚠</span>
          <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-primary)' }}>
            <strong>当前存在沙箱模式连接，其产出的全部为本地演练数据，不是真实平台数据。</strong>
            <div style={{ color: 'var(--text-secondary)', marginTop: 4 }}>
              沙箱用于在没有平台 AppKey 时验证「连接 → 同步 → 归一化 → 落库 → 统计」全链路。
              演练订单在订单列表中以 <code style={codeStyle}>SBX-</code> 前缀标识，备注写明「沙箱演练订单」。
              填入真实凭据并测试通过后，连接会自动转为 live 模式，届时调用的是各平台真实开放接口。
            </div>
          </div>
        </div>
      )}

      {/* 操作反馈 */}
      {banner && (
        <div style={{
          padding: '10px 14px', borderRadius: 8, fontSize: 13,
          background: banner.level === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(59,130,246,0.1)',
          border: `1px solid ${banner.level === 'error' ? 'rgba(239,68,68,0.4)' : 'rgba(59,130,246,0.35)'}`,
          color: 'var(--text-primary)', display: 'flex', justifyContent: 'space-between', gap: 12,
        }}>
          <span>{banner.text}</span>
          <span style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setBanner(null)}>✕</span>
        </div>
      )}

      {/* 统计区 */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <StatCard label="已建连接" value={String(stats.connectionCount)} sub={`已连通 ${stats.connectedCount} · 沙箱 ${stats.sandboxCount} · 异常 ${stats.errorCount}`} />
          <StatCard label="同步订单总数" value={String(stats.syncedOrderCount)} sub={stats.sandboxOrderCount ? `其中演练数据 ${stats.sandboxOrderCount} 条` : '全部来自真实连接'} />
          <StatCard label="同步订单金额" value={fmtMoney(stats.syncedOrderAmount)} sub={`最近同步 ${fmtTime(stats.lastSyncAt)}`} />
          <StatCard label="任务成功率" value={`${Math.round(stats.successRate * 100)}%`} sub={`共 ${stats.jobTotal} 次 · 失败 ${stats.jobFailed} 次`} />
        </div>
      )}

      {/* 平台占比 */}
      {stats && stats.byPlatform.length > 0 && (
        <div className="card" style={cardStyle}>
          <div style={sectionTitleStyle}>各平台订单占比</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {stats.byPlatform.map((p) => (
              <div key={p.platform} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 96, fontSize: 12, color: 'var(--text-secondary)' }}>{p.platformName}</span>
                <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--bg-tertiary, rgba(148,163,184,0.18))', overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.max(2, p.ratio * 100)}%`, height: '100%',
                    background: PLATFORM_COLORS[p.platform] || 'var(--ecom-blue-500)',
                  }} />
                </div>
                <span style={{ width: 150, textAlign: 'right', fontSize: 12, color: 'var(--text-muted)' }}>
                  {p.orderCount} 单 · {fmtMoney(p.orderAmount)}
                  {p.sandboxOrderCount > 0 && <span style={{ color: 'var(--warning-500)' }}>（演练 {p.sandboxOrderCount}）</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 平台卡片墙 */}
      <div>
        <div style={sectionTitleStyle}>平台接入</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
          {catalog.map((entry) => {
            const conn = connByPlatform.get(entry.platform);
            const meta = STATUS_META[conn?.status || 'disconnected'];
            return (
              <div
                key={entry.platform}
                className="card card-hoverable"
                style={{ ...cardStyle, cursor: entry.supported ? 'pointer' : 'not-allowed', opacity: entry.supported ? 1 : 0.6 }}
                onClick={() => openDrawer(entry)}
              >
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <PlatformLogo platform={entry.platform} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{entry.displayName}</span>
                      <span style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 10,
                        color: entry.supported ? meta.color : 'var(--text-muted)',
                        background: entry.supported ? meta.bg : 'rgba(148,163,184,0.14)',
                      }}>
                        {entry.supported ? meta.label : '规划中'}
                      </span>
                    </div>
                    <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)', wordBreak: 'break-all' }}>
                      {entry.gateway}
                    </div>
                    <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {entry.capabilities.map((c) => (
                        <span key={c} style={tagStyle}>{RESOURCE_LABELS[c] || c}</span>
                      ))}
                      {!entry.capabilities.length && <span style={tagStyle}>适配器未实现</span>}
                    </div>
                    <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                      签名：{entry.signatureAlgorithm}
                    </div>
                    {conn && (
                      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                        最近同步 {fmtTime(conn.lastSyncAt)}
                        {conn.lastError && (
                          <div style={{ color: 'var(--danger-500)', marginTop: 2 }}>错误：{conn.lastError.slice(0, 60)}</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 同步中心 */}
      <div className="card" style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={sectionTitleStyle}>同步中心</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>同步资源</span>
            <select
              value={syncResource}
              onChange={(e) => setSyncResource(e.target.value as ResourceType)}
              style={selectStyle}
            >
              <option value="orders">订单</option>
              <option value="products">商品</option>
              <option value="inventory">库存</option>
            </select>
          </div>
        </div>

        {/* 可同步连接 */}
        {connections.length === 0 ? (
          <div style={emptyStyle}>还没有任何平台连接。点击上方平台卡片开始接入；没有 AppKey 也可以先用沙箱模式演练全链路。</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
            {connections.map((c) => (
              <div key={c.id} style={rowStyle}>
                <PlatformLogo platform={c.platform} size={28} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                    {c.platformName}
                    <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: 12 }}>{c.shopName || '未命名店铺'}</span>
                    {c.sandbox && <span style={{ ...tagStyle, marginLeft: 8, color: 'var(--warning-500)' }}>沙箱演练</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    凭据 {c.credentialsComplete ? '已补齐' : '不完整'} · AppKey {c.appKeyMasked || '未配置'} ·
                    Secret {c.hasAppSecret ? c.appSecretMasked : '未配置'} · Token {c.hasAccessToken ? '已配置' : '未配置'}
                  </div>
                </div>
                <button
                  style={btnStyle('primary')}
                  disabled={syncingId === c.id}
                  onClick={() => handleSync(c)}
                >
                  {syncingId === c.id ? '同步中…' : '立即同步'}
                </button>
                <button
                  style={btnStyle('secondary')}
                  onClick={() => {
                    const entry = catalog.find((e) => e.platform === c.platform);
                    if (entry) openDrawer(entry);
                  }}
                >
                  配置
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 任务列表 */}
        <div style={{ marginTop: 16 }}>
          <div style={{ ...sectionTitleStyle, fontSize: 13 }}>同步任务</div>
          {jobs.length === 0 ? (
            <div style={emptyStyle}>暂无同步任务记录。</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {jobs.map((j) => {
                const jm = JOB_STATUS_META[j.status] || JOB_STATUS_META.pending;
                const progress = j.totalCount ? Math.round((j.successCount / j.totalCount) * 100) : 0;
                return (
                  <div key={j.id} style={{ ...rowStyle, flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, color: 'var(--text-primary)', minWidth: 110 }}>
                        {j.shopName || j.platform || '—'} · {RESOURCE_LABELS[j.resource] || j.resource}
                      </span>
                      <span style={{ fontSize: 11, color: jm.color }}>{jm.label}</span>
                      {j.sandbox && <span style={{ ...tagStyle, color: 'var(--warning-500)' }}>演练数据</span>}
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {j.successCount}/{j.totalCount} 成功{j.failedCount > 0 ? ` · ${j.failedCount} 失败` : ''}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>{fmtTime(j.createdAt)}</span>
                      <button style={btnStyle('ghost')} onClick={() => toggleJobLogs(j.id)}>
                        {expandedJob === j.id ? '收起日志' : '查看日志'}
                      </button>
                      {(j.status === 'pending' || j.status === 'running') && (
                        <button style={btnStyle('ghost')} onClick={() => handleCancelJob(j.id)}>取消</button>
                      )}
                    </div>
                    <div style={{ height: 4, borderRadius: 2, background: 'rgba(148,163,184,0.2)', overflow: 'hidden' }}>
                      <div style={{ width: `${progress}%`, height: '100%', background: jm.color }} />
                    </div>
                    {j.errorMessage && (
                      <div style={{ fontSize: 11, color: 'var(--danger-500)' }}>错误：{j.errorMessage}</div>
                    )}
                    {expandedJob === j.id && (
                      <div style={{
                        marginTop: 4, padding: 10, borderRadius: 6, maxHeight: 220, overflowY: 'auto',
                        background: 'var(--bg-tertiary, rgba(148,163,184,0.08))',
                      }}>
                        {(jobLogs[j.id] || []).length === 0 ? (
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>暂无日志</div>
                        ) : (
                          (jobLogs[j.id] || []).map((log) => (
                            <div key={log.id} style={{ fontSize: 11, lineHeight: 1.7, display: 'flex', gap: 8 }}>
                              <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{fmtTime(log.createdAt)}</span>
                              <span style={{ color: LOG_LEVEL_COLORS[log.level], flexShrink: 0, width: 40 }}>[{log.level}]</span>
                              <span style={{ color: 'var(--text-secondary)' }}>{log.message}</span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 配置抽屉 */}
      {drawer && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
            display: 'flex', justifyContent: 'flex-end',
          }}
          onClick={() => setDrawer(null)}
        >
          <div
            style={{
              width: 460, maxWidth: '92vw', height: '100%', overflowY: 'auto', padding: 24,
              background: 'var(--bg-secondary, #fff)', boxShadow: '-8px 0 24px rgba(0,0,0,0.18)',
              display: 'flex', flexDirection: 'column', gap: 16,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <PlatformLogo platform={drawer.platform.platform} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>{drawer.platform.displayName} 接入配置</div>
                <a
                  href={drawer.platform.docUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 11, color: 'var(--ecom-blue-500, #3b82f6)' }}
                >
                  查看官方开放平台文档 →
                </a>
              </div>
              <span style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setDrawer(null)}>✕</span>
            </div>

            {/* 真实性说明 */}
            <div style={{ padding: 12, borderRadius: 8, background: 'rgba(148,163,184,0.1)', fontSize: 11, lineHeight: 1.7, color: 'var(--text-secondary)' }}>
              <div><strong style={{ color: 'var(--text-primary)' }}>签名算法：</strong>{drawer.platform.signatureAlgorithm}</div>
              <div style={{ marginTop: 6 }}><strong style={{ color: 'var(--text-primary)' }}>已实现端点：</strong></div>
              {Object.entries(drawer.platform.endpoints).map(([k, v]) => (
                <div key={k} style={{ marginLeft: 8 }}>· {k}：<code style={codeStyle}>{v}</code></div>
              ))}
              {drawer.platform.notes && <div style={{ marginTop: 6 }}>{drawer.platform.notes}</div>}
            </div>

            {/* 沙箱开关 */}
            <label style={{
              display: 'flex', gap: 10, alignItems: 'flex-start', padding: 12, borderRadius: 8, cursor: 'pointer',
              background: drawer.sandbox ? 'rgba(245,158,11,0.12)' : 'transparent',
              border: `1px solid ${drawer.sandbox ? 'rgba(245,158,11,0.45)' : 'var(--border-color, rgba(148,163,184,0.3))'}`,
            }}>
              <input
                type="checkbox"
                checked={drawer.sandbox}
                onChange={(e) => setDrawer({ ...drawer, sandbox: e.target.checked })}
                style={{ marginTop: 2 }}
              />
              <span style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.6 }}>
                使用沙箱模式演练
                <div style={{ color: 'var(--text-secondary)', fontSize: 11, marginTop: 2 }}>
                  勾选后不会向 {drawer.platform.displayName} 发起任何真实请求，同步产出的是本地演练数据（订单号带 SBX- 前缀）。
                  取消勾选并填齐凭据后，才会调用平台真实接口。
                </div>
              </span>
            </label>

            {/* 凭据表单 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {drawer.platform.credentialFields.map((f) => (
                <div key={f.key}>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                    {f.label}
                    {f.required && <span style={{ color: 'var(--danger-500)' }}> *</span>}
                  </label>
                  {f.type === 'select' ? (
                    <select
                      value={drawer.values[f.key] || ''}
                      onChange={(e) => setDrawer({ ...drawer, values: { ...drawer.values, [f.key]: e.target.value } })}
                      style={{ ...selectStyle, width: '100%' }}
                    >
                      {(f.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : (
                    <input
                      type={f.type === 'secret' ? 'password' : 'text'}
                      value={drawer.values[f.key] || ''}
                      placeholder={
                        f.type === 'secret' && drawer.connection
                          ? (fieldConfigured(drawer.connection, f.key) ? '已配置（留空则保持不变）' : (f.placeholder || ''))
                          : (f.placeholder || '')
                      }
                      onChange={(e) => setDrawer({ ...drawer, values: { ...drawer.values, [f.key]: e.target.value } })}
                      style={inputStyle}
                    />
                  )}
                  {f.hint && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>{f.hint}</div>}
                </div>
              ))}
            </div>

            {/* 当前连接状态 */}
            {drawer.connection && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.8 }}>
                当前状态：<span style={{ color: STATUS_META[drawer.connection.status]?.color }}>
                  {STATUS_META[drawer.connection.status]?.label || drawer.connection.status}
                </span>
                <br />
                运行模式：{drawer.connection.mode === 'sandbox' ? '沙箱（演练数据）' : 'live（真实平台接口）'}
                <br />
                最近同步：{fmtTime(drawer.connection.lastSyncAt)}
                {drawer.connection.lastError && (
                  <div style={{ color: 'var(--danger-500)' }}>最近错误：{drawer.connection.lastError}</div>
                )}
                <div style={{ marginTop: 4 }}>
                  密钥安全：所有 Secret / Token 均以 AES-256-GCM 加密落库，接口只返回掩码，不回传明文。
                </div>
              </div>
            )}

            {/* 操作 */}
            <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 12, flexWrap: 'wrap' }}>
              <button style={btnStyle('primary')} disabled={saving} onClick={handleSave}>
                {saving ? '保存中…' : (drawer.connection ? '保存修改' : '创建连接')}
              </button>
              <button style={btnStyle('secondary')} disabled={testing || !drawer.connection} onClick={handleTest}>
                {testing ? '测试中…' : '测试连接'}
              </button>
              {drawer.connection && (
                <button style={btnStyle('danger')} disabled={saving} onClick={handleDelete}>删除连接</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────── 小组件与样式 ──────────────────

function fieldConfigured(conn: PlatformConnection, key: string): boolean {
  if (key === 'appSecret') return conn.hasAppSecret;
  if (key === 'accessToken') return conn.hasAccessToken;
  if (key === 'refreshToken') return conn.hasRefreshToken;
  return false;
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card" style={{ ...cardStyle, gap: 4 }}>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  );
}

const cardStyle: CSSProperties = {
  padding: 16,
  borderRadius: 12,
  background: 'var(--bg-secondary, rgba(255,255,255,0.04))',
  border: '1px solid var(--border-color, rgba(148,163,184,0.2))',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const sectionTitleStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--text-primary)',
  marginBottom: 8,
};

const tagStyle: CSSProperties = {
  fontSize: 10,
  padding: '2px 6px',
  borderRadius: 4,
  background: 'rgba(148,163,184,0.16)',
  color: 'var(--text-secondary)',
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid var(--border-color, rgba(148,163,184,0.18))',
};

const emptyStyle: CSSProperties = {
  padding: '18px 12px',
  fontSize: 12,
  color: 'var(--text-muted)',
  textAlign: 'center',
};

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 13,
  borderRadius: 6,
  border: '1px solid var(--border-color, rgba(148,163,184,0.35))',
  background: 'var(--bg-primary, transparent)',
  color: 'var(--text-primary)',
  boxSizing: 'border-box',
};

const selectStyle: CSSProperties = {
  padding: '6px 10px',
  fontSize: 12,
  borderRadius: 6,
  border: '1px solid var(--border-color, rgba(148,163,184,0.35))',
  background: 'var(--bg-primary, transparent)',
  color: 'var(--text-primary)',
};

const codeStyle: CSSProperties = {
  padding: '1px 4px',
  borderRadius: 3,
  background: 'rgba(148,163,184,0.2)',
  fontSize: 10,
};

function btnStyle(variant: 'primary' | 'secondary' | 'ghost' | 'danger'): CSSProperties {
  const base: CSSProperties = {
    padding: '6px 14px',
    fontSize: 12,
    borderRadius: 6,
    cursor: 'pointer',
    border: '1px solid transparent',
    whiteSpace: 'nowrap',
  };
  if (variant === 'primary') {
    return { ...base, background: 'var(--ecom-blue-500, #3b82f6)', color: '#fff' };
  }
  if (variant === 'danger') {
    return { ...base, background: 'transparent', color: 'var(--danger-500, #ef4444)', borderColor: 'var(--danger-500, #ef4444)' };
  }
  if (variant === 'ghost') {
    return { ...base, background: 'transparent', color: 'var(--text-secondary)', padding: '4px 8px' };
  }
  return {
    ...base,
    background: 'transparent',
    color: 'var(--text-primary)',
    borderColor: 'var(--border-color, rgba(148,163,184,0.4))',
  };
}
