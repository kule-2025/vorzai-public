import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDatabase } from '../db';
import { NotFoundError } from '../utils/errors';
import { hrService } from '../services/hrService';
import { hrSpecializationService } from '../services/hrSpecializationService';
import { authenticateToken, tenantIsolation, requireRole } from '../middleware/auth';
import { asyncHandler, successResponse, paginatedResponse } from '../middleware/common';

const router = Router();
router.use(authenticateToken, tenantIsolation);

// ==================== Employees ====================

router.post('/employees', requireRole('admin', 'manager'), asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    employeeNo: z.string().min(1),
    name: z.string().min(1),
    gender: z.enum(['male', 'female', 'other']).optional(),
    birthDate: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().email().optional(),
    departmentId: z.string().optional(),
    position: z.string().optional(),
    jobLevel: z.string().optional(),
    employmentType: z.enum(['full_time', 'part_time', 'contract', 'intern', 'outsource']).optional(),
    hireDate: z.string().optional(),
    salaryBase: z.number().optional(),
    skills: z.array(z.string()).optional(),
  }).parse(req.body);

  const result = hrService.createEmployee(req.user!.tenantId, input);
  successResponse(res, result, '员工创建成功', 201);
}));

router.get('/employees', asyncHandler(async (req: Request, res: Response) => {
  const params = {
    page: Number(req.query.page) || undefined,
    limit: Number(req.query.limit) || undefined,
    departmentId: req.query.departmentId as string | undefined,
    status: req.query.status as string | undefined,
    keyword: req.query.keyword as string | undefined,
    sortBy: req.query.sortBy as string | undefined,
    sortOrder: req.query.sortOrder as 'ASC' | 'DESC' | undefined,
  };
  const result = hrService.listEmployees(req.user!.tenantId, params);
  paginatedResponse(res, result.data, result.pagination);
}));

router.get('/employees/:id', asyncHandler(async (req: Request, res: Response) => {
  const result = hrService.getEmployee(req.params.id, req.user!.tenantId);
  successResponse(res, result);
}));

router.put('/employees/:id', requireRole('admin', 'manager'), asyncHandler(async (req: Request, res: Response) => {
  const result = hrService.updateEmployee(req.params.id, req.user!.tenantId, req.body);
  successResponse(res, result, '员工信息更新成功');
}));

router.delete('/employees/:id', requireRole('admin'), asyncHandler(async (req: Request, res: Response) => {
  hrService.deleteEmployee(req.params.id, req.user!.tenantId);
  successResponse(res, null, '员工已删除');
}));

// ==================== Departments ====================

router.get('/departments', asyncHandler(async (req: Request, res: Response) => {
  const result = hrService.listDepartments(req.user!.tenantId);
  successResponse(res, result);
}));

router.post('/departments', requireRole('admin', 'manager'), asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    name: z.string().min(1),
    parentId: z.string().optional(),
    leaderId: z.string().optional(),
  }).parse(req.body);

  const result = hrService.createDepartment(req.user!.tenantId, input);
  successResponse(res, result, '部门创建成功', 201);
}));

// ==================== Attendance ====================

router.post('/attendance', asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    employeeId: z.string(),
    date: z.string(),
    checkIn: z.string().optional(),
    checkOut: z.string().optional(),
    status: z.enum(['normal', 'late', 'early_leave', 'absent', 'leave', 'overtime', 'business_trip']).optional(),
    workHours: z.number().optional(),
    overtimeHours: z.number().optional(),
    remark: z.string().optional(),
  }).parse(req.body);

  const result = hrService.recordAttendance(req.user!.tenantId, input);
  successResponse(res, result, '考勤记录成功', 201);
}));

router.get('/attendance', asyncHandler(async (req: Request, res: Response) => {
  const params = {
    page: Number(req.query.page) || undefined,
    limit: Number(req.query.limit) || undefined,
    employeeId: req.query.employeeId as string | undefined,
    startDate: req.query.startDate as string | undefined,
    endDate: req.query.endDate as string | undefined,
    status: req.query.status as string | undefined,
  };
  const result = hrService.getAttendanceRecords(req.user!.tenantId, params);
  paginatedResponse(res, result.data, result.pagination);
}));

