import { getDatabase, paginate, transaction, PaginationParams, PaginatedResult } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { NotFoundError, ValidationError, ConflictError } from '../utils/errors';
import { logger } from '../utils/logger';

export interface EmployeeInput {
  employeeNo: string;
  name: string;
  gender?: string;
  birthDate?: string;
  phone?: string;
  email?: string;
  departmentId?: string;
  position?: string;
  jobLevel?: string;
  employmentType?: string;
  hireDate?: string;
  salaryBase?: number;
  skills?: string[];
}

export interface AttendanceInput {
  employeeId: string;
  date: string;
  checkIn?: string;
  checkOut?: string;
  status?: string;
  workHours?: number;
  overtimeHours?: number;
  remark?: string;
}

export interface PerformanceInput {
  employeeId: string;
  reviewerId?: string;
  period: string;
  cycle?: string;
  score?: number;
  rating?: string;
  kpiData?: Record<string, unknown>;
  strengths?: string;
  improvements?: string;
  goalsNext?: string;
}

export interface PayrollRules {
  attendanceRate: number;       // 出勤率（0~1）
  performanceBonus: number;     // 绩效奖金基数
  performanceCoefficient: number; // 绩效系数（0~2）
  allowance: number;            // 津贴
  deductions: number;           // 扣除项
  overtimeRate: number;         // 加班倍率（默认 1.5）
}

export interface PerformanceReviewData {
  achievement: number;  // 业绩（权重 40%）
  collaboration: number; // 协作（权重 25%）
  innovation: number;    // 创新（权重 20%）
  learning: number;      // 学习（权重 15%）
}

export interface AttendanceDateRange {
  startDate: string;
  endDate: string;
}

export class HrService {
  // ==================== Employees ====================

  createEmployee(tenantId: string, input: EmployeeInput): Record<string, unknown> {
    const db = getDatabase();

    const existing = db.prepare('SELECT id FROM employees WHERE tenant_id = ? AND employee_no = ?').get(tenantId, input.employeeNo);
    if (existing) throw new ConflictError(`工号 ${input.employeeNo} 已存在`);

    const id = uuidv4();
    db.prepare(
      `INSERT INTO employees (id, tenant_id, employee_no, name, gender, birth_date, phone, email, department_id, position, job_level, employment_type, hire_date, salary_base, skills, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
    ).run(
      id, tenantId, input.employeeNo, input.name,
      input.gender || null, input.birthDate || null,
      input.phone || null, input.email || null,
      input.departmentId || null, input.position || null,
      input.jobLevel || null, input.employmentType || 'full_time',
      input.hireDate || new Date().toISOString().slice(0, 10),
      input.salaryBase || 0, JSON.stringify(input.skills || [])
    );

    logger.info('hr', `Employee created: ${input.name} (${input.employeeNo})`, { id, tenantId });
    return this.getEmployee(id, tenantId)!;
  }

  /**
   * SECURITY: tenantId is required — this returns the full employee row including
   * salary_base / salary_structure (PII). An unscoped id lookup leaked another
   * tenant's compensation data.
   */
  getEmployee(id: string, tenantId: string): Record<string, unknown> | null {
    const db = getDatabase();
    const row = db.prepare(
      `SELECT e.*, d.name as department_name
       FROM employees e LEFT JOIN departments d ON e.department_id = d.id
       WHERE e.id = ? AND e.tenant_id = ?`
    ).get(id, tenantId) as any;

    if (!row) return null;
    row.skills = JSON.parse(row.skills || '[]');
    row.salary_structure = JSON.parse(row.salary_structure || '{}');
    return row;
  }

  listEmployees(tenantId: string, params: PaginationParams & { departmentId?: string; status?: string; keyword?: string }): PaginatedResult<any> {
    let where = 'WHERE e.tenant_id = @tenantId';
    const queryParams: Record<string, unknown> = { tenantId };

    if (params.departmentId) { where += ' AND e.department_id = @departmentId'; queryParams.departmentId = params.departmentId; }
    if (params.status) { where += ' AND e.status = @status'; queryParams.status = params.status; }
    if (params.keyword) {
      where += ' AND (e.name LIKE @keyword OR e.employee_no LIKE @keyword OR e.position LIKE @keyword)';
      queryParams.keyword = `%${params.keyword}%`;
    }

    const query = `SELECT e.*, d.name as department_name FROM employees e LEFT JOIN departments d ON e.department_id = d.id ${where}`;
    const countQuery = `SELECT COUNT(*) as total FROM employees e ${where}`;

    const result = paginate(query, countQuery, queryParams, params);
    result.data = result.data.map((row: any) => ({
      ...row,
      skills: JSON.parse(row.skills || '[]'),
    }));
    return result;
  }

  updateEmployee(id: string, tenantId: string, input: Partial<EmployeeInput> & { status?: string; leaveDate?: string }): Record<string, unknown> {
    const db = getDatabase();
    const existing = db.prepare('SELECT id FROM employees WHERE id = ? AND tenant_id = ?').get(id, tenantId);
    if (!existing) throw new NotFoundError('员工', id);

    const fields: string[] = [];
    const values: unknown[] = [];
    const mapping: Record<string, string> = {
      name: 'name', gender: 'gender', birthDate: 'birth_date',
      phone: 'phone', email: 'email', departmentId: 'department_id',
      position: 'position', jobLevel: 'job_level', employmentType: 'employment_type',
      hireDate: 'hire_date', leaveDate: 'leave_date', salaryBase: 'salary_base',
      status: 'status',
    };

    for (const [key, column] of Object.entries(mapping)) {
      if ((input as any)[key] !== undefined) {
        fields.push(`${column} = ?`);
        values.push((input as any)[key]);
      }
    }

    if (input.skills !== undefined) {
      fields.push('skills = ?');
      values.push(JSON.stringify(input.skills));
    }

    if (fields.length === 0) throw new ValidationError('没有需要更新的字段');
    fields.push("updated_at = datetime('now', '+0000')");
    values.push(id, tenantId);

    db.prepare(`UPDATE employees SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...values);
    return this.getEmployee(id, tenantId)!;
  }

