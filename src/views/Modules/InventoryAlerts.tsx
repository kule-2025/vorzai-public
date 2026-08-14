/**
 * Vorzai 库存预警中心（Inventory Alerts）
 *
 * 一屏呈现：
 *   1. 顶部 4 张统计卡（严重告警 / 警告 / 待处理总数 / 建议补货 SKU 数）
 *   2. 「立即评估」按钮 —— 触发后端规则评估引擎并刷新
 *   3. 告警列表（商品 / 类型 / 严重度 / 库存 / 可售天数 / 建议补货 / 操作）
 *   4. 严重度与状态筛选器
 *   5. 规则管理区（列表 + 启停 + 新建）
 *   6. 人效归因区（员工 GMV / 毛利排行榜 Top10 + 人均 GMV 汇总）
 *
 * 数据全部来自 inventoryApi 真实接口，严禁任何 Mock / 硬编码业务数据。
 */
import { useState, useEffect, useCallback } from 'react';
import { Card } from '@components/Common/Card';
import { Badge } from '@components/Common/Badge';
import { Button } from '@components/Common/Button';
import inventoryApi, {
  InventoryAlert,
  InventoryAlertRule,
  AlertStats,
  AlertSeverity,
  AlertStatus,
  RuleType,
  RuleScope,
  RuleInput,
  RankingItem,
  EfficiencySummary,
} from '@api/inventory';

// ─────────────── 常量映射（UI 文案，非业务数据）───────────────

const RULE_TYPE_LABEL: Record<string, string> = {
  low_stock: '低库存',
  out_of_stock: '断货',
  overstock: '库存积压',
  slow_moving: '滞销',
  stockout_eta: '预计断货',
};

const SEVERITY_LABEL: Record<string, string> = {
  critical: '严重',
  warning: '警告',
  info: '提示',
};

const STATUS_LABEL: Record<string, string> = {
  open: '待处理',
  acknowledged: '已确认',
  resolved: '已解决',
  ignored: '已忽略',
};

const SCOPE_LABEL: Record<string, string> = {
  all: '全部商品',
  category: '指定类目',
  product: '指定单品',
};

const RULE_TYPE_OPTIONS: RuleType[] = [
  'low_stock', 'out_of_stock', 'overstock', 'slow_moving', 'stockout_eta',
];
const SEVERITY_OPTIONS: AlertSeverity[] = ['critical', 'warning', 'info'];
const STATUS_OPTIONS: AlertStatus[] = ['open', 'acknowledged', 'resolved', 'ignored'];
const SCOPE_OPTIONS: RuleScope[] = ['all', 'category', 'product'];

function severityVariant(s: string): 'danger' | 'warning' | 'info' | 'neutral' {
  if (s === 'critical') return 'danger';
  if (s === 'warning') return 'warning';
  if (s === 'info') return 'info';
  return 'neutral';
}

function statusVariant(s: string): 'success' | 'info' | 'neutral' {
  if (s === 'resolved') return 'success';
  if (s === 'acknowledged') return 'info';
  return 'neutral';
}

// ─────────────── 样式 ───────────────

const pageStyle: React.CSSProperties = {
  padding: 20, display: 'flex', flexDirection: 'column', gap: 16,
  background: 'var(--bg-app, var(--bg-card-hover, #f5f6fa))',
  minHeight: '100%',
};
const sectionTitleStyle: React.CSSProperties = {
  fontSize: 14, fontWeight: 600, color: 'var(--text-primary)',
  display: 'flex', alignItems: 'center', gap: 8,
};
const statGridStyle: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12,
};
const panelStyle: React.CSSProperties = {
  padding: 14, background: 'var(--bg-card)',
  border: '1px solid var(--border-card)', borderRadius: 'var(--radius-card)',
  display: 'flex', flexDirection: 'column', gap: 10,
};
const inputStyle: React.CSSProperties = {
  padding: '6px 8px', fontSize: 12, borderRadius: 6,
  border: '1px solid var(--border-card)',
  background: 'var(--bg-card)', color: 'var(--text-primary)',
  outline: 'none',
};
const thStyle: React.CSSProperties = {
  textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
  padding: '8px 10px', borderBottom: '1px solid var(--border-card)', whiteSpace: 'nowrap',
};
const tdStyle: React.CSSProperties = {
  fontSize: 12, color: 'var(--text-primary)', padding: '8px 10px',
  borderBottom: '1px solid var(--border-card)', verticalAlign: 'middle',
};
const emptyStyle: React.CSSProperties = {
  padding: 28, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12,
};