router.get('/attendance/summary/:period', asyncHandler(async (req: Request, res: Response) => {
  const result = hrService.getAttendanceSummary(req.user!.tenantId, req.params.period);
  successResponse(res, result);
}));

// ==================== Performance ====================

router.post('/performance', requireRole('admin', 'manager'), asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    employeeId: z.string(),
    reviewerId: z.string().optional(),
    period: z.string(),
    cycle: z.enum(['weekly', 'monthly', 'quarterly', 'semi_annual', 'annual']).optional(),
    score: z.number().min(0).max(100).optional(),
    rating: z.enum(['S', 'A', 'B', 'C', 'D']).optional(),
    kpiData: z.record(z.unknown()).optional(),
    strengths: z.string().optional(),
    improvements: z.string().optional(),
    goalsNext: z.string().optional(),
  }).parse(req.body);

  const result = hrService.createPerformanceReview(req.user!.tenantId, input);
  successResponse(res, result, '绩效评估创建成功', 201);
}));

router.get('/performance', asyncHandler(async (req: Request, res: Response) => {
  const params = {
    page: Number(req.query.page) || undefined,
    limit: Number(req.query.limit) || undefined,
    employeeId: req.query.employeeId as string | undefined,
    period: req.query.period as string | undefined,
    cycle: req.query.cycle as string | undefined,
  };
  const result = hrService.listPerformanceReviews(req.user!.tenantId, params);
  paginatedResponse(res, result.data, result.pagination);
}));

// ==================== Payroll ====================

router.post('/payroll/calculate', requireRole('admin', 'manager'), asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    employeeId: z.string(),
    period: z.string(),
    rules: z.object({
      attendanceRate: z.number().min(0).max(1).optional(),
      performanceBonus: z.number().optional(),
      performanceCoefficient: z.number().min(0).optional(),
      allowance: z.number().optional(),
      deductions: z.number().optional(),
      overtimeRate: z.number().min(0).optional(),
    }).optional(),
  }).parse(req.body);

  const result = hrService.calculatePayroll(req.user!.tenantId, input.employeeId, input.period, input.rules);
  successResponse(res, result, '薪酬计算完成');
}));

router.get('/payroll/:employeeId/:period', asyncHandler(async (req: Request, res: Response) => {
  const db = getDatabase();
  const row = db.prepare(
    'SELECT p.*, e.tenant_id FROM payroll_records p JOIN employees e ON p.employee_id = e.id WHERE p.employee_id = ? AND p.period = ?'
  ).get(req.params.employeeId, req.params.period) as any;
  if (!row) throw new NotFoundError('薪酬记录', req.params.employeeId);
  if (row.tenant_id !== req.user!.tenantId) throw new NotFoundError('薪酬记录', req.params.employeeId);
  row.details = JSON.parse(row.details || '{}');
  row.tenant_id = undefined; // 不暴露租户 ID
  successResponse(res, row);
}));

router.post('/attendance/calculate', asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    employeeId: z.string(),
    startDate: z.string(),
    endDate: z.string(),
  }).parse(req.body);

  const result = hrService.calculateAttendance(req.user!.tenantId, input.employeeId, {
    startDate: input.startDate,
    endDate: input.endDate,
  });
  successResponse(res, result, '考勤计算完成');
}));

router.post('/performance/calculate', requireRole('admin', 'manager'), asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    employeeId: z.string(),
    achievement: z.number().min(0).max(100),
    collaboration: z.number().min(0).max(100),
    innovation: z.number().min(0).max(100),
    learning: z.number().min(0).max(100),
  }).parse(req.body);

  const result = hrService.calculatePerformance(req.user!.tenantId, input.employeeId, {
    achievement: input.achievement,
    collaboration: input.collaboration,
    innovation: input.innovation,
    learning: input.learning,
  });
  successResponse(res, result, '绩效计算完成');
}));

