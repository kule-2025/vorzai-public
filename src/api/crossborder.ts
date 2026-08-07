/**
 * Vorzai 跨境电商 API Client
 * 与 /api/crossborder 后端对接。
 *
 * 设计原则：
 *  · 全程通过真实后端，零 Mock。
 *  · 汇率由用户本地手工维护，本模块绝不联网抓取，也不伪装实时行情
 *    （后端返回的 rate.isBuiltinDefault / isStale 由前端如实展示）。
 */

import api from './client';

// ============================================================
// 类型定义（与 server/src/services/crossborderService.ts 对齐）
// ============================================================

export type ShippingMode = 'air' | 'sea' | 'express';
export type ComplianceLevel = 'blocker' | 'warning' | 'info';
export type ComplianceRiskLevel = 'clear' | 'low' | 'medium' | 'high' | 'critical';

export interface HsCodeSearchItem {
  code: string;
  nameZh: string;
  nameEn: string;
  categoryZh: string;
  duty: Record<string, number>;
  keywords: string;
  dutyRange: [number, number];
  dutyRangeText: string;
}

export interface CurrencyEntry {
  code: string;
  nameZh: string;
  symbol: string;
  decimals: number;
}

export interface CountryEntry {
  code: string;
  nameZh: string;
  nameEn: string;
  currency: string;
  vatRate: number;
  vatLabel: string;
  vatNote: string;
  dutyZone: string;
  deMinimis: number;
  baseCertifications: string[];
  isEu: boolean;
}

export interface ShippingModeEntry {
  mode: ShippingMode;
  nameZh: string;
  volumetricDivisor: number;
  defaultRatePerKg: number;
  leadTimeDays: string;
  note: string;
}

export interface ExchangeRateView {
  fromCurrency: string;
  toCurrency: string;
  currencyNameZh: string;
  symbol: string;
  rate: number;
  source: string;
  updatedAt: string | null;
  ageDays: number | null;
  isBuiltinDefault: boolean;
  isStale: boolean;
  note: string;
}

export interface ProductCompliance {
  productId: string;
  sku: string;
  name: string;
  category: string | null;
  hsCode: string | null;
  hsCodeInfo: HsCodeSearchItem | null;
  originCountry: string | null;
  declaredNameEn: string | null;
  declaredValue: number;
  netWeightKg: number;
  grossWeightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  isBattery: boolean;
  isLiquid: boolean;
  isMagnetic: boolean;
  isProhibited: boolean;
  certifications: string[];
  costPrice: number | null;
  sellingPrice: number | null;
  updatedAt: string | null;
}

export interface ComplianceIssue {
  code: string;
  level: ComplianceLevel;
  field: string;
  title: string;
  detail: string;
  suggestion: string;
}

export interface ComplianceCheckResult {
  productId: string;
  sku: string;
  name: string;
  targetCountry: string;
  targetCountryNameZh: string;
  riskLevel: ComplianceRiskLevel;
  riskLabel: string;
  score: number;
  issues: ComplianceIssue[];
  passed: string[];
  requiredCertifications: string[];
  missingCertifications: string[];
  applicableDutyRate: number;
  applicableVatRate: number;
  vatLabel: string;
  vatNote: string;
  deMinimis: number;
  deMinimisCurrency: string;
  checkedAt: string;
}

export interface LandedCostLine {
  key: string;
  label: string;
  amountCny: number;
  amountLocal: number;
  ratio: number;
  formula: string;
  group: 'goods' | 'logistics' | 'tax' | 'channel';
}

export interface LandedCostResult {
  id: string;
  calculatedAt: string;
  input: Record<string, unknown>;
  productSku: string | null;
  productName: string | null;
  destinationCountry: string;
  destinationNameZh: string;
  localCurrency: string;
  sellingCurrency: string;
  fxRate: number;
  fxSource: string;
  fxUpdatedAt: string | null;
  fxIsStale: boolean;
  fxPath: string[];
  qty: number;
  actualWeightKg: number;
  volumetricWeightKg: number;
  chargeableWeightKg: number;
  freightRatePerKg: number;
  shippingModeLabel: string;
  hsCode: string | null;
  hsCodeNameZh: string | null;
  dutyRate: number;
  dutyRateSource: string;
  vatRate: number;
  vatLabel: string;
  vatNote: string;
  declaredValueCny: number;
  lines: LandedCostLine[];
  revenueCny: number;
  revenueLocal: number;
  totalCostCny: number;
  totalCostLocal: number;
  unitCostCny: number;
  unitCostLocal: number;
  grossProfitCny: number;
  grossProfitLocal: number;
  grossMarginRate: number;
  roi: number;
  breakEvenPriceLocal: number;
  breakEvenPriceCny: number;
  notes: string[];
}

export interface LandedCostHistoryItem {
  id: string;
  calculatedAt: string;
  productSku: string | null;
  productName: string | null;
  destinationCountry: string;
  destinationNameZh: string;
  qty: number;
  sellingCurrency: string;
  revenueCny: number;
  totalCostCny: number;
  grossProfitCny: number;
  grossMarginRate: number;
}

