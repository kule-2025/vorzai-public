/**
 * 业务链视图 — 打通传统电商、直播电商、新媒体电商、跨境电商及企业业务链
 * 覆盖：立项(OGSM) → 选品 → 组盘 → 订单 → 客服 五阶段闭环
 */
import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '@api/client';
import { Badge } from '@components/Common/Badge';
import { Button } from '@components/Common/Button';
import { Input } from '@components/Common/Input';
import { useToast } from '@components/Common/Toast';
import { Select } from '@components/Common/Select';

// ─── 全链路节点数据 — 从 cockpit API 加载真实数据 ───
interface ChainNode {
  id: string;
  label: string;
  status: 'normal' | 'warning' | 'error' | 'disabled';
  metrics: { label: string; value: string }[];
  children?: ChainNode[];
}

const STATUS_STYLES: Record<string, { dot: string }> = {
  normal: { dot: 'var(--success-500)' },
  warning: { dot: 'var(--warning-500)' },
  error: { dot: 'var(--danger-500)' },
  disabled: { dot: 'var(--text-muted)' },
};

// ─── 类型定义 ───
interface Assortment {
  id: string; name: string; description: string; category: string;
  products: { productId: string; quantity: number; unitPrice: number }[];
  grossMargin: number; totalValue: number;
  stockStatus: 'sufficient' | 'low' | 'insufficient';
  status: 'draft' | 'active' | 'archived';
  createdAt: string; updatedAt: string;
}

interface ServiceTicket {
  id: string; ticketNo: string; status: string; subject: string;
  priority: string; assignedTo?: string; assignedName?: string;
  category: string; channel: string; messageCount: number; lastMessage?: string;
  customerName?: string;
}

// ─── 通用样式 ───
const panelStyle: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-card)', padding: 16, marginTop: 16,
};
const panelTitleStyle: React.CSSProperties = {
  fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12,
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
};
const gridStyle: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12,
};
const cardBodyStyle: React.CSSProperties = { padding: 12, display: 'flex', flexDirection: 'column', gap: 6 };
const toolBarStyle: React.CSSProperties = {
  display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center',
};

function StatusBadge({ text, variant }: { text: string; variant?: 'success' | 'warning' | 'danger' | 'info' | 'neutral' }) {
  if (variant) return <Badge variant={variant}>{text}</Badge>;
  const map: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
    open: 'info', in_progress: 'warning', waiting_customer: 'warning',
    escalated: 'danger', closed: 'neutral',
    draft: 'neutral', active: 'success', archived: 'neutral',
    sufficient: 'success', low: 'warning', insufficient: 'danger',
    candidate: 'neutral', selected: 'success', listed: 'info',
    planning: 'neutral',
    pending: 'warning', confirmed: 'info', processing: 'info',
    shipped: 'info', delivered: 'info', completed: 'success',
    cancelled: 'danger', returned: 'warning', refunded: 'danger',
    unpaid: 'warning', paid: 'success',
  };
  const v = map[text] || 'neutral';
  return <Badge variant={v}>{text}</Badge>;
}

function PriorityBadge({ priority }: { priority: string }) {
  const map: Record<string, string> = { urgent: 'danger', high: 'warning', normal: 'info', low: 'neutral' };
  const v = map[priority] || 'neutral';
  return <Badge variant={v as any}>{priority}</Badge>;
}

