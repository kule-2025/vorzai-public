/**
 * Vorzai 采购供应链路由（V2 · S1-S6）
 *
 * 挂载点：/api/procurement
 *   S1 供应商台账      GET|POST /suppliers, GET|PUT|DELETE /suppliers/:id
 *   S6 供应商绩效      GET /suppliers/performance, GET /suppliers/:id/performance
 *   S2 采购单          GET|POST /orders, GET /orders/:id, PUT /orders/:id/status
 *   S3 到货入库        POST /orders/:id/receive
 *      出入库流水      GET /stock-transactions, POST /stock/adjust
 *   S4 补货建议        GET /replenish-suggestions, POST /replenish-suggestions/convert
 *      采购总览        GET /overview
 *
 * 权限：写操作限 admin/manager；读操作对已认证用户开放。
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { procurementService } from '../services/procurementService';
import { authenticateToken, tenantIsolation, requireRole } from '../middleware/auth';
import { asyncHandler, successResponse, paginatedResponse } from '../middleware/common';

const router = Router();
router.use(authenticateToken, tenantIsolation);

// ==================== S1 供应商台账 ====================

const supplierSchema = z.object({
  name: z.string().min(1, '供应商名称不能为空').max(200),
  code: z.string().max(64).optional(),
  contactName: z.string().max(100).optional(),
  contactPhone: z.string().max(50).optional(),
  // 允许空串（前端清空输入时提交 ''），非空时才校验邮箱格式
  contactEmail: z.union([z.string().email('邮箱格式不正确'), z.literal('')]).optional(),
  address: z.string().max(500).optional(),
  category: z.string().max(100).optional(),
  grade: z.enum(['A', 'B', 'C', 'D']).optional(),
  paymentTerms: z.string().max(50).optional(),
  leadTimeDays: z.number().int().min(0).max(365).optional(),
  currency: z.string().max(10).optional(),
  remark: z.string().max(1000).optional(),
  isSandbox: z.boolean().optional(),
});

router.post('/suppliers', requireRole('admin', 'manager'), asyncHandler(async (req: Request, res: Response) => {
  const input = supplierSchema.parse(req.body);
  const result = procurementService.createSupplier(req.user!.tenantId, input, req.user!.userId);
  successResponse(res, result, '供应商创建成功', 201);
}));

router.get('/suppliers', asyncHandler(async (req: Request, res: Response) => {
  const result = procurementService.listSuppliers(req.user!.tenantId, {
    page: Number(req.query.page) || undefined,
    limit: Number(req.query.limit) || undefined,
    status: req.query.status as string | undefined,
    grade: req.query.grade as string | undefined,
    category: req.query.category as string | undefined,
    keyword: req.query.keyword as string | undefined,
    sortBy: req.query.sortBy as string | undefined,
    sortOrder: req.query.sortOrder as 'ASC' | 'DESC' | undefined,
  });
  paginatedResponse(res, result.data, result.pagination);
}));

// 注意：静态路径必须放在 /:id 之前，否则会被参数路由吞掉
router.get('/suppliers/performance', asyncHandler(async (req: Request, res: Response) => {
  const result = procurementService.getSupplierPerformance(req.user!.tenantId);
  successResponse(res, result);
}));

router.get('/suppliers/:id', asyncHandler(async (req: Request, res: Response) => {
  const result = procurementService.getSupplier(req.user!.tenantId, req.params.id);
  successResponse(res, result);
}));

router.get('/suppliers/:id/performance', asyncHandler(async (req: Request, res: Response) => {
  const result = procurementService.getSupplierPerformance(req.user!.tenantId, req.params.id);
  successResponse(res, result);
}));

router.put('/suppliers/:id', requireRole('admin', 'manager'), asyncHandler(async (req: Request, res: Response) => {
  const input = supplierSchema.partial().extend({
    status: z.enum(['active', 'suspended', 'archived']).optional(),
  }).parse(req.body);
  const result = procurementService.updateSupplier(req.user!.tenantId, req.params.id, input);
  successResponse(res, result, '供应商更新成功');
}));

router.delete('/suppliers/:id', requireRole('admin'), asyncHandler(async (req: Request, res: Response) => {
  procurementService.deleteSupplier(req.user!.tenantId, req.params.id);
  successResponse(res, null, '供应商已归档');
}));

// ==================== S2 采购单 ====================

const purchaseItemSchema = z.object({
  productId: z.string().optional(),
  productSku: z.string().max(100).optional(),
  productName: z.string().max(200).optional(),
  quantity: z.number().int().positive('采购数量必须大于 0'),
  unitPrice: z.number().min(0, '采购单价不能为负数'),
  remark: z.string().max(500).optional(),
});

router.post('/orders', requireRole('admin', 'manager'), asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    supplierId: z.string().optional(),
    supplierName: z.string().max(200).optional(),
    items: z.array(purchaseItemSchema).min(1, '采购单至少需要一条明细').max(200),
    expectedDate: z.string().optional(),
    currency: z.string().max(10).optional(),
    source: z.enum(['manual', 'replenish_suggestion', 'import']).optional(),
    sourceRef: z.string().max(100).optional(),
    remark: z.string().max(1000).optional(),
    isSandbox: z.boolean().optional(),
  }).parse(req.body);

  const result = procurementService.createPurchaseOrder(req.user!.tenantId, input, req.user!.userId);
  successResponse(res, result, '采购单创建成功', 201);
}));

router.get('/orders', asyncHandler(async (req: Request, res: Response) => {
  const result = procurementService.listPurchaseOrders(req.user!.tenantId, {
    page: Number(req.query.page) || undefined,
    limit: Number(req.query.limit) || undefined,
    status: req.query.status as string | undefined,
    supplierId: req.query.supplierId as string | undefined,
    keyword: req.query.keyword as string | undefined,
    sortBy: req.query.sortBy as string | undefined,
    sortOrder: req.query.sortOrder as 'ASC' | 'DESC' | undefined,
  });
  paginatedResponse(res, result.data, result.pagination);
}));

router.get('/orders/:id', asyncHandler(async (req: Request, res: Response) => {
  const result = procurementService.getPurchaseOrder(req.user!.tenantId, req.params.id);
  successResponse(res, result);
}));

router.put('/orders/:id/status', requireRole('admin', 'manager'), asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    status: z.enum(['draft', 'submitted', 'approved', 'receiving', 'completed', 'cancelled']),
  }).parse(req.body);
  const result = procurementService.transitionPurchaseOrder(
    req.user!.tenantId, req.params.id, input.status, req.user!.userId
  );
  successResponse(res, result, `采购单已流转至「${result.statusLabel}」`);
}));

// ==================== S3 到货入库 ====================

router.post('/orders/:id/receive', requireRole('admin', 'manager'), asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    receipts: z.array(z.object({
      itemId: z.string().min(1),
      receivedQuantity: z.number().int().positive('到货数量必须大于 0'),
      qualifiedQuantity: z.number().int().min(0).optional(),
      remark: z.string().max(500).optional(),
    })).min(1, '请至少填写一条到货明细'),
  }).parse(req.body);

  const result = procurementService.receivePurchaseOrder(
    req.user!.tenantId, req.params.id, input.receipts, req.user!.userId
  );
  successResponse(res, result, '到货入库成功，库存已更新');
}));

// ==================== 出入库流水 ====================

router.get('/stock-transactions', asyncHandler(async (req: Request, res: Response) => {
  const result = procurementService.listStockTransactions(req.user!.tenantId, {
    page: Number(req.query.page) || undefined,
    limit: Number(req.query.limit) || undefined,
    productId: req.query.productId as string | undefined,
    txnType: req.query.txnType as string | undefined,
    startDate: req.query.startDate as string | undefined,
    endDate: req.query.endDate as string | undefined,
  });
  paginatedResponse(res, result.data, result.pagination);
}));

router.post('/stock/adjust', requireRole('admin', 'manager'), asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    productId: z.string().min(1),
    quantity: z.number().int().refine((v) => v !== 0, '调整数量不能为 0'),
    txnType: z.enum(['adjust', 'scrap', 'transfer', 'return_in', 'return_out']).optional(),
    remark: z.string().max(500).optional(),
  }).parse(req.body);

  const result = procurementService.adjustStock(req.user!.tenantId, input, req.user!.userId);
  successResponse(res, result, '库存调整成功');
}));

// ==================== S4 补货建议 ====================

router.get('/replenish-suggestions', asyncHandler(async (req: Request, res: Response) => {
  const result = procurementService.buildReplenishSuggestions(req.user!.tenantId, {
    coverDays: Number(req.query.coverDays) || undefined,
    windowDays: Number(req.query.windowDays) || undefined,
    limit: Number(req.query.limit) || undefined,
  });
  successResponse(res, result);
}));

router.post('/replenish-suggestions/convert', requireRole('admin', 'manager'), asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    productIds: z.array(z.string()).min(1, '请选择要补货的商品').max(200),
    coverDays: z.number().int().min(1).max(365).optional(),
    expectedDate: z.string().optional(),
  }).parse(req.body);

  const result = procurementService.createPOFromSuggestions(
    req.user!.tenantId, input.productIds,
    { coverDays: input.coverDays, expectedDate: input.expectedDate },
    req.user!.userId
  );
  successResponse(res, result, `已生成 ${result.createdCount} 张采购单`, 201);
}));

// ==================== 采购总览 ====================

router.get('/overview', asyncHandler(async (req: Request, res: Response) => {
  const result = procurementService.getProcurementOverview(req.user!.tenantId);
  successResponse(res, result);
}));

export default router;
