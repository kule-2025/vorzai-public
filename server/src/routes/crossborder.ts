import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { crossborderService } from '../services/crossborderService';
import { authenticateToken, tenantIsolation } from '../middleware/auth';
import { checkAccountStatus } from '../middleware/license';
import { asyncHandler, successResponse } from '../middleware/common';

const router = Router();
router.use(authenticateToken, tenantIsolation, checkAccountStatus);

// ============================================================
// 跨境电商 API 路由
// ============================================================

// GET /api/crossborder/hs-code/:productId — 取商品跨境信息（HS Code、原产国等）
router.get('/hs-code/:productId', asyncHandler(async (req: Request, res: Response) => {
  const { productId } = req.params;
  const { getDatabase } = require('../db');
  const db = getDatabase();
  const product = db.prepare(
    'SELECT id, sku, name, hs_code, origin_country, declared_value, is_prohibited, product_weight_kg FROM products WHERE id = ? AND tenant_id = ?'
  ).get(productId, req.user!.tenantId) as any;

  if (!product) {
    return successResponse(res, { found: false, productId }, '未找到该商品的跨境信息');
  }

  const hsValidation = product.hs_code
    ? crossborderService.validateHSCode(product.hs_code)
    : null;

  return successResponse(res, {
    found: true,
    productId: product.id,
    sku: product.sku,
    name: product.name,
    hsCode: product.hs_code,
    hsValidation,
    originCountry: product.origin_country,
    declaredValue: product.declared_value,
    isProhibited: product.is_prohibited === 1,
    productWeightKg: product.product_weight_kg,
  });
}));

// POST /api/crossborder/hs-code/validate — 单独校验 HS Code 格式
router.post('/hs-code/validate', asyncHandler(async (req: Request, res: Response) => {
  const { hsCode } = z.object({ hsCode: z.string() }).parse(req.body);
  const result = crossborderService.validateHSCode(hsCode);
  successResponse(res, result);
}));

// POST /api/crossborder/vat/calculate — 计算 VAT
router.post('/vat/calculate', asyncHandler(async (req: Request, res: Response) => {
  const { amount, rate, destinationCountry, vatNumber } = z.object({
    amount: z.number().nonnegative(),
    rate: z.number().min(0).max(1),
    destinationCountry: z.string().optional(),
    vatNumber: z.string().optional(),
  }).parse(req.body);

  const result = crossborderService.calculateVAT(amount, rate, { destinationCountry, vatNumber });
  successResponse(res, result);
}));

// POST /api/crossborder/currency/convert — 货币转换
router.post('/currency/convert', asyncHandler(async (req: Request, res: Response) => {
  const { amount, from, to, rate } = z.object({
    amount: z.number(),
    from: z.string().min(3).max(3),
    to: z.string().min(3).max(3),
    rate: z.number().positive().optional(),
  }).parse(req.body);

  // 如果未传 rate，从汇率快照自动取最新一条
  let useRate = rate;
  let source: 'manual' | 'snapshot' = 'manual';
  if (useRate === undefined) {
    const latest = crossborderService.getLatestRate(req.user!.tenantId, from, to);
    if (latest) {
      useRate = latest.rate;
      source = 'snapshot';
    }
  }

  const result = crossborderService.convertCurrency(amount, from, to, useRate);
  successResponse(res, { ...result, source });
}));

// GET /api/crossborder/exchange-rates — 列出当前租户的汇率快照
router.get('/exchange-rates', asyncHandler(async (req: Request, res: Response) => {
  const limit = Number(req.query.limit) || 100;
  const rates = crossborderService.listExchangeRates(req.user!.tenantId, limit);
  successResponse(res, rates);
}));

