/**
 * 调休与休假管理服务
 *
 * 核心规则：
 *   1. 加班审批通过后，自动累积调休额度（1:1 小时换算）
 *   2. 员工申请调休时，校验剩余额度
 *   3. 调休使用后扣减额度，关联原加班记录
 *   4. 支持年假/事假/病假等多类型休假
 *   5. 跨年结转：未使用的调休额度可结转至下一年度
 */
import { getDatabase, transaction } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** 调休余额行的有效期：显式 expires_at 优先；否则按所属年度年底（当年加班当年有效，结转额度转入年度年底过期） */
function balanceExpiry(row: { year: number; expires_at?: string | null }): string {
  return row.expires_at || `${row.year}-12-31`;
}

function isBalanceValid(row: { year: number; expires_at?: string | null }, today: string): boolean {
  return balanceExpiry(row) >= today;
}

// ============================================================
// 类型定义
// ============================================================

export interface OvertimeRecord {
  id: string;
  tenant_id: string;
  employee_id: string;
  date: string;
  start_time: string;
  end_time: string;
  hours: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'converted';
  approved_by?: string;
  approved_at?: string;
  converted_to_leave: number;
  created_at: string;
}

export interface LeaveType {
  id: string;
  tenant_id: string;
  name: string;
  category: string;
  is_paid: number;
  max_days_per_year: number | null;
  min_hours_per_application: number;
  approval_required: number;
  overtime_source: number;
  icon: string;
  sort_order: number;
  is_active: number;
}

export interface LeaveBalance {
  id: string;
  employee_id: string;
  leave_type_id: string;
  leave_type_name: string;
  year: number;
  total_hours: number;
  used_hours: number;
  remaining_hours: number;
}

export interface LeaveApplication {
  id: string;
  tenant_id: string;
  employee_id: string;
  leave_type_id: string;
  start_datetime: string;
  end_datetime: string;
  total_hours: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'taken';
  submitted_at: string;
  approved_by?: string;
  approved_at?: string;
  rejected_reason?: string;
  overtime_record_id?: string;
}

// ============================================================
// 加班管理
// ============================================================

