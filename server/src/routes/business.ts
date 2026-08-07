import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { businessService } from '../services/businessService';
import { aftersalesService } from '../services/aftersalesService';
import { authenticateToken, tenantIsolation } from '../middleware/auth';
import { asyncHandler, successResponse, paginatedResponse, notFound } from '../middleware/common';

const router = Router();
router.use(authenticateToken, tenantIsolation);

// ==================== Projects (立项) ====================

router.post('/projects', asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    name: z.string().min(1),
    code: z.string().min(1),
    description: z.string().optional(),
    businessType: z.enum(['live_commerce', 'cross_border', 'traditional', 'o2o', 'new_media']),
    platform: z.string().optional(),
    ownerId: z.string().optional(),
    departmentId: z.string().optional(),
    budget: z.number().optional(),
    expectedRevenue: z.number().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
    tags: z.array(z.string()).optional(),
  }).parse(req.body);

  const result = businessService.createProject(req.user!.tenantId, input);
  successResponse(res, result, '项目创建成功', 201);
}));

router.get('/projects', asyncHandler(async (req: Request, res: Response) => {
  const params = {
    page: Number(req.query.page) || undefined,
    limit: Number(req.query.limit) || undefined,
    businessType: req.query.businessType as string | undefined,
    status: req.query.status as string | undefined,
    keyword: req.query.keyword as string | undefined,
    sortBy: req.query.sortBy as string | undefined,
    sortOrder: req.query.sortOrder as 'ASC' | 'DESC' | undefined,
  };
  const result = businessService.listProjects(req.user!.tenantId, params);
  paginatedResponse(res, result.data, result.pagination);
}));

router.get('/projects/:id', asyncHandler(async (req: Request, res: Response) => {
  const result = businessService.getProject(req.params.id, req.user!.tenantId);
  successResponse(res, result);
}));

router.put('/projects/:id', asyncHandler(async (req: Request, res: Response) => {
  const result = businessService.updateProject(req.params.id, req.user!.tenantId, req.body);
  successResponse(res, result, '项目更新成功');
}));

// ==================== Products (选品) ====================

router.post('/products', asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    projectId: z.string().optional(),
    sku: z.string().min(1),
    name: z.string().min(1),
    category: z.string().optional(),
    brand: z.string().optional(),
    description: z.string().optional(),
    sourcePlatform: z.string().optional(),
    sourceUrl: z.string().optional(),
    costPrice: z.number().optional(),
    sellingPrice: z.number().optional(),
    marketPrice: z.number().optional(),
    stock: z.number().optional(),
    supplierName: z.string().optional(),
    attributes: z.record(z.unknown()).optional(),
  }).parse(req.body);

  const result = businessService.createProduct(req.user!.tenantId, input);
  successResponse(res, result, '商品创建成功', 201);
}));

router.get('/products', asyncHandler(async (req: Request, res: Response) => {
  const params = {
    page: Number(req.query.page) || undefined,
    limit: Number(req.query.limit) || undefined,
    projectId: req.query.projectId as string | undefined,
    status: req.query.status as string | undefined,
    category: req.query.category as string | undefined,
    keyword: req.query.keyword as string | undefined,
    sortBy: req.query.sortBy as string | undefined,
    sortOrder: req.query.sortOrder as 'ASC' | 'DESC' | undefined,
  };
  const result = businessService.listProducts(req.user!.tenantId, params);
  paginatedResponse(res, result.data, result.pagination);
}));

router.put('/products/:id/status', asyncHandler(async (req: Request, res: Response) => {
  const { status, ...extra } = z.object({
    status: z.enum(['candidate', 'selected', 'listed', 'out_of_stock', 'discontinued']),
    selectionScore: z.number().optional(),
    selectionReason: z.string().optional(),
    stock: z.number().optional(),
  }).parse(req.body);

  const result = businessService.updateProductStatus(req.params.id, req.user!.tenantId, status, extra);
  successResponse(res, result, '商品状态更新成功');
}));

