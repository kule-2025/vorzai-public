/**
 * HR 差异化智能服务（H3/H4/H5）
 *
 * H3: 岗位绩效模型库 — 五类电商岗位（运营/客服/主播/跨境/HR）差异化 KPI 权重模板
 * H4: 行业日历 — 大促/直播/排班/跨时区日程，联动考勤与排班
 * H5: 离职风险模型 — 基于考勤异常+绩效下滑+加班超限的规则评分
 */

import { getDatabase, transaction, type DatabaseSync } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

// ── 类型 ──────────────────────────────────────────────────────
export interface JobModel {
  id: string;
  tenant_id: string;
  job_category: 'operator' | 'cs' | 'live' | 'crossborder' | 'hr' | 'media';
  name: string;
  description: string | null;
  dimension_weights: Record<string, number>;
  kpi_template: { name: string; type: string; target: number; unit: string; weight: number }[];
  rating_scale: Record<string, number>;
  is_default: number;
  is_sandbox: number;
  created_at: string;
  updated_at: string;
}

export interface HRCalendar {
  id: string;
  tenant_id: string;
  name: string;
  calendar_type: 'campaign' | 'livestream' | 'shift' | 'crossborder_timezone' | 'holiday' | 'training';
  start_date: string | null;
  end_date: string | null;
  payload: Record<string, unknown>;
  is_recurring: number;
  is_sandbox: number;
  created_at: string;
  updated_at: string;
}

export interface RetentionRisk {
  id: string;
  tenant_id: string;
  employee_id: string;
  assessment_date: string;
  attendance_risk: number;
  performance_risk: number;
  overtime_risk: number;
  total_risk_score: number;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  factors: string[];
  is_acknowledged: number;
  note: string | null;
  created_at: string;
}

export interface HRStrategyDashboard {
  employeeCount: number;
  avgAttendanceRate: number;
  avgPerformanceScore: number;
  turnoverRiskCount: { low: number; medium: number; high: number; critical: number };
  activeCalendars: number;
  jobModels: number;
}

// ── 默认模板 ──────────────────────────────────────────────────
const DEFAULT_MODELS: Omit<JobModel, 'id' | 'created_at' | 'updated_at'>[] = [
  {
    tenant_id: '', job_category: 'operator', name: '电商运营岗',
    description: '店铺运营 + 活动策划 + 转化优化', is_default: 1, is_sandbox: 0,
    dimension_weights: { achievement: 0.35, collaboration: 0.25, innovation: 0.20, growth: 0.20 },
    kpi_template: [
      { name: 'GMV达成率', type: 'percentage', target: 100, unit: '%', weight: 40 },
      { name: '转化率', type: 'percentage', target: 3.5, unit: '%', weight: 25 },
      { name: '客单价AOV', type: 'currency', target: 200, unit: '¥', weight: 20 },
      { name: '响应时效', type: 'number', target: 30, unit: 'min', weight: 15 },
    ],
    rating_scale: { S: 5, A: 4, B: 3, C: 2, D: 1 },
  },
  {
    tenant_id: '', job_category: 'cs', name: '客服岗',
    description: '售前咨询 + 售后处理 + 满意度提升', is_default: 1, is_sandbox: 0,
    dimension_weights: { achievement: 0.30, collaboration: 0.30, innovation: 0.15, growth: 0.25 },
    kpi_template: [
      { name: '客户满意度', type: 'percentage', target: 95, unit: '%', weight: 35 },
      { name: '首次响应时长', type: 'number', target: 60, unit: 'sec', weight: 25 },
      { name: '工单解决率', type: 'percentage', target: 90, unit: '%', weight: 25 },
      { name: '好评率', type: 'percentage', target: 85, unit: '%', weight: 15 },
    ],
    rating_scale: { S: 5, A: 4, B: 3, C: 2, D: 1 },
  },
  {
    tenant_id: '', job_category: 'live', name: '直播主播岗',
    description: '直播带货 + 粉丝互动 + 内容创作', is_default: 1, is_sandbox: 0,
    dimension_weights: { achievement: 0.40, collaboration: 0.20, innovation: 0.25, growth: 0.15 },
    kpi_template: [
      { name: '直播GMV', type: 'currency', target: 50000, unit: '¥', weight: 35 },
      { name: '直播间在线人数', type: 'number', target: 5000, unit: '人', weight: 25 },
      { name: '粉丝增长', type: 'number', target: 500, unit: '人/场', weight: 20 },
      { name: '带货转化率', type: 'percentage', target: 2.5, unit: '%', weight: 20 },
    ],
    rating_scale: { S: 5, A: 4, B: 3, C: 2, D: 1 },
  },
  {
    tenant_id: '', job_category: 'crossborder', name: '跨境电商运营岗',
    description: '跨境店铺运营 + 合规 + 多币种管理', is_default: 1, is_sandbox: 0,
    dimension_weights: { achievement: 0.35, collaboration: 0.25, innovation: 0.20, growth: 0.20 },
    kpi_template: [
      { name: '跨境GMV', type: 'currency', target: 10000, unit: '$', weight: 35 },
      { name: '利润率', type: 'percentage', target: 25, unit: '%', weight: 30 },
      { name: '退货率', type: 'percentage', target: 5, unit: '%', weight: 20 },
      { name: '合规达标率', type: 'percentage', target: 100, unit: '%', weight: 15 },
    ],
    rating_scale: { S: 5, A: 4, B: 3, C: 2, D: 1 },
  },
  {
    tenant_id: '', job_category: 'hr', name: '人力资源岗',
    description: '招聘 + 绩效 + 薪酬 + 员工关系', is_default: 1, is_sandbox: 0,
    dimension_weights: { achievement: 0.25, collaboration: 0.25, innovation: 0.25, growth: 0.25 },
    kpi_template: [
      { name: '招聘完成率', type: 'percentage', target: 90, unit: '%', weight: 30 },
      { name: '员工满意度', type: 'percentage', target: 85, unit: '%', weight: 25 },
      { name: '培训覆盖率', type: 'percentage', target: 100, unit: '%', weight: 20 },
      { name: '员工留存率', type: 'percentage', target: 85, unit: '%', weight: 25 },
    ],
    rating_scale: { S: 5, A: 4, B: 3, C: 2, D: 1 },
  },
];

