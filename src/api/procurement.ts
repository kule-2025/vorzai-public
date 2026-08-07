/**
 * Vorzai 采购供应链 API Client
 * 对接后端 /api/procurement/*（供应商台账 / 采购单 / 到货入库 / 补货建议 / 供应商绩效）
 *
 * 口径与后端 procurementService 严格一致，前端不得自行换算：
 *   补货建议量 suggestedQty = max(0, ceil(日均销量 × 覆盖天数) − 当前库存)
 *   供应商评分 score = onTimeRate×0.4 + completionRate×0.3 + qualifyRate×0.3
 */

import api from './client';

// ─────────────── 类型定义（与后端 procurementService 保持一致）───────────────

export type SupplierGrade = 'A' | 'B' | 'C' | 'D';
export type SupplierStatus = 'active' | 'suspended' | 'archived';
export type POStatus =
  | 'draft' | 'submitted' | 'approved' | 'receiving' | 'completed' | 'cancelled';
export type POSource = 'manual' | 'replenish_suggestion' | 'import';
export type StockTxnType =
  | 'purchase_in' | 'sale_out' | 'return_in' | 'return_out' | 'adjust' | 'transfer' | 'scrap';

export const PO_STATUS_LABEL: Record<POStatus, string> = {
  draft: '草稿',
  submitted: '待审批',
  approved: '已批准',
  receiving: '到货中',
  completed: '已完成',
  cancelled: '已取消',
};

export const SUPPLIER_STATUS_LABEL: Record<SupplierStatus, string> = {
  active: '合作中',
  suspended: '已暂停',
  archived: '已归档',
};

export const STOCK_TXN_LABEL: Record<StockTxnType, string> = {
  purchase_in: '采购入库',
  sale_out: '销售出库',
  return_in: '退货入库',
  return_out: '退供出库',
  adjust: '库存调整',
  transfer: '调拨',
  scrap: '报损',
};