// PUT /api/business/products/:id — 完整更新商品信息
router.put('/products/:id', asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    name: z.string().optional(),
    category: z.string().optional(),
    brand: z.string().optional(),
    description: z.string().optional(),
    sourcePlatform: z.string().optional(),
    sourceUrl: z.string().optional(),
    costPrice: z.number().optional(),
    sellingPrice: z.number().optional(),
    marketPrice: z.number().optional(),
    stock: z.number().optional(),
    supplierName: z.string().optional(),
    attributes: z.record(z.unknown()).optional(),
    projectId: z.string().optional(),
  }).parse(req.body);

  const result = businessService.updateProduct(req.params.id, req.user!.tenantId, input);
  successResponse(res, result, '商品更新成功');
}));

// ==================== Orders (订单) ====================

router.post('/orders', asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    projectId: z.string().optional(),
    platform: z.string().optional(),
    platformOrderId: z.string().optional(),
    customerName: z.string().optional(),
    customerPhone: z.string().optional(),
    shippingAddress: z.string().optional(),
    items: z.array(z.object({
      productId: z.string(),
      quantity: z.number().min(1),
      unitPrice: z.number().min(0),
    })).min(1),
    discount: z.number().optional(),
    shippingFee: z.number().optional(),
    paymentMethod: z.string().optional(),
    remark: z.string().optional(),
    // 业绩归属员工，不传则由服务层按当前操作人自动解析
    ownerEmployeeId: z.string().optional(),
    // 直播 / 平台来源标识，供渠道分析与人效归因使用
    liveSessionId: z.string().optional(),
    sourceConnectionId: z.string().optional(),
  }).parse(req.body);

  const result = businessService.createOrder(req.user!.tenantId, input, req.user!.userId);
  successResponse(res, result, '订单创建成功', 201);
}));

router.get('/orders', asyncHandler(async (req: Request, res: Response) => {
  const params = {
    page: Number(req.query.page) || undefined,
    limit: Number(req.query.limit) || undefined,
    projectId: req.query.projectId as string | undefined,
    status: req.query.status as string | undefined,
    paymentStatus: req.query.paymentStatus as string | undefined,
    keyword: req.query.keyword as string | undefined,
    startDate: req.query.startDate as string | undefined,
    endDate: req.query.endDate as string | undefined,
    sortBy: req.query.sortBy as string | undefined,
    sortOrder: req.query.sortOrder as 'ASC' | 'DESC' | undefined,
  };
  const result = businessService.listOrders(req.user!.tenantId, params);
  paginatedResponse(res, result.data, result.pagination);
}));

router.put('/orders/:id/status', asyncHandler(async (req: Request, res: Response) => {
  const { status, ...extra } = z.object({
    status: z.enum(['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'completed', 'cancelled', 'returned', 'refunded']),
    shippingNo: z.string().optional(),
    shippingCompany: z.string().optional(),
    cancelReason: z.string().optional(),
  }).parse(req.body);

  const result = businessService.updateOrderStatus(req.params.id, req.user!.tenantId, status, extra);
  successResponse(res, result, '订单状态更新成功');
}));

// PUT /api/business/orders/:id/payment — 登记收款/退款（正数收款，负数退款）
router.put('/orders/:id/payment', asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    amount: z.number(),
    paymentMethod: z.string().optional(),
    remark: z.string().optional(),
  }).parse(req.body);

  const result = businessService.recordPayment(req.params.id, req.user!.tenantId, input);
  successResponse(res, result, input.amount >= 0 ? '收款登记成功' : '退款登记成功');
}));

router.get('/orders/stats', asyncHandler(async (req: Request, res: Response) => {
  const period = req.query.period as string | undefined;
  const result = businessService.getOrderStats(req.user!.tenantId, period);
  successResponse(res, result);
}));

// ==================== Assortments (组盘) ====================

router.post('/assortment', asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    category: z.enum(['live', 'daily', 'promo', 'new_product']).optional(),
    products: z.array(z.object({
      productId: z.string(),
      quantity: z.number().min(1),
      unitPrice: z.number().min(0),
    })).optional(),
  }).parse(req.body);

  const result = businessService.createAssortment(req.user!.tenantId, req.user!.userId, input);
  successResponse(res, result, '组盘创建成功', 201);
}));