// POST /api/crossborder/exchange-rates — 新增一条汇率快照
router.post('/exchange-rates', asyncHandler(async (req: Request, res: Response) => {
  const { fromCurrency, toCurrency, rate, effectiveDate, source } = z.object({
    fromCurrency: z.string().min(3).max(3),
    toCurrency: z.string().min(3).max(3),
    rate: z.number().positive(),
    effectiveDate: z.string().optional(),
    source: z.string().optional(),
  }).parse(req.body);

  const record = crossborderService.createExchangeRate({
    tenantId: req.user!.tenantId,
    fromCurrency,
    toCurrency,
    rate,
    effectiveDate,
    source,
  });
  successResponse(res, record, '汇率快照已保存', 201);
}));

// GET /api/crossborder/exchange-rates/latest — 取某币种对最新一条汇率
router.get('/exchange-rates/latest', asyncHandler(async (req: Request, res: Response) => {
  const { from, to } = z.object({
    from: z.string().min(3).max(3),
    to: z.string().min(3).max(3),
  }).parse(req.query);

  const record = crossborderService.getLatestRate(req.user!.tenantId, from, to);
  if (!record) {
    return successResponse(res, { found: false, from, to }, '未找到该币种对的汇率快照');
  }
  return successResponse(res, { found: true, ...record });
}));

// GET /api/crossborder/prohibited-check/:productId — 违禁品检查
router.get('/prohibited-check/:productId', asyncHandler(async (req: Request, res: Response) => {
  const result = crossborderService.checkProhibited(req.user!.tenantId, req.params.productId);
  successResponse(res, result);
}));

// ============================================================
// 新增端点（P0-2 跨境合规 / 多币种 / 落地成本）
// ============================================================

// GET /api/crossborder/hs-codes?keyword=&limit= — 中英文模糊检索内置 HS Code 参考库
router.get('/hs-codes', asyncHandler(async (req: Request, res: Response) => {
  const q = z.object({
    keyword: z.string().optional(),
    limit: z.string().optional(),
  }).parse(req.query);
  const keyword = q.keyword ? q.keyword.trim() : undefined;
  const limit = q.limit ? Math.min(200, Math.max(1, parseInt(q.limit, 10) || 50)) : 50;
  const items = crossborderService.searchHsCode(keyword, limit);
  successResponse(res, items);
}));

// GET /api/crossborder/currencies — 全部币种与小数位
router.get('/currencies', asyncHandler(async (_req: Request, res: Response) => {
  successResponse(res, crossborderService.listCurrencies());
}));

// GET /api/crossborder/countries — 全部目的国 / 地区（含 VAT 率、币种、认证要求）
router.get('/countries', asyncHandler(async (_req: Request, res: Response) => {
  successResponse(res, crossborderService.listCountries());
}));

// GET /api/crossborder/shipping-modes — 运输方式与计费参数（测算表单下拉用）
router.get('/shipping-modes', asyncHandler(async (_req: Request, res: Response) => {
  successResponse(res, crossborderService.listShippingModes());
}));

// GET /api/crossborder/rates — 当前租户汇率表（手工快照 + 内置参考基准合并）
router.get('/rates', asyncHandler(async (req: Request, res: Response) => {
  successResponse(res, crossborderService.getExchangeRates(req.user!.tenantId));
}));

// PUT /api/crossborder/rates — 录入/更新一条汇率（外币 → CNY，本地维护，覆盖当天）
router.put('/rates', asyncHandler(async (req: Request, res: Response) => {
  const { from, to, rate, source } = z.object({
    from: z.string().length(3, '源币种为 3 位代码，如 USD'),
    to: z.string().length(3).optional(),
    rate: z.number().positive('汇率必须为正数'),
    source: z.string().max(40).optional(),
  }).parse(req.body);
  const view = crossborderService.upsertExchangeRate(req.user!.tenantId, { from, to, rate, source });
  successResponse(res, view, '汇率已更新');
}));