router.post('/efficiency/calculate', asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    startDate: z.string(),
    endDate: z.string(),
  }).parse(req.body);

  const result = hrService.calculateEfficiency(req.user!.tenantId, {
    startDate: input.startDate,
    endDate: input.endDate,
  });
  successResponse(res, result, '人效计算完成');
}));

// ==================== Efficiency ====================

router.get('/efficiency/:period', asyncHandler(async (req: Request, res: Response) => {
  const scope = req.query.scope as string | undefined;
  const scopeId = req.query.scopeId as string | undefined;
  const result = hrService.getEfficiencyMetrics(req.user!.tenantId, req.params.period, scope, scopeId);
  successResponse(res, result);
}));

// ==================== V2 · H1 组织架构树 ====================

/**
 * 组织架构树（部门层级 + 直属员工 + 人数汇总）
 * 前端 HRMS 组织视图的唯一数据源，替代原 IndexedDB 本地拼装
 */
router.get('/org-tree', asyncHandler(async (req: Request, res: Response) => {
  const result = hrService.getOrgTree(req.user!.tenantId);
  successResponse(res, result);
}));

// ==================== V2 · H2 前端本地数据回流 ====================

/**
 * 批量同步员工：前端 IndexedDB 历史数据 → 后端单一事实源
 * 幂等键 (tenant_id, employee_no)，重复调用不会产生脏数据
 */
router.post('/sync', requireRole('admin', 'manager'), asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    employees: z.array(
      z.object({
        employeeNo: z.string().optional(),
        name: z.string().min(1, '姓名不能为空'),
        department: z.string().optional(),
        departmentId: z.string().optional(),
        position: z.string().optional(),
        email: z.union([z.string().email('邮箱格式不正确'), z.literal('')]).optional(),
        phone: z.string().optional(),
        status: z.string().optional(),
        skills: z.array(z.string()).optional(),
        hireDate: z.string().optional(),
      })
    ).max(2000, '单次同步最多 2000 条，请分批提交'),
  }).parse(req.body);

  const result = hrService.syncEmployees(req.user!.tenantId, input.employees);
  successResponse(
    res,
    result,
    `同步完成：新增 ${result.created} 人，更新 ${result.updated} 人，跳过 ${result.skipped} 人`
  );
}));

// ==================== H3: 岗位绩效模型库 ====================
// POST /hr/job-models/seed  — 为新租户灌入 5 类默认模板
router.post('/job-models/seed', requireRole('admin'), asyncHandler(async (req: Request, res: Response) => {
  const n = hrSpecializationService.seedDefaults(req.user!.tenantId);
  successResponse(res, { seeded: n }, `已预置 ${n} 个岗位模型`);
}));

router.post('/job-models', requireRole('admin', 'manager'), asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    job_category: z.enum(['operator', 'cs', 'live', 'crossborder', 'hr', 'media']),
    name: z.string().min(1),
    description: z.string().optional(),
    dimension_weights: z.record(z.number()),
    kpi_template: z.array(z.object({ name: z.string(), type: z.string(), target: z.number(), unit: z.string(), weight: z.number() })),
    rating_scale: z.record(z.number()).optional(),
  }).parse(req.body);
  successResponse(res, hrSpecializationService.createJobModel(req.user!.tenantId, input));
}));

router.get('/job-models', asyncHandler(async (req: Request, res: Response) => {
  const category = req.query.category as string | undefined;
  successResponse(res, hrSpecializationService.listJobModels(req.user!.tenantId, category));
}));

router.get('/job-models/:id', asyncHandler(async (req: Request, res: Response) => {
  const model = hrSpecializationService.getJobModel(req.params.id, req.user!.tenantId);
  if (!model) throw new NotFoundError('岗位模型', req.params.id);
  successResponse(res, model);
}));