router.get('/assortments', asyncHandler(async (req: Request, res: Response) => {
  const params = {
    page: Number(req.query.page) || undefined,
    limit: Number(req.query.limit) || undefined,
    status: req.query.status as string | undefined,
    category: req.query.category as string | undefined,
    keyword: req.query.keyword as string | undefined,
  };
  const result = businessService.listAssortments(req.user!.tenantId, params);
  paginatedResponse(res, result.data, result.pagination);
}));

router.get('/assortments/:id', asyncHandler(async (req: Request, res: Response) => {
  const result = businessService.getAssortmentById(req.params.id, req.user!.tenantId);
  successResponse(res, result);
}));

router.put('/assortments/:id', asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    category: z.enum(['live', 'daily', 'promo', 'new_product']).optional(),
    status: z.enum(['draft', 'active', 'archived']).optional(),
  }).parse(req.body);
  const result = businessService.updateAssortment(req.params.id, req.user!.tenantId, input);
  successResponse(res, result, '组盘更新成功');
}));

router.delete('/assortments/:id', asyncHandler(async (req: Request, res: Response) => {
  businessService.deleteAssortment(req.params.id, req.user!.tenantId);
  successResponse(res, null, '组盘已删除');
}));

router.put('/assortments/:id/products', asyncHandler(async (req: Request, res: Response) => {
  const product = z.object({
    productId: z.string(),
    quantity: z.number().min(1),
    unitPrice: z.number().min(0),
  }).parse(req.body);
  const result = businessService.addProductToAssortment(req.params.id, req.user!.tenantId, product);
  successResponse(res, result, '商品已添加到组盘');
}));

router.delete('/assortments/:id/products/:productId', asyncHandler(async (req: Request, res: Response) => {
  const result = businessService.removeProductFromAssortment(req.params.id, req.user!.tenantId, req.params.productId);
  successResponse(res, result, '商品已从组盘移除');
}));

router.get('/assortments/:id/preview', asyncHandler(async (req: Request, res: Response) => {
  const result = businessService.previewAssortment(req.params.id, req.user!.tenantId);
  successResponse(res, result);
}));

// ==================== Service Tickets (客服) ====================

router.post('/tickets', asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    orderId: z.string().optional(),
    customerName: z.string().optional(),
    customerContact: z.string().optional(),
    channel: z.enum(['online', 'phone', 'email', 'wechat', 'platform']).optional(),
    category: z.enum(['inquiry', 'complaint', 'return', 'exchange', 'refund', 'logistics', 'after_sales', 'other']).optional(),
    subject: z.string().min(1),
    description: z.string().optional(),
    priority: z.enum(['urgent', 'high', 'normal', 'low']).optional(),
    assignedTo: z.string().optional(),
  }).parse(req.body);

  const result = businessService.createTicket(req.user!.tenantId, input);
  successResponse(res, result, '工单创建成功', 201);
}));

router.get('/tickets', asyncHandler(async (req: Request, res: Response) => {
  const params = {
    page: Number(req.query.page) || undefined,
    limit: Number(req.query.limit) || undefined,
    status: req.query.status as string | undefined,
    category: req.query.category as string | undefined,
    assignedTo: req.query.assignedTo as string | undefined,
    priority: req.query.priority as string | undefined,
    sortBy: req.query.sortBy as string | undefined,
    sortOrder: req.query.sortOrder as 'ASC' | 'DESC' | undefined,
  };
  const result = businessService.listTickets(req.user!.tenantId, params);
  paginatedResponse(res, result.data, result.pagination);
}));

router.post('/tickets/:id/messages', asyncHandler(async (req: Request, res: Response) => {
  const { content } = z.object({ content: z.string().min(1) }).parse(req.body);
  const result = businessService.addTicketMessage(req.params.id, req.user!.tenantId, 'agent', req.user!.userId, content);
  successResponse(res, result, '回复成功', 201);
}));

router.get('/tickets/:id', asyncHandler(async (req: Request, res: Response) => {
  const result = businessService.getServiceTicket(req.params.id, req.user!.tenantId);
  successResponse(res, result);
}));