  deleteEmployee(id: string, tenantId: string): void {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM employees WHERE id = ? AND tenant_id = ?').run(id, tenantId);
    if ((result as any).changes === 0) throw new NotFoundError('员工', id);
  }

  // ==================== Attendance ====================

  recordAttendance(tenantId: string, input: AttendanceInput): Record<string, unknown> {
    const db = getDatabase();
    const employee = db.prepare('SELECT id FROM employees WHERE id = ? AND tenant_id = ?').get(input.employeeId, tenantId);
    if (!employee) throw new NotFoundError('员工', input.employeeId);

    // Use UPSERT to preserve row ID and avoid destroying audit trail
    db.prepare(
      `INSERT INTO attendance_records (id, tenant_id, employee_id, date, check_in, check_out, status, work_hours, overtime_hours, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(employee_id, date) DO UPDATE SET
         check_in = excluded.check_in,
         check_out = excluded.check_out,
         status = excluded.status,
         work_hours = excluded.work_hours,
         overtime_hours = excluded.overtime_hours,
         remark = excluded.remark`
    ).run(
      uuidv4(), tenantId, input.employeeId, input.date,
      input.checkIn || null, input.checkOut || null,
      input.status || 'normal', input.workHours || 0,
      input.overtimeHours || 0, input.remark || null
    );

    // Return the upserted record
    return db.prepare(
      'SELECT * FROM attendance_records WHERE employee_id = ? AND tenant_id = ? AND date = ?'
    ).get(input.employeeId, tenantId, input.date) as any;
  }

  getAttendanceRecords(tenantId: string, params: PaginationParams & { employeeId?: string; startDate?: string; endDate?: string; status?: string }): PaginatedResult<any> {
    let where = 'WHERE a.tenant_id = @tenantId';
    const queryParams: Record<string, unknown> = { tenantId };

    if (params.employeeId) { where += ' AND a.employee_id = @employeeId'; queryParams.employeeId = params.employeeId; }
    if (params.startDate) { where += ' AND a.date >= @startDate'; queryParams.startDate = params.startDate; }
    if (params.endDate) { where += ' AND a.date <= @endDate'; queryParams.endDate = params.endDate; }
    if (params.status) { where += ' AND a.status = @status'; queryParams.status = params.status; }

    const query = `SELECT a.*, e.name as employee_name, e.employee_no
                   FROM attendance_records a JOIN employees e ON a.employee_id = e.id ${where}`;
    const countQuery = `SELECT COUNT(*) as total FROM attendance_records a ${where}`;

    return paginate(query, countQuery, queryParams, params);
  }

  getAttendanceSummary(tenantId: string, period: string): Record<string, unknown> {
    const db = getDatabase();
    const [year, month] = period.split('-');
    const datePrefix = `${year}-${month}`;

    const summary = db.prepare(
      `SELECT
        COUNT(*) as total_records,
        SUM(CASE WHEN status = 'normal' THEN 1 ELSE 0 END) as normal_days,
        SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late_days,
        SUM(CASE WHEN status = 'early_leave' THEN 1 ELSE 0 END) as early_leave_days,
        SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent_days,
        SUM(CASE WHEN status = 'leave' THEN 1 ELSE 0 END) as leave_days,
        SUM(CASE WHEN status = 'overtime' THEN 1 ELSE 0 END) as overtime_days,
        SUM(work_hours) as total_work_hours,
        SUM(overtime_hours) as total_overtime_hours
       FROM attendance_records
       WHERE tenant_id = ? AND date LIKE ?`
    ).get(tenantId, `${datePrefix}%`) as any;

    return { period, ...summary };
  }

  // ==================== Performance ====================