router.patch('/job-models/:id', requireRole('admin', 'manager'), asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    dimension_weights: z.record(z.number()).optional(),
    kpi_template: z.array(z.any()).optional(),
    rating_scale: z.record(z.number()).optional(),
  }).parse(req.body);
  const model = hrSpecializationService.updateJobModel(req.params.id, req.user!.tenantId, input);
  if (!model) throw new NotFoundError('岗位模型', req.params.id);
  successResponse(res, model);
}));

router.delete('/job-models/:id', requireRole('admin'), asyncHandler(async (req: Request, res: Response) => {
  if (!hrSpecializationService.deleteJobModel(req.params.id, req.user!.tenantId)) {
    throw new NotFoundError('岗位模型', req.params.id);
  }
  successResponse(res, { deleted: true });
}));

// ==================== H4: 行业日历 ====================
router.post('/calendars', requireRole('admin', 'manager'), asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    name: z.string().min(1),
    calendar_type: z.enum(['campaign', 'livestream', 'shift', 'crossborder_timezone', 'holiday', 'training']),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    payload: z.record(z.any()).optional(),
    is_recurring: z.boolean().optional(),
  }).parse(req.body);
  successResponse(res, hrSpecializationService.createCalendar(req.user!.tenantId, input));
}));

router.get('/calendars', asyncHandler(async (req: Request, res: Response) => {
  const { type, from, to } = req.query as Record<string, string>;
  successResponse(res, hrSpecializationService.listCalendars(req.user!.tenantId, { type, from, to }));
}));

router.get('/calendars/upcoming', asyncHandler(async (req: Request, res: Response) => {
  const days = Number((req.query as any).days) || 30;
  successResponse(res, hrSpecializationService.getUpcomingCalendars(req.user!.tenantId, days));
}));

router.patch('/calendars/:id', requireRole('admin', 'manager'), asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    name: z.string().min(1).optional(),
    calendar_type: z.string().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    payload: z.record(z.any()).optional(),
    is_recurring: z.boolean().optional(),
  }).parse(req.body);
  const cal = hrSpecializationService.updateCalendar(req.params.id, req.user!.tenantId, input);
  if (!cal) throw new NotFoundError('日历', req.params.id);
  successResponse(res, cal);
}));

router.delete('/calendars/:id', requireRole('admin'), asyncHandler(async (req: Request, res: Response) => {
  if (!hrSpecializationService.deleteCalendar(req.params.id, req.user!.tenantId)) {
    throw new NotFoundError('日历', req.params.id);
  }
  successResponse(res, { deleted: true });
}));

// ==================== H5: 离职风险 ====================
router.post('/retention/assess/:employeeId', requireRole('admin', 'manager'), asyncHandler(async (req: Request, res: Response) => {
  const risk = hrSpecializationService.assessRetentionRisk(req.user!.tenantId, req.params.employeeId);
  if (!risk) throw new NotFoundError('员工', req.params.employeeId);
  successResponse(res, risk);
}));

router.get('/retention/risks', asyncHandler(async (req: Request, res: Response) => {
  const { risk_level, acknowledged } = req.query as Record<string, string>;
  successResponse(res, hrSpecializationService.listRetentionRisks(req.user!.tenantId, {
    riskLevel: risk_level,
    acknowledged: acknowledged === undefined ? undefined : acknowledged === 'true',
  }));
}));

router.post('/retention/risks/:id/acknowledge', requireRole('admin', 'manager'), asyncHandler(async (req: Request, res: Response) => {
  const risk = hrSpecializationService.acknowledgeRisk(req.params.id, req.user!.tenantId);
  if (!risk) throw new NotFoundError('风险记录', req.params.id);
  successResponse(res, risk);
}));

// ==================== H6: HR 战略看板 ====================
router.get('/dashboard/strategy', asyncHandler(async (req: Request, res: Response) => {
  successResponse(res, hrSpecializationService.getStrategyDashboard(req.user!.tenantId));
}));

export default router;