// ── Service ──────────────────────────────────────────────────
export class HRSpecializationService {
  // ── H3: 岗位绩效模型库 ────────────────────────────────────
  seedDefaults(tenantId: string): number {
    const db = getDatabase();
    const existing = db.prepare(
      'SELECT COUNT(*) as c FROM hr_job_models WHERE tenant_id = ?'
    ).get(tenantId) as { c: number };
    if (existing.c > 0) return existing.c;

    let seeded = 0;
    transaction(() => {
      for (const model of DEFAULT_MODELS) {
        db.prepare(
          `INSERT INTO hr_job_models (id, tenant_id, job_category, name, description, dimension_weights, kpi_template, rating_scale, is_default, is_sandbox)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
        ).run(
          uuidv4(), tenantId, model.job_category, model.name, model.description,
          JSON.stringify(model.dimension_weights), JSON.stringify(model.kpi_template),
          JSON.stringify(model.rating_scale), 1
        );
        seeded++;
      }
    });
    logger.info('hr-specialization', `岗位模型预设完成: ${seeded} 个`);
    return seeded;
  }

  createJobModel(tenantId: string, input: {
    job_category: string;
    name: string;
    description?: string;
    dimension_weights: Record<string, number>;
    kpi_template: { name: string; type: string; target: number; unit: string; weight: number }[];
    rating_scale?: Record<string, number>;
  }): JobModel {
    const db = getDatabase();
    const id = uuidv4();
    transaction(() => {
      db.prepare(
        `INSERT INTO hr_job_models (id, tenant_id, job_category, name, description, dimension_weights, kpi_template, rating_scale, is_default, is_sandbox)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`
      ).run(
        id, tenantId, input.job_category, input.name, input.description ?? null,
        JSON.stringify(input.dimension_weights), JSON.stringify(input.kpi_template),
        JSON.stringify(input.rating_scale ?? { S: 5, A: 4, B: 3, C: 2, D: 1 })
      );
    });
    return this._hydrateModel(db.prepare('SELECT * FROM hr_job_models WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any);
  }

  getJobModel(id: string, tenantId: string): JobModel | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM hr_job_models WHERE id = ? AND tenant_id = ?')
      .get(id, tenantId) as any;
    return row ? this._hydrateModel(row) : null;
  }

  listJobModels(tenantId: string, jobCategory?: string): JobModel[] {
    const db = getDatabase();
    if (jobCategory) {
      return (db.prepare(
        'SELECT * FROM hr_job_models WHERE tenant_id = ? AND job_category = ? ORDER BY is_default DESC, created_at'
      ).all(tenantId, jobCategory) as any[]).map(this._hydrateModel);
    }
    return (db.prepare(
      'SELECT * FROM hr_job_models WHERE tenant_id = ? ORDER BY job_category, is_default DESC, created_at'
    ).all(tenantId) as any[]).map(this._hydrateModel);
  }

  updateJobModel(id: string, tenantId: string, patch: {
    name?: string; description?: string;
    dimension_weights?: Record<string, number>;
    kpi_template?: any[]; rating_scale?: Record<string, number>;
  }): JobModel | null {
    const db = getDatabase();
    const row = db.prepare('SELECT id FROM hr_job_models WHERE id = ? AND tenant_id = ?').get(id, tenantId);
    if (!row) return null;

    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.name !== undefined) { sets.push('name = ?'); params.push(patch.name); }
    if (patch.description !== undefined) { sets.push('description = ?'); params.push(patch.description ?? null); }
    if (patch.dimension_weights !== undefined) { sets.push('dimension_weights = ?'); params.push(JSON.stringify(patch.dimension_weights)); }
    if (patch.kpi_template !== undefined) { sets.push('kpi_template = ?'); params.push(JSON.stringify(patch.kpi_template)); }
    if (patch.rating_scale !== undefined) { sets.push('rating_scale = ?'); params.push(JSON.stringify(patch.rating_scale)); }
    sets.push("updated_at = datetime('now')");
    params.push(id, tenantId);
    db.prepare(`UPDATE hr_job_models SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...params);
    return this.getJobModel(id, tenantId);
  }

  deleteJobModel(id: string, tenantId: string): boolean {
    const db = getDatabase();
    const r = db.prepare('DELETE FROM hr_job_models WHERE id = ? AND tenant_id = ?').run(id, tenantId);
    return (r as { changes: number }).changes > 0;
  }

  // ── H4: 行业日历 ──────────────────────────────────────────
  createCalendar(tenantId: string, input: {
    name: string;
    calendar_type: string;
    start_date?: string;
    end_date?: string;
    payload?: Record<string, unknown>;
    is_recurring?: boolean;
  }): HRCalendar {
    const db = getDatabase();
    const id = uuidv4();
    db.prepare(
      `INSERT INTO hr_calendars (id, tenant_id, name, calendar_type, start_date, end_date, payload, is_recurring, is_sandbox)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
    ).run(
      id, tenantId, input.name, input.calendar_type,
      input.start_date ?? null, input.end_date ?? null,
      JSON.stringify(input.payload ?? {}),
      input.is_recurring ? 1 : 0
    );
    return this._hydrateCalendar(db.prepare('SELECT * FROM hr_calendars WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any);
  }

  getCalendar(id: string, tenantId: string): HRCalendar | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM hr_calendars WHERE id = ? AND tenant_id = ?')
      .get(id, tenantId) as any;
    return row ? this._hydrateCalendar(row) : null;
  }

  listCalendars(tenantId: string, opts: { type?: string; from?: string; to?: string } = {}): HRCalendar[] {
    const db = getDatabase();
    const where: string[] = ['tenant_id = ?'];
    const params: unknown[] = [tenantId];
    if (opts.type) { where.push('calendar_type = ?'); params.push(opts.type); }
    if (opts.from) { where.push('end_date >= ? OR end_date IS NULL'); params.push(opts.from); }
    if (opts.to) { where.push('start_date <= ? OR start_date IS NULL'); params.push(opts.to); }
    return (db.prepare(
      `SELECT * FROM hr_calendars WHERE ${where.join(' AND ')} ORDER BY start_date NULLS LAST, created_at DESC`
    ).all(...params) as any[]).map(this._hydrateCalendar);
  }

  getUpcomingCalendars(tenantId: string, days: number = 30): HRCalendar[] {
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    return this.listCalendars(tenantId, { from, to });
  }

  updateCalendar(id: string, tenantId: string, patch: {
    name?: string; calendar_type?: string; start_date?: string;
    end_date?: string; payload?: Record<string, unknown>; is_recurring?: boolean;
  }): HRCalendar | null {
    const db = getDatabase();
    const row = db.prepare('SELECT id FROM hr_calendars WHERE id = ? AND tenant_id = ?').get(id, tenantId);
    if (!row) return null;

    const sets: string[] = [];
    const params: unknown[] = [];
    const allowed: Record<string, string> = {
      name: 'name', calendar_type: 'calendar_type',
      start_date: 'start_date', end_date: 'end_date',
    };
    for (const [key, col] of Object.entries(allowed)) {
      if ((patch as any)[key] !== undefined) { sets.push(`${col} = ?`); params.push((patch as any)[key] ?? null); }
    }
    if (patch.payload !== undefined) { sets.push('payload = ?'); params.push(JSON.stringify(patch.payload)); }
    if (patch.is_recurring !== undefined) { sets.push('is_recurring = ?'); params.push(patch.is_recurring ? 1 : 0); }
    sets.push("updated_at = datetime('now')");
    params.push(id, tenantId);
    db.prepare(`UPDATE hr_calendars SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...params);
    return this.getCalendar(id, tenantId);
  }

  deleteCalendar(id: string, tenantId: string): boolean {
    const db = getDatabase();
    const r = db.prepare('DELETE FROM hr_calendars WHERE id = ? AND tenant_id = ?').run(id, tenantId);
    return (r as { changes: number }).changes > 0;
  }

  // ── H5: 离职风险评分 ──────────────────────────────────────
  assessRetentionRisk(tenantId: string, employeeId: string, date?: string): RetentionRisk | null {
    const db = getDatabase();
    const emp = db.prepare(
      'SELECT e.id, e.tenant_id FROM employees e WHERE e.id = ? AND e.tenant_id = ?'
    ).get(employeeId, tenantId);
    if (!emp) return null;

    const assessmentDate = date ?? new Date().toISOString().slice(0, 10);

    // 考勤异常：检查最近 30 天的出勤记录
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const attendanceRecords = db.prepare(
      "SELECT status FROM attendance_records WHERE employee_id = ? AND tenant_id = ? AND date BETWEEN ? AND ? AND status IN ('late','absent')"
    ).all(employeeId, tenantId, thirtyDaysAgo, today) as { status: string }[];
    const lateCount = attendanceRecords.filter((a) => a.status === 'late').length;
    const absentCount = attendanceRecords.filter((a) => a.status === 'absent').length;
    const attendanceRisk = Math.min(100, (lateCount * 10 + absentCount * 25));

    // 绩效下滑：检查最近 2 期绩效评分
    const perfs = db.prepare(
      'SELECT score FROM performance_reviews WHERE employee_id = ? AND tenant_id = ? ORDER BY period DESC LIMIT 2'
    ).all(employeeId, tenantId) as { score: number }[];
    let performanceRisk = 0;
    if (perfs.length === 2) {
      const drop = perfs[1].score - perfs[0].score;
      if (drop > 5) performanceRisk = Math.min(100, drop * 5);
    } else if (perfs.length === 1 && perfs[0].score < 60) {
      performanceRisk = (60 - perfs[0].score) * 2;
    }

    // 加班超限：最近 30 天平均工时
    const summary = db.prepare(
      "SELECT AVG(work_hours) as avg_hours FROM attendance_records WHERE employee_id = ? AND tenant_id = ? AND date BETWEEN ? AND ? AND work_hours IS NOT NULL"
    ).get(employeeId, tenantId, thirtyDaysAgo, today) as { avg_hours: number | null };
    const avgHours = summary?.avg_hours ?? 0;
    const overtimeRisk = avgHours > 10 ? Math.min(100, (avgHours - 8) * 15) : 0;

    const totalRiskScore = Math.round(attendanceRisk * 0.4 + performanceRisk * 0.35 + overtimeRisk * 0.25);
    let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
    if (totalRiskScore >= 70) riskLevel = 'critical';
    else if (totalRiskScore >= 50) riskLevel = 'high';
    else if (totalRiskScore >= 30) riskLevel = 'medium';

    const factors: string[] = [];
    if (lateCount > 0) factors.push(`最近30天迟到${lateCount}次`);
    if (absentCount > 0) factors.push(`缺勤${absentCount}次`);
    if (performanceRisk > 0) factors.push(`绩效下滑风险`);
    if (overtimeRisk > 0) factors.push(`日均工时${avgHours.toFixed(1)}h超限`);

    const id = uuidv4();
    transaction(() => {
      db.prepare(
        `INSERT INTO hr_retention_risks (id, tenant_id, employee_id, assessment_date, attendance_risk, performance_risk, overtime_risk, total_risk_score, risk_level, factors)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(employee_id, assessment_date) DO UPDATE SET
           attendance_risk = excluded.attendance_risk,
           performance_risk = excluded.performance_risk,
           overtime_risk = excluded.overtime_risk,
           total_risk_score = excluded.total_risk_score,
           risk_level = excluded.risk_level,
           factors = excluded.factors`
      ).run(
        id, tenantId, employeeId, assessmentDate,
        attendanceRisk, performanceRisk, overtimeRisk,
        totalRiskScore, riskLevel, JSON.stringify(factors)
      );
    });
    return this._hydrateRisk(db.prepare(
      'SELECT * FROM hr_retention_risks WHERE employee_id = ? AND assessment_date = ?'
    ).get(employeeId, assessmentDate) as any);
  }

  listRetentionRisks(tenantId: string, opts: { riskLevel?: string; acknowledged?: boolean } = {}): RetentionRisk[] {
    const db = getDatabase();
    const where: string[] = ['r.tenant_id = ?'];
    const params: unknown[] = [tenantId];
    if (opts.riskLevel) { where.push('r.risk_level = ?'); params.push(opts.riskLevel); }
    if (opts.acknowledged !== undefined) { where.push('r.is_acknowledged = ?'); params.push(opts.acknowledged ? 1 : 0); }
    return (db.prepare(
      `SELECT r.* FROM hr_retention_risks r WHERE ${where.join(' AND ')} ORDER BY r.total_risk_score DESC LIMIT 100`
    ).all(...params) as any[]).map(this._hydrateRisk);
  }

  acknowledgeRisk(id: string, tenantId: string): RetentionRisk | null {
    const db = getDatabase();
    const r = db.prepare(
      "UPDATE hr_retention_risks SET is_acknowledged = 1 WHERE id = ? AND tenant_id = ?"
    ).run(id, tenantId);
    if ((r as { changes: number }).changes === 0) return null;
    return this._hydrateRisk(db.prepare('SELECT * FROM hr_retention_risks WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any);
  }

  getStrategyDashboard(tenantId: string): HRStrategyDashboard {
    const db = getDatabase();
    const empCount = (db.prepare('SELECT COUNT(*) as c FROM employees WHERE tenant_id = ?').get(tenantId) as { c: number }).c;
    const attendance = db.prepare(
      "SELECT AVG(CASE WHEN a.status IN ('normal','late','overtime') THEN 1 ELSE 0 END) as rate FROM attendance_records a WHERE a.tenant_id = ? AND a.date >= ?"
    ).get(tenantId, new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)) as { rate: number | null };
    const perf = db.prepare(
      "SELECT AVG(p.score) as avg FROM performance_reviews p WHERE p.tenant_id = ? AND p.period >= ?"
    ).get(tenantId, new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)) as { avg: number | null };
    const risks = db.prepare(
      "SELECT risk_level, COUNT(*) as c FROM hr_retention_risks WHERE tenant_id = ? GROUP BY risk_level"
    ).all(tenantId) as { risk_level: string; c: number }[];
    const riskCount = { low: 0, medium: 0, high: 0, critical: 0 };
    risks.forEach((r) => { (riskCount as any)[r.risk_level] = r.c; });
    const calendars = (db.prepare('SELECT COUNT(*) as c FROM hr_calendars WHERE tenant_id = ?').get(tenantId) as { c: number }).c;
    const models = (db.prepare('SELECT COUNT(*) as c FROM hr_job_models WHERE tenant_id = ?').get(tenantId) as { c: number }).c;

    return {
      employeeCount: empCount,
      avgAttendanceRate: Math.round((attendance?.rate ?? 0) * 100),
      avgPerformanceScore: Math.round(perf?.avg ?? 0),
      turnoverRiskCount: riskCount,
      activeCalendars: calendars,
      jobModels: models,
    };
  }

  // ── 私有 _hydrate ─────────────────────────────────────────
  private _hydrateModel(row: any): JobModel {
    return {
      ...row,
      dimension_weights: typeof row.dimension_weights === 'string' ? JSON.parse(row.dimension_weights) : (row.dimension_weights ?? {}),
      kpi_template: typeof row.kpi_template === 'string' ? JSON.parse(row.kpi_template) : (row.kpi_template ?? []),
      rating_scale: typeof row.rating_scale === 'string' ? JSON.parse(row.rating_scale) : (row.rating_scale ?? {}),
    };
  }

  private _hydrateCalendar(row: any): HRCalendar {
    return { ...row, payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload ?? {}) };
  }

  private _hydrateRisk(row: any): RetentionRisk {
    return { ...row, factors: typeof row.factors === 'string' ? JSON.parse(row.factors) : (row.factors ?? []) };
  }
}

export const hrSpecializationService = new HRSpecializationService();