export interface Supplier {
  id: string;
  tenantId: string;
  code: string | null;
  name: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  address: string | null;
  category: string | null;
  grade: SupplierGrade;
  paymentTerms: string | null;
  leadTimeDays: number;
  rating: number;
  onTimeRate: number;
  totalPurchaseAmount: number;
  currency: string;
  status: SupplierStatus;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierInput {
  name: string;
  code?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  address?: string;
  category?: string;
  grade?: SupplierGrade;
  paymentTerms?: string;
  leadTimeDays?: number;
  currency?: string;
  remark?: string;
  status?: SupplierStatus;
}

export interface PurchaseItem {
  id: string;
  purchaseOrderId: string;
  productId: string;
  sku: string | null;
  productName: string | null;
  quantity: number;
  receivedQuantity: number;
  qualifiedQuantity: number;
  unitPrice: number;
  subtotal: number;
  remark: string | null;
}

export interface PurchaseOrder {
  id: string;
  tenantId: string;
  poNo: string;
  supplierId: string;
  supplierName: string | null;
  status: POStatus;
  statusLabel: string;
  source: POSource;
  sourceRef: string | null;
  currency: string;
  totalAmount: number;
  receivedAmount: number;
  expectedDate: string | null;
  receivedDate: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdBy: string | null;
  remark: string | null;
  items?: PurchaseItem[];
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseOrderInput {
  supplierId: string;
  expectedDate?: string;
  currency?: string;
  remark?: string;
  source?: POSource;
  sourceRef?: string;
  items: Array<{
    productId: string;
    quantity: number;
    unitPrice: number;
    remark?: string;
  }>;
}

export interface StockTransaction {
  id: string;
  tenantId: string;
  productId: string;
  sku: string | null;
  productName: string | null;
  txnType: StockTxnType;
  quantity: number;
  stockBefore: number;
  stockAfter: number;
  unitCost: number | null;
  refType: string | null;
  refId: string | null;
  operatorId: string | null;
  remark: string | null;
  createdAt: string;
}

export interface ReplenishSuggestion {
  productId: string;
  sku: string | null;
  name: string;
  currentStock: number;
  dailySalesAvg: number;
  coverDays: number;
  suggestedQty: number;
  estimatedCost: number;
  lastPurchasePrice: number;
  supplierId: string | null;
  supplierName: string | null;
  reason: string;
}

export interface ReplenishResult {
  suggestions: ReplenishSuggestion[];
  coverDays: number;
  windowDays: number;
  generatedAt: string;
}

export interface SupplierPerformance {
  supplierId: string;
  supplierName: string;
  grade: SupplierGrade;
  leadTimeDays: number;
  totalOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  receivedAmount: number;
  onTimeRate: number;
  completionRate: number;
  qualifyRate: number;
  score: number;
  /** 口径说明，供业务方核对 */
  formula: string;
}

export interface OverdueOrder {
  id: string;
  poNo: string;
  supplierName: string | null;
  expectedDate: string;
  totalAmount: number;
  overdueDays: number;
}

export interface ProcurementOverview {
  purchaseOrders: {
    total: number;
    draft: number;
    pendingApproval: number;
    inProgress: number;
    completed: number;
    totalAmount: number;
  };
  suppliers: { total: number; active: number };
  overdueOrders: OverdueOrder[];
  generatedAt: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PagedResult<T> {
  items: T[];
  pagination: Pagination;
}

export interface SupplierQuery {
  status?: SupplierStatus;
  grade?: SupplierGrade;
  category?: string;
  keyword?: string;
  page?: number;
  limit?: number;
}

export interface PurchaseOrderQuery {
  status?: POStatus;
  supplierId?: string;
  keyword?: string;
  page?: number;
  limit?: number;
}

export interface StockTxnQuery {
  productId?: string;
  txnType?: StockTxnType;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

export interface ReceiveInput {
  items: Array<{
    purchaseItemId: string;
    receivedQuantity: number;
    qualifiedQuantity?: number;
    remark?: string;
  }>;
  receivedDate?: string;
  remark?: string;
}

// ─────────────── 工具 ───────────────

interface RawResponse<T> {
  success: boolean;
  data?: T;
  pagination?: Pagination;
  error?: { code: string; message: string };
}

function unwrap<T>(resp: RawResponse<T>): T {
  if (!resp.success) throw new Error(resp.error?.message || '请求失败');
  return resp.data as T;
}

/** 分页接口返回 { data, pagination }，统一整形为 { items, pagination } */
function unwrapPaged<T>(resp: RawResponse<T[]>): PagedResult<T> {
  if (!resp.success) throw new Error(resp.error?.message || '请求失败');
  return {
    items: (resp.data as T[]) || [],
    pagination: resp.pagination || { page: 1, limit: 20, total: 0, totalPages: 0 },
  };
}

function toQuery(params: Record<string, string | number | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

// ─────────────── API ───────────────

export const procurementApi = {
  // ===== S1 供应商台账 =====

  listSuppliers: async (query: SupplierQuery = {}): Promise<PagedResult<Supplier>> =>
    unwrapPaged<Supplier>(
      await api.call<Supplier[]>('GET', `/procurement/suppliers${toQuery(query as never)}`)
    ),

  getSupplier: async (id: string): Promise<Supplier> =>
    unwrap<Supplier>(await api.call<Supplier>('GET', `/procurement/suppliers/${id}`)),

  createSupplier: async (input: SupplierInput): Promise<Supplier> =>
    unwrap<Supplier>(await api.call<Supplier>('POST', '/procurement/suppliers', input)),

  updateSupplier: async (id: string, updates: Partial<SupplierInput>): Promise<Supplier> =>
    unwrap<Supplier>(await api.call<Supplier>('PUT', `/procurement/suppliers/${id}`, updates)),

  /** 归档供应商（有进行中采购单时后端会拒绝） */
  deleteSupplier: async (id: string): Promise<void> => {
    const resp = await api.call<null>('DELETE', `/procurement/suppliers/${id}`);
    if (!resp.success) throw new Error(resp.error?.message || '归档失败');
  },

  // ===== S2 采购单 =====

  listPurchaseOrders: async (
    query: PurchaseOrderQuery = {}
  ): Promise<PagedResult<PurchaseOrder>> =>
    unwrapPaged<PurchaseOrder>(
      await api.call<PurchaseOrder[]>('GET', `/procurement/orders${toQuery(query as never)}`)
    ),

  getPurchaseOrder: async (id: string): Promise<PurchaseOrder> =>
    unwrap<PurchaseOrder>(await api.call<PurchaseOrder>('GET', `/procurement/orders/${id}`)),

  createPurchaseOrder: async (input: PurchaseOrderInput): Promise<PurchaseOrder> =>
    unwrap<PurchaseOrder>(await api.call<PurchaseOrder>('POST', '/procurement/orders', input)),

  /** 状态流转，非法流转后端返回 400 并给出可用目标状态 */
  transitionStatus: async (id: string, status: POStatus): Promise<PurchaseOrder> =>
    unwrap<PurchaseOrder>(
      await api.call<PurchaseOrder>('PUT', `/procurement/orders/${id}/status`, { status })
    ),

  // ===== S3 到货入库 =====

  receive: async (id: string, input: ReceiveInput): Promise<PurchaseOrder> =>
    unwrap<PurchaseOrder>(
      await api.call<PurchaseOrder>('POST', `/procurement/orders/${id}/receive`, input)
    ),

  listStockTransactions: async (
    query: StockTxnQuery = {}
  ): Promise<PagedResult<StockTransaction>> =>
    unwrapPaged<StockTransaction>(
      await api.call<StockTransaction[]>(
        'GET',
        `/procurement/stock-transactions${toQuery(query as never)}`
      )
    ),

  adjustStock: async (input: {
    productId: string;
    quantity: number;
    txnType?: StockTxnType;
    remark?: string;
  }): Promise<StockTransaction> =>
    unwrap<StockTransaction>(
      await api.call<StockTransaction>('POST', '/procurement/stock/adjust', input)
    ),

  // ===== S4 补货建议 =====

  getReplenishSuggestions: async (
    params: { coverDays?: number; windowDays?: number; limit?: number } = {}
  ): Promise<ReplenishResult> =>
    unwrap<ReplenishResult>(
      await api.call<ReplenishResult>(
        'GET',
        `/procurement/replenish-suggestions${toQuery(params as never)}`
      )
    ),

  /** 勾选商品一键转采购单，后端按供应商分组，一供应商一单 */
  convertSuggestions: async (
    productIds: string[],
    options: { coverDays?: number; expectedDate?: string } = {}
  ): Promise<{ createdCount: number; purchaseOrders: PurchaseOrder[] }> =>
    unwrap<{ createdCount: number; purchaseOrders: PurchaseOrder[] }>(
      await api.call('POST', '/procurement/replenish-suggestions/convert', {
        productIds,
        ...options,
      })
    ),

  // ===== S6 绩效与总览 =====

  getSupplierPerformance: async (supplierId?: string): Promise<SupplierPerformance[]> =>
    unwrap<SupplierPerformance[]>(
      await api.call<SupplierPerformance[]>(
        'GET',
        supplierId
          ? `/procurement/suppliers/${supplierId}/performance`
          : '/procurement/suppliers/performance'
      )
    ),

  getOverview: async (): Promise<ProcurementOverview> =>
    unwrap<ProcurementOverview>(
      await api.call<ProcurementOverview>('GET', '/procurement/overview')
    ),
};

export default procurementApi;