router.put('/tickets/:id/status', asyncHandler(async (req: Request, res: Response) => {
  const { status } = z.object({
    status: z.enum(['open', 'in_progress', 'waiting_customer', 'escalated', 'closed']),
  }).parse(req.body);
  const result = businessService.updateServiceTicketStatus(req.params.id, req.user!.tenantId, status);
  successResponse(res, result, '工单状态更新成功');
}));

router.put('/tickets/:id/assign', asyncHandler(async (req: Request, res: Response) => {
  const { agentId } = z.object({ agentId: z.string() }).parse(req.body);
  const result = businessService.assignTicketToAgent(req.params.id, req.user!.tenantId, agentId);
  successResponse(res, result, '工单已分配');
}));

router.put('/tickets/:id/escalate', asyncHandler(async (req: Request, res: Response) => {
  const { reason } = z.object({ reason: z.string().optional() }).parse(req.body);
  const result = businessService.escalateTicket(req.params.id, req.user!.tenantId, reason);
  successResponse(res, result, '工单已升级');
}));

// ==================== CSV Import ====================

// POST /api/business/import/products — 批量导入商品
router.post('/import/products', asyncHandler(async (req: Request, res: Response) => {
  const { csv } = z.object({
    csv: z.string().min(1),
  }).parse(req.body);

  const result = businessService.batchImportProducts(req.user!.tenantId, csv, req.user!.userId);
  successResponse(res, result, `导入完成：成功 ${result.imported} 条，跳过 ${result.skipped} 条`);
}));

// POST /api/business/import/orders — 批量导入订单
router.post('/import/orders', asyncHandler(async (req: Request, res: Response) => {
  const { csv } = z.object({
    csv: z.string().min(1),
  }).parse(req.body);

  const result = businessService.batchImportOrders(req.user!.tenantId, csv, req.user!.userId);
  successResponse(res, result, `导入完成：成功 ${result.imported} 条，跳过 ${result.skipped} 条`);
}));

// ==================== Settlements (结算) ====================

router.post('/settlements', asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    projectId: z.string().optional(),
    period: z.string(),
    platform: z.string().optional(),
  }).parse(req.body);

  const result = businessService.createSettlement(req.user!.tenantId, input);
  successResponse(res, result, '结算单创建成功', 201);
}));

router.get('/settlements', asyncHandler(async (req: Request, res: Response) => {
  const params = {
    page: Number(req.query.page) || undefined,
    limit: Number(req.query.limit) || undefined,
    projectId: req.query.projectId as string | undefined,
    status: req.query.status as string | undefined,
  };
  const result = businessService.listSettlements(req.user!.tenantId, params);
  paginatedResponse(res, result.data, result.pagination);
}));

// ==================== Campaigns (大促活动) ====================

router.post('/campaigns', asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    name: z.string().min(1),
    code: z.string().optional(),
    platform: z.string().optional(),
    campaignType: z.enum(['promotional', 'festival', 'flash_sale', 'new_user', 'clearance']).optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    discountType: z.enum(['percentage', 'fixed', 'buy_one_get_one', 'tiered']).optional(),
    discountValue: z.number().optional(),
    thresholdAmount: z.number().optional(),
    budget: z.number().optional(),
    targetGmv: z.number().optional(),
    targetOrders: z.number().optional(),
    description: z.string().optional(),
    conditions: z.record(z.unknown()).optional(),
  }).parse(req.body);
  const result = businessService.createCampaign(req.user!.tenantId, input);
  successResponse(res, result, '活动创建成功', 201);
}));

router.get('/campaigns', asyncHandler(async (req: Request, res: Response) => {
  const params = {
    page: Number(req.query.page) || undefined,
    limit: Number(req.query.limit) || undefined,
    status: req.query.status as string | undefined,
    platform: req.query.platform as string | undefined,
    keyword: req.query.keyword as string | undefined,
  };
  const result = businessService.listCampaigns(req.user!.tenantId, params);
  paginatedResponse(res, result.data, result.pagination);
}));

router.get('/campaigns/:id', asyncHandler(async (req: Request, res: Response) => {
  const result = businessService.getCampaignById(req.params.id, req.user!.tenantId);
  if (!result) notFound('活动', req.params.id);
  successResponse(res, result);
}));

