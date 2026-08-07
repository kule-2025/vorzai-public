/**
 * 业务链打通模块
 * 功能：打通订单、库存、供应链、结算全链路
 */
import { moduleBus } from '@api/moduleBus';

export interface OrderChain {
  id: string;
  orderNo: string;
  platform: string;
  status: 'pending' | 'paid' | 'shipped' | 'delivered' | 'completed' | 'cancelled' | 'refunded';
  amount: number;
  currency: string;
  buyer: string;
  inventory: { sku: string; allocated: number; available: number }[];
  createdAt: string;
  updatedAt: string;
  logistics?: { carrier: string; trackingNo: string; status: string };
  settlement?: { amount: number; status: 'pending' | 'matched' | 'disputed'; matchedAt?: string };
}

export interface InventorySnapshot {
  sku: string;
  product: string;
  platform: string;
  allocated: number;
  available: number;
  reserved: number;
  total: number;
  lastUpdated: string;
}

export interface SettlementRecord {
  id: string;
  platform: string;
  period: string;
  gross: number;
  fees: number;
  net: number;
  status: 'pending' | 'matched' | 'disputed';
  matchedAt?: string;
}

export interface AssortmentProduct { productId: string; quantity: number; unitPrice: number }
export interface Assortment {
  id: string; name: string; description: string; category: string;
  products: AssortmentProduct[]; grossMargin: number; totalValue: number;
  stockStatus: 'sufficient' | 'low' | 'insufficient';
  status: 'draft' | 'active' | 'archived';
  createdById: string; createdAt: string; updatedAt: string;
}

export interface ServiceTicket {
  id: string; ticketNo: string; status: string; subject: string;
  priority: string; assignedTo?: string; assignedName?: string;
  category: string; channel: string; messageCount: number; lastMessage?: string;
  customerName?: string; customerId?: string;
  orders?: Array<{ id: string; orderNo: string; amount: number }>;
  chat?: { messages: Array<{ id: string; sender: string; senderName?: string; content: string; timestamp: string }> };
  escalateReason?: string;
}

// ────────── 业务链状态（内存 + moduleBus 同步） ──────────

let orders: OrderChain[] = [
  {
    id: 'ord-001', orderNo: 'TB20260723001', platform: 'taobao', status: 'completed',
    amount: 239.0, currency: 'CNY', buyer: 'tb_user_8842',
    inventory: [{ sku: 'SKU-A001', allocated: 2, available: 48 }],
    createdAt: '2026-07-20T10:30:00Z', updatedAt: '2026-07-23T09:15:00Z',
    logistics: { carrier: 'SF', trackingNo: 'SF1234567890', status: 'delivered' },
    settlement: { amount: 226.05, status: 'matched', matchedAt: '2026-07-23T09:15:00Z' },
  },
  {
    id: 'ord-002', orderNo: 'JD20260723002', platform: 'jd', status: 'shipped',
    amount: 1599.0, currency: 'CNY', buyer: 'jd_user_3211',
    inventory: [{ sku: 'SKU-B003', allocated: 1, available: 12 }],
    createdAt: '2026-07-23T14:00:00Z', updatedAt: '2026-07-23T16:20:00Z',
    logistics: { carrier: 'JD-LOG', trackingNo: 'JD9876543210', status: 'in-transit' },
    settlement: { amount: 1519.05, status: 'pending' },
  },
  {
    id: 'ord-003', orderNo: 'PDD20260722003', platform: 'pdd', status: 'paid',
    amount: 89.9, currency: 'CNY', buyer: 'pdd_user_5512',
    inventory: [{ sku: 'SKU-C007', allocated: 3, available: 157 }],
    createdAt: '2026-07-22T20:45:00Z', updatedAt: '2026-07-22T20:46:00Z',
  },
];