// ─────────────── 工具函数 ───────────────

function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return '¥0';
  const abs = Math.abs(n);
  if (abs >= 1_0000_0000) return `¥${(n / 1_0000_0000).toFixed(2)}亿`;
  if (abs >= 1_0000) return `¥${(n / 1_0000).toFixed(2)}万`;
  return `¥${n.toFixed(2)}`;
}
function formatInt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return new Intl.NumberFormat('zh-CN').format(Math.round(n));
}
function formatPct(n: number): string {
  if (!Number.isFinite(n)) return '0%';
  return `${(n * 100).toFixed(1)}%`;
}
function defaultPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

// ─────────────── 子组件 ───────────────

function StatCard({
  label, value, sub, tone, icon,
}: {
  label: string; value: string; sub?: string;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  icon?: string;
}) {
  const colorMap: Record<string, string> = {
    default: 'var(--text-primary)',
    success: 'var(--success-500, #22c55e)',
    warning: 'var(--warning-500, #f59e0b)',
    danger: 'var(--danger-500, #ef4444)',
    info: 'var(--text-link, #4f46e5)',
  };
  return (
    <Card hoverable>
      <div style={{ ...panelStyle, gap: 6 }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          fontSize: 12, color: 'var(--text-muted)',
        }}>
          <span>{label}</span>
          {icon && <span aria-hidden style={{ fontSize: 14 }}>{icon}</span>}
        </div>
        <div style={{
          fontSize: 22, fontWeight: 700, lineHeight: 1.2,
          color: colorMap[tone || 'default'], fontVariantNumeric: 'tabular-nums',
        }}>
          {value}
        </div>
        {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sub}</div>}
      </div>
    </Card>
  );
}