export interface CrossBorderOverview {
  generatedAt: string;
  compliance: {
    totalProducts: number;
    withHsCode: number;
    withOriginCountry: number;
    fullyCompliant: number;
    missingHsCode: number;
    missingOriginCountry: number;
    prohibitedCount: number;
    completionRate: number;
  };
  rates: {
    total: number;
    manualCount: number;
    builtinCount: number;
    staleCount: number;
    latestUpdatedAt: string | null;
    oldestUpdatedAt: string | null;
    staleDaysThreshold: number;
  };
  destinations: Array<{
    country: string;
    nameZh: string;
    orderCount: number;
    amount: number;
    vatRate: number;
  }>;
  recentCalculations: LandedCostHistoryItem[];
  hsLibrarySize: number;
  countryLibrarySize: number;
}

export interface ComplianceUpsertInput {
  hsCode?: string | null;
  originCountry?: string | null;
  declaredNameEn?: string | null;
  declaredValue?: number | null;
  netWeightKg?: number | null;
  grossWeightKg?: number | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  isBattery?: boolean;
  isLiquid?: boolean;
  isMagnetic?: boolean;
  isProhibited?: boolean;
  certifications?: string[];
}

export interface LandedCostInput {
  productId?: string;
  costPrice?: number;
  qty: number;
  destinationCountry: string;
  sellingPrice: number;
  sellingCurrency: string;
  shippingMode: ShippingMode;
  weightKg?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  freightRatePerKg?: number;
  declaredValuePerUnit?: number;
  hsCode?: string;
  dutyRateOverride?: number;
  vatRateOverride?: number;
  platformFeeRate: number;
  paymentFeeRate: number;
  adRate: number;
  lastMileFeePerUnit?: number;
}

// ============================================================
// 解包工具
// ============================================================

function unwrap<T>(resp: {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
  message?: string;
}): T {
  if (!resp.success) {
    throw resp.error || { code: 'UNKNOWN', message: resp.message || '请求失败' };
  }
  return resp.data as T;
}

function buildQuery(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  });
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// ============================================================
// API 模块
// ============================================================

export const crossborderApi = {
  /** HS Code 参考库模糊检索 */
  searchHsCodes: async (keyword?: string, limit = 50): Promise<HsCodeSearchItem[]> =>
    unwrap(await api.call<HsCodeSearchItem[]>(
      'GET',
      `/crossborder/hs-codes${buildQuery({ keyword, limit })}`
    )),

  /** 跨境属性商品列表 */
  listProducts: async (params?: {
    keyword?: string;
    onlyIncomplete?: boolean;
    limit?: number;
  }): Promise<ProductCompliance[]> =>
    unwrap(await api.call<ProductCompliance[]>(
      'GET',
      `/crossborder/products${buildQuery({
        keyword: params?.keyword,
        onlyIncomplete: params?.onlyIncomplete ? 'true' : undefined,
        limit: params?.limit,
      })}`
    )),

  /** 单品跨境属性 */
  getProductCompliance: async (productId: string): Promise<ProductCompliance> =>
    unwrap(await api.call<ProductCompliance>(
      'GET',
      `/crossborder/products/${encodeURIComponent(productId)}/compliance`
    )),

  /** 更新单品跨境属性 */
  upsertProductCompliance: async (
    productId: string,
    data: ComplianceUpsertInput
  ): Promise<ProductCompliance> =>
    unwrap(await api.call<ProductCompliance>(
      'PUT',
      `/crossborder/products/${encodeURIComponent(productId)}/compliance`,
      data
    )),

  /** 合规体检 */
  checkCompliance: async (
    productId: string,
    targetCountry: string
  ): Promise<ComplianceCheckResult> =>
    unwrap(await api.call<ComplianceCheckResult>(
      'POST',
      `/crossborder/products/${encodeURIComponent(productId)}/compliance-check`,
      { targetCountry }
    )),

  /** 币种列表 */
  listCurrencies: async (): Promise<CurrencyEntry[]> =>
    unwrap(await api.call<CurrencyEntry[]>('GET', '/crossborder/currencies')),

  /** 目的国 / 地区列表 */
  listCountries: async (): Promise<CountryEntry[]> =>
    unwrap(await api.call<CountryEntry[]>('GET', '/crossborder/countries')),

  /** 运输方式列表 */
  listShippingModes: async (): Promise<ShippingModeEntry[]> =>
    unwrap(await api.call<ShippingModeEntry[]>('GET', '/crossborder/shipping-modes')),

  /** 汇率表（手工快照 + 内置基准合并） */
  getRates: async (): Promise<ExchangeRateView[]> =>
    unwrap(await api.call<ExchangeRateView[]>('GET', '/crossborder/rates')),

  /** 录入/更新汇率 */
  upsertRate: async (input: {
    from: string;
    to?: string;
    rate: number;
    source?: string;
  }): Promise<ExchangeRateView> =>
    unwrap(await api.call<ExchangeRateView>('PUT', '/crossborder/rates', input)),

  /** 落地成本与利润测算 */
  calculateLandedCost: async (input: LandedCostInput): Promise<LandedCostResult> =>
    unwrap(await api.call<LandedCostResult>('POST', '/crossborder/landed-cost', input)),

  /** 跨境概览 */
  getOverview: async (): Promise<CrossBorderOverview> =>
    unwrap(await api.call<CrossBorderOverview>('GET', '/crossborder/overview')),
};

export default crossborderApi;