let inventory: InventorySnapshot[] = [
  { sku: 'SKU-A001', product: '纯棉T恤 黑色 M', platform: 'all', allocated: 2, available: 48, reserved: 0, total: 50, lastUpdated: '2026-07-23T09:00:00Z' },
  { sku: 'SKU-B003', product: '无线蓝牙耳机', platform: 'jd', allocated: 1, available: 12, reserved: 2, total: 15, lastUpdated: '2026-07-23T14:00:00Z' },
  { sku: 'SKU-C007', product: '便携充电宝 20000mAh', platform: 'pdd', allocated: 3, available: 157, reserved: 5, total: 165, lastUpdated: '2026-07-22T20:00:00Z' },
];

let settlements: SettlementRecord[] = [
  { id: 'settle-001', platform: 'taobao', period: '2026-07', gross: 239.0, fees: 12.95, net: 226.05, status: 'matched', matchedAt: '2026-07-23T09:15:00Z' },
  { id: 'settle-002', platform: 'jd', period: '2026-07', gross: 1599.0, fees: 79.95, net: 1519.05, status: 'pending' },
];

function _nextId(prefix: string): string {
  return `${prefix}-${Date.now()}`;
}

// ────────── 组盘（Assortment） ──────────
let assortments: Assortment[] = [
  {
    id: 'ass-001', name: '夏季爆款套装', description: '夏季主推，T恤+短裤组合',
    category: 'live', products: [
      { productId: 'prod-001', quantity: 5, unitPrice: 89.0 },
      { productId: 'prod-003', quantity: 3, unitPrice: 129.0 },
    ], grossMargin: 35, totalValue: 856, stockStatus: 'sufficient',
    status: 'active', createdById: 'user-001', createdAt: '2026-07-10T09:00:00Z', updatedAt: '2026-07-15T10:00:00Z',
  },
  {
    id: 'ass-002', name: '新品尝鲜包', description: '新品首发组合，限量体验',
    category: 'new_product', products: [
      { productId: 'prod-005', quantity: 2, unitPrice: 199.0 },
    ], grossMargin: 42, totalValue: 398, stockStatus: 'low',
    status: 'draft', createdById: 'user-002', createdAt: '2026-07-20T14:00:00Z', updatedAt: '2026-07-20T14:00:00Z',
  },
];

function _calcAssortment(a: Assortment): { grossMargin: number; totalValue: number } {
  let totalCost = 0, totalSale = 0;
  for (const p of a.products) { totalSale += p.quantity * p.unitPrice; totalCost += p.quantity * p.unitPrice * 0.65; }
  const gm = totalSale > 0 ? Math.round(((totalSale - totalCost) / totalSale) * 100) : 0;
  return { grossMargin: gm, totalValue: Math.round(totalSale * 100) / 100 };
}

function _notifyOrderStatus(orderNo: string, status: string) {
  moduleBus.broadcast('chain:order-status-change', { orderNo, status });
}

