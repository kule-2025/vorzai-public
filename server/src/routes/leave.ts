/**
 * 调休与休假管理 API 路由
 * 挂载：/api/leave/*
 */
import { Router, Request, Response } from 'express';
import { authenticateToken, tenantIsolation } from '../middleware/auth';
import { overtimeService, leaveService } from '../services/leaveService';

const router = Router();

// 所有端点需鉴权 + 多租户隔离
router.use(authenticateToken, tenantIsolation);

// ============================================================
// 休假类型
// ============================================================
router.get('/types', (_req: Request, res: Response) => {
  const tenant_id = (res as any).tenantId;
  const types = leaveService.getActiveLeaveTypes(tenant_id);
  res.json({ success: true, data: types });
});

// ============================================================
// 加班记录
// ============================================================
router.post('/overtime', (req: Request, res: Response) => {
  const tenant_id = (res as any).tenantId;
  const { employee_id, date, start_time, end_time, hours, reason } = req.body;
  if (!employee_id || !date || !start_time || !end_time || !hours) {
    res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: '缺少必填字段' } });
    return;
  }
  const record = overtimeService.createOvertime({ tenant_id, employee_id, date, start_time, end_time, hours, reason });
  res.status(201).json({ success: true, data: record });
});

router.get('/overtime/:id', (req: Request, res: Response) => {
  const tenant_id = (res as any).tenantId;
  const record = overtimeService.getById(req.params.id, tenant_id);
  if (!record) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '记录不存在' } }); return; }
  res.json({ success: true, data: record });
});

router.get('/overtime/employee/:employee_id', (req: Request, res: Response) => {
  const tenant_id = (res as any).tenantId;
  const year = req.query.year ? parseInt(req.query.year as string) : undefined;
  const records = overtimeService.listByEmployee(req.params.employee_id, tenant_id, year);
  res.json({ success: true, data: records });
});

router.post('/overtime/:id/approve', (req: Request, res: Response) => {
  const tenant_id = (res as any).tenantId;
  const userId = (req as any).user?.id;
  const { status, rejected_reason } = req.body;
  if (!['approved', 'rejected'].includes(status)) {
    res.status(400).json({ success: false, error: { code: 'INVALID_STATUS', message: '状态值必须为 approved 或 rejected' } });
    return;
  }
  const result = overtimeService.approveOvertime(req.params.id, tenant_id, userId, status);
  if (!result) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '加班记录不存在或已处理' } });
    return;
  }
  res.json({ success: true, data: result });
});

// 待审批加班
router.get('/overtime-pending', (_req: Request, res: Response) => {
  const tenant_id = (res as any).tenantId;
  res.json({ success: true, data: overtimeService.listPending(tenant_id) });
});

// ============================================================
// 休假余额
// ============================================================
router.get('/balances/:employee_id', (req: Request, res: Response) => {
  const tenant_id = (res as any).tenantId;
  const year = req.query.year ? parseInt(req.query.year as string) : undefined;
  const balances = leaveService.getBalances(req.params.employee_id, tenant_id, year);
  res.json({ success: true, data: balances });
});

router.get('/balances/:employee_id/check-compensatory', (req: Request, res: Response) => {
  const tenant_id = (res as any).tenantId;
  const hours = parseFloat(req.query.hours as string) || 8;
  const check = leaveService.checkCompensatoryBalance(req.params.employee_id, tenant_id, hours);
  res.json({ success: true, data: check });
});

// 调休额度汇总（有效余额 + 即将过期 + 流水账），前端调休工作台单一数据源
router.get('/compensatory-summary/:employee_id', (req: Request, res: Response) => {
  const tenant_id = (res as any).tenantId;
  const year = req.query.year ? parseInt(req.query.year as string) : undefined;
  const summary = leaveService.getCompensatorySummary(tenant_id, req.params.employee_id, year);
  res.json({ success: true, data: summary });
});

// ============================================================
// 休假申请
// ============================================================
router.post('/applications', (req: Request, res: Response) => {
  const tenant_id = (res as any).tenantId;
  const { employee_id, leave_type_id, start_datetime, end_datetime, total_hours, reason, overtime_record_id } = req.body;
  if (!employee_id || !leave_type_id || !start_datetime || !end_datetime || !total_hours) {
    res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: '缺少必填字段' } });
    return;
  }
  const result = leaveService.applyLeave({ tenant_id, employee_id, leave_type_id, start_datetime, end_datetime, total_hours, reason, overtime_record_id });
  if (result.error) {
    res.status(400).json({ success: false, error: { code: 'APPLY_FAILED', message: result.error } });
    return;
  }
  res.status(201).json({ success: true, data: result.application });
});

router.get('/applications/:id', (req: Request, res: Response) => {
  const tenant_id = (res as any).tenantId;
  const app = leaveService.getById(req.params.id, tenant_id);
  if (!app) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '申请不存在' } }); return; }
  res.json({ success: true, data: app });
});

router.get('/applications/employee/:employee_id', (req: Request, res: Response) => {
  const tenant_id = (res as any).tenantId;
  const year = req.query.year ? parseInt(req.query.year as string) : undefined;
  res.json({ success: true, data: leaveService.listByEmployee(req.params.employee_id, tenant_id, year) });
});

router.post('/applications/:id/approve', (req: Request, res: Response) => {
  const tenant_id = (res as any).tenantId;
  const userId = (req as any).user?.id;
  const { status, rejected_reason } = req.body;
  if (!['approved', 'rejected'].includes(status)) {
    res.status(400).json({ success: false, error: { code: 'INVALID_STATUS', message: '状态值必须为 approved 或 rejected' } });
    return;
  }
  const result = leaveService.approveLeave(req.params.id, tenant_id, userId, status, rejected_reason);
  if (!result) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '申请不存在或已处理' } });
    return;
  }
  res.json({ success: true, data: result });
});

router.post('/applications/:id/cancel', (req: Request, res: Response) => {
  const tenant_id = (res as any).tenantId;
  const result = leaveService.cancelLeave(req.params.id, tenant_id);
  if (!result) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '申请不存在或无法取消' } });
    return;
  }
  res.json({ success: true, data: result });
});

// 待审批休假
router.get('/applications-pending', (_req: Request, res: Response) => {
  const tenant_id = (res as any).tenantId;
  res.json({ success: true, data: leaveService.listPendingApprovals(tenant_id) });
});

// ============================================================
// 年度结转
// ============================================================
router.post('/carry-over', (req: Request, res: Response) => {
  const tenant_id = (res as any).tenantId;
  const from_year = req.body.from_year || new Date().getFullYear() - 1;
  const carry_over_hours = req.body.carry_over_hours || 80;
  const count = leaveService.carryOverCompensatoryBalance(tenant_id, from_year, carry_over_hours);
  res.json({ success: true, data: { carried_over_count: count, from_year, to_year: from_year + 1 } });
});

export default router;
