/**
 * Vorzai 采购供应链中心（Procurement Hub）
 *
 * V2 方案 M1 交付：补齐「采购 → 到货 → 入库」链路断层
 *
 * 一屏呈现（4 个 Tab）：
 *   总览      —— 4 张统计卡 + 逾期未到货采购单（今日要处理）
 *   采购单    —— 列表 / 状态机流转 / 到货入库 / 新建
 *   供应商    —— 台账 CRUD + 绩效评分（onTimeRate×0.4 + completionRate×0.3 + qualifyRate×0.3）
 *   补货建议  —— 按 max(0, ceil(日均销量×覆盖天数) − 当前库存) 测算，勾选一键转采购单
 *
 * 数据全部来自 procurementApi 真实接口，严禁任何 Mock / 硬编码业务数据。
 */
import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { Card } from '@components/Common/Card';
import { Badge } from '@components/Common/Badge';
import { Button } from '@components/Common/Button';
import procurementApi, {
  Supplier,
  SupplierInput,
  SupplierGrade,
  SupplierStatus,
  PurchaseOrder,
  POStatus,
  PurchaseItem,
  ReplenishSuggestion,
  SupplierPerformance,
  ProcurementOverview,
  PO_STATUS_LABEL,
  SUPPLIER_STATUS_LABEL,
} from '@api/procurement';

// ─────────────── 常量（UI 文案，非业务数据）───────────────

type TabKey = 'overview' | 'orders' | 'suppliers' | 'replenish';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'overview', label: '总览' },
  { key: 'orders', label: '采购单' },
  { key: 'suppliers', label: '供应商' },
  { key: 'replenish', label: '补货建议' },
];

const GRADE_OPTIONS: SupplierGrade[] = ['A', 'B', 'C', 'D'];
const PO_STATUS_OPTIONS: POStatus[] = [
  'draft', 'submitted', 'approved', 'receiving', 'completed', 'cancelled',
];
const SUPPLIER_STATUS_OPTIONS: SupplierStatus[] = ['active', 'suspended', 'archived'];