export const businessChainModule = {
  /** 获取订单链数据 */
  getOrders: async (filters?: { platform?: string; status?: string; dateRange?: [string, string] }) => {
    let result = [...orders];
    if (filters?.platform) result = result.filter((o) => o.platform === filters.platform);
    if (filters?.status) result = result.filter((o) => o.status === filters.status);
    return result;
  },

  /** 更新订单状态 */
  updateOrderStatus: async (orderNo: string, status: string): Promise<{ success: boolean; order?: OrderChain; error?: string }> => {
    const order = orders.find((o) => o.orderNo === orderNo);
    if (!order) return { success: false, error: '订单不存在' };
    const validStatuses = ['pending', 'paid', 'shipped', 'delivered', 'completed', 'cancelled', 'refunded'];
    if (!validStatuses.includes(status as any)) return { success: false, error: `无效状态: ${status}` };
    order.status = status as OrderChain['status'];
    order.updatedAt = new Date().toISOString();
    _notifyOrderStatus(orderNo, status);
    return { success: true, order };
  },

  /** 库存分配 */
  allocateInventory: async (orderNo: string, sku: string, quantity: number): Promise<{ success: boolean; error?: string; available?: number }> => {
    const item = inventory.find((i) => i.sku === sku);
    if (!item) return { success: false, error: `SKU 不存在: ${sku}` };
    if (item.available < quantity) return { success: false, error: `库存不足，可用: ${item.available}` };
    item.allocated += quantity;
    item.available -= quantity;
    item.lastUpdated = new Date().toISOString();
    moduleBus.broadcast('chain:inventory-allocated', { sku, quantity, orderNo });
    return { success: true, available: item.available };
  },

  /** 释放库存 */
  releaseInventory: async (orderNo: string, sku: string, quantity: number): Promise<{ success: boolean; error?: string }> => {
    const item = inventory.find((i) => i.sku === sku);
    if (!item) return { success: false, error: `SKU 不存在: ${sku}` };
    const rel = Math.min(quantity, item.allocated);
    item.allocated -= rel;
    item.available += rel;
    item.lastUpdated = new Date().toISOString();
    return { success: true };
  },

  /** 结算对账 */
  reconcileSettlement: async (date?: string): Promise<{ matched: number; unmatched: number; records?: SettlementRecord[] }> => {
    const cutoff = date ? new Date(date) : new Date();
    const matched = settlements.filter((s) => s.status === 'matched');
    const unmatched = settlements.filter((s) => s.status === 'pending');
    return { matched: matched.length, unmatched: unmatched.length, records: settlements };
  },

  /** 获取库存快照 */
  getInventory: async (sku?: string): Promise<InventorySnapshot[]> => {
    if (sku) return inventory.filter((i) => i.sku === sku);
    return [...inventory];
  },

  // ────────── 组盘 (Assortment) ──────────

  /** 创建组盘 */
  createAssortment: async (input: { name: string; description?: string; category?: string; products?: AssortmentProduct[] }): Promise<Assortment> => {
    const id = _nextId('ass');
    const now = new Date().toISOString();
    const products = input.products || [];
    const { grossMargin, totalValue } = _calcAssortment({ id, name: '', description: '', category: '', products, grossMargin: 0, totalValue: 0, stockStatus: 'sufficient', status: 'draft', createdById: '', createdAt: now, updatedAt: now });
    const a: Assortment = {
      id, name: input.name, description: input.description || '',
      category: input.category || 'daily', products, grossMargin, totalValue,
      stockStatus: 'sufficient', status: 'draft', createdById: 'user-001', createdAt: now, updatedAt: now,
    };
    assortments.push(a);
    return a;
  },

  /** 获取组盘列表 */
  getAssortments: async (filters?: { status?: string; category?: string; keyword?: string }): Promise<Assortment[]> => {
    let result = [...assortments];
    if (filters?.status) result = result.filter((a) => a.status === filters.status);
    if (filters?.category) result = result.filter((a) => a.category === filters.category);
    if (filters?.keyword) result = result.filter((a: Assortment) => a.name.includes(filters.keyword as string));
    return result;
  },

  /** 获取组盘详情 */
  getAssortmentById: async (id: string): Promise<Assortment | undefined> => assortments.find((a) => a.id === id),

  /** 更新组盘基本信息 */
  updateAssortment: async (id: string, input: { name?: string; description?: string; category?: string; status?: string }): Promise<{ success: boolean; assortment?: Assortment; error?: string }> => {
    const a = assortments.find((x) => x.id === id);
    if (!a) return { success: false, error: '组盘不存在' };
    if (input.name !== undefined) a.name = input.name;
    if (input.description !== undefined) a.description = input.description;
    if (input.category !== undefined) a.category = input.category;
    if (input.status !== undefined) a.status = input.status as Assortment['status'];
    a.updatedAt = new Date().toISOString();
    return { success: true, assortment: a };
  },

  /** 删除组盘 */
  deleteAssortment: async (id: string): Promise<{ success: boolean; error?: string }> => {
    const idx = assortments.findIndex((a) => a.id === id);
    if (idx === -1) return { success: false, error: '组盘不存在' };
    assortments.splice(idx, 1);
    return { success: true };
  },

  /** 添加商品到组盘 */
  addProductToAssortment: async (id: string, product: AssortmentProduct): Promise<{ success: boolean; assortment?: Assortment; error?: string }> => {
    const a = assortments.find((x) => x.id === id);
    if (!a) return { success: false, error: '组盘不存在' };
    const existing = a.products.find((p) => p.productId === product.productId);
    if (existing) { existing.quantity += product.quantity; } else { a.products.push({ ...product }); }
    const { grossMargin, totalValue } = _calcAssortment(a);
    a.grossMargin = grossMargin; a.totalValue = totalValue;
    a.updatedAt = new Date().toISOString();
    return { success: true, assortment: a };
  },

  /** 从组盘移除商品 */
  removeProductFromAssortment: async (id: string, productId: string): Promise<{ success: boolean; assortment?: Assortment; error?: string }> => {
    const a = assortments.find((x) => x.id === id);
    if (!a) return { success: false, error: '组盘不存在' };
    a.products = a.products.filter((p) => p.productId !== productId);
    const { grossMargin, totalValue } = _calcAssortment(a);
    a.grossMargin = grossMargin; a.totalValue = totalValue;
    a.updatedAt = new Date().toISOString();
    return { success: true, assortment: a };
  },

  // ────────── 客服工单 (Service Ticket) ──────────

  /** 创建客服工单 */
  createServiceTicket: async (input: { customerId?: string; subject: string; description?: string; priority?: string; orderId?: string; channel?: string; category?: string }): Promise<ServiceTicket> => {
    const id = _nextId('tkt');
    const chat = input.description
      ? { messages: [{ id: `msg-${id}-1`, sender: 'customer', senderName: '客户', content: input.description, timestamp: new Date().toISOString() }] }
      : { messages: [] };
    const ticket: ServiceTicket = {
      id, ticketNo: `TKT-${id}`, status: 'open', subject: input.subject,
      priority: input.priority || 'normal', category: input.category || 'inquiry',
      channel: input.channel || 'online',
      customerName: input.customerId ? `客户-${input.customerId}` : undefined,
      customerId: input.customerId,
      messageCount: chat.messages.length,
      lastMessage: chat.messages.length ? chat.messages[0].content : undefined,
      orders: input.orderId ? [{ id: input.orderId, orderNo: input.orderId, amount: 0 }] : [],
      chat,
    };
    return ticket;
  },

  /** 获取工单列表 */
  getServiceTickets: async (filters?: { status?: string; priority?: string; keyword?: string }): Promise<ServiceTicket[]> => {
    let result: ServiceTicket[] = [
      { id: 'tkt-001', ticketNo: 'TKT-001', status: 'open', subject: '商品质量问题反馈', priority: 'high', assignedTo: 'agent-01', assignedName: '张三', category: 'complaint', channel: 'online', messageCount: 3, lastMessage: '请提供订单号', chat: { messages: [] } },
      { id: 'tkt-002', ticketNo: 'TKT-002', status: 'in_progress', subject: '物流信息异常', priority: 'normal', assignedTo: 'agent-02', assignedName: '李四', category: 'logistics', channel: 'platform', messageCount: 5, lastMessage: '正在核实物流', chat: { messages: [] } },
      { id: 'tkt-003', ticketNo: 'TKT-003', status: 'waiting_customer', subject: '退款申请', priority: 'urgent', category: 'refund', channel: 'phone', messageCount: 2, lastMessage: '等待客户确认退款金额', chat: { messages: [] } },
    ];
    if (filters?.status) result = result.filter((t: ServiceTicket) => t.status === filters.status);
    if (filters?.priority) result = result.filter((t: ServiceTicket) => t.priority === filters.priority);
    if (filters?.keyword) result = result.filter((t: ServiceTicket) => t.subject.includes(filters.keyword as string));
    return result;
  },

  /** 更新工单状态 */
  updateServiceTicketStatus: async (id: string, status: string): Promise<{ success: boolean; ticket?: ServiceTicket; error?: string }> => {
    const list: ServiceTicket[] = await (this as any).getServiceTickets()!;
    const t: ServiceTicket | undefined = list.find((x: ServiceTicket) => x.id === id);
    if (!t) return { success: false, error: '工单不存在' };
    t.status = status;
    t.messageCount = t.chat?.messages.length ?? 0;
    return { success: true, ticket: t };
  },

  /** 获取工单详情（含消息） */
  getServiceTicket: async (id: string): Promise<ServiceTicket | null> => {
    const list: ServiceTicket[] = await (this as any).getServiceTickets()!;
    const t = list.find((t: ServiceTicket) => t.id === id);
    return t ?? null;
  },

  /** 添加工单回复消息 */
  addTicketMessage: async (id: string, content: string, sender?: string): Promise<{ success: boolean; message?: any; error?: string }> => {
    const list: ServiceTicket[] = await (this as any).getServiceTickets()!;
    const t: ServiceTicket | undefined = list.find((x: ServiceTicket) => x.id === id);
    if (!t) return { success: false, error: '工单不存在' };
    const sn = sender || 'agent';
    const msg = { id: `msg-${id}-${Date.now()}`, sender: sn, senderName: sn === 'agent' ? '客服' : '客户', content, timestamp: new Date().toISOString() };
    if (!t.chat) t.chat = { messages: [] };
    t.chat.messages.push(msg);
    t.messageCount = t.chat.messages.length;
    t.lastMessage = content;
    if (t.status === 'open') t.status = 'in_progress';
    return { success: true, message: msg };
  },

  /** 分配工单给客服 */
  assignTicketToAgent: async (id: string, agentId: string, agentName?: string): Promise<{ success: boolean; ticket?: ServiceTicket; error?: string }> => {
    const list: ServiceTicket[] = await (this as any).getServiceTickets()!;
    const t: ServiceTicket | undefined = list.find((x: ServiceTicket) => x.id === id);
    if (!t) return { success: false, error: '工单不存在' };
    t.assignedTo = agentId;
    t.assignedName = agentName;
    t.status = 'in_progress';
    return { success: true, ticket: t };
  },

  /** 升级工单（转人工/升级处理） */
  escalateTicket: async (id: string, reason?: string): Promise<{ success: boolean; ticket?: ServiceTicket; error?: string }> => {
    const list: ServiceTicket[] = await (this as any).getServiceTickets()!;
    const t: ServiceTicket | undefined = list.find((x: ServiceTicket) => x.id === id);
    if (!t) return { success: false, error: '工单不存在' };
    t.priority = 'urgent';
    t.status = 'waiting_customer';
    t.assignedTo = 'senior-agent';
    t.assignedName = '高级客服';
    t.escalateReason = reason;
    if (reason) {
      if (!t.chat) t.chat = { messages: [] };
      t.chat.messages.push({ id: `msg-${id}-esc`, sender: 'system', senderName: '系统', content: `[升级] ${reason}`, timestamp: new Date().toISOString() });
    }
    return { success: true, ticket: t };
  },

  /** 全链路健康检查 */
  healthCheck: async (): Promise<{ orders: boolean; inventory: boolean; logistics: boolean; settlement: boolean; details: Record<string, unknown> }> => {
    const hasOrders = orders.length > 0;
    const hasInventory = inventory.every((i) => i.total >= 0);
    const allShippedHasLogistics = orders.filter((o) => o.status === 'shipped').every((o) => o.logistics !== undefined);
    const allPaidHasSettlement = orders.filter((o) => o.status === 'paid').every((o) => o.settlement !== undefined);
    return {
      orders: hasOrders,
      inventory: hasInventory,
      logistics: allShippedHasLogistics,
      settlement: allPaidHasSettlement,
      details: { orderCount: orders.length, inventoryCount: inventory.length },
    };
  },
};