export const overtimeService = {
  /** 创建加班记录 */
  createOvertime(params: {
    tenant_id: string;
    employee_id: string;
    date: string;
    start_time: string;
    end_time: string;
    hours: number;
    reason: string;
  }): OvertimeRecord {
    const db = getDatabase();
    const id = uuidv4();
    db.prepare(`
      INSERT INTO overtime_records (id, tenant_id, employee_id, date, start_time, end_time, hours, reason, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(id, params.tenant_id, params.employee_id, params.date, params.start_time, params.end_time, params.hours, params.reason);

    logger.info('overtime', `Overtime created: ${id} for employee ${params.employee_id}, ${params.hours}h`);
    return overtimeService.getById(id, params.tenant_id)!;
  },

  /** 审批加班 */
  approveOvertime(id: string, tenant_id: string, approved_by: string, status: 'approved' | 'rejected'): OvertimeRecord | null {
    return transaction((db) => {
      const record = db.prepare(
        'SELECT * FROM overtime_records WHERE id = ? AND tenant_id = ?'
      ).get(id, tenant_id) as any;
      if (!record || record.status !== 'pending') return null;

      db.prepare(
        'UPDATE overtime_records SET status = ?, approved_by = ?, approved_at = datetime(\'now\') WHERE id = ? AND tenant_id = ?'
      ).run(status, approved_by, id, tenant_id);

      // 审批通过 → 自动增加调休额度
      if (status === 'approved') {
        overtimeService.addCompensatoryLeaveBalance(tenant_id, record.employee_id, record.hours, id);
      }

      logger.info('overtime', `Overtime ${id} ${status}`);
      return overtimeService.getById(id, tenant_id);
    })!;
  },

  /** 加班审批通过后，自动累积调休额度 */
  addCompensatoryLeaveBalance(tenant_id: string, employee_id: string, hours: number, overtime_record_id: string): void {
    const db = getDatabase();
    const currentYear = new Date().getFullYear();

    // 查找或创建调休额度记录
    const existing = db.prepare(`
      SELECT * FROM leave_balances
      WHERE tenant_id = ? AND employee_id = ? AND leave_type_id = 'lt_compensatory' AND year = ?
    `).get(tenant_id, employee_id, currentYear) as any;

    if (existing) {
      db.prepare(`
        UPDATE leave_balances
        SET total_hours = total_hours + ?, remaining_hours = remaining_hours + ?, updated_at = datetime('now')
        WHERE id = ? AND tenant_id = ?
      `).run(hours, hours, existing.id, tenant_id);
      logger.info('overtime', `Compensatory leave +${hours}h for employee ${employee_id} (existing balance)`);
    } else {
      db.prepare(`
        INSERT INTO leave_balances (id, tenant_id, employee_id, leave_type_id, year, total_hours, used_hours, remaining_hours, source)
        VALUES (?, ?, ?, 'lt_compensatory', ?, ?, 0, ?, 'overtime')
      `).run(uuidv4(), tenant_id, employee_id, currentYear, hours, hours);
      logger.info('overtime', `Compensatory leave balance created for employee ${employee_id}, ${hours}h`);
    }

    // 标记加班记录的已转换额度
    db.prepare(
      'UPDATE overtime_records SET converted_to_leave = hours, status = \'converted\' WHERE id = ? AND tenant_id = ?'
    ).run(overtime_record_id, tenant_id);
  },

  /** 查询员工的加班记录 */
  listByEmployee(employee_id: string, tenant_id: string, year?: number): OvertimeRecord[] {
    const db = getDatabase();
    const y = year || new Date().getFullYear();
    return db.prepare(`
      SELECT * FROM overtime_records
      WHERE employee_id = ? AND tenant_id = ? AND date >= ? AND date < ?
      ORDER BY date DESC
    `).all(employee_id, tenant_id, `${y}-01-01`, `${y + 1}-01-01`) as OvertimeRecord[];
  },

  getById(id: string, tenant_id: string): OvertimeRecord | null {
    return getDatabase().prepare(
      'SELECT * FROM overtime_records WHERE id = ? AND tenant_id = ?'
    ).get(id, tenant_id) as OvertimeRecord | null;
  },

  /** 获取待审批的加班列表 */
  listPending(tenant_id: string): OvertimeRecord[] {
    return getDatabase().prepare(
      'SELECT * FROM overtime_records WHERE tenant_id = ? AND status = \'pending\' ORDER BY date DESC'
    ).all(tenant_id) as OvertimeRecord[];
  },
};

// ============================================================
// 休假管理
// ============================================================

export const leaveService = {
  /** 获取所有启用的休假类型 */
  getActiveLeaveTypes(tenant_id: string): LeaveType[] {
    const db = getDatabase();
    // 先查租户专属类型，兜底查 default
    let types = db.prepare(
      'SELECT * FROM leave_types WHERE tenant_id = ? AND is_active = 1 ORDER BY sort_order'
    ).all(tenant_id) as LeaveType[];
    if (!types.length) {
      types = db.prepare(
        'SELECT * FROM leave_types WHERE tenant_id = \'default\' AND is_active = 1 ORDER BY sort_order'
      ).all() as LeaveType[];
    }
    return types;
  },

  /** 查询员工休假余额 */
  getBalances(employee_id: string, tenant_id: string, year?: number): LeaveBalance[] {
    const db = getDatabase();
    const y = year || new Date().getFullYear();
    return db.prepare(`
      SELECT lb.*, lt.name as leave_type_name
      FROM leave_balances lb
      JOIN leave_types lt ON lb.leave_type_id = lt.id
      WHERE lb.employee_id = ? AND lb.tenant_id = ? AND lb.year = ?
    `).all(employee_id, tenant_id, y) as LeaveBalance[];
  },

  /** 检查调休余额是否足够（仅统计未过期的有效额度） */
  checkCompensatoryBalance(employee_id: string, tenant_id: string, requested_hours: number): { sufficient: boolean; remaining: number; deficit: number } {
    const db = getDatabase();
    const today = new Date().toISOString().slice(0, 10);
    const rows = db.prepare(`
      SELECT remaining_hours, year, expires_at FROM leave_balances
      WHERE employee_id = ? AND tenant_id = ? AND leave_type_id = 'lt_compensatory'
    `).all(employee_id, tenant_id) as any[];

    let remaining = 0;
    for (const r of rows) {
      if (isBalanceValid(r, today)) remaining += r.remaining_hours || 0;
    }
    remaining = round2(remaining);
    return {
      sufficient: remaining >= requested_hours,
      remaining,
      deficit: round2(Math.max(0, requested_hours - remaining)),
    };
  },

  /**
   * 调休额度汇总（前端「调休工作台」单一数据源）
   * 返回：有效剩余额度、有效期内的总额/已用、即将过期明细、调休流水账（加班累积 + 调休消耗）
   */
  getCompensatorySummary(tenant_id: string, employee_id: string, year?: number): {
    employee_id: string;
    year: number;
    totalHours: number;
    usedHours: number;
    effectiveRemaining: number;
    expiringSoon: Array<{ hours: number; expiresAt: string; daysLeft: number }>;
    ledger: Array<{ date: string; type: 'accrual' | 'consume'; hours: number; refId: string; note: string }>;
  } {
    const db = getDatabase();
    const y = year || new Date().getFullYear();
    const today = new Date().toISOString().slice(0, 10);

    const balances = db.prepare(`
      SELECT * FROM leave_balances
      WHERE tenant_id = ? AND employee_id = ? AND leave_type_id = 'lt_compensatory'
    `).all(tenant_id, employee_id) as any[];

    let totalHours = 0;
    let usedHours = 0;
    let effectiveRemaining = 0;
    const expiringSoon: Array<{ hours: number; expiresAt: string; daysLeft: number }> = [];

    for (const b of balances) {
      if (!isBalanceValid(b, today)) continue;
      totalHours += b.total_hours || 0;
      usedHours += b.used_hours || 0;
      effectiveRemaining += b.remaining_hours || 0;
      if ((b.remaining_hours || 0) > 0) {
        const expiry = balanceExpiry(b);
        const daysLeft = Math.ceil((new Date(expiry).getTime() - Date.now()) / 86400000);
        if (daysLeft <= 90) expiringSoon.push({ hours: round2(b.remaining_hours), expiresAt: expiry, daysLeft });
      }
    }
    expiringSoon.sort((a, b) => a.daysLeft - b.daysLeft);

    const accruals = db.prepare(`
      SELECT id, date, hours, status FROM overtime_records
      WHERE tenant_id = ? AND employee_id = ? AND status IN ('approved', 'converted')
      ORDER BY date DESC LIMIT 50
    `).all(tenant_id, employee_id) as any[];
    const consumes = db.prepare(`
      SELECT id, start_datetime, total_hours, status FROM leave_applications
      WHERE tenant_id = ? AND employee_id = ? AND leave_type_id = 'lt_compensatory' AND status IN ('approved', 'taken')
      ORDER BY start_datetime DESC LIMIT 50
    `).all(tenant_id, employee_id) as any[];

    const ledger = [
      ...accruals.map((o) => ({ date: o.date, type: 'accrual' as const, hours: o.hours, refId: o.id, note: o.status === 'converted' ? '已转调休' : '加班审批通过' })),
      ...consumes.map((c) => ({ date: String(c.start_datetime || '').slice(0, 10), type: 'consume' as const, hours: c.total_hours, refId: c.id, note: '调休使用' })),
    ]
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 50);

    return {
      employee_id,
      year: y,
      totalHours: round2(totalHours),
      usedHours: round2(usedHours),
      effectiveRemaining: round2(effectiveRemaining),
      expiringSoon,
      ledger,
    };
  },

  /** 申请休假 */
  applyLeave(params: {
    tenant_id: string;
    employee_id: string;
    leave_type_id: string;
    start_datetime: string;
    end_datetime: string;
    total_hours: number;
    reason: string;
    overtime_record_id?: string;
  }): { application: LeaveApplication | null; error?: string } {
    return transaction((db) => {
      // 校验休假类型
      const leaveType = db.prepare(
        'SELECT * FROM leave_types WHERE id = ? AND tenant_id = ? AND is_active = 1'
      ).get(params.leave_type_id, params.tenant_id) as LeaveType | undefined;
      if (!leaveType) return { application: null, error: '休假类型不存在或已停用' };

      // 校验最小申请时长
      if (params.total_hours < leaveType.min_hours_per_application) {
        return { application: null, error: `最小申请时长为 ${leaveType.min_hours_per_application} 小时` };
      }

      // 调休类型：校验余额
      if (leaveType.overtime_source) {
        const check = leaveService.checkCompensatoryBalance(params.employee_id, params.tenant_id, params.total_hours);
        if (!check.sufficient) {
          return { application: null, error: `调休余额不足：需要 ${params.total_hours}h，剩余 ${check.remaining}h，差额 ${check.deficit}h` };
        }
      }

      // 校验年上限
      if (leaveType.max_days_per_year) {
        const currentYear = new Date().getFullYear();
        const used = db.prepare(`
          SELECT COALESCE(SUM(total_hours), 0) as used FROM leave_applications
          WHERE employee_id = ? AND tenant_id = ? AND leave_type_id = ?
            AND status IN ('approved', 'taken')
            AND start_datetime >= ? AND start_datetime < ?
        `).get(params.employee_id, params.tenant_id, params.leave_type_id, `${currentYear}-01-01`, `${currentYear + 1}-01-01`) as any;

        const usedHours = used?.used || 0;
        const maxHours = leaveType.max_days_per_year * 8; // 按每天 8 小时换算
        if (usedHours + params.total_hours > maxHours) {
          return { application: null, error: `超出年度上限：已用 ${usedHours}h，上限 ${maxHours}h` };
        }
      }

      // 创建申请
      const id = uuidv4();
      db.prepare(`
        INSERT INTO leave_applications (id, tenant_id, employee_id, leave_type_id, start_datetime, end_datetime, total_hours, reason, status, overtime_record_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `).run(id, params.tenant_id, params.employee_id, params.leave_type_id,
        params.start_datetime, params.end_datetime, params.total_hours,
        params.reason, params.overtime_record_id || null);

      logger.info('leave', `Leave application ${id} created: ${params.total_hours}h, type=${params.leave_type_id}`);
      return { application: leaveService.getById(id, params.tenant_id) };
    });
  },

  /** 审批休假申请 */
  approveLeave(id: string, tenant_id: string, approved_by: string, status: 'approved' | 'rejected', rejected_reason?: string): LeaveApplication | null {
    return transaction((db) => {
      const app = db.prepare(
        'SELECT * FROM leave_applications WHERE id = ? AND tenant_id = ?'
      ).get(id, tenant_id) as any;
      if (!app || app.status !== 'pending') return null;

      const updates: any = {
        status,
        approved_by,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (rejected_reason) updates.rejected_reason = rejected_reason;

      const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      const values = Object.values(updates);
      db.prepare(`UPDATE leave_applications SET ${setClause} WHERE id = ? AND tenant_id = ?`)
        .run(...values, id, tenant_id);

      // 审批通过 → 扣减额度
      if (status === 'approved') {
        const currentYear = new Date().getFullYear();
        const bal = db.prepare(`
          SELECT * FROM leave_balances
          WHERE employee_id = ? AND tenant_id = ? AND leave_type_id = ? AND year = ?
        `).get(app.employee_id, tenant_id, app.leave_type_id, currentYear) as any;

        if (bal) {
          db.prepare(`
          UPDATE leave_balances
          SET used_hours = used_hours + ?, remaining_hours = remaining_hours - ?, updated_at = datetime('now')
          WHERE id = ? AND tenant_id = ?
        `).run(app.total_hours, app.total_hours, bal.id, tenant_id);
        } else {
          // 无余额记录时创建一条（调休余额为负表示超额，管理员手动调整）
          db.prepare(`
            INSERT INTO leave_balances (id, tenant_id, employee_id, leave_type_id, year, total_hours, used_hours, remaining_hours)
            VALUES (?, ?, ?, ?, ?, 0, ?, ?)
          `).run(uuidv4(), tenant_id, app.employee_id, app.leave_type_id, currentYear, app.total_hours, -app.total_hours);
        }
      }

      logger.info('leave', `Leave application ${id} ${status}`);
      return leaveService.getById(id, tenant_id);
    });
  },

  /** 取消休假申请 */
  cancelLeave(id: string, tenant_id: string): LeaveApplication | null {
    const db = getDatabase();
    const app = db.prepare(
      'SELECT * FROM leave_applications WHERE id = ? AND tenant_id = ?'
    ).get(id, tenant_id) as any;
    if (!app || !['pending', 'approved'].includes(app.status)) return null;

    db.prepare(`
      UPDATE leave_applications SET status = 'cancelled', cancelled_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND tenant_id = ?
    `).run(id, tenant_id);

    // 如果已审批通过，退还额度
    if (app.status === 'approved') {
      const currentYear = new Date().getFullYear();
      const bal = db.prepare(`
        SELECT * FROM leave_balances
        WHERE employee_id = ? AND tenant_id = ? AND leave_type_id = ? AND year = ?
      `).get(app.employee_id, tenant_id, app.leave_type_id, currentYear) as any;
      if (bal) {
        db.prepare(`
          UPDATE leave_balances
          SET used_hours = used_hours - ?, remaining_hours = remaining_hours + ?, updated_at = datetime('now')
          WHERE id = ? AND tenant_id = ?
        `).run(app.total_hours, app.total_hours, bal.id, tenant_id);
      }
    }

    logger.info('leave', `Leave application ${id} cancelled`);
    return leaveService.getById(id, tenant_id);
  },

  /** 查询员工的休假申请列表 */
  listByEmployee(employee_id: string, tenant_id: string, year?: number): LeaveApplication[] {
    const db = getDatabase();
    const y = year || new Date().getFullYear();
    return db.prepare(`
      SELECT la.*, lt.name as leave_type_name
      FROM leave_applications la
      JOIN leave_types lt ON la.leave_type_id = lt.id
      WHERE la.employee_id = ? AND la.tenant_id = ?
        AND la.start_datetime >= ? AND la.start_datetime < ?
      ORDER BY la.submitted_at DESC
    `).all(employee_id, tenant_id, `${y}-01-01`, `${y + 1}-01-01`) as any[];
  },

  /** 获取待审批列表 */
  listPendingApprovals(tenant_id: string): LeaveApplication[] {
    const db = getDatabase();
    return db.prepare(`
      SELECT la.*, lt.name as leave_type_name
      FROM leave_applications la
      JOIN leave_types lt ON la.leave_type_id = lt.id
      WHERE la.tenant_id = ? AND la.status = 'pending'
      ORDER BY la.submitted_at DESC
    `).all(tenant_id) as any[];
  },

  getById(id: string, tenant_id: string): LeaveApplication | null {
    const db = getDatabase();
    return db.prepare(`
      SELECT la.*, lt.name as leave_type_name
      FROM leave_applications la
      JOIN leave_types lt ON la.leave_type_id = lt.id
      WHERE la.id = ? AND la.tenant_id = ?
    `).get(id, tenant_id) as any;
  },

  /** 年度结转：将未使用调休额度结转到下一年 */
  carryOverCompensatoryBalance(tenant_id: string, from_year: number, carry_over_hours: number = 80): number {
    return transaction((db) => {
      const balances = db.prepare(`
        SELECT * FROM leave_balances
        WHERE tenant_id = ? AND leave_type_id = 'lt_compensatory' AND year = ? AND remaining_hours > 0
      `).all(tenant_id, from_year) as any[];

      let carriedOver = 0;
      for (const bal of balances) {
        const carry = Math.min(bal.remaining_hours, carry_over_hours);
        if (carry <= 0) continue;

        // 新年度余额
        const existing = db.prepare(`
          SELECT * FROM leave_balances
          WHERE tenant_id = ? AND employee_id = ? AND leave_type_id = 'lt_compensatory' AND year = ?
        `).get(tenant_id, bal.employee_id, from_year + 1) as any;

        if (existing) {
          db.prepare(`
            UPDATE leave_balances SET total_hours = total_hours + ?, remaining_hours = remaining_hours + ?
            WHERE id = ? AND tenant_id = ?
          `).run(carry, carry, existing.id, tenant_id);
        } else {
          db.prepare(`
            INSERT INTO leave_balances (id, tenant_id, employee_id, leave_type_id, year, total_hours, used_hours, remaining_hours, source, expires_at)
            VALUES (?, ?, ?, 'lt_compensatory', ?, ?, 0, ?, 'carry_over', ?)
          `).run(uuidv4(), tenant_id, bal.employee_id, from_year + 1, carry, carry, `${from_year + 1}-12-31`);
        }
        carriedOver++;
      }

      logger.info('leave', `年度结转完成：${from_year} → ${from_year + 1}，涉及 ${carriedOver} 名员工`);
      return carriedOver;
    });
  },
};