router.put('/campaigns/:id', asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    name: z.string().optional(),
    platform: z.string().optional(),
    campaignType: z.enum(['promotional', 'festival', 'flash_sale', 'new_user', 'clearance']).optional(),
    status: z.enum(['draft', 'active', 'paused', 'completed', 'cancelled']).optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    discountType: z.enum(['percentage', 'fixed', 'buy_one_get_one', 'tiered']).optional(),
    discountValue: z.number().optional(),
    budget: z.number().optional(),
    targetGmv: z.number().optional(),
    targetOrders: z.number().optional(),
    description: z.string().optional(),
  }).parse(req.body);
  const result = businessService.updateCampaign(req.params.id, req.user!.tenantId, input);
  successResponse(res, result, '活动更新成功');
}));

router.delete('/campaigns/:id', asyncHandler(async (req: Request, res: Response) => {
  businessService.deleteCampaign(req.params.id, req.user!.tenantId);
  successResponse(res, { id: req.params.id }, '活动已删除');
}));

// ==================== Ad Spend (投流记录) ====================

router.post('/ad-spend', asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    platform: z.enum(['douyin', 'taobao', 'jd', 'pdd', 'kuaishou', 'bilibili', 'other']),
    campaignId: z.string().optional(),
    projectId: z.string().optional(),
    channel: z.string().optional(),
    planName: z.string().optional(),
    spend: z.number().positive(),
    impression: z.number().optional(),
    click: z.number().optional(),
    cvr: z.number().optional(),
    cpc: z.number().optional(),
    cpm: z.number().optional(),
    orderCount: z.number().optional(),
    gmv: z.number().optional(),
    roi: z.number().optional(),
    note: z.string().optional(),
    spendDate: z.string(),
  }).parse(req.body);
  const result = businessService.createAdSpend(req.user!.tenantId, input);
  successResponse(res, result, '投流记录创建成功', 201);
}));

router.get('/ad-spend', asyncHandler(async (req: Request, res: Response) => {
  const params = {
    page: Number(req.query.page) || undefined,
    limit: Number(req.query.limit) || undefined,
    platform: req.query.platform as string | undefined,
    campaignId: req.query.campaignId as string | undefined,
    startDate: req.query.startDate as string | undefined,
    endDate: req.query.endDate as string | undefined,
  };
  const result = businessService.listAdSpend(req.user!.tenantId, params);
  paginatedResponse(res, result.data, result.pagination);
}));

router.get('/ad-spend/summary', asyncHandler(async (req: Request, res: Response) => {
  const params = {
    platform: req.query.platform as string | undefined,
    startDate: req.query.startDate as string | undefined,
    endDate: req.query.endDate as string | undefined,
  };
  const result = businessService.getAdSpendSummary(req.user!.tenantId, params);
  successResponse(res, result);
}));

// ==================== Product Reviews (商品评价) ====================

router.post('/reviews', asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    productId: z.string(),
    orderId: z.string().optional(),
    userId: z.string().optional(),
    rating: z.number().int().min(1).max(5),
    description: z.string().optional(),
    images: z.array(z.string()).optional(),
  }).parse(req.body);
  const result = businessService.createReview(req.user!.tenantId, input);
  successResponse(res, result, '评价提交成功', 201);
}));

router.get('/reviews', asyncHandler(async (req: Request, res: Response) => {
  const params = {
    page: Number(req.query.page) || undefined,
    limit: Number(req.query.limit) || undefined,
    productId: req.query.productId as string | undefined,
    rating: req.query.rating ? Number(req.query.rating) : undefined,
    status: req.query.status as string | undefined,
  };
  const result = businessService.listReviews(req.user!.tenantId, params);
  paginatedResponse(res, result.data, result.pagination);
}));

router.put('/reviews/:id/approve', asyncHandler(async (req: Request, res: Response) => {
  const result = businessService.approveReview(req.params.id, req.user!.tenantId);
  successResponse(res, result, '评价已审核通过');
}));

router.put('/reviews/:id/reply', asyncHandler(async (req: Request, res: Response) => {
  const { reply } = z.object({ reply: z.string().min(1) }).parse(req.body);
  const result = businessService.replyToReview(req.params.id, req.user!.tenantId, { reply, userId: req.user!.userId });
  successResponse(res, result, '回复成功');
}));