/** 前端仅用于渲染可点按钮，真正的合法性由后端状态机裁决 */
const NEXT_STATUS: Record<POStatus, POStatus[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['approved', 'draft', 'cancelled'],
  approved: ['receiving', 'cancelled'],
  receiving: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

function poStatusVariant(s: POStatus): 'success' | 'warning' | 'info' | 'danger' | 'neutral' {
  if (s === 'completed') return 'success';
  if (s === 'receiving' || s === 'approved') return 'info';
  if (s === 'submitted') return 'warning';
  if (s === 'cancelled') return 'danger';
  return 'neutral';
}

function gradeVariant(g: SupplierGrade): 'success' | 'info' | 'warning' | 'danger' {
  if (g === 'A') return 'success';
  if (g === 'B') return 'info';
  if (g === 'C') return 'warning';
  return 'danger';
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
const labelStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4,
  fontSize: 11, color: 'var(--text-muted)',
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
const tabBarStyle: React.CSSProperties = {
  display: 'flex', gap: 4, borderBottom: '1px solid var(--border-card)',
};

function tabStyle(active: boolean): React.CSSProperties {
  return {
    padding: '8px 16px', fontSize: 13, cursor: 'pointer',
    fontWeight: active ? 600 : 400,
    color: active ? 'var(--text-link, #4f46e5)' : 'var(--text-muted)',
    borderBottom: active ? '2px solid var(--text-link, #4f46e5)' : '2px solid transparent',
    background: 'none', border: 'none', borderRadius: 0,
    outline: 'none',
  };
}

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
function formatDate(s: string | null): string {
  if (!s) return '—';
  return s.slice(0, 10);
}
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ─────────────── 子组件 ───────────────

function StatCard({
  label, value, sub, tone,
}: {
  label: string; value: string; sub?: string;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'info';
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
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</div>
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

/** 新建供应商内联表单 */
function SupplierForm({
  submitting, onSubmit, onCancel,
}: {
  submitting: boolean;
  onSubmit: (input: SupplierInput) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [category, setCategory] = useState('');
  const [grade, setGrade] = useState<SupplierGrade>('B');
  const [paymentTerms, setPaymentTerms] = useState('net30');
  const [leadTimeDays, setLeadTimeDays] = useState('7');
  const [formError, setFormError] = useState<string | null>(null);

  const submit = () => {
    if (!name.trim()) { setFormError('请填写供应商名称'); return; }
    const lt = Number(leadTimeDays);
    if (!Number.isInteger(lt) || lt < 0 || lt > 365) {
      setFormError('交货周期需为 0 ~ 365 之间的整数天'); return;
    }
    setFormError(null);
    onSubmit({
      name: name.trim(),
      code: code.trim() || undefined,
      contactName: contactName.trim() || undefined,
      contactPhone: contactPhone.trim() || undefined,
      category: category.trim() || undefined,
      grade,
      paymentTerms: paymentTerms.trim() || undefined,
      leadTimeDays: lt,
    });
  };

  return (
    <div style={{ ...panelStyle, background: 'var(--bg-row-hover)', gap: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>新建供应商</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <label style={labelStyle}>
          供应商名称 *
          <input style={inputStyle} value={name} placeholder="例如：华东电子元件厂"
            onChange={(e) => setName(e.target.value)} />
        </label>
        <label style={labelStyle}>
          供应商编码
          <input style={inputStyle} value={code} placeholder="留空自动生成"
            onChange={(e) => setCode(e.target.value)} />
        </label>
        <label style={labelStyle}>
          联系人
          <input style={inputStyle} value={contactName} onChange={(e) => setContactName(e.target.value)} />
        </label>
        <label style={labelStyle}>
          联系电话
          <input style={inputStyle} value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
        </label>
        <label style={labelStyle}>
          主营类目
          <input style={inputStyle} value={category} placeholder="与商品 category 对齐"
            onChange={(e) => setCategory(e.target.value)} />
        </label>
        <label style={labelStyle}>
          等级
          <select style={inputStyle} value={grade} onChange={(e) => setGrade(e.target.value as SupplierGrade)}>
            {GRADE_OPTIONS.map((g) => <option key={g} value={g}>{g} 级</option>)}
          </select>
        </label>
        <label style={labelStyle}>
          账期
          <input style={inputStyle} value={paymentTerms} placeholder="net30 / 月结 / 款到发货"
            onChange={(e) => setPaymentTerms(e.target.value)} />
        </label>
        <label style={labelStyle}>
          交货周期（天）
          <input style={inputStyle} type="number" value={leadTimeDays}
            onChange={(e) => setLeadTimeDays(e.target.value)} />
        </label>
      </div>
      {formError && (
        <div style={{ fontSize: 11, color: 'var(--danger-500, #ef4444)' }}>{formError}</div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button size="sm" onClick={submit} disabled={submitting}>
          {submitting ? '提交中…' : '创建'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={submitting}>取消</Button>
      </div>
    </div>
  );
}

/** 到货入库表单：逐行填写实收 / 合格数量 */
function ReceiveForm({
  order, submitting, onSubmit, onCancel,
}: {
  order: PurchaseOrder;
  submitting: boolean;
  onSubmit: (rows: Array<{ purchaseItemId: string; receivedQuantity: number; qualifiedQuantity: number }>) => void;
  onCancel: () => void;
}) {
  const items = order.items || [];
  const [rows, setRows] = useState<Record<string, { received: string; qualified: string }>>(() => {
    const init: Record<string, { received: string; qualified: string }> = {};
    for (const it of items) {
      const remain = Math.max(0, it.quantity - it.receivedQuantity);
      init[it.id] = { received: String(remain), qualified: String(remain) };
    }
    return init;
  });
  const [formError, setFormError] = useState<string | null>(null);

  const setField = (id: string, key: 'received' | 'qualified', v: string) => {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], [key]: v } }));
  };

  const submit = () => {
    const payload: Array<{ purchaseItemId: string; receivedQuantity: number; qualifiedQuantity: number }> = [];
    for (const it of items) {
      const r = rows[it.id];
      if (!r) continue;
      const received = Number(r.received);
      const qualified = Number(r.qualified);
      if (!Number.isFinite(received) || received < 0) {
        setFormError(`${it.productName || it.sku || it.productId}：实收数量非法`); return;
      }
      if (received === 0) continue;
      if (!Number.isFinite(qualified) || qualified < 0 || qualified > received) {
        setFormError(`${it.productName || it.sku || it.productId}：合格数量不能超过实收数量`); return;
      }
      if (received + it.receivedQuantity > it.quantity) {
        setFormError(`${it.productName || it.sku || it.productId}：累计实收超过订购数量`); return;
      }
      payload.push({ purchaseItemId: it.id, receivedQuantity: received, qualifiedQuantity: qualified });
    }
    if (payload.length === 0) { setFormError('请至少填写一行实收数量'); return; }
    setFormError(null);
    onSubmit(payload);
  };

  return (
    <div style={{ ...panelStyle, background: 'var(--bg-row-hover)', gap: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
        到货入库 · {order.poNo}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>商品</th>
              <th style={thStyle}>订购</th>
              <th style={thStyle}>已收</th>
              <th style={thStyle}>本次实收</th>
              <th style={thStyle}>其中合格</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td style={tdStyle}>
                  <div>{it.productName || '—'}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{it.sku || it.productId}</div>
                </td>
                <td style={tdStyle}>{formatInt(it.quantity)}</td>
                <td style={tdStyle}>{formatInt(it.receivedQuantity)}</td>
                <td style={tdStyle}>
                  <input style={{ ...inputStyle, width: 80 }} type="number"
                    value={rows[it.id]?.received ?? '0'}
                    onChange={(e) => setField(it.id, 'received', e.target.value)} />
                </td>
                <td style={tdStyle}>
                  <input style={{ ...inputStyle, width: 80 }} type="number"
                    value={rows[it.id]?.qualified ?? '0'}
                    onChange={(e) => setField(it.id, 'qualified', e.target.value)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        仅合格数量计入库存并参与采购加权均价核算；不合格部分计入到货量但不入库。
      </div>
      {formError && <div style={{ fontSize: 11, color: 'var(--danger-500, #ef4444)' }}>{formError}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button size="sm" onClick={submit} disabled={submitting}>
          {submitting ? '入库中…' : '确认入库'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={submitting}>取消</Button>
      </div>
    </div>
  );
}

// ─────────────── 主组件 ───────────────

export default function ProcurementHub() {
  const [tab, setTab] = useState<TabKey>('overview');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 总览
  const [overview, setOverview] = useState<ProcurementOverview | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);

  // 采购单
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [orderStatusFilter, setOrderStatusFilter] = useState<POStatus | ''>('');
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [expandedOrder, setExpandedOrder] = useState<PurchaseOrder | null>(null);
  const [receivingOrder, setReceivingOrder] = useState<PurchaseOrder | null>(null);

  // 供应商
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierKeyword, setSupplierKeyword] = useState('');
  const [supplierStatusFilter, setSupplierStatusFilter] = useState<SupplierStatus | ''>('');
  const [loadingSuppliers, setLoadingSuppliers] = useState(false);
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [performance, setPerformance] = useState<SupplierPerformance[]>([]);

  // 补货建议
  const [suggestions, setSuggestions] = useState<ReplenishSuggestion[]>([]);
  const [coverDays, setCoverDays] = useState('30');
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());

  // ── 数据加载 ──

  const loadOverview = useCallback(async () => {
    setLoadingOverview(true);
    try {
      setOverview(await procurementApi.getOverview());
      setError(null);
    } catch (e) {
      setError(`加载采购总览失败：${errMsg(e)}`);
    } finally {
      setLoadingOverview(false);
    }
  }, []);

  const loadOrders = useCallback(async () => {
    setLoadingOrders(true);
    try {
      const r = await procurementApi.listPurchaseOrders({
        status: orderStatusFilter || undefined,
        limit: 50,
      });
      setOrders(r.items);
      setError(null);
    } catch (e) {
      setError(`加载采购单失败：${errMsg(e)}`);
    } finally {
      setLoadingOrders(false);
    }
  }, [orderStatusFilter]);

  const loadSuppliers = useCallback(async () => {
    setLoadingSuppliers(true);
    try {
      const r = await procurementApi.listSuppliers({
        keyword: supplierKeyword.trim() || undefined,
        status: supplierStatusFilter || undefined,
        limit: 50,
      });
      setSuppliers(r.items);
      setError(null);
    } catch (e) {
      setError(`加载供应商失败：${errMsg(e)}`);
    } finally {
      setLoadingSuppliers(false);
    }
  }, [supplierKeyword, supplierStatusFilter]);

  const loadPerformance = useCallback(async () => {
    try {
      setPerformance(await procurementApi.getSupplierPerformance());
    } catch (e) {
      // 绩效为增强信息，失败不阻塞台账展示
      setPerformance([]);
    }
  }, []);

  const loadSuggestions = useCallback(async () => {
    setLoadingSuggestions(true);
    try {
      const cd = Number(coverDays);
      const r = await procurementApi.getReplenishSuggestions({
        coverDays: Number.isFinite(cd) && cd > 0 ? cd : undefined,
        limit: 50,
      });
      setSuggestions(r.suggestions);
      setSelectedProducts(new Set());
      setError(null);
    } catch (e) {
      setError(`加载补货建议失败：${errMsg(e)}`);
    } finally {
      setLoadingSuggestions(false);
    }
  }, [coverDays]);

  useEffect(() => { void loadOverview(); }, [loadOverview]);
  useEffect(() => { if (tab === 'orders') void loadOrders(); }, [tab, loadOrders]);
  useEffect(() => {
    if (tab === 'suppliers') { void loadSuppliers(); void loadPerformance(); }
  }, [tab, loadSuppliers, loadPerformance]);
  useEffect(() => { if (tab === 'replenish') void loadSuggestions(); }, [tab, loadSuggestions]);

  // ── 操作 ──

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 3000);
  };

  const handleTransition = async (order: PurchaseOrder, target: POStatus) => {
    setSubmitting(true);
    try {
      await procurementApi.transitionStatus(order.id, target);
      flash(`${order.poNo} 已流转至「${PO_STATUS_LABEL[target]}」`);
      await loadOrders();
      await loadOverview();
      setError(null);
    } catch (e) {
      setError(`状态流转失败：${errMsg(e)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReceive = async (
    rows: Array<{ purchaseItemId: string; receivedQuantity: number; qualifiedQuantity: number }>
  ) => {
    if (!receivingOrder) return;
    setSubmitting(true);
    try {
      await procurementApi.receive(receivingOrder.id, { items: rows });
      flash(`${receivingOrder.poNo} 入库成功，库存已更新`);
      setReceivingOrder(null);
      await loadOrders();
      await loadOverview();
      setError(null);
    } catch (e) {
      setError(`入库失败：${errMsg(e)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const openOrderDetail = async (order: PurchaseOrder) => {
    if (expandedOrder?.id === order.id) { setExpandedOrder(null); return; }
    try {
      setExpandedOrder(await procurementApi.getPurchaseOrder(order.id));
    } catch (e) {
      setError(`加载采购单明细失败：${errMsg(e)}`);
    }
  };

  const openReceive = async (order: PurchaseOrder) => {
    try {
      setReceivingOrder(await procurementApi.getPurchaseOrder(order.id));
    } catch (e) {
      setError(`加载采购单明细失败：${errMsg(e)}`);
    }
  };

  const handleCreateSupplier = async (input: SupplierInput) => {
    setSubmitting(true);
    try {
      await procurementApi.createSupplier(input);
      flash(`供应商「${input.name}」创建成功`);
      setShowSupplierForm(false);
      await loadSuppliers();
      setError(null);
    } catch (e) {
      setError(`创建供应商失败：${errMsg(e)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleArchiveSupplier = async (s: Supplier) => {
    setSubmitting(true);
    try {
      await procurementApi.deleteSupplier(s.id);
      flash(`供应商「${s.name}」已归档`);
      await loadSuppliers();
      setError(null);
    } catch (e) {
      setError(`归档失败：${errMsg(e)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleProduct = (productId: string) => {
    setSelectedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const handleConvert = async () => {
    if (selectedProducts.size === 0) return;
    setSubmitting(true);
    try {
      const r = await procurementApi.convertSuggestions(Array.from(selectedProducts), {
        coverDays: Number(coverDays) || undefined,
      });
      flash(`已生成 ${r.createdCount} 张采购单`);
      await loadSuggestions();
      await loadOverview();
      setError(null);
    } catch (e) {
      setError(`转采购单失败：${errMsg(e)}`);
    } finally {
      setSubmitting(false);
    }
  };

  // ── 派生数据 ──

  const perfMap = useMemo(() => {
    const m = new Map<string, SupplierPerformance>();
    for (const p of performance) m.set(p.supplierId, p);
    return m;
  }, [performance]);

  const selectedCost = useMemo(
    () => suggestions
      .filter((s) => selectedProducts.has(s.productId))
      .reduce((sum, s) => sum + s.estimatedCost, 0),
    [suggestions, selectedProducts]
  );

  // ── 渲染 ──

  return (
    <div style={pageStyle}>
      {/* 标题栏 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>采购供应链</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            供应商台账 · 采购单流转 · 到货入库 · 补货建议，打通「采购 → 到货 → 入库」链路
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => {
          void loadOverview();
          if (tab === 'orders') void loadOrders();
          if (tab === 'suppliers') { void loadSuppliers(); void loadPerformance(); }
          if (tab === 'replenish') void loadSuggestions();
        }}>
          刷新
        </Button>
      </div>

      {error && (
        <div style={{
          padding: '8px 12px', fontSize: 12, borderRadius: 6,
          background: 'var(--danger-50, #fef2f2)', color: 'var(--danger-500, #ef4444)',
          border: '1px solid var(--danger-500, #ef4444)',
        }}>
          {error}
        </div>
      )}
      {notice && (
        <div style={{
          padding: '8px 12px', fontSize: 12, borderRadius: 6,
          background: 'var(--success-50, #f0fdf4)', color: 'var(--success-500, #22c55e)',
          border: '1px solid var(--success-500, #22c55e)',
        }}>
          {notice}
        </div>
      )}

      {/* Tab 栏 */}
      <div style={tabBarStyle}>
        {TABS.map((t) => (
          <button key={t.key} style={tabStyle(tab === t.key)} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ═══════════ 总览 ═══════════ */}
      {tab === 'overview' && (
        <>
          <div style={statGridStyle}>
            <StatCard
              label="采购单总数"
              value={formatInt(overview?.purchaseOrders.total || 0)}
              sub={`草稿 ${overview?.purchaseOrders.draft || 0} · 已完成 ${overview?.purchaseOrders.completed || 0}`}
            />
            <StatCard
              label="待审批"
              value={formatInt(overview?.purchaseOrders.pendingApproval || 0)}
              tone={overview && overview.purchaseOrders.pendingApproval > 0 ? 'warning' : 'default'}
              sub="提交后等待管理者批准"
            />
            <StatCard
              label="进行中（已批准 / 到货中）"
              value={formatInt(overview?.purchaseOrders.inProgress || 0)}
              tone="info"
              sub="占用在途资金，需跟踪到货"
            />
            <StatCard
              label="采购总金额"
              value={formatMoney(overview?.purchaseOrders.totalAmount || 0)}
              sub={`合作供应商 ${overview?.suppliers.active || 0} / ${overview?.suppliers.total || 0}`}
            />
          </div>

          <div style={panelStyle}>
            <div style={sectionTitleStyle}>
              今日要处理 · 逾期未到货
              {overview && overview.overdueOrders.length > 0 && (
                <Badge variant="danger">{overview.overdueOrders.length}</Badge>
              )}
            </div>
            {loadingOverview ? (
              <div style={emptyStyle}>加载中…</div>
            ) : !overview || overview.overdueOrders.length === 0 ? (
              <div style={emptyStyle}>没有逾期采购单，供应链节奏正常</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>采购单号</th>
                      <th style={thStyle}>供应商</th>
                      <th style={thStyle}>约定到货</th>
                      <th style={thStyle}>逾期天数</th>
                      <th style={thStyle}>金额</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.overdueOrders.map((o) => (
                      <tr key={o.id}>
                        <td style={tdStyle}>{o.poNo}</td>
                        <td style={tdStyle}>{o.supplierName || '—'}</td>
                        <td style={tdStyle}>{formatDate(o.expectedDate)}</td>
                        <td style={{ ...tdStyle, color: 'var(--danger-500, #ef4444)', fontWeight: 600 }}>
                          逾期 {o.overdueDays} 天
                        </td>
                        <td style={tdStyle}>{formatMoney(o.totalAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ═══════════ 采购单 ═══════════ */}
      {tab === 'orders' && (
        <div style={panelStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={sectionTitleStyle}>采购单列表</div>
            <select
              style={inputStyle}
              value={orderStatusFilter}
              onChange={(e) => setOrderStatusFilter(e.target.value as POStatus | '')}
            >
              <option value="">全部状态</option>
              {PO_STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{PO_STATUS_LABEL[s]}</option>
              ))}
            </select>
          </div>

          {receivingOrder && (
            <ReceiveForm
              order={receivingOrder}
              submitting={submitting}
              onSubmit={handleReceive}
              onCancel={() => setReceivingOrder(null)}
            />
          )}

          {loadingOrders ? (
            <div style={emptyStyle}>加载中…</div>
          ) : orders.length === 0 ? (
            <div style={emptyStyle}>暂无采购单，可从「补货建议」一键生成</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>采购单号</th>
                    <th style={thStyle}>供应商</th>
                    <th style={thStyle}>状态</th>
                    <th style={thStyle}>金额</th>
                    <th style={thStyle}>已入库金额</th>
                    <th style={thStyle}>约定到货</th>
                    <th style={thStyle}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <Fragment key={o.id}>
                      <tr>
                        <td style={tdStyle}>
                          <button
                            style={{
                              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                              color: 'var(--text-link, #4f46e5)', fontSize: 12,
                            }}
                            onClick={() => void openOrderDetail(o)}
                          >
                            {o.poNo}
                          </button>
                        </td>
                        <td style={tdStyle}>{o.supplierName || '—'}</td>
                        <td style={tdStyle}>
                          <Badge variant={poStatusVariant(o.status)}>{PO_STATUS_LABEL[o.status]}</Badge>
                        </td>
                        <td style={tdStyle}>{formatMoney(o.totalAmount)}</td>
                        <td style={tdStyle}>{formatMoney(o.receivedAmount)}</td>
                        <td style={tdStyle}>{formatDate(o.expectedDate)}</td>
                        <td style={tdStyle}>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {NEXT_STATUS[o.status].map((t) => (
                              <Button
                                key={t}
                                size="sm"
                                variant={t === 'cancelled' ? 'ghost' : 'secondary'}
                                disabled={submitting}
                                onClick={() => void handleTransition(o, t)}
                              >
                                {PO_STATUS_LABEL[t]}
                              </Button>
                            ))}
                            {(o.status === 'approved' || o.status === 'receiving') && (
                              <Button size="sm" disabled={submitting} onClick={() => void openReceive(o)}>
                                入库
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {expandedOrder?.id === o.id && (
                        <tr>
                          <td style={{ ...tdStyle, background: 'var(--bg-row-hover)' }} colSpan={7}>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                              采购明细
                            </div>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                              <thead>
                                <tr>
                                  <th style={thStyle}>商品</th>
                                  <th style={thStyle}>订购</th>
                                  <th style={thStyle}>已收 / 合格</th>
                                  <th style={thStyle}>单价</th>
                                  <th style={thStyle}>小计</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(expandedOrder.items || []).map((it: PurchaseItem) => (
                                  <tr key={it.id}>
                                    <td style={tdStyle}>
                                      <div>{it.productName || '—'}</div>
                                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                        {it.sku || it.productId}
                                      </div>
                                    </td>
                                    <td style={tdStyle}>{formatInt(it.quantity)}</td>
                                    <td style={tdStyle}>
                                      {formatInt(it.receivedQuantity)} / {formatInt(it.qualifiedQuantity)}
                                    </td>
                                    <td style={tdStyle}>{formatMoney(it.unitPrice)}</td>
                                    <td style={tdStyle}>{formatMoney(it.subtotal)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══════════ 供应商 ═══════════ */}
      {tab === 'suppliers' && (
        <div style={panelStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div style={sectionTitleStyle}>供应商台账</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                style={{ ...inputStyle, width: 160 }}
                placeholder="搜索名称 / 编码 / 联系人"
                value={supplierKeyword}
                onChange={(e) => setSupplierKeyword(e.target.value)}
              />
              <select
                style={inputStyle}
                value={supplierStatusFilter}
                onChange={(e) => setSupplierStatusFilter(e.target.value as SupplierStatus | '')}
              >
                <option value="">全部状态</option>
                {SUPPLIER_STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{SUPPLIER_STATUS_LABEL[s]}</option>
                ))}
              </select>
              <Button size="sm" onClick={() => setShowSupplierForm((v) => !v)}>
                {showSupplierForm ? '收起' : '新建供应商'}
              </Button>
            </div>
          </div>

          {showSupplierForm && (
            <SupplierForm
              submitting={submitting}
              onSubmit={handleCreateSupplier}
              onCancel={() => setShowSupplierForm(false)}
            />
          )}

          {loadingSuppliers ? (
            <div style={emptyStyle}>加载中…</div>
          ) : suppliers.length === 0 ? (
            <div style={emptyStyle}>暂无供应商，点击「新建供应商」开始建档</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>供应商</th>
                    <th style={thStyle}>等级</th>
                    <th style={thStyle}>联系人</th>
                    <th style={thStyle}>账期 / 交期</th>
                    <th style={thStyle}>累计采购额</th>
                    <th style={thStyle}>交付达成</th>
                    <th style={thStyle}>综合评分</th>
                    <th style={thStyle}>状态</th>
                    <th style={thStyle}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {suppliers.map((s) => {
                    const p = perfMap.get(s.id);
                    return (
                      <tr key={s.id}>
                        <td style={tdStyle}>
                          <div>{s.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.code || '—'}</div>
                        </td>
                        <td style={tdStyle}>
                          <Badge variant={gradeVariant(s.grade)}>{s.grade}</Badge>
                        </td>
                        <td style={tdStyle}>
                          <div>{s.contactName || '—'}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.contactPhone || ''}</div>
                        </td>
                        <td style={tdStyle}>{s.paymentTerms || '—'} / {s.leadTimeDays} 天</td>
                        <td style={tdStyle}>{formatMoney(s.totalPurchaseAmount)}</td>
                        <td style={tdStyle}>
                          {p ? `${formatPct(p.onTimeRate)}（${p.completedOrders}/${p.totalOrders} 单）` : '—'}
                        </td>
                        <td style={tdStyle} title={p?.formula}>
                          {p ? p.score.toFixed(2) : '—'}
                        </td>
                        <td style={tdStyle}>
                          <Badge variant={s.status === 'active' ? 'success' : s.status === 'suspended' ? 'warning' : 'neutral'}>
                            {SUPPLIER_STATUS_LABEL[s.status]}
                          </Badge>
                        </td>
                        <td style={tdStyle}>
                          {s.status !== 'archived' && (
                            <Button size="sm" variant="ghost" disabled={submitting}
                              onClick={() => void handleArchiveSupplier(s)}>
                              归档
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
                综合评分口径：score = 交期达成率×0.4 + 订单完成率×0.3 + 质检合格率×0.3
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════ 补货建议 ═══════════ */}
      {tab === 'replenish' && (
        <div style={panelStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div style={sectionTitleStyle}>补货建议</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <label style={labelStyle}>
                覆盖天数
                <input style={{ ...inputStyle, width: 80 }} type="number" value={coverDays}
                  onChange={(e) => setCoverDays(e.target.value)} />
              </label>
              <Button size="sm" variant="secondary" onClick={() => void loadSuggestions()}>
                重新测算
              </Button>
              <Button size="sm" disabled={submitting || selectedProducts.size === 0}
                onClick={() => void handleConvert()}>
                转采购单（{selectedProducts.size}）
              </Button>
            </div>
          </div>

          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            建议量口径：max(0, ceil(日均销量 × 覆盖天数) − 当前库存)；转单时按供应商分组，一供应商一单。
            {selectedProducts.size > 0 && (
              <span style={{ marginLeft: 8, color: 'var(--text-primary)', fontWeight: 600 }}>
                已选预估金额 {formatMoney(selectedCost)}
              </span>
            )}
          </div>

          {loadingSuggestions ? (
            <div style={emptyStyle}>测算中…</div>
          ) : suggestions.length === 0 ? (
            <div style={emptyStyle}>当前库存充足，没有需要补货的商品</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>
                      <input
                        type="checkbox"
                        checked={selectedProducts.size === suggestions.length && suggestions.length > 0}
                        onChange={(e) => {
                          setSelectedProducts(
                            e.target.checked ? new Set(suggestions.map((s) => s.productId)) : new Set()
                          );
                        }}
                      />
                    </th>
                    <th style={thStyle}>商品</th>
                    <th style={thStyle}>当前库存</th>
                    <th style={thStyle}>日均销量</th>
                    <th style={thStyle}>建议补货</th>
                    <th style={thStyle}>预估金额</th>
                    <th style={thStyle}>建议供应商</th>
                    <th style={thStyle}>原因</th>
                  </tr>
                </thead>
                <tbody>
                  {suggestions.map((s) => (
                    <tr key={s.productId}>
                      <td style={tdStyle}>
                        <input
                          type="checkbox"
                          checked={selectedProducts.has(s.productId)}
                          onChange={() => toggleProduct(s.productId)}
                        />
                      </td>
                      <td style={tdStyle}>
                        <div>{s.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.sku || s.productId}</div>
                      </td>
                      <td style={{
                        ...tdStyle,
                        color: s.currentStock === 0 ? 'var(--danger-500, #ef4444)' : undefined,
                        fontWeight: s.currentStock === 0 ? 600 : undefined,
                      }}>
                        {formatInt(s.currentStock)}
                      </td>
                      <td style={tdStyle}>{s.dailySalesAvg.toFixed(2)}</td>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{formatInt(s.suggestedQty)}</td>
                      <td style={tdStyle}>{formatMoney(s.estimatedCost)}</td>
                      <td style={tdStyle}>{s.supplierName || '未绑定'}</td>
                      <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{s.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