  createPerformanceReview(tenantId: string, input: PerformanceInput): Record<string, unknown> {
    const db = getDatabase();
    const employee = db.prepare('SELECT id FROM employees WHERE id = ? AND tenant_id = ?').get(input.employeeId, tenantId);
    if (!employee) throw new NotFoundError('员工', input.employeeId);

    const id = uuidv4();
    db.prepare(
      `INSERT INTO performance_reviews (id, tenant_id, employee_id, reviewer_id, period, cycle, score, rating, kpi_data, strengths, improvements, goals_next, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`
    ).run(
      id, tenantId, input.employeeId, input.reviewerId || null,
      input.period, input.cycle || 'monthly',
      input.score || null, input.rating || null,
      JSON.stringify(input.kpiData || {}),
      input.strengths || null, input.improvements || null, input.goalsNext || null
    );

    return db.prepare('SELECT * FROM performance_reviews WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
  }

  listPerformanceReviews(tenantId: string, params: PaginationParams & { employeeId?: string; period?: string; cycle?: string }): PaginatedResult<any> {
    let where = 'WHERE p.tenant_id = @tenantId';
    const queryParams: Record<string, unknown> = { tenantId };

    if (params.employeeId) { where += ' AND p.employee_id = @employeeId'; queryParams.employeeId = params.employeeId; }
    if (params.period) { where += ' AND p.period = @period'; queryParams.period = params.period; }
    if (params.cycle) { where += ' AND p.cycle = @cycle'; queryParams.cycle = params.cycle; }

    const query = `SELECT p.*, e.name as employee_name, e.employee_no
                   FROM performance_reviews p JOIN employees e ON p.employee_id = e.id ${where}`;
    const countQuery = `SELECT COUNT(*) as total FROM performance_reviews p ${where}`;

    return paginate(query, countQuery, queryParams, params);
  }

  // ==================== Payroll ====================

  calculatePayroll(tenantId: string, employeeId: string, period: string, rules?: Partial<PayrollRules>): Record<string, unknown> {
    const db = getDatabase();
    const employee = db.prepare('SELECT * FROM employees WHERE id = ? AND tenant_id = ?').get(employeeId, tenantId) as any;
    if (!employee) throw new NotFoundError('员工', employeeId);

    const baseSalary = employee.salary_base || 0;
    const structure = JSON.parse(employee.salary_structure || '{}');

    // 计算考勤数据（实际出勤天数 / 应出勤天数 → 出勤率）
    const [year, month] = period.split('-');
    const datePrefix = `${year}-${month}`;

    // 应出勤天数：当月工作日 ≈ 21.75
    const expectedWorkingDays = 21.75;

    const attendanceStats = db.prepare(
      `SELECT
        COUNT(*) as total_days,
        SUM(CASE WHEN status = 'normal' THEN 1 ELSE 0 END) as normal_days,
        SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late_days,
        SUM(CASE WHEN status = 'early_leave' THEN 1 ELSE 0 END) as early_leave_days,
        SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent_days,
        SUM(CASE WHEN status = 'leave' THEN 1 ELSE 0 END) as leave_days,
        SUM(work_hours) as total_hours,
        SUM(overtime_hours) as total_overtime
       FROM attendance_records WHERE employee_id = ? AND date LIKE ?`
    ).get(employeeId, `${datePrefix}%`) as any;

    // 实际有效出勤天数 = 正常 + 迟到×0.8 + 早退×0.8（迟到/早退部分折算）
    const effectiveDays = (attendanceStats?.normal_days || 0)
      + (attendanceStats?.late_days || 0) * 0.8
      + (attendanceStats?.early_leave_days || 0) * 0.8;
    const attendanceRate = rules?.attendanceRate !== undefined
      ? rules.attendanceRate
      : expectedWorkingDays > 0 ? Math.min(1, effectiveDays / expectedWorkingDays) : 1;

    // 加班工资：加班小时 × 时薪 × 加班倍率
    const standardHours = 174;
    const hourlyRate = baseSalary / standardHours;
    const overtimeRate = rules?.overtimeRate ?? 1.5;
    const totalOvertime = attendanceStats?.total_overtime || 0;
    const overtimePay = totalOvertime * hourlyRate * overtimeRate;

    // 应发工资 = 基本工资 × 出勤率 + 绩效奖金 × 绩效系数 + 津贴 - 扣除项
    const performanceCoefficient = rules?.performanceCoefficient ?? 1;
    const performanceBonus = rules?.performanceBonus ?? (structure.bonus || 0);
    const allowance = rules?.allowance ?? (structure.allowance || 0);
    const deductions = rules?.deductions ?? 0;

    const attendanceSalary = baseSalary * attendanceRate;            // 基本工资 × 出勤率
    const performanceSalary = performanceBonus * performanceCoefficient; // 绩效奖金 × 绩效系数
    const grossSalary = attendanceSalary + performanceSalary + overtimePay + allowance; // 应发总额
    const netSalary = Math.max(0, grossSalary - deductions);        // 实发

    // 社保公积金（按应发基数计算，简化）
    const socialInsurance = grossSalary * 0.105;
    const housingFund = grossSalary * 0.12;
    const finalDeductions = deductions + socialInsurance + housingFund;
    const taxableIncome = Math.max(0, grossSalary - finalDeductions - 5000);
    const tax = this.calculateTax(taxableIncome);
    const finalNetSalary = grossSalary - finalDeductions - tax;

    const id = uuidv4();
    db.prepare(
      `INSERT INTO payroll_records (id, tenant_id, employee_id, period, base_salary, bonus, commission, overtime_pay, allowance, deductions, social_insurance, housing_fund, tax, net_salary, details, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'calculated')
       ON CONFLICT(employee_id, period) DO UPDATE SET
         base_salary = excluded.base_salary,
         bonus = excluded.bonus,
         commission = excluded.commission,
         overtime_pay = excluded.overtime_pay,
         allowance = excluded.allowance,
         deductions = excluded.deductions,
         social_insurance = excluded.social_insurance,
         housing_fund = excluded.housing_fund,
         tax = excluded.tax,
         net_salary = excluded.net_salary,
         details = excluded.details,
         status = excluded.status,
         updated_at = datetime('now', '+0000')`
    ).run(
      id, tenantId, employeeId, period,
      baseSalary, performanceBonus, 0,
      Math.round(overtimePay * 100) / 100, allowance,
      deductions, Math.round(socialInsurance * 100) / 100, Math.round(housingFund * 100) / 100,
      Math.round(tax * 100) / 100, Math.round(finalNetSalary * 100) / 100,
      JSON.stringify({
        attendanceRate: Math.round(attendanceRate * 10000) / 10000,
        attendanceSalary: Math.round(attendanceSalary * 100) / 100,
        performanceCoefficient,
        performanceSalary: Math.round(performanceSalary * 100) / 100,
        grossSalary: Math.round(grossSalary * 100) / 100,
        expectedDays: effectiveDays,
        normalDays: attendanceStats?.normal_days || 0,
        absentDays: attendanceStats?.absent_days || 0,
        overtimeHours: totalOvertime,
      })
    );

    return db.prepare('SELECT * FROM payroll_records WHERE employee_id = ? AND tenant_id = ? AND period = ?').get(employeeId, tenantId, period) as any;
  }

  /**
   * 考勤计算：根据打卡记录计算出勤率
   * 规则：正常出勤=1.0，迟到/早退=0.8，缺勤=0.0，请假=0.0，加班=1.5倍（额外）
   * @param dateRange 日期范围 { startDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD' }
   */
  calculateAttendance(tenantId: string, employeeId: string, dateRange: AttendanceDateRange): Record<string, unknown> {
    const db = getDatabase();
    const employee = db.prepare('SELECT id FROM employees WHERE id = ? AND tenant_id = ?').get(employeeId, tenantId);
    if (!employee) throw new NotFoundError('员工', employeeId);

    const stats = db.prepare(
      `SELECT
        SUM(CASE WHEN status = 'normal' THEN 1 ELSE 0 END) as normal_days,
        SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late_days,
        SUM(CASE WHEN status = 'early_leave' THEN 1 ELSE 0 END) as early_leave_days,
        SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent_days,
        SUM(CASE WHEN status = 'leave' THEN 1 ELSE 0 END) as leave_days,
        SUM(CASE WHEN status = 'overtime' THEN 1 ELSE 0 END) as overtime_days,
        SUM(work_hours) as total_hours,
        SUM(overtime_hours) as total_overtime
       FROM attendance_records WHERE employee_id = ? AND date >= ? AND date <= ?`
    ).get(employeeId, dateRange.startDate, dateRange.endDate) as any;

    const normalDays = stats?.normal_days || 0;
    const lateDays = stats?.late_days || 0;
    const earlyLeaveDays = stats?.early_leave_days || 0;
    const absentDays = stats?.absent_days || 0;
    const leaveDays = stats?.leave_days || 0;
    const overtimeDays = stats?.overtime_days || 0;
    const totalHours = stats?.total_hours || 0;
    const totalOvertime = stats?.total_overtime || 0;

    // 有效出勤天数（含折算）
    const effectiveDays = normalDays + lateDays * 0.8 + earlyLeaveDays * 0.8;
    const totalDays = normalDays + lateDays + earlyLeaveDays + absentDays + leaveDays + overtimeDays;
    const attendanceRate = totalDays > 0 ? Math.min(1, effectiveDays / totalDays) : 0;

    // 加班折算：加班小时 × 1.5
    const overtimeCreditHours = totalOvertime * 1.5;

    return {
      employeeId,
      dateRange: { startDate: dateRange.startDate, endDate: dateRange.endDate },
      breakdown: { normalDays, lateDays, earlyLeaveDays, absentDays, leaveDays, overtimeDays },
      totalHours,
      totalOvertime,
      overtimeCreditHours: Math.round(overtimeCreditHours * 100) / 100,
      effectiveDays: Math.round(effectiveDays * 100) / 100,
      attendanceRate: Math.round(attendanceRate * 10000) / 10000,
      // 出勤评级
      rating: attendanceRate >= 0.95 ? 'A' : attendanceRate >= 0.8 ? 'B' : attendanceRate >= 0.6 ? 'C' : 'D',
    };
  }

  /**
   * 绩效计算：加权平均评分
   * 权重：业绩 40% + 协作 25% + 创新 20% + 学习 15%
   * @param reviewData { achievement, collaboration, innovation, learning } 每项 0~100
   */
  calculatePerformance(tenantId: string, employeeId: string, reviewData: PerformanceReviewData): Record<string, unknown> {
    const db = getDatabase();
    const employee = db.prepare('SELECT id, name, employee_no FROM employees WHERE id = ? AND tenant_id = ?').get(employeeId, tenantId) as any;
    if (!employee) throw new NotFoundError('员工', employeeId);

    const { achievement, collaboration, innovation, learning } = reviewData;

    // 验证评分范围
    const scores = { achievement, collaboration, innovation, learning };
    for (const [k, v] of Object.entries(scores)) {
      if (typeof v !== 'number' || v < 0 || v > 100) {
        throw new ValidationError(`${k} 评分应在 0~100 之间`);
      }
    }

    // 加权平均：业绩 40% + 协作 25% + 创新 20% + 学习 15%
    const totalWeight = 0.4 + 0.25 + 0.2 + 0.15; // = 1.0
    const weightedScore =
      achievement * 0.40 +
      collaboration * 0.25 +
      innovation * 0.20 +
      learning * 0.15;

    // 等级判定（基于加权总分）
    const rating = weightedScore >= 90 ? 'S' : weightedScore >= 80 ? 'A' : weightedScore >= 65 ? 'B' : weightedScore >= 50 ? 'C' : 'D';

    return {
      employeeId,
      employeeName: employee.name,
      employeeNo: employee.employee_no,
      dimensionScores: scores,
      weights: { achievement: 0.4, collaboration: 0.25, innovation: 0.2, learning: 0.15 },
      weightedScore: Math.round(weightedScore * 100) / 100,
      rating,
      // 各维度加权贡献
      contributions: {
        achievement: Math.round(achievement * 0.4 * 100) / 100,
        collaboration: Math.round(collaboration * 0.25 * 100) / 100,
        innovation: Math.round(innovation * 0.2 * 100) / 100,
        learning: Math.round(learning * 0.15 * 100) / 100,
      },
    };
  }

  /**
   * 人效计算：团队总产出 / 团队人数 + 成本效率
   * 人效 = 团队总产出（GMV） / 活跃员工数
   * 成本效率 = 人均产出 / 人均成本
   */
  calculateEfficiency(tenantId: string, dateRange: AttendanceDateRange): Record<string, unknown> {
    const db = getDatabase();
    const { startDate, endDate } = dateRange;

    // 活跃员工数（active / probation）
    const headcount = (db.prepare(
      "SELECT COUNT(*) as count FROM employees WHERE tenant_id = ? AND status IN ('active', 'probation')"
    ).get(tenantId) as any).count;

    // 期间订单总 GMV（简化：按订单创建时间筛选）
    const gmvStats = db.prepare(
      `SELECT COUNT(*) as order_count, COALESCE(SUM(total_amount), 0) as total_gmv
       FROM orders WHERE tenant_id = ? AND created_at >= ? AND created_at <= ?`
    ).get(tenantId, startDate, endDate) as any;

    const totalGmv = gmvStats?.total_gmv || 0;
    const orderCount = gmvStats?.order_count || 0;

    // 团队总薪酬成本（活跃员工 salary_base 合计）
    const costStats = db.prepare(
      "SELECT COALESCE(SUM(salary_base), 0) as total_salary FROM employees WHERE tenant_id = ? AND status IN ('active', 'probation')"
    ).get(tenantId) as any;
    const totalSalary = costStats?.total_salary || 0;

    const gmvPerCapita = headcount > 0 ? totalGmv / headcount : 0;            // 人效 = GMV / 人数
    const salaryPerCapita = headcount > 0 ? totalSalary / headcount : 0;       // 人均成本
    const costEfficiency = salaryPerCapita > 0 ? gmvPerCapita / salaryPerCapita : 0; // 成本效率 = 人均产出 / 人均成本

    return {
      tenantId,
      dateRange: { startDate, endDate },
      headcount,
      totalGmv: Math.round(totalGmv * 100) / 100,
      orderCount,
      totalSalary: Math.round(totalSalary * 100) / 100,
      gmvPerCapita: Math.round(gmvPerCapita * 100) / 100,       // 人效
      salaryPerCapita: Math.round(salaryPerCapita * 100) / 100, // 人均成本
      ordersPerCapita: headcount > 0 ? Math.round(orderCount / headcount * 100) / 100 : 0,
      costEfficiency: Math.round(costEfficiency * 10000) / 10000, // 成本效率
    };
  }

  private calculateTax(taxableIncome: number): number {
    // 月度7级累进税率表（2019年起实施）
    const brackets = [
      { limit: 3000, rate: 0.03, deduction: 0 },
      { limit: 12000, rate: 0.10, deduction: 210 },
      { limit: 25000, rate: 0.20, deduction: 1410 },
      { limit: 35000, rate: 0.25, deduction: 2660 },
      { limit: 55000, rate: 0.30, deduction: 4410 },
      { limit: 80000, rate: 0.35, deduction: 7160 },
      { limit: Infinity, rate: 0.45, deduction: 15160 },
    ];

    for (const bracket of brackets) {
      if (taxableIncome <= bracket.limit) {
        return Math.max(0, taxableIncome * bracket.rate - bracket.deduction);
      }
    }
    return 0;
  }

  // ==================== Efficiency Metrics ====================

  getEfficiencyMetrics(tenantId: string, period: string, scope?: string, scopeId?: string): Record<string, unknown> | null {
    const db = getDatabase();
    let query = 'SELECT * FROM efficiency_metrics WHERE tenant_id = ? AND period = ?';
    const params: unknown[] = [tenantId, period];

    if (scope) { query += ' AND scope = ?'; params.push(scope); }
    if (scopeId) { query += ' AND scope_id = ?'; params.push(scopeId); }

    const row = db.prepare(query).get(...params) as any;
    if (row) {
      row.extra_metrics = JSON.parse(row.extra_metrics || '{}');
      return row;
    }

    // Calculate from raw data if not pre-computed
    const [year, month] = period.split('-');
    const firstDay = new Date(Number(year), Number(month) - 1, 1).toISOString().slice(0, 10);
    const lastDay = new Date(Number(year), Number(month), 0).toISOString().slice(0, 10);
    return this.computeEfficiencyMetrics(tenantId, period, scope || 'company', scopeId);
  }

  private computeEfficiencyMetrics(tenantId: string, period: string, scope: string, scopeId?: string): Record<string, unknown> {
    const db = getDatabase();
    const [year, month] = period.split('-');
    const datePrefix = `${year}-${month}`;

    // GMV 口径统一：仅计入已支付/部分支付（排除 unpaid/refunded），与 cockpit/analytics 一致
    let orderWhere = "WHERE tenant_id = ? AND created_at LIKE ? AND is_sandbox = 0 AND payment_status IN ('paid', 'partial')";
    const orderParams: unknown[] = [tenantId, `${datePrefix}%`];

    const orderStats = db.prepare(
      `SELECT COUNT(*) as order_count, COALESCE(SUM(paid_amount), 0) as gmv
       FROM orders ${orderWhere}`
    ).get(...orderParams) as any;

    let empWhere = 'WHERE tenant_id = ? AND status IN (?, ?)';
    const empParams: unknown[] = [tenantId, 'active', 'probation'];
    if (scope === 'department' && scopeId) {
      empWhere += ' AND department_id = ?';
      empParams.push(scopeId);
    }

    const headcount = (db.prepare(`SELECT COUNT(*) as count FROM employees ${empWhere}`).get(...empParams) as any).count;

    const gmv = Number(orderStats.gmv || 0);
    const orderCount = Number(orderStats.order_count || 0);

    const gmvPerCapita = headcount > 0 ? Math.round(gmv / headcount) : 0;
    const ordersPerCapita = headcount > 0 ? Math.round((orderCount / headcount) * 100) / 100 : 0;
    const revenuePerCapita = gmvPerCapita;

    // 写入 efficiency_metrics 缓存表（ON CONFLICT REPLACE 覆盖旧值）
    const id = uuidv4();
    db.prepare(
      `INSERT INTO efficiency_metrics (id, tenant_id, period, scope, scope_id, gmv, gmv_per_capita, order_count, orders_per_capita, revenue_per_capita, headcount, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+0000'))
       ON CONFLICT(tenant_id, period, scope, scope_id) DO UPDATE SET
         id = excluded.id, gmv = excluded.gmv, gmv_per_capita = excluded.gmv_per_capita,
         order_count = excluded.order_count, orders_per_capita = excluded.orders_per_capita,
         revenue_per_capita = excluded.revenue_per_capita, headcount = excluded.headcount,
         created_at = datetime('now', '+0000')`
    ).run(id, tenantId, period, scope, scopeId || null, gmv, gmvPerCapita, orderCount, ordersPerCapita, revenuePerCapita, headcount);

    return {
      tenant_id: tenantId,
      period,
      scope,
      scope_id: scopeId || null,
      headcount,
      gmv,
      order_count: orderCount,
      gmv_per_capita: gmvPerCapita,
      orders_per_capita: ordersPerCapita,
      revenue_per_capita: revenuePerCapita,
    };
  }

  // ==================== Departments ====================

  listDepartments(tenantId: string): Record<string, unknown>[] {
    const db = getDatabase();
    return db.prepare(
      `SELECT d.*, u.display_name as leader_name,
              (SELECT COUNT(*) FROM employees e WHERE e.department_id = d.id AND e.status IN ('active', 'probation')) as member_count
       FROM departments d LEFT JOIN users u ON d.leader_id = u.id
       WHERE d.tenant_id = ? ORDER BY d.sort_order`
    ).all(tenantId) as any[];
  }

  createDepartment(tenantId: string, input: { name: string; parentId?: string; leaderId?: string }): Record<string, unknown> {
    const db = getDatabase();
    const id = uuidv4();

    db.prepare(
      'INSERT INTO departments (id, tenant_id, name, parent_id, leader_id) VALUES (?, ?, ?, ?, ?)'
    ).run(id, tenantId, input.name, input.parentId || null, input.leaderId || null);

    return db.prepare('SELECT * FROM departments WHERE id = ?').get(id) as any;
  }

  // ==================== V2 · H1 组织架构树 ====================

  /**
   * 组织架构树：部门层级 + 直属员工 + 人数汇总
   *
   * 口径说明（前端不得自行换算）：
   *   memberCount    = 本部门在岗人数（status IN active/probation）
   *   totalHeadcount = 本部门 + 全部子部门在岗人数（自底向上累加）
   *   未分配部门的员工归入虚拟节点 __unassigned__
   */
  getOrgTree(tenantId: string): Record<string, unknown> {
    const db = getDatabase();

    const departments = db.prepare(
      `SELECT d.id, d.name, d.parent_id, d.leader_id, d.sort_order,
              u.display_name AS leader_name
       FROM departments d
       LEFT JOIN users u ON d.leader_id = u.id
       WHERE d.tenant_id = ?
       ORDER BY d.sort_order, d.name`
    ).all(tenantId) as any[];

    const employees = db.prepare(
      `SELECT id, employee_no, name, department_id, position, job_level, status, hire_date
       FROM employees
       WHERE tenant_id = ?
       ORDER BY employee_no`
    ).all(tenantId) as any[];

    const ACTIVE = new Set(['active', 'probation']);

    // 按部门归集员工
    const byDept = new Map<string, any[]>();
    const unassigned: any[] = [];
    for (const e of employees) {
      const item = {
        id: e.id,
        employeeNo: e.employee_no,
        name: e.name,
        position: e.position,
        jobLevel: e.job_level,
        status: e.status,
        hireDate: e.hire_date,
      };
      if (!e.department_id) { unassigned.push(item); continue; }
      const list = byDept.get(e.department_id);
      if (list) list.push(item);
      else byDept.set(e.department_id, [item]);
    }

    interface OrgNode {
      id: string;
      name: string;
      parentId: string | null;
      leaderId: string | null;
      leaderName: string | null;
      memberCount: number;
      totalHeadcount: number;
      members: any[];
      children: OrgNode[];
    }

    const nodeMap = new Map<string, OrgNode>();
    for (const d of departments) {
      const members = byDept.get(d.id) || [];
      nodeMap.set(d.id, {
        id: d.id,
        name: d.name,
        parentId: d.parent_id || null,
        leaderId: d.leader_id || null,
        leaderName: d.leader_name || null,
        memberCount: members.filter((m) => ACTIVE.has(m.status)).length,
        totalHeadcount: 0,
        members,
        children: [],
      });
    }

    // 挂载父子关系；父节点缺失（脏数据）时降级为根节点，避免整棵树丢失
    const roots: OrgNode[] = [];
    for (const node of nodeMap.values()) {
      const parent = node.parentId ? nodeMap.get(node.parentId) : undefined;
      if (parent && parent.id !== node.id) parent.children.push(node);
      else roots.push(node);
    }

    // 自底向上累加在岗人数，visited 防御环形引用
    const visited = new Set<string>();
    const accumulate = (node: OrgNode): number => {
      if (visited.has(node.id)) return node.memberCount;
      visited.add(node.id);
      let sum = node.memberCount;
      for (const c of node.children) sum += accumulate(c);
      node.totalHeadcount = sum;
      return sum;
    };
    for (const r of roots) accumulate(r);

    if (unassigned.length > 0) {
      roots.push({
        id: '__unassigned__',
        name: '未分配部门',
        parentId: null,
        leaderId: null,
        leaderName: null,
        memberCount: unassigned.filter((m) => ACTIVE.has(m.status)).length,
        totalHeadcount: unassigned.filter((m) => ACTIVE.has(m.status)).length,
        members: unassigned,
        children: [],
      });
    }

    const activeTotal = employees.filter((e) => ACTIVE.has(e.status)).length;

    return {
      tree: roots,
      summary: {
        departmentCount: departments.length,
        employeeTotal: employees.length,
        activeTotal,
        resignedTotal: employees.length - activeTotal,
        unassignedCount: unassigned.length,
        maxDepth: roots.reduce((m, r) => Math.max(m, depthOf(r)), 0),
      },
      generatedAt: new Date().toISOString(),
    };
  }

  // ==================== V2 · H2 前端本地数据回流 ====================

  /**
   * 批量同步员工（前端 IndexedDB 历史数据 → 后端单一事实源）
   *
   * 幂等策略：以 (tenant_id, employee_no) 为唯一键
   *   - 已存在 → 更新可变字段（name/position/email/phone/department/skills/status）
   *   - 不存在 → 新建
   *   - employee_no 缺失 → 用 EMP-{name hash} 兜底不了，直接计入 skipped 并给出原因
   * 部门以名称匹配，匹配不到时自动建部门，避免同步中断。
   */
  syncEmployees(
    tenantId: string,
    list: Array<{
      employeeNo?: string;
      name: string;
      department?: string;
      departmentId?: string;
      position?: string;
      email?: string;
      phone?: string;
      status?: string;
      skills?: string[];
      hireDate?: string;
    }>
  ): Record<string, unknown> {
    const db = getDatabase();

    if (!Array.isArray(list) || list.length === 0) {
      return { created: 0, updated: 0, skipped: 0, createdDepartments: 0, details: [] };
    }

    // 部门名 → id 索引（大小写与首尾空格不敏感）
    const deptRows = db.prepare('SELECT id, name FROM departments WHERE tenant_id = ?').all(tenantId) as any[];
    const deptByName = new Map<string, string>();
    for (const d of deptRows) deptByName.set(String(d.name).trim().toLowerCase(), d.id);

    const details: Array<{ name: string; action: string; reason?: string }> = [];
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let createdDepartments = 0;

    const VALID_STATUS = new Set(['active', 'probation', 'leave', 'resigned', 'terminated']);

    transaction(() => {
      for (const raw of list) {
        const name = String(raw.name || '').trim();
        if (!name) {
          skipped++;
          details.push({ name: '(空)', action: 'skipped', reason: '缺少姓名' });
          continue;
        }

        const employeeNo = String(raw.employeeNo || '').trim();
        if (!employeeNo) {
          skipped++;
          details.push({ name, action: 'skipped', reason: '缺少工号 employeeNo，无法保证幂等' });
          continue;
        }

        // 解析部门
        let departmentId: string | null = raw.departmentId || null;
        if (!departmentId && raw.department) {
          const key = String(raw.department).trim().toLowerCase();
          const hit = deptByName.get(key);
          if (hit) {
            departmentId = hit;
          } else {
            const newId = uuidv4();
            db.prepare(
              'INSERT INTO departments (id, tenant_id, name) VALUES (?, ?, ?)'
            ).run(newId, tenantId, String(raw.department).trim());
            deptByName.set(key, newId);
            departmentId = newId;
            createdDepartments++;
          }
        }

        // 前端只有 active/inactive 两态，映射到后端枚举
        let status = raw.status ? String(raw.status) : 'active';
        if (status === 'inactive') status = 'resigned';
        if (!VALID_STATUS.has(status)) status = 'active';

        const skills = JSON.stringify(Array.isArray(raw.skills) ? raw.skills : []);
        const existing = db.prepare(
          'SELECT id FROM employees WHERE tenant_id = ? AND employee_no = ?'
        ).get(tenantId, employeeNo) as any;

        if (existing) {
          db.prepare(
            `UPDATE employees
             SET name = ?, position = ?, email = ?, phone = ?,
                 department_id = COALESCE(?, department_id),
                 status = ?, skills = ?, updated_at = datetime('now')
             WHERE id = ? AND tenant_id = ?`
          ).run(
            name, raw.position || null, raw.email || null, raw.phone || null,
            departmentId, status, skills, existing.id, tenantId
          );
          updated++;
          details.push({ name, action: 'updated' });
        } else {
          db.prepare(
            `INSERT INTO employees
               (id, tenant_id, employee_no, name, phone, email, department_id,
                position, hire_date, status, skills)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            uuidv4(), tenantId, employeeNo, name, raw.phone || null, raw.email || null,
            departmentId, raw.position || null, raw.hireDate || null, status, skills
          );
          created++;
          details.push({ name, action: 'created' });
        }
      }
    });

    logger.info('hr', `员工批量同步完成: 新增 ${created} / 更新 ${updated} / 跳过 ${skipped}`, {
      tenantId,
      createdDepartments,
    });

    return { created, updated, skipped, createdDepartments, details };
  }
}

/** 计算节点深度（根为 1），供组织树 summary 使用 */
function depthOf(node: { children: any[] }, guard = 0): number {
  if (guard > 32) return guard; // 防御脏数据造成的深递归
  if (!node.children || node.children.length === 0) return 1;
  return 1 + Math.max(...node.children.map((c) => depthOf(c, guard + 1)));
}

export const hrService = new HrService();