router.get('/products/:productId/review-stats', asyncHandler(async (req: Request, res: Response) => {
  const result = businessService.getProductReviewStats(req.user!.tenantId, req.params.productId);
  successResponse(res, result);
}));

// ==================== C1: 退货闭环 ====================
router.post('/returns', asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    ticketId: z.string().optional(), orderId: z.string().optional(),
    reason: z.string().optional(),
    returnItems: z.array(z.object({
      productId: z.string().optional(), sku: z.string().optional(), name: z.string().optional(),
      quantity: z.number().int().min(1), unitPrice: z.number().min(0),
    })).min(1),
    refundAmount: z.number().min(0).optional(), note: z.string().optional(),
  }).parse(req.body);
  successResponse(res, aftersalesService.createReturn(req.user!.tenantId, req.user!.userId, input));
}));

router.get('/returns', asyncHandler(async (req: Request, res: Response) => {
  const { status, orderId } = req.query as Record<string, string>;
  successResponse(res, aftersalesService.listReturns(req.user!.tenantId, { status, orderId }));
}));

router.get('/returns/:id', asyncHandler(async (req: Request, res: Response) => {
  const r = aftersalesService.getReturn(req.params.id, req.user!.tenantId);
  if (!r) return notFound('退货申请', req.params.id);
  successResponse(res, r);
}));

router.post('/returns/:id/approve', asyncHandler(async (req: Request, res: Response) => {
  const { note } = (req.body || {}) as { note?: string };
  const r = aftersalesService.approveReturn(req.params.id, req.user!.tenantId, req.user!.userId, note);
  if (!r) return notFound('退货申请', req.params.id);
  successResponse(res, r, '退货审批通过');
}));

router.post('/returns/:id/reject', asyncHandler(async (req: Request, res: Response) => {
  const { note } = (req.body || {}) as { note?: string };
  const r = aftersalesService.rejectReturn(req.params.id, req.user!.tenantId, note);
  if (!r) return notFound('退货申请', req.params.id);
  successResponse(res, r, '退货已驳回');
}));

router.post('/returns/:id/receive', asyncHandler(async (req: Request, res: Response) => {
  const r = aftersalesService.receiveReturn(req.params.id, req.user!.tenantId, req.user!.userId);
  if (!r) return notFound('退货申请', req.params.id);
  successResponse(res, r, '退货已入库');
}));

router.post('/returns/:id/refund', asyncHandler(async (req: Request, res: Response) => {
  const r = aftersalesService.processRefund(req.params.id, req.user!.tenantId);
  if (!r) return notFound('退款申请', req.params.id);
  successResponse(res, r, '退款已完成');
}));

// ==================== C2: 客户标签 ====================
router.post('/customer-tags', asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    customerId: z.string(), customerName: z.string().optional(),
    tag: z.string().min(1), category: z.enum(['behavior','demographic','value','risk','custom']).optional(),
    score: z.number().optional(), source: z.string().optional(),
  }).parse(req.body);
  successResponse(res, aftersalesService.addTag(req.user!.tenantId, input));
}));

router.get('/customer-tags', asyncHandler(async (req: Request, res: Response) => {
  const customerId = req.query.customerId as string | undefined;
  successResponse(res, aftersalesService.listTags(req.user!.tenantId, customerId));
}));

router.delete('/customer-tags/:id', asyncHandler(async (req: Request, res: Response) => {
  if (!aftersalesService.removeTag(req.params.id, req.user!.tenantId)) return notFound('标签', req.params.id);
  successResponse(res, { deleted: true });
}));

router.get('/customer-segments', asyncHandler(async (req: Request, res: Response) => {
  successResponse(res, aftersalesService.getCustomerSegments(req.user!.tenantId));
}));

// ==================== C3: 转化分析 ====================
router.get('/conversion-analysis', asyncHandler(async (req: Request, res: Response) => {
  const from = (req.query.from as string) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to = (req.query.to as string) || new Date().toISOString().slice(0, 10);
  successResponse(res, aftersalesService.analyzeConversion(req.user!.tenantId, from, to));
}));

export default router;