// GET /api/crossborder/products — 跨境合规属性批量列表（合规管理页）
router.get('/products', asyncHandler(async (req: Request, res: Response) => {
  const q = z.object({
    keyword: z.string().optional(),
    limit: z.string().optional(),
  }).parse(req.query);
  const onlyIncomplete = req.query.onlyIncomplete === 'true';
  const keyword = q.keyword ? q.keyword.trim() : undefined;
  const limit = q.limit ? Math.min(500, Math.max(1, parseInt(q.limit, 10) || 200)) : 200;
  const items = crossborderService.listProductCompliance(req.user!.tenantId, {
    keyword,
    onlyIncomplete,
    limit,
  });
  successResponse(res, items);
}));

// GET /api/crossborder/products/:productId/compliance — 取单个商品跨境属性
router.get('/products/:productId/compliance', asyncHandler(async (req: Request, res: Response) => {
  const cp = crossborderService.getProductCompliance(req.user!.tenantId, req.params.productId);
  successResponse(res, cp);
}));

// PUT /api/crossborder/products/:productId/compliance — 写入/更新跨境属性
router.put('/products/:productId/compliance', asyncHandler(async (req: Request, res: Response) => {
  const data = z.object({
    hsCode: z.string().nullable().optional(),
    originCountry: z.string().nullable().optional(),
    declaredNameEn: z.string().nullable().optional(),
    declaredValue: z.number().nonnegative().nullable().optional(),
    netWeightKg: z.number().nonnegative().nullable().optional(),
    grossWeightKg: z.number().nonnegative().nullable().optional(),
    lengthCm: z.number().nonnegative().nullable().optional(),
    widthCm: z.number().nonnegative().nullable().optional(),
    heightCm: z.number().nonnegative().nullable().optional(),
    isBattery: z.boolean().optional(),
    isLiquid: z.boolean().optional(),
    isMagnetic: z.boolean().optional(),
    isProhibited: z.boolean().optional(),
    certifications: z.array(z.string().min(1)).optional(),
  }).parse(req.body);
  const cp = crossborderService.upsertProductCompliance(req.user!.tenantId, req.params.productId, data);
  successResponse(res, cp, '跨境属性已保存');
}));

// POST /api/crossborder/products/:productId/compliance-check — 合规体检
router.post('/products/:productId/compliance-check', asyncHandler(async (req: Request, res: Response) => {
  const { targetCountry } = z.object({
    targetCountry: z.string().min(2).max(3),
  }).parse(req.body);
  const result = crossborderService.checkCompliance(
    req.user!.tenantId, req.params.productId, targetCountry
  );
  successResponse(res, result);
}));

// POST /api/crossborder/landed-cost — 落地成本与利润测算
router.post('/landed-cost', asyncHandler(async (req: Request, res: Response) => {
  const body = z.object({
    productId: z.string().optional(),
    costPrice: z.number().nonnegative().optional(),
    qty: z.number().int().positive(),
    destinationCountry: z.string().min(2).max(3),
    sellingPrice: z.number().positive(),
    sellingCurrency: z.string().length(3),
    shippingMode: z.enum(['air', 'sea', 'express']),
    weightKg: z.number().nonnegative().optional(),
    lengthCm: z.number().nonnegative().optional(),
    widthCm: z.number().nonnegative().optional(),
    heightCm: z.number().nonnegative().optional(),
    freightRatePerKg: z.number().nonnegative().optional(),
    declaredValuePerUnit: z.number().nonnegative().optional(),
    hsCode: z.string().optional(),
    dutyRateOverride: z.number().min(0).max(1).optional(),
    vatRateOverride: z.number().min(0).max(1).optional(),
    platformFeeRate: z.number().min(0).max(1),
    paymentFeeRate: z.number().min(0).max(1),
    adRate: z.number().min(0).max(1),
    lastMileFeePerUnit: z.number().nonnegative().optional(),
  }).parse(req.body);
  const result = crossborderService.calculateLandedCost(req.user!.tenantId, body);
  successResponse(res, result);
}));

// GET /api/crossborder/overview — 跨境概览聚合
router.get('/overview', asyncHandler(async (req: Request, res: Response) => {
  successResponse(res, crossborderService.getOverview(req.user!.tenantId));
}));

export default router;