/** 新建规则内联表单 */
function RuleForm({
  submitting, onSubmit, onCancel,
}: {
  submitting: boolean;
  onSubmit: (input: RuleInput) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [ruleType, setRuleType] = useState<RuleType>('low_stock');
  const [scope, setScope] = useState<RuleScope>('all');
  const [scopeValue, setScopeValue] = useState('');
  const [threshold, setThreshold] = useState('10');
  const [windowDays, setWindowDays] = useState('7');
  const [severity, setSeverity] = useState<AlertSeverity>('warning');
  const [formError, setFormError] = useState<string | null>(null);

  const submit = () => {
    if (!name.trim()) { setFormError('请填写规则名称'); return; }
    if (scope !== 'all' && !scopeValue.trim()) { setFormError('请填写作用域取值（类目名或商品 SKU）'); return; }
    const th = Number(threshold);
    const wd = Number(windowDays);
    if (!Number.isFinite(th) || th < 0) { setFormError('阈值必须为非负数字'); return; }
    if (!Number.isInteger(wd) || wd < 1 || wd > 365) { setFormError('统计窗口需为 1 ~ 365 之间的整数天'); return; }
    setFormError(null);
    onSubmit({
      name: name.trim(),
      ruleType,
      scope,
      scopeValue: scope === 'all' ? null : scopeValue.trim(),
      threshold: th,
      windowDays: wd,
      severity,
    });
  };

  return (
    <div style={{
      ...panelStyle,
      background: 'var(--bg-row-hover)', gap: 10,
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>新建预警规则</div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10,
      }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
          规则名称
          <input
            style={inputStyle}
            value={name}
            placeholder="例如：核心类目低库存"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
          规则类型
          <select style={inputStyle} value={ruleType} onChange={(e) => setRuleType(e.target.value as RuleType)}>
            {RULE_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>{RULE_TYPE_LABEL[t]}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
          作用域
          <select style={inputStyle} value={scope} onChange={(e) => setScope(e.target.value as RuleScope)}>
            {SCOPE_OPTIONS.map((s) => (
              <option key={s} value={s}>{SCOPE_LABEL[s]}</option>
            ))}
          </select>
        </label>
        {scope !== 'all' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
            {scope === 'category' ? '类目名称' : '商品 SKU'}
            <input
              style={inputStyle}
              value={scopeValue}
              placeholder={scope === 'category' ? '与商品 category 完全一致' : '商品 SKU 或商品 ID'}
              onChange={(e) => setScopeValue(e.target.value)}
            />
          </label>
        )}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
          阈值{ruleType === 'stockout_eta' ? '（天）' : '（件）'}
          <input
            style={inputStyle}
            type="number"
            min={0}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
          统计窗口（天）
          <input
            style={inputStyle}
            type="number"
            min={1}
            max={365}
            value={windowDays}
            onChange={(e) => setWindowDays(e.target.value)}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
          严重度
          <select style={inputStyle} value={severity} onChange={(e) => setSeverity(e.target.value as AlertSeverity)}>
            {SEVERITY_OPTIONS.map((s) => (
              <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>
            ))}
          </select>
        </label>
      </div>
      {formError && (
        <div style={{ fontSize: 12, color: 'var(--danger-500, #ef4444)' }}>{formError}</div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button size="sm" onClick={submit} disabled={submitting}>
          {submitting ? '保存中…' : '保存规则'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={submitting}>取消</Button>
      </div>
    </div>
  );
}

// ─────────────── 主组件 ───────────────

export default function InventoryAlerts() {
  // 数据
  const [stats, setStats] = useState<AlertStats | null>(null);
  const [alerts, setAlerts] = useState<InventoryAlert[]>([]);
  const [alertTotal, setAlertTotal] = useState(0);
  const [rules, setRules] = useState<InventoryAlertRule[]>([]);
  const [ranking, setRanking] = useState<RankingItem[]>([]);
  const [efficiency, setEfficiency] = useState<EfficiencySummary | null>(null);

  // 交互状态
  const [loading, setLoading] = useState(true);
  const [evaluating, setEvaluating] = useState(false);
  const [computing, setComputing] = useState(false);
  const [savingRule, setSavingRule] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showRuleForm, setShowRuleForm] = useState(false);

  // 筛选
  const [filterSeverity, setFilterSeverity] = useState<AlertSeverity | ''>('');
  const [filterStatus, setFilterStatus] = useState<AlertStatus | ''>('open');
  const [page, setPage] = useState(1);
  const [period, setPeriod] = useState(defaultPeriod());

  const PAGE_SIZE = 20;

  /** 拉取告警列表 + 统计 */
  const loadAlerts = useCallback(async () => {
    const [listRes, statsRes] = await Promise.all([
      inventoryApi.listAlerts({
        severity: filterSeverity || undefined,
        status: filterStatus || undefined,
        page,
        limit: PAGE_SIZE,
      }),
      inventoryApi.getAlertStats(),
    ]);
    setAlerts(listRes.items);
    setAlertTotal(listRes.pagination.total);
    setStats(statsRes);
  }, [filterSeverity, filterStatus, page]);

  /** 拉取归因数据 */
  const loadAttribution = useCallback(async () => {
    const [rankRes, effRes] = await Promise.all([
      inventoryApi.getRanking(period, 10),
      inventoryApi.getEfficiency(period),
    ]);
    setRanking(rankRes);
    setEfficiency(effRes);
  }, [period]);

  /** 全量刷新 */
  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rulesRes = await inventoryApi.listRules();
      setRules(rulesRes);
      await loadAlerts();
      await loadAttribution();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [loadAlerts, loadAttribution]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── 操作 ──

  const handleEvaluate = async () => {
    setEvaluating(true);
    setError(null);
    setNotice(null);
    try {
      const r = await inventoryApi.evaluate();
      setNotice(
        `评估完成：扫描 ${r.productCount} 个商品 / ${r.ruleCount} 条规则，新增告警 ${r.created} 条，更新 ${r.updated} 条，自动关闭 ${r.autoResolved} 条。`
      );
      setPage(1);
      await loadAlerts();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEvaluating(false);
    }
  };

  const handleCompute = async () => {
    setComputing(true);
    setError(null);
    setNotice(null);
    try {
      const r = await inventoryApi.computeAttribution(period);
      setNotice(
        `${r.period} 归因完成：订单 ${r.orderRows} 条 / 工单 ${r.ticketRows} 条，覆盖 ${r.employeeCount} 名员工，跳过 ${r.skippedOrders + r.skippedTickets} 条无法关联的数据。`
      );
      await loadAttribution();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setComputing(false);
    }
  };

  const handleAlertAction = async (id: string, action: 'acknowledge' | 'resolve' | 'ignore') => {
    setActingId(id);
    setError(null);
    try {
      if (action === 'acknowledge') await inventoryApi.acknowledgeAlert(id);
      else if (action === 'resolve') await inventoryApi.resolveAlert(id);
      else await inventoryApi.ignoreAlert(id);
      await loadAlerts();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActingId(null);
    }
  };

  const handleToggleRule = async (rule: InventoryAlertRule) => {
    setActingId(rule.id);
    setError(null);
    try {
      await inventoryApi.toggleRule(rule.id, !rule.enabled);
      setRules(await inventoryApi.listRules());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActingId(null);
    }
  };

  const handleDeleteRule = async (rule: InventoryAlertRule) => {
    setActingId(rule.id);
    setError(null);
    try {
      await inventoryApi.deleteRule(rule.id);
      setRules(await inventoryApi.listRules());
      await loadAlerts();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActingId(null);
    }
  };

  const handleCreateRule = async (input: RuleInput) => {
    setSavingRule(true);
    setError(null);
    try {
      await inventoryApi.createRule(input);
      setShowRuleForm(false);
      setRules(await inventoryApi.listRules());
      setNotice('规则已创建，点击「立即评估」即可生效。');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingRule(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(alertTotal / PAGE_SIZE));
  const maxRankingGmv = ranking.reduce((m, r) => Math.max(m, r.gmv), 0);

  return (
    <div style={pageStyle}>
      {/* ── 标题栏 ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 8,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
            库存预警中心
          </h1>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            库存风险实时监控 · 补货建议 · 业务与人效归因打通
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="secondary" size="sm" onClick={loadAll} disabled={loading}>
            {loading ? '加载中…' : '刷新'}
          </Button>
          <Button size="sm" onClick={handleEvaluate} disabled={evaluating || loading}>
            {evaluating ? '评估中…' : '立即评估'}
          </Button>
        </div>
      </div>

      {/* ── 错误 / 提示 ── */}
      {error && (
        <div style={{
          padding: 12, borderRadius: 8, fontSize: 13,
          background: 'var(--bg-row-hover)',
          border: '1px solid var(--danger-500, #ef4444)',
          color: 'var(--danger-500, #ef4444)',
        }}>
          {error}
          <Button variant="ghost" size="sm" onClick={loadAll} style={{ marginLeft: 12 }}>重试</Button>
        </div>
      )}
      {notice && (
        <div style={{
          padding: 12, borderRadius: 8, fontSize: 12,
          background: 'var(--bg-row-hover)',
          border: '1px solid var(--border-card)',
          color: 'var(--text-secondary)',
          display: 'flex', justifyContent: 'space-between', gap: 12,
        }}>
          <span>{notice}</span>
          <span
            role="button"
            tabIndex={0}
            onClick={() => setNotice(null)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setNotice(null); }}
            style={{ cursor: 'pointer', color: 'var(--text-muted)' }}
          >×</span>
        </div>
      )}

      {/* ── 4 张统计卡 ── */}
      <section>
        <div style={{ ...sectionTitleStyle, marginBottom: 10 }}>告警概览</div>
        <div style={statGridStyle}>
          <StatCard
            label="严重告警"
            value={formatInt(stats?.bySeverity.critical ?? 0)}
            sub="断货等需立即处理"
            tone={(stats?.bySeverity.critical ?? 0) > 0 ? 'danger' : 'default'}
            icon="🚨"
          />
          <StatCard
            label="警告级告警"
            value={formatInt(stats?.bySeverity.warning ?? 0)}
            sub="低库存 / 预计断货"
            tone={(stats?.bySeverity.warning ?? 0) > 0 ? 'warning' : 'default'}
            icon="⚠️"
          />
          <StatCard
            label="待处理总数"
            value={formatInt(stats?.pending ?? 0)}
            sub={`累计告警 ${formatInt(stats?.total ?? 0)} 条`}
            tone={(stats?.pending ?? 0) > 0 ? 'info' : 'default'}
            icon="📋"
          />
          <StatCard
            label="建议补货 SKU"
            value={formatInt(stats?.restockSkuCount ?? 0)}
            sub={`合计建议补货 ${formatInt(stats?.suggestedQtyTotal ?? 0)} 件`}
            tone={(stats?.restockSkuCount ?? 0) > 0 ? 'info' : 'default'}
            icon="📦"
          />
        </div>
      </section>

      {/* ── 告警列表 ── */}
      <section>
        <div style={{
          ...sectionTitleStyle, marginBottom: 10,
          justifyContent: 'space-between', flexWrap: 'wrap',
        }}>
          <span>告警列表</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              style={inputStyle}
              value={filterSeverity}
              onChange={(e) => { setFilterSeverity(e.target.value as AlertSeverity | ''); setPage(1); }}
            >
              <option value="">全部严重度</option>
              {SEVERITY_OPTIONS.map((s) => (
                <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>
              ))}
            </select>
            <select
              style={inputStyle}
              value={filterStatus}
              onChange={(e) => { setFilterStatus(e.target.value as AlertStatus | ''); setPage(1); }}
            >
              <option value="">全部状态</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
          </div>
        </div>
        <Card>
          <div style={{ ...panelStyle, padding: 0, gap: 0, overflow: 'hidden' }}>
            {loading && alerts.length === 0 ? (
              <div style={emptyStyle}>加载中…</div>
            ) : alerts.length === 0 ? (
              <div style={emptyStyle}>
                <div style={{ fontSize: 24, marginBottom: 6 }}>✓</div>
                当前筛选条件下暂无告警，点击右上角「立即评估」可重新扫描库存。
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>商品</th>
                      <th style={thStyle}>类型</th>
                      <th style={thStyle}>严重度</th>
                      <th style={thStyle}>状态</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>当前库存</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>日均销量</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>可售天数</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>建议补货</th>
                      <th style={thStyle}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alerts.map((a) => (
                      <tr key={a.id} title={a.message}>
                        <td style={tdStyle}>
                          <div style={{ fontWeight: 500 }}>{a.productName || '未知商品'}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {a.productSku || a.productId}
                            {a.productCategory ? ` · ${a.productCategory}` : ''}
                          </div>
                        </td>
                        <td style={tdStyle}>{RULE_TYPE_LABEL[a.alertType] || a.alertType}</td>
                        <td style={tdStyle}>
                          <Badge variant={severityVariant(a.severity)}>
                            {SEVERITY_LABEL[a.severity] || a.severity}
                          </Badge>
                        </td>
                        <td style={tdStyle}>
                          <Badge variant={statusVariant(a.status)}>
                            {STATUS_LABEL[a.status] || a.status}
                          </Badge>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {formatInt(a.currentStock)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {a.dailySalesAvg.toFixed(2)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {a.daysOfSupply === null ? '—' : `${a.daysOfSupply.toFixed(1)} 天`}
                        </td>
                        <td style={{
                          ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                          fontWeight: a.suggestedQty > 0 ? 700 : 400,
                          color: a.suggestedQty > 0 ? 'var(--text-link, #4f46e5)' : 'var(--text-muted)',
                        }}>
                          {a.suggestedQty > 0 ? `${formatInt(a.suggestedQty)} 件` : '—'}
                        </td>
                        <td style={tdStyle}>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            <Button
                              size="sm" variant="ghost"
                              disabled={actingId === a.id || a.status !== 'open'}
                              onClick={() => handleAlertAction(a.id, 'acknowledge')}
                            >确认</Button>
                            <Button
                              size="sm" variant="ghost"
                              disabled={actingId === a.id || a.status === 'resolved'}
                              onClick={() => handleAlertAction(a.id, 'resolve')}
                            >解决</Button>
                            <Button
                              size="sm" variant="ghost"
                              disabled={actingId === a.id || a.status === 'ignored'}
                              onClick={() => handleAlertAction(a.id, 'ignore')}
                            >忽略</Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {alertTotal > 0 && (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 12px', fontSize: 11, color: 'var(--text-muted)',
                borderTop: '1px solid var(--border-card)',
              }}>
                <span>共 {formatInt(alertTotal)} 条 · 第 {page} / {totalPages} 页</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Button
                    size="sm" variant="ghost"
                    disabled={page <= 1 || loading}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >上一页</Button>
                  <Button
                    size="sm" variant="ghost"
                    disabled={page >= totalPages || loading}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >下一页</Button>
                </div>
              </div>
            )}
          </div>
        </Card>
      </section>

      {/* ── 规则管理 ── */}
      <section>
        <div style={{ ...sectionTitleStyle, marginBottom: 10, justifyContent: 'space-between' }}>
          <span>预警规则</span>
          <Button size="sm" variant="secondary" onClick={() => setShowRuleForm((v) => !v)}>
            {showRuleForm ? '收起表单' : '新建规则'}
          </Button>
        </div>
        {showRuleForm && (
          <div style={{ marginBottom: 10 }}>
            <RuleForm
              submitting={savingRule}
              onSubmit={handleCreateRule}
              onCancel={() => setShowRuleForm(false)}
            />
          </div>
        )}
        <Card>
          <div style={{ ...panelStyle, padding: 0, gap: 0, overflow: 'hidden' }}>
            {loading && rules.length === 0 ? (
              <div style={emptyStyle}>加载中…</div>
            ) : rules.length === 0 ? (
              <div style={emptyStyle}>暂无预警规则，点击「新建规则」开始配置。</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>规则名称</th>
                      <th style={thStyle}>类型</th>
                      <th style={thStyle}>作用域</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>阈值</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>窗口</th>
                      <th style={thStyle}>严重度</th>
                      <th style={thStyle}>状态</th>
                      <th style={thStyle}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map((r) => (
                      <tr key={r.id}>
                        <td style={{ ...tdStyle, fontWeight: 500 }}>{r.name}</td>
                        <td style={tdStyle}>{RULE_TYPE_LABEL[r.ruleType] || r.ruleType}</td>
                        <td style={tdStyle}>
                          {SCOPE_LABEL[r.scope] || r.scope}
                          {r.scopeValue ? ` · ${r.scopeValue}` : ''}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {r.threshold}
                          {r.ruleType === 'stockout_eta' ? ' 天' : ' 件'}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {r.windowDays} 天
                        </td>
                        <td style={tdStyle}>
                          <Badge variant={severityVariant(r.severity)}>
                            {SEVERITY_LABEL[r.severity] || r.severity}
                          </Badge>
                        </td>
                        <td style={tdStyle}>
                          <Badge variant={r.enabled ? 'success' : 'neutral'}>
                            {r.enabled ? '已启用' : '已停用'}
                          </Badge>
                        </td>
                        <td style={tdStyle}>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <Button
                              size="sm" variant="ghost"
                              disabled={actingId === r.id}
                              onClick={() => handleToggleRule(r)}
                            >{r.enabled ? '停用' : '启用'}</Button>
                            <Button
                              size="sm" variant="ghost"
                              disabled={actingId === r.id}
                              onClick={() => handleDeleteRule(r)}
                            >删除</Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card>
      </section>

      {/* ── 人效归因 ── */}
      <section>
        <div style={{ ...sectionTitleStyle, marginBottom: 10, justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <span>人效归因（业务 × HR）</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              style={{ ...inputStyle, width: 130 }}
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value || defaultPeriod())}
            />
            <Button size="sm" variant="secondary" onClick={handleCompute} disabled={computing}>
              {computing ? '计算中…' : '重新计算归因'}
            </Button>
          </div>
        </div>

        {/* 人均汇总卡 */}
        <div style={{ ...statGridStyle, marginBottom: 12 }}>
          <StatCard
            label="本期总 GMV"
            value={formatMoney(efficiency?.totalGmv ?? 0)}
            sub={`归因订单 ${formatInt(efficiency?.totalOrderCount ?? 0)} 单`}
            tone="info"
            icon="💰"
          />
          <StatCard
            label="人均 GMV"
            value={formatMoney(efficiency?.gmvPerCapita ?? 0)}
            sub={`在职 ${formatInt(efficiency?.headcount ?? 0)} 人`}
            tone="info"
            icon="👥"
          />
          <StatCard
            label="人均毛利"
            value={formatMoney(efficiency?.grossProfitPerCapita ?? 0)}
            sub={`总毛利 ${formatMoney(efficiency?.totalGrossProfit ?? 0)}`}
            tone={(efficiency?.grossProfitPerCapita ?? 0) >= 0 ? 'success' : 'danger'}
            icon="📈"
          />
          <StatCard
            label="有产出员工"
            value={formatInt(efficiency?.contributorCount ?? 0)}
            sub={`人均 ${(efficiency?.orderPerCapita ?? 0).toFixed(2)} 单`}
            tone="default"
            icon="🏅"
          />
        </div>

        <Card>
          <div style={{ ...panelStyle, padding: 0, gap: 0, overflow: 'hidden' }}>
            {loading && ranking.length === 0 ? (
              <div style={emptyStyle}>加载中…</div>
            ) : ranking.length === 0 ? (
              <div style={emptyStyle}>
                {period} 暂无归因数据。请确认订单已关联负责人（orders.owner_employee_id），
                然后点击「重新计算归因」。
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>排名</th>
                      <th style={thStyle}>员工</th>
                      <th style={thStyle}>部门 / 岗位</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>GMV</th>
                      <th style={thStyle}>GMV 占比</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>毛利</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>毛利率</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>订单 / 工单</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranking.map((r) => (
                      <tr key={r.employeeId}>
                        <td style={{ ...tdStyle, fontWeight: 700, width: 48 }}>
                          {r.rank <= 3
                            ? <Badge variant="warning">{r.rank}</Badge>
                            : r.rank}
                        </td>
                        <td style={tdStyle}>
                          <div style={{ fontWeight: 500 }}>{r.employeeName}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.employeeNo}</div>
                        </td>
                        <td style={{ ...tdStyle, color: 'var(--text-secondary)' }}>
                          {r.departmentName || '未分配部门'}
                          {r.position ? ` · ${r.position}` : ''}
                        </td>
                        <td style={{
                          ...tdStyle, textAlign: 'right', fontWeight: 600,
                          fontVariantNumeric: 'tabular-nums',
                        }}>
                          {formatMoney(r.gmv)}
                        </td>
                        <td style={{ ...tdStyle, minWidth: 120 }}>
                          <div style={{
                            height: 6, borderRadius: 3, background: 'var(--bg-row-hover)', overflow: 'hidden',
                          }}>
                            <div style={{
                              width: `${maxRankingGmv > 0 ? (r.gmv / maxRankingGmv) * 100 : 0}%`,
                              height: '100%',
                              background: 'linear-gradient(90deg, rgba(79,70,229,0.9), rgba(139,92,246,0.7))',
                            }} />
                          </div>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {formatMoney(r.grossProfit)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {formatPct(r.marginRate)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {formatInt(r.orderCount)} / {formatInt(r.ticketCount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card>

        {/* Top3 / Bottom3 */}
        {efficiency && (efficiency.top3.length > 0 || efficiency.bottom3.length > 0) && (
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 12, marginTop: 12,
          }}>
            <Card>
              <div style={panelStyle}>
                <div style={sectionTitleStyle}>人效 Top 3</div>
                {efficiency.top3.length === 0 ? (
                  <div style={emptyStyle}>暂无数据</div>
                ) : efficiency.top3.map((r) => (
                  <div key={r.employeeId} style={{
                    display: 'flex', justifyContent: 'space-between', gap: 8,
                    padding: '6px 8px', borderRadius: 6, background: 'var(--bg-row-hover)', fontSize: 12,
                  }}>
                    <span style={{ color: 'var(--text-primary)' }}>
                      {r.employeeName}
                      <span style={{ color: 'var(--text-muted)', marginLeft: 6, fontSize: 11 }}>
                        {r.departmentName || '未分配部门'}
                      </span>
                    </span>
                    <span style={{
                      fontWeight: 700, color: 'var(--success-500, #22c55e)',
                      fontVariantNumeric: 'tabular-nums',
                    }}>{formatMoney(r.gmv)}</span>
                  </div>
                ))}
              </div>
            </Card>
            <Card>
              <div style={panelStyle}>
                <div style={sectionTitleStyle}>人效待改进 Bottom 3</div>
                {efficiency.bottom3.length === 0 ? (
                  <div style={emptyStyle}>在职员工不足 4 人，暂不展示</div>
                ) : efficiency.bottom3.map((r) => (
                  <div key={r.employeeId} style={{
                    display: 'flex', justifyContent: 'space-between', gap: 8,
                    padding: '6px 8px', borderRadius: 6, background: 'var(--bg-row-hover)', fontSize: 12,
                  }}>
                    <span style={{ color: 'var(--text-primary)' }}>
                      {r.employeeName}
                      <span style={{ color: 'var(--text-muted)', marginLeft: 6, fontSize: 11 }}>
                        {r.departmentName || '未分配部门'}
                      </span>
                    </span>
                    <span style={{
                      fontWeight: 700, color: 'var(--warning-500, #f59e0b)',
                      fontVariantNumeric: 'tabular-nums',
                    }}>{formatMoney(r.gmv)}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}
      </section>

      {/* ── 口径说明 ── */}
      <Card>
        <div style={{
          padding: 12, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7,
          background: 'var(--bg-card)', border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-card)',
        }}>
          <strong style={{ color: 'var(--text-secondary)' }}>口径说明：</strong>
          日均销量 = 规则统计窗口内的销量 ÷ 窗口天数；可售天数 = 当前库存 ÷ 日均销量；
          建议补货量 = 日均销量 × 30 天安全周期 − 当前库存（向上取整，最小 0）。
          归因毛利 = 订单营收 − Σ(items[].quantity × products.cost_price)，与业务驾驶舱口径一致。
          所有数据按 tenant_id 隔离。
        </div>
      </Card>
    </div>
  );
}