export default function BusinessChain() {
  const toast = useToast();
  const [expanded, setExpanded] = useState<string[]>(['inventory']);
  const [activeScenario, setActiveScenario] = useState('all');
  const [searchParams, setSearchParams] = useSearchParams();
  const currentPhase = searchParams.get('phase') || 'project';
  const setPhase = (p: string) => setSearchParams({ phase: p });

  // 链路指标 — 从真实数据计算
  interface ChainMetric { label: string; value: string; trend: string }
  const [chainMetrics, setChainMetrics] = useState<ChainMetric[]>([]);
  const [chainMetricLoading, setChainMetricLoading] = useState(false);

  const loadChainMetrics = useCallback(async () => {
    setChainMetricLoading(true);
    try {
      const [kpiRes, statsRes] = await Promise.all([
        api.cockpit.getOverview(),
        api.business.getOrderStats(),
      ]);
      const kpi = (kpiRes as any).data?.kpi || {};
      const stats = (statsRes as any).data || {};
      const totalOrders = Number(stats.total_orders || 0);
      const paidOrders = Number(stats.paid_revenue > 0 ? stats.total_orders : 0);
      const gmv = Number(stats.net_gmv || 0) || Number(kpi.todayGmv || 0);
      const fulfillmentRate = totalOrders > 0 ? ((paidOrders / totalOrders) * 100).toFixed(1) : '—';
      const avgOrderValue = totalOrders > 0 ? `¥${(Number(stats.avg_order_value || 0)).toFixed(0)}` : '—';
      const lowStockSku = Number(kpi.lowStockSkuCount || 0);

      // 营销 ROI：从投流数据汇总
      let marketingRoi = '—';
      try {
        const adRes = await api.business.getAdSpendSummary();
        const adData = (adRes as any).data;
        if (adData && adData.totalSpend > 0) {
          marketingRoi = `${adData.overallRoi.toFixed(2)}x`;
        }
      } catch (e: any) {
        // 投流数据加载失败不影响主流程
        console.warn('[BusinessChain] 投流数据加载失败:', e?.message);
      }

      setChainMetrics([
        { label: '今日营收', value: `¥${gmv.toLocaleString()}`, trend: '今日数据' },
        { label: '订单履约率', value: `${fulfillmentRate}%`, trend: `共 ${totalOrders} 单` },
        { label: '库存预警', value: String(lowStockSku), trend: lowStockSku > 5 ? '↑ 关注' : '↓ 健康' },
        { label: '平均客单价', value: avgOrderValue, trend: totalOrders > 0 ? '本期' : '—' },
        { label: '活跃订单', value: String(Number(kpi.activeOrderCount || 0)), trend: '在途' },
        { label: '营销 ROI', value: marketingRoi, trend: marketingRoi !== '—' ? '本期' : '暂无数据' },
      ]);
    } catch (e: any) {
      // 加载链路指标失败，保持空状态
      console.error('[BusinessChain] 加载链路指标失败:', e?.message);
      setChainMetrics([]);
    } finally {
      setChainMetricLoading(false);
    }
  }, []);

  useEffect(() => { loadChainMetrics(); }, [loadChainMetrics]);

  const phases = [
    { id: 'project', label: '立项' },
    { id: 'select', label: '选品' },
    { id: 'package', label: '组盘' },
    { id: 'order', label: '订单' },
    { id: 'service', label: '客服' },
  ];

  const toggleExpand = (id: string) => setExpanded((prev) => prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]);

  const scenarios = [
    { id: 'all', label: '全链路' },
    { id: 'platform', label: '平台电商' },
    { id: 'live', label: '直播电商' },
    { id: 'social', label: '社交电商' },
    { id: 'cross', label: '跨境电商' },
    { id: 'independent', label: '独立站' },
  ];

  // ──────────────────── 各阶段状态 ────────────────────
  // Project — GM-04: 立项阶段展示真实业务项目（projects 表），而非 OGSM 目标
  const [projects, setProjects] = useState<any[]>([]);
  const [projectLoading, setProjectLoading] = useState(false);
  const [projectKeyword, setProjectKeyword] = useState('');
  const [projectStatus, setProjectStatus] = useState('');

  const loadProjects = useCallback(async () => {
    setProjectLoading(true);
    try {
      const res = await api.business.listProjects({
        status: projectStatus || undefined,
        keyword: projectKeyword || undefined,
        limit: 20,
      });
      setProjects((res.data as any[]) || []);
    } catch (e) {
      console.error('[BusinessChain] 加载项目失败:', e);
    } finally { setProjectLoading(false); }
  }, [projectKeyword, projectStatus]);

  // Select
  const [products, setProducts] = useState<any[]>([]);
  const [productLoading, setProductLoading] = useState(false);
  const [productKeyword, setProductKeyword] = useState('');
  const [productStatus, setProductStatus] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const [showScoreDialog, setShowScoreDialog] = useState(false);
  const [scoreValue, setScoreValue] = useState(80);

  // Package
  const [assortments, setAssortments] = useState<Assortment[]>([]);
  const [assLoading, setAssLoading] = useState(false);
  const [assStatus, setAssStatus] = useState('');
  const [assCategory, setAssCategory] = useState('');
  const [showAssDialog, setShowAssDialog] = useState(false);
  const [showAssProductDialog, setShowAssProductDialog] = useState(false);
  const [selectedAssortment, setSelectedAssortment] = useState<Assortment | null>(null);
  const [assForm, setAssForm] = useState({ name: '', description: '', category: 'daily' });
  const [addProductForm, setAddProductForm] = useState({ productId: '', quantity: 1, unitPrice: 0 });

  // Order
  const [orders, setOrders] = useState<any[]>([]);
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderStatus, setOrderStatus] = useState('');
  const [orderKeyword, setOrderKeyword] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  // 收款登记（P0：打通 paid_amount 写入链路，Analytics 营收/毛利依赖此字段）
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('');
  const [paySubmitting, setPaySubmitting] = useState(false);
  const [payError, setPayError] = useState('');

  // Service
  const [tickets, setTickets] = useState<ServiceTicket[]>([]);
  const [ticketLoading, setTicketLoading] = useState(false);
  const [ticketStatus, setTicketStatus] = useState('');
  const [ticketPriority, setTicketPriority] = useState('');
  const [selectedTicket, setSelectedTicket] = useState<ServiceTicket | null>(null);
  const [ticketMessages, setTicketMessages] = useState<any[]>([]);
  const [replyContent, setReplyContent] = useState('');

  // Chain nodes — 从 cockpit API 加载
  const [chainNodes, setChainNodes] = useState<ChainNode[]>([]);
  const [chainLoading, setChainLoading] = useState(false);

  // ──────────────────── 数据加载 ────────────────────

  const loadProducts = useCallback(async () => {
    setProductLoading(true);
    try {
      const res = await api.business.listProducts({
        status: productStatus || undefined, keyword: productKeyword || undefined, limit: 20,
      });
      setProducts((res.data as any[]) || []);
    } catch (e) {
      console.error('[BusinessChain] 加载选品失败:', e);
    } finally { setProductLoading(false); }
  }, [productStatus, productKeyword]);

  const loadAssortments = useCallback(async () => {
    setAssLoading(true);
    try {
      const res = await api.business.getAssortments({
        status: assStatus || undefined, category: assCategory || undefined, limit: 20,
      });
      setAssortments((res.data as Assortment[]) || []);
    } catch (e) {
      console.error('[BusinessChain] 加载组盘失败:', e);
    } finally { setAssLoading(false); }
  }, [assStatus, assCategory]);

  const loadOrders = useCallback(async () => {
    setOrderLoading(true);
    try {
      const res = await api.business.listOrders({
        status: orderStatus || undefined, keyword: orderKeyword || undefined, limit: 20,
      });
      setOrders((res.data as any[]) || []);
    } catch (e) {
      console.error('[BusinessChain] 加载订单失败:', e);
    } finally { setOrderLoading(false); }
  }, [orderStatus, orderKeyword]);

  /**
   * 登记收款/退款。正数=收款，负数=退款。
   * 后端按累计实收自动推导 payment_status（unpaid/partial/paid/refunded），
   * 结清时自动把 pending 推进为 confirmed。这是 Analytics 营收与毛利的唯一数据来源。
   */
  const handleRecordPayment = useCallback(async () => {
    if (!selectedOrder) return;
    const amt = Number(payAmount);
    if (!Number.isFinite(amt) || amt === 0) {
      setPayError('请输入非零金额（正数收款 / 负数退款）');
      return;
    }
    setPaySubmitting(true);
    setPayError('');
    try {
      const res = await api.business.recordOrderPayment(selectedOrder.id, {
        amount: amt,
        paymentMethod: payMethod || undefined,
      });
      const updated = (res as any)?.data ?? res;
      if (updated && updated.id) {
        setSelectedOrder(updated);
        setOrders((prev) => prev.map((o: any) => (o.id === updated.id ? { ...o, ...updated } : o)));
      }
      setPayAmount('');
      await loadOrders();
    } catch (e: any) {
      setPayError(e?.message || '登记失败，请检查金额是否超出订单总额');
    } finally {
      setPaySubmitting(false);
    }
  }, [selectedOrder, payAmount, payMethod, loadOrders]);

  const loadTickets = useCallback(async () => {
    setTicketLoading(true);
    try {
      const res = await api.business.listTickets({
        status: ticketStatus || undefined, priority: ticketPriority || undefined, limit: 20,
      });
      setTickets((res.data as ServiceTicket[]) || []);
    } catch (e) {
      console.error('[BusinessChain] 加载工单失败:', e);
    } finally { setTicketLoading(false); }
  }, [ticketStatus, ticketPriority]);

  useEffect(() => { if (currentPhase === 'project') loadProjects(); }, [currentPhase, loadProjects]);
  useEffect(() => { if (currentPhase === 'select') loadProducts(); }, [currentPhase, loadProducts]);
  useEffect(() => { if (currentPhase === 'package') loadAssortments(); }, [currentPhase, loadAssortments]);
  useEffect(() => { if (currentPhase === 'order') loadOrders(); }, [currentPhase, loadOrders]);
  useEffect(() => { if (currentPhase === 'service') loadTickets(); }, [currentPhase, loadTickets]);

  // 加载全链路节点数据（从 cockpit API）
  const loadChainNodes = useCallback(async () => {
    setChainLoading(true);
    try {
      const res = await api.cockpit.getOverview();
      const overview = res.data as any;
      if (overview?.kpi) {
        setChainNodes([
          { id: 'sourcing', label: '选品', status: 'normal', metrics: [{ label: '商品数', value: String(overview.kpi.activeOrderCount || 0) }, { label: '本周上新', value: '—' }] },
          { id: 'procurement', label: '采购', status: 'normal', metrics: [{ label: '采购单', value: '—' }, { label: '待确认', value: '—' }] },
          { id: 'inventory', label: '库存', status: overview.kpi.lowStockSkuCount ? 'warning' : 'normal', metrics: [{ label: 'SKU 总数', value: '—' }, { label: '预警', value: String(overview.kpi.lowStockSkuCount || 0) }] },
          { id: 'marketing', label: '营销', status: 'normal', metrics: [{ label: '活动进行中', value: '—' }, { label: 'ROI', value: '—' }] },
          { id: 'order', label: '订单', status: overview.kpi.todayOrderCount > 0 ? 'normal' : 'warning', metrics: [{ label: '今日单量', value: String(overview.kpi.todayOrderCount || 0) }, { label: '待处理', value: '—' }] },
          { id: 'fulfillment', label: '履约', status: 'normal', metrics: [{ label: '发货延迟', value: '—' }, { label: '物流异常', value: '—' }] },
          { id: 'after-sale', label: '售后', status: overview.kpi.openTicketCount > 5 ? 'warning' : 'normal', metrics: [{ label: '待处理', value: String(overview.kpi.openTicketCount || 0) }, { label: '退款率', value: '—' }] },
        ]);
      }
    } catch (e) {
      console.error('[BusinessChain] 加载链路节点失败:', e);
      setChainNodes([]);
    } finally {
      setChainLoading(false);
    }
  }, []);

  useEffect(() => { loadChainNodes(); }, [loadChainNodes]);

  // ──────────────────── 操作 ────────────────────

  // Product: 评分
  const handleProductScore = async () => {
    if (!selectedProduct) return;
    try {
      await api.business.updateProductStatus(selectedProduct, {
        status: 'selected', selectionScore: scoreValue, selectionReason: '业务链选品评分',
      });
      setShowScoreDialog(false); setSelectedProduct(null); loadProducts();
    } catch (e) { toast.addToast('error', '评分失败', (e as Error).message); }
  };

  // Assortment: 创建
  const handleCreateAssortment = async () => {
    if (!assForm.name.trim()) return;
    try {
      const res = await api.business.createAssortment(assForm);
      if (res.data) setAssortments((prev) => [...prev, res.data as Assortment]);
      setShowAssDialog(false); setAssForm({ name: '', description: '', category: 'daily' });
    } catch (e) { toast.addToast('error', '创建组盘失败', (e as Error).message); }
  };

  // Assortment: 删除
  const handleDeleteAssortment = async (id: string) => {
    try {
      await api.business.deleteAssortment(id);
      setAssortments((prev) => prev.filter((a) => a.id !== id));
    } catch (e) { toast.addToast('error', '删除组盘失败', (e as Error).message); }
  };

  // Assortment: 添加商品
  const handleAddProductToAssortment = async () => {
    if (!selectedAssortment || !addProductForm.productId) return;
    try {
      await api.business.addProductToAssortment(selectedAssortment.id, {
        productId: addProductForm.productId, quantity: addProductForm.quantity, unitPrice: addProductForm.unitPrice,
      });
      setShowAssProductDialog(false); setSelectedAssortment(null);
      setAddProductForm({ productId: '', quantity: 1, unitPrice: 0 });
      loadAssortments();
    } catch (e) { toast.addToast('error', '添加商品失败', (e as Error).message); }
  };

  // Assortment: 移除商品
  const handleRemoveProduct = async (assortmentId: string, productId: string) => {
    try {
      await api.business.removeProductFromAssortment(assortmentId, productId);
      loadAssortments();
    } catch (e) { toast.addToast('error', '移除商品失败', (e as Error).message); }
  };

  // Ticket: 加载消息
  const loadTicketMessages = async (id: string) => {
    try {
      const res = await api.business.getTicket(id);
      const msgs = (res.data as any)?.messages;
      if (Array.isArray(msgs)) setTicketMessages(msgs);
      else setTicketMessages([]);
    } catch (e) { toast.addToast('error', '加载工单消息失败', (e as Error).message); }
  };

  // Ticket: 回复
  const handleReplyTicket = async () => {
    if (!selectedTicket || !replyContent.trim()) return;
    try {
      await api.business.addTicketMessage(selectedTicket.id, replyContent);
      setReplyContent('');
      loadTicketMessages(selectedTicket.id);
      loadTickets();
    } catch (e) { toast.addToast('error', '回复失败', (e as Error).message); }
  };

  // Ticket: 升级
  const handleEscalateTicket = async (ticket: ServiceTicket) => {
    try {
      await api.business.escalateTicket(ticket.id, '人工升级');
      loadTickets();
    } catch (e) { toast.addToast('error', '升级工单失败', (e as Error).message); }
  };

  // Ticket: 状态切换
  const handleUpdateTicketStatus = async (ticket: ServiceTicket, status: string) => {
    try {
      await api.business.updateTicketStatus(ticket.id, status);
      loadTickets();
    } catch (e) { toast.addToast('error', '状态更新失败', (e as Error).message); }
  };

  // ──────────────────── Phase Panels ────────────────────

  // Project Panel
  const renderProjectPanel = () => (
    <div style={panelStyle}>
      <div style={panelTitleStyle}>
        <span>业务项目看板</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <Input
            value={projectKeyword} onChange={(e) => setProjectKeyword(e.target.value)}
            placeholder="搜索项目..." addonLeft={<span style={{ fontSize: 12 }}>⌕</span>}
            style={{ width: 200, padding: '6px 10px' }}
          />
          <Button variant="ghost" size="sm" onClick={loadProjects}>刷新</Button>
        </div>
      </div>

      {/* 项目指标摘要 */}
      <div style={gridStyle}>
        {[
          { label: '项目总数', value: String(projects.length), delta: '' },
          { label: '进行中', value: String(projects.filter((p) => p.status === 'in_progress').length), delta: '' },
          { label: '已完成', value: String(projects.filter((p) => p.status === 'completed').length), delta: '' },
          { label: '计划中', value: String(projects.filter((p) => p.status === 'planning' || p.status === 'approved').length), delta: '' },
        ].map((s) => (
          <div key={s.label} className="card" style={{ padding: 12, textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>{s.value}</div>
            {s.delta && <div style={{ fontSize: 11, color: 'var(--success-500)', marginTop: 2 }}>{s.delta}</div>}
          </div>
        ))}
      </div>

      {/* 项目列表 */}
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 8 }}>项目列表</div>
        {projectLoading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>加载中...</div>
        ) : projects.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>暂无项目，请在 OGSM / 项目管理模块创建项目</div>
        ) : (
          projects.slice(0, 8).map((p) => (
            <div key={p.id} className="row row-hoverable" style={{ padding: '8px 12px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name || '未命名项目'}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {p.owner_name ? `负责人: ${p.owner_name}` : ''}
                  {p.department_name ? ` · ${p.department_name}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <StatusBadge text={p.status || 'planning'} />
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {p.productCount ? `${p.productCount}商品` : ''}
                  {p.orderCount ? ` · ${p.orderCount}单` : ''}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  // Select Panel
  const renderSelectPanel = () => (
    <div style={panelStyle}>
      <div style={panelTitleStyle}>
        <span>选品列表</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <Select
            options={[{ value: '', label: '全部状态' }, { value: 'candidate', label: '候选' }, { value: 'selected', label: '已选' }, { value: 'listed', label: '上架' }]}
            value={productStatus} onChange={(v) => setProductStatus(v)}
            placeholder="状态筛选" className="select-compact"
          />
          <Input
            value={productKeyword} onChange={(e) => setProductKeyword(e.target.value)}
            placeholder="搜索 SKU/名称..." addonLeft={<span style={{ fontSize: 12 }}>⌕</span>}
            style={{ width: 180, padding: '6px 10px' }}
          />
          <Button variant="ghost" size="sm" onClick={loadProducts}>刷新</Button>
        </div>
      </div>

      <div className="row" style={{ padding: '6px 12px', background: 'var(--bg-table-header)', fontSize: 11, color: 'var(--text-table-header)', fontWeight: 500, borderRadius: 6 }}>
        <span style={{ width: 100 }}>SKU</span>
        <span style={{ flex: 1 }}>名称</span>
        <span style={{ width: 70, textAlign: 'right' }}>成本</span>
        <span style={{ width: 70, textAlign: 'right' }}>售价</span>
        <span style={{ width: 60, textAlign: 'center' }}>库存</span>
        <span style={{ width: 70 }}>状态</span>
        <span style={{ width: 100 }}>操作</span>
      </div>

      {productLoading ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>加载中...</div>
      ) : products.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>暂无选品数据，请先在商品模块添加</div>
      ) : (
        products.slice(0, 10).map((p) => (
          <div key={p.id} className="row row-hoverable" style={{ padding: '8px 12px' }}>
            <span style={{ width: 100, fontSize: 11, color: 'var(--text-muted)' }}>{p.sku}</span>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
            <span style={{ width: 70, textAlign: 'right', fontSize: 12, color: 'var(--text-secondary)' }}>{p.cost_price ? `¥${p.cost_price}` : '-'}</span>
            <span style={{ width: 70, textAlign: 'right', fontSize: 12, color: 'var(--text-primary)' }}>{p.selling_price ? `¥${p.selling_price}` : '-'}</span>
            <span style={{ width: 60, textAlign: 'center', fontSize: 12, color: p.stock !== undefined ? 'var(--text-primary)' : 'var(--text-muted)' }}>{p.stock ?? '-'}</span>
            <span style={{ width: 70 }}><StatusBadge text={p.status || 'candidate'} /></span>
            <span style={{ width: 100 }}>
              <Button variant="ghost" size="sm" onClick={() => { setSelectedProduct(p.id); setScoreValue(p.selection_score || 80); setShowScoreDialog(true); }}>评分</Button>
            </span>
          </div>
        ))
      )}

      {/* 评分弹窗 */}
      {showScoreDialog && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card" style={{ width: 380, padding: 20, borderRadius: 12 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>选品评分</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>综合评分</span>
              <input
                type="range" min="0" max="100" value={scoreValue}
                onChange={(e) => setScoreValue(Number(e.target.value))}
                style={{ flex: 1, accentColor: 'var(--ecom-amber-500)' }}
              />
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ecom-amber-600)', minWidth: 32, textAlign: 'right' }}>{scoreValue}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>
              {scoreValue >= 80 ? '优质商品，建议选入' : scoreValue >= 60 ? '中等质量，酌情考虑' : '质量偏低，暂不推荐'}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button variant="ghost" size="sm" onClick={() => setShowScoreDialog(false)}>取消</Button>
              <Button size="sm" onClick={handleProductScore}>确认选品</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // Package Panel
  const renderPackagePanel = () => (
    <div style={panelStyle}>
      <div style={panelTitleStyle}>
        <span>组盘列表</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <Select
            options={[{ value: '', label: '全部状态' }, { value: 'draft', label: '草稿' }, { value: 'active', label: '活跃' }, { value: 'archived', label: '归档' }]}
            value={assStatus} onChange={(v) => setAssStatus(v)} placeholder="状态"
          />
          <Select
            options={[{ value: '', label: '全部分类' }, { value: 'live', label: '直播' }, { value: 'daily', label: '日常' }, { value: 'promo', label: '促销' }, { value: 'new_product', label: '新品' }]}
            value={assCategory} onChange={(v) => setAssCategory(v)} placeholder="分类"
          />
          <Button variant="ghost" size="sm" onClick={loadAssortments}>刷新</Button>
          <Button size="sm" onClick={() => { setAssForm({ name: '', description: '', category: 'daily' }); setShowAssDialog(true); }}>+ 新建组盘</Button>
        </div>
      </div>

      {assLoading ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>加载中...</div>
      ) : assortments.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>暂无组盘，点击上方"新建组盘"创建</div>
      ) : (
        <div style={gridStyle}>
          {assortments.map((a) => (
            <div key={a.id} className="card card-hoverable" style={{ padding: 12, cursor: 'pointer' }}
              onClick={() => { setSelectedAssortment(a); setShowAssProductDialog(true); }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{a.name}</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <StatusBadge text={a.status} />
                  <StatusBadge text={a.stockStatus} />
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.description}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 11, marginBottom: 8 }}>
                <span style={{ color: 'var(--text-secondary)' }}>SKU 数: <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{a.products.length}</span></span>
                <span style={{ color: 'var(--text-secondary)' }}>分类: <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{a.category}</span></span>
                <span style={{ color: 'var(--text-secondary)' }}>毛利: <span style={{ color: 'var(--success-500)', fontWeight: 500 }}>{a.grossMargin}%</span></span>
                <span style={{ color: 'var(--text-secondary)' }}>总值: <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>¥{a.totalValue.toLocaleString()}</span></span>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <Button variant="ghost" size="sm" style={{ flex: 1 }} onClick={(e) => { e.stopPropagation(); setSelectedAssortment(a); setShowAssProductDialog(true); }}>管理商品</Button>
                <Button variant="danger" size="sm" style={{ flex: 1 }} onClick={(e) => { e.stopPropagation(); handleDeleteAssortment(a.id); }}>删除</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 新建组盘弹窗 */}
      {showAssDialog && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card" style={{ width: 420, padding: 20, borderRadius: 12 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>新建组盘</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Input label="组盘名称" value={assForm.name} onChange={(e) => setAssForm({ ...assForm, name: e.target.value })} placeholder="例如：夏季爆款套装" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span className="input-label">分类</span>
                <Select
                  options={[{ value: 'live', label: '直播' }, { value: 'daily', label: '日常' }, { value: 'promo', label: '促销' }, { value: 'new_product', label: '新品' }]}
                  value={assForm.category} onChange={(v) => setAssForm({ ...assForm, category: v })}
                />
              </div>
              <div className="input-group">
                <label className="input-label">描述</label>
                <textarea
                  className="input-field" rows={2}
                  value={assForm.description} onChange={(e) => setAssForm({ ...assForm, description: e.target.value })}
                  placeholder="组盘说明..."
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <Button variant="ghost" size="sm" onClick={() => setShowAssDialog(false)}>取消</Button>
              <Button size="sm" onClick={handleCreateAssortment} disabled={!assForm.name.trim()}>创建</Button>
            </div>
          </div>
        </div>
      )}

      {/* 组盘商品管理弹窗 */}
      {showAssProductDialog && selectedAssortment && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card" style={{ width: 520, padding: 20, borderRadius: 12, maxHeight: '75vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600 }}>{selectedAssortment.name}</h3>
              <div style={{ display: 'flex', gap: 4 }}>
                <StatusBadge text={selectedAssortment.status} />
                <StatusBadge text={selectedAssortment.stockStatus} />
              </div>
            </div>

            {/* 商品列表 */}
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 6 }}>商品列表</div>
            {selectedAssortment.products.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 12, textAlign: 'center' }}>暂无商品，请添加</div>
            ) : (
              <div style={{ flex: 1, overflow: 'auto' }}>
                <div className="row" style={{ padding: '5px 10px', background: 'var(--bg-table-header)', fontSize: 10, color: 'var(--text-table-header)' }}>
                  <span style={{ flex: 1 }}>商品 ID</span>
                  <span style={{ width: 60, textAlign: 'right' }}>数量</span>
                  <span style={{ width: 70, textAlign: 'right' }}>单价</span>
                  <span style={{ width: 60, textAlign: 'right' }}>小计</span>
                  <span style={{ width: 60, textAlign: 'center' }}>操作</span>
                </div>
                {selectedAssortment.products.map((p, i) => (
                  <div key={i} className="row row-hoverable" style={{ padding: '5px 10px' }}>
                    <span style={{ flex: 1, fontSize: 11, color: 'var(--text-primary)' }}>{p.productId}</span>
                    <span style={{ width: 60, textAlign: 'right', fontSize: 11, color: 'var(--text-secondary)' }}>{p.quantity}</span>
                    <span style={{ width: 70, textAlign: 'right', fontSize: 11, color: 'var(--text-secondary)' }}>¥{p.unitPrice}</span>
                    <span style={{ width: 60, textAlign: 'right', fontSize: 11, color: 'var(--text-primary)', fontWeight: 500 }}>¥{(p.quantity * p.unitPrice).toLocaleString()}</span>
                    <span style={{ width: 60, textAlign: 'center' }}>
                      <Button variant="ghost" size="sm" onClick={() => handleRemoveProduct(selectedAssortment.id, p.productId)}>移除</Button>
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* 统计 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, padding: 8, background: 'var(--bg-row-hover)', borderRadius: 8, marginBottom: 12 }}>
              <div style={{ textAlign: 'center' }}><span style={{ fontSize: 10, color: 'var(--text-muted)' }}>毛利</span><div style={{ fontSize: 16, fontWeight: 700, color: 'var(--success-500)' }}>{selectedAssortment.grossMargin}%</div></div>
              <div style={{ textAlign: 'center' }}><span style={{ fontSize: 10, color: 'var(--text-muted)' }}>总值</span><div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>¥{selectedAssortment.totalValue.toLocaleString()}</div></div>
              <div style={{ textAlign: 'center' }}><span style={{ fontSize: 10, color: 'var(--text-muted)' }}>SKU</span><div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{selectedAssortment.products.length}</div></div>
            </div>

            {/* 添加商品表单 */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
              <div style={{ flex: 2 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>商品 ID</span>
                <input className="input-field" style={{ fontSize: 11, padding: '5px 8px' }}
                  value={addProductForm.productId} onChange={(e) => setAddProductForm({ ...addProductForm, productId: e.target.value })} placeholder="prod-xxx" />
              </div>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>数量</span>
                <input className="input-field" type="number" style={{ fontSize: 11, padding: '5px 8px' }} min="1"
                  value={addProductForm.quantity} onChange={(e) => setAddProductForm({ ...addProductForm, quantity: Number(e.target.value) || 1 })} />
              </div>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>单价</span>
                <input className="input-field" type="number" style={{ fontSize: 11, padding: '5px 8px' }} min="0"
                  value={addProductForm.unitPrice} onChange={(e) => setAddProductForm({ ...addProductForm, unitPrice: Number(e.target.value) || 0 })} />
              </div>
              <Button size="sm" onClick={handleAddProductToAssortment}>+ 添加</Button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <Button variant="ghost" size="sm" onClick={() => { setShowAssProductDialog(false); setSelectedAssortment(null); }}>关闭</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // Order Panel
  const renderOrderPanel = () => (
    <div style={panelStyle}>
      <div style={panelTitleStyle}>
        <span>订单列表</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <Select
            options={[{ value: '', label: '全部状态' }, { value: 'pending', label: '待确认' }, { value: 'processing', label: '处理中' }, { value: 'shipped', label: '已发货' }, { value: 'completed', label: '已完成' }, { value: 'cancelled', label: '已取消' }]}
            value={orderStatus} onChange={(v) => setOrderStatus(v)} placeholder="状态"
          />
          <Input
            value={orderKeyword} onChange={(e) => setOrderKeyword(e.target.value)}
            placeholder="搜索订单号/客户..." addonLeft={<span style={{ fontSize: 12 }}>⌕</span>}
            style={{ width: 180, padding: '6px 10px' }}
          />
          <Button variant="ghost" size="sm" onClick={loadOrders}>刷新</Button>
        </div>
      </div>

      <div className="row" style={{ padding: '6px 12px', background: 'var(--bg-table-header)', fontSize: 11, color: 'var(--text-table-header)', fontWeight: 500, borderRadius: 6 }}>
        <span style={{ width: 130 }}>订单号</span>
        <span style={{ width: 100 }}>客户</span>
        <span style={{ width: 80, textAlign: 'right' }}>金额</span>
        <span style={{ width: 90, textAlign: 'center' }}>付款</span>
        <span style={{ width: 80, textAlign: 'center' }}>状态</span>
        <span style={{ width: 120 }}>创建时间</span>
        <span style={{ width: 80, textAlign: 'center' }}>操作</span>
      </div>

      {orderLoading ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>加载中...</div>
      ) : orders.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>暂无订单数据</div>
      ) : (
        orders.slice(0, 12).map((o) => (
          <div key={o.id} className="row row-hoverable" style={{ padding: '8px 12px', cursor: 'pointer' }}
            onClick={() => setSelectedOrder(o)}>
            <span style={{ width: 130, fontSize: 11, color: 'var(--text-muted)' }}>{o.order_no}</span>
            <span style={{ width: 100, fontSize: 12, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.customer_name || '-'}</span>
            <span style={{ width: 80, textAlign: 'right', fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>¥{(o.total_amount || 0).toLocaleString()}</span>
            <span style={{ width: 90, textAlign: 'center' }}><StatusBadge text={o.payment_status || 'unpaid'} /></span>
            <span style={{ width: 80, textAlign: 'center' }}><StatusBadge text={o.order_status || 'pending'} /></span>
            <span style={{ width: 120, fontSize: 10, color: 'var(--text-muted)' }}>{o.created_at ? new Date(o.created_at).toLocaleString('zh-CN') : '-'}</span>
            <span style={{ width: 80, textAlign: 'center' }}>
              <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setSelectedOrder(o); }}>详情</Button>
            </span>
          </div>
        ))
      )}

      {/* 订单详情弹窗 */}
      {selectedOrder && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card" style={{ width: 500, padding: 20, borderRadius: 12, maxHeight: '80vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600 }}>订单详情</h3>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{selectedOrder.order_no}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12, marginBottom: 12 }}>
              <div><span style={{ color: 'var(--text-muted)' }}>客户: </span><span style={{ color: 'var(--text-primary)' }}>{selectedOrder.customer_name || '-'}</span></div>
              <div><span style={{ color: 'var(--text-muted)' }}>电话: </span><span style={{ color: 'var(--text-primary)' }}>{selectedOrder.customer_phone || '-'}</span></div>
              <div><span style={{ color: 'var(--text-muted)' }}>地址: </span><span style={{ color: 'var(--text-primary)' }}>{selectedOrder.shipping_address || '-'}</span></div>
              <div><span style={{ color: 'var(--text-muted)' }}>平台: </span><span style={{ color: 'var(--text-primary)' }}>{selectedOrder.platform || '-'}</span></div>
              <div><span style={{ color: 'var(--text-muted)' }}>金额: </span><span style={{ fontWeight: 600, color: 'var(--ecom-amber-600)' }}>¥{(selectedOrder.total_amount || 0).toLocaleString()}</span></div>
              <div><span style={{ color: 'var(--text-muted)' }}>运费: </span><span style={{ color: 'var(--text-primary)' }}>¥{(selectedOrder.shipping_fee || 0).toLocaleString()}</span></div>
              <div><span style={{ color: 'var(--text-muted)' }}>付款: </span><StatusBadge text={selectedOrder.payment_status || 'unpaid'} /></div>
              <div><span style={{ color: 'var(--text-muted)' }}>状态: </span><StatusBadge text={selectedOrder.order_status || 'pending'} /></div>
            </div>
            {selectedOrder.items && selectedOrder.items.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 6 }}>商品明细</div>
                {selectedOrder.items.map((item: any, i: number) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12, borderBottom: '1px solid var(--border-divider)' }}>
                    <span style={{ color: 'var(--text-primary)' }}>{item.productId}</span>
                    <span style={{ color: 'var(--text-secondary)' }}>[×{item.quantity}] ¥{item.unitPrice} = ¥{(item.quantity * item.unitPrice).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
            {selectedOrder.remark && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>备注: {selectedOrder.remark}</div>
            )}

            {/* 收款登记：paid_amount 的唯一写入入口，直接驱动经营分析的营收/毛利/人效 */}
            <div style={{ borderTop: '1px solid var(--border-divider)', paddingTop: 12, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>收款登记</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  已收 <b style={{ color: 'var(--ecom-amber-600)' }}>¥{(selectedOrder.paid_amount || 0).toLocaleString()}</b>
                  {' / '}待收 ¥{Math.max(0, (selectedOrder.total_amount || 0) - (selectedOrder.paid_amount || 0)).toLocaleString()}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <Input
                  value={payAmount}
                  onChange={(e) => { setPayAmount(e.target.value); setPayError(''); }}
                  placeholder="金额（负数为退款）"
                  style={{ flex: 1, padding: '6px 10px' }}
                />
                <Select
                  options={[
                    { value: '', label: '支付方式' },
                    { value: 'alipay', label: '支付宝' },
                    { value: 'wechat', label: '微信' },
                    { value: 'bank_transfer', label: '银行转账' },
                    { value: 'cod', label: '货到付款' },
                    { value: 'other', label: '其他' },
                  ]}
                  value={payMethod}
                  onChange={(v) => setPayMethod(v)}
                  placeholder="支付方式"
                />
                <Button
                  variant="primary" size="sm"
                  disabled={paySubmitting || !payAmount}
                  onClick={handleRecordPayment}
                >
                  {paySubmitting ? '提交中...' : '登记'}
                </Button>
                <Button
                  variant="ghost" size="sm"
                  disabled={paySubmitting}
                  onClick={() => {
                    const rest = (selectedOrder.total_amount || 0) - (selectedOrder.paid_amount || 0);
                    setPayAmount(rest > 0 ? String(Math.round(rest * 100) / 100) : '');
                    setPayError('');
                  }}
                >
                  结清
                </Button>
              </div>
              {payError && (
                <div style={{ fontSize: 11, color: 'var(--color-danger, #d93026)', marginTop: 6 }}>{payError}</div>
              )}
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
                付款状态由累计实收自动推导；结清后订单自动由「待确认」推进为「已确认」。经营分析的营收与毛利只统计已收款金额。
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant="ghost" size="sm" onClick={() => { setSelectedOrder(null); setPayAmount(''); setPayError(''); }}>关闭</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // Service Panel
  const renderServicePanel = () => (
    <div style={{ ...panelStyle, display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 12 }}>
      {/* 工单列表 */}
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ ...panelTitleStyle, marginBottom: 8 }}>
          <span>客服工单</span>
        </div>
        <div style={toolBarStyle}>
          <Select
            options={[{ value: '', label: '全部状态' }, { value: 'open', label: '待处理' }, { value: 'in_progress', label: '处理中' }, { value: 'waiting_customer', label: '等待客户' }, { value: 'closed', label: '已关闭' }]}
            value={ticketStatus} onChange={(v) => setTicketStatus(v)} placeholder="状态"
          />
          <Select
            options={[{ value: '', label: '全部优先级' }, { value: 'urgent', label: '紧急' }, { value: 'high', label: '高' }, { value: 'normal', label: '普通' }, { value: 'low', label: '低' }]}
            value={ticketPriority} onChange={(v) => setTicketPriority(v)} placeholder="优先级"
          />
          <Button variant="ghost" size="sm" onClick={loadTickets}>刷新</Button>
        </div>

        <div style={{ flex: 1, overflow: 'auto' }}>
          {ticketLoading ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>加载中...</div>
          ) : tickets.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>暂无工单</div>
          ) : (
            tickets.map((t) => (
              <div key={t.id}
                className="row row-hoverable"
                style={{
                  padding: '10px 12px', cursor: 'pointer', borderRadius: 8, marginBottom: 4,
                  background: selectedTicket?.id === t.id ? 'var(--bg-row-selected)' : 'var(--bg-card)',
                  border: selectedTicket?.id === t.id ? '1px solid var(--ecom-amber-500)' : '1px solid transparent',
                  borderLeft: `3px solid ${t.priority === 'urgent' ? 'var(--danger-500)' : t.priority === 'high' ? 'var(--warning-500)' : 'var(--text-muted)'}`,
                  display: 'flex',
                }}
                onClick={() => { setSelectedTicket(t); loadTicketMessages(t.id); }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.subject}</span>
                    <PriorityBadge priority={t.priority} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {t.lastMessage ? `${t.lastMessage.substring(0, 40)}${t.lastMessage.length > 40 ? '...' : ''}` : '暂无消息'}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0, marginLeft: 8 }}>
                  <StatusBadge text={t.status} />
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{t.assignedName || '未分配'} · {t.messageCount}条</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 工单回复区 */}
      <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 8, overflow: 'hidden', minHeight: 0 }}>
        {selectedTicket ? (
          <>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-divider)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{selectedTicket.subject}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>#{selectedTicket.ticketNo} · {selectedTicket.category}</div>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <Button variant="ghost" size="sm" onClick={() => handleEscalateTicket(selectedTicket)}>升级</Button>
                <Button variant="ghost" size="sm" onClick={() => handleUpdateTicketStatus(selectedTicket, 'closed')}>关闭</Button>
              </div>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {ticketMessages.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, padding: 20 }}>暂无对话记录</div>
              ) : (
                ticketMessages.map((m) => (
                  <div key={m.id} style={{ display: 'flex', justifyContent: m.sender === 'agent' ? 'flex-end' : 'flex-start' }}>
                    <div style={{
                      maxWidth: '85%', padding: '6px 10px', borderRadius: 8,
                      background: m.sender === 'agent' ? 'var(--ecom-amber-100)' : 'var(--bg-row-hover)',
                      color: 'var(--text-primary)', fontSize: 12, lineHeight: 1.4,
                    }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>{m.sender_name || (m.sender === 'agent' ? '客服' : '客户')}</div>
                      <div>{m.content}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div style={{ padding: 10, borderTop: '1px solid var(--border-divider)', display: 'flex', gap: 6 }}>
              <textarea
                className="input-field" rows={2}
                value={replyContent} onChange={(e) => setReplyContent(e.target.value)}
                placeholder="输入回复内容..."
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReplyTicket(); } }}
              />
              <Button size="sm" onClick={handleReplyTicket} disabled={!replyContent.trim()}>发送</Button>
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            请选择工单查看详情
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="hrms-container">
      <div className="hrms-header">
        <h2 className="page-title">业务链</h2>
        <div className="hrms-header-actions">
          <span className="text-secondary" style={{ fontSize: 12 }}>立项 → 选品 → 组盘 → 订单 → 客服 全链路闭环</span>
        </div>
      </div>

      {/* 业务环节切换 */}
      <div
        style={{
          display: 'flex', gap: 2, padding: 3,
          background: 'var(--bg-toolbar, #f3f4f6)',
          border: '1px solid var(--border-color, #e5e7eb)',
          borderRadius: 8, marginBottom: 12, width: 'fit-content',
        }}
      >
        {phases.map((p) => (
          <button
            key={p.id}
            onClick={() => setPhase(p.id)}
            style={{
              padding: '6px 14px', fontSize: 12, fontWeight: currentPhase === p.id ? 600 : 400,
              border: 'none', borderRadius: 5, cursor: 'pointer', transition: 'all 0.15s',
              background: currentPhase === p.id ? 'var(--bg-card, #fff)' : 'transparent',
              color: currentPhase === p.id ? 'var(--text-primary, #111)' : 'var(--text-muted, #6b7280)',
              boxShadow: currentPhase === p.id ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* 业务场景筛选 */}
      <div className="kanban-header" style={{ marginBottom: 12 }}>
        {scenarios.map((sc) => (
          <button
            key={sc.id}
            className={`tab ${activeScenario === sc.id ? 'tab-active' : ''}`}
            onClick={() => setActiveScenario(sc.id)}
          >
            {sc.label}
          </button>
        ))}
      </div>

      {/* 全链路节点网络 */}
      {chainLoading ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20, width: '100%' }}>加载中...</div>
      ) : chainNodes.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20, width: '100%' }}>暂无数据</div>
      ) : (
      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 12, minHeight: 200 }}>
        {chainNodes.map((node, idx) => (
          <div key={node.id} style={{ minWidth: 180, flexShrink: 0 }}>
            {idx > 0 && (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 10, height: 20, lineHeight: '20px' }}>──→</div>
            )}
            <div
              className="card"
              style={{ padding: 16, borderLeft: `3px solid ${STATUS_STYLES[node.status].dot}`, cursor: 'pointer' }}
              onClick={() => node.children && toggleExpand(node.id)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_STYLES[node.status].dot, flexShrink: 0 }} />
                <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{node.label}</span>
                {node.children && (
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>{expanded.includes(node.id) ? '收起' : '展开'}</span>
                )}
              </div>
              {node.metrics.map((m) => (
                <div key={m.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{m.label}</span>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{m.value}</span>
                </div>
              ))}
              {node.children && expanded.includes(node.id) && (
                <div style={{ marginTop: 12, borderTop: '1px solid var(--border-divider)', paddingTop: 8 }}>
                  {node.children.map((child) => (
                    <div key={child.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', fontSize: 12 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_STYLES[child.status].dot }} />
                      <span style={{ color: 'var(--text-primary)' }}>{child.label}</span>
                      {child.metrics.map((m) => (
                        <span key={m.label} style={{ color: 'var(--text-muted)', marginLeft: 4 }}>{m.label}: {m.value}</span>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
              <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 8px', flex: 1 }}>详情</button>
              <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 8px', flex: 1 }}>优化</button>
            </div>
          </div>
        ))}
      </div>
      )}

      {/* 业务链路指标 — 真实数据 */}
      <div className="card" style={{ padding: 16 }}>
        <h3 className="section-title" style={{ marginBottom: 12 }}>业务链路指标</h3>
        {chainMetricLoading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>加载中...</div>
        ) : chainMetrics.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>
            暂无业务数据，请先录入订单和商品
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
            {chainMetrics.map((metric) => (
              <div key={metric.label} className="card" style={{ padding: 12, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>{metric.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>{metric.value}</div>
                <div style={{ fontSize: 11, color: metric.trend.startsWith('↑') ? 'var(--success-500)' : metric.trend.startsWith('↓') ? 'var(--success-500)' : 'var(--text-muted)', marginTop: 2 }}>{metric.trend}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 五阶段内容面板 */}
      <div className="phase-panel" style={{ animation: 'fadeIn 0.3s ease' }}>
        {currentPhase === 'project' && renderProjectPanel()}
        {currentPhase === 'select' && renderSelectPanel()}
        {currentPhase === 'package' && renderPackagePanel()}
        {currentPhase === 'order' && renderOrderPanel()}
        {currentPhase === 'service' && renderServicePanel()}
      </div>
    </div>
  );
}
