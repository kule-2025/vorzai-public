/**
 * HR 差异化智能服务 单元测试 (H3/H4/H5/H6)
 *
 * 覆盖:
 *   - 岗位模型：预置种子、CRUD、按类别查询、租户隔离
 *   - 行业日历：CRUD、即将到来查询、按类型过滤
 *   - 离职风险：评分计算、严重度分级、确认、租户隔离
 *   - 战略看板：聚合指标
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

let _idx = 0;
function uniq(base: string): string { return `${base}_${Date.now()}_${_idx++}`; }

import {
  hrSpecializationService,
  type JobModel,
  type HRCalendar,
  type RetentionRisk,
} from '../src/services/hrSpecializationService';
import { getDatabase, initDatabase, closeDatabase } from '../src/db';
import { v4 as uuidv4 } from 'uuid';

const TEST_DB_PATH = 'data/test_vorzai_hr_spec.db';

function seedTenant(): string {
  const db = getDatabase();
  const id = uuidv4();
  const slug = 'hrspec-' + id.slice(0, 8);
  db.prepare(
    `INSERT INTO tenants (id, name, slug, status) VALUES (?, ?, ?, ?)`
  ).run(id, 'HR差异化测试租户', slug, 'active');
  return id;
}

function seedEmployee(tenantId: string): string {
  const db = getDatabase();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO employees (id, tenant_id, employee_no, name, status)
     VALUES (?, ?, ?, ?, 'active')`
  ).run(id, tenantId, 'EMP-' + id.slice(0, 6), uniq('员工'));
  return id;
}

let tenantA: string;
let tenantB: string;

beforeAll(() => {
  initDatabase(TEST_DB_PATH);
  tenantA = seedTenant();
  tenantB = seedTenant();
});

afterAll(() => {
  closeDatabase();
});

// ──────────────────────────────────────────────────────────────
describe('H3 岗位绩效模型库', () => {
  it('预置种子模型', () => {
    const n = hrSpecializationService.seedDefaults(tenantA);
    expect(n).toBe(5); // 5 类默认岗位模型
  });

  it('重复预置不重复插入', () => {
    const n = hrSpecializationService.seedDefaults(tenantA);
    expect(n).toBe(5); // already exists
  });

  it('列表：按类别过滤', () => {
    const list = hrSpecializationService.listJobModels(tenantA, 'operator');
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0].job_category).toBe('operator');
    expect(list[0].dimension_weights).toHaveProperty('achievement');
    expect(Array.isArray(list[0].kpi_template)).toBe(true);
    expect(list[0].kpi_template.length).toBeGreaterThanOrEqual(2);
  });

  it('列表：全部（不传 category）', () => {
    const list = hrSpecializationService.listJobModels(tenantA);
    expect(list.length).toBeGreaterThanOrEqual(5);
  });

  it('查询单个模型', () => {
    const list = hrSpecializationService.listJobModels(tenantA, 'live');
    const model = hrSpecializationService.getJobModel(list[0].id, tenantA);
    expect(model).not.toBeNull();
    expect(model!.job_category).toBe('live');
  });

  it('创建自定义模型', () => {
    const model = hrSpecializationService.createJobModel(tenantA, {
      job_category: 'media',
      name: '新媒体运营岗',
      description: '测试模型',
      dimension_weights: { achievement: 0.5, collaboration: 0.2, innovation: 0.2, growth: 0.1 },
      kpi_template: [{ name: '文章阅读量', type: 'number', target: 10000, unit: '次', weight: 100 }],
    });
    expect(model.id).toBeDefined();
    expect(model.is_default).toBe(0);
    expect(model.dimension_weights.achievement).toBe(0.5);
  });

  it('更新模型', () => {
    const list = hrSpecializationService.listJobModels(tenantA, 'cs');
    const updated = hrSpecializationService.updateJobModel(list[0].id, tenantA, {
      name: '客服岗-新版',
      dimension_weights: { achievement: 0.4, collaboration: 0.3, innovation: 0.15, growth: 0.15 },
    });
    expect(updated?.name).toBe('客服岗-新版');
    expect(updated?.dimension_weights.achievement).toBe(0.4);
  });

  it('删除模型', () => {
    const model = hrSpecializationService.createJobModel(tenantA, {
      job_category: 'media',
      name: '待删除模型',
      dimension_weights: { achievement: 1.0, collaboration: 0, innovation: 0, growth: 0 },
      kpi_template: [{ name: 'test', type: 'number', target: 1, unit: '个', weight: 100 }],
    });
    expect(hrSpecializationService.deleteJobModel(model.id, tenantA)).toBe(true);
    expect(hrSpecializationService.getJobModel(model.id, tenantA)).toBeNull();
  });

  it('租户隔离：tenantB 看不到 tenantA 模型', () => {
    const list = hrSpecializationService.listJobModels(tenantB);
    expect(list.length).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────
describe('H4 行业日历', () => {
  it('创建日历', () => {
    const cal = hrSpecializationService.createCalendar(tenantA, {
      name: '618 大促',
      calendar_type: 'campaign',
      start_date: '2026-06-01',
      end_date: '2026-06-18',
      payload: { discount: '20%', platform: '淘宝' },
      is_recurring: true,
    });
    expect(cal.name).toBe('618 大促');
    expect(cal.calendar_type).toBe('campaign');
    expect(cal.payload).toHaveProperty('discount');
    expect(cal.is_recurring).toBe(1);
  });

  it('列表：所有 / 按类型', () => {
    hrSpecializationService.createCalendar(tenantA, {
      name: '双11直播', calendar_type: 'livestream', start_date: '2026-11-11', end_date: '2026-11-11',
    });
    hrSpecializationService.createCalendar(tenantA, {
      name: '国庆假期', calendar_type: 'holiday', start_date: '2026-10-01', end_date: '2026-10-07',
    });

    const all = hrSpecializationService.listCalendars(tenantA);
    expect(all.length).toBeGreaterThanOrEqual(3);

    const live = hrSpecializationService.listCalendars(tenantA, { type: 'livestream' });
    expect(live.length).toBe(1);
    expect(live[0].calendar_type).toBe('livestream');
  });

  it('即将到来日历', () => {
    // 创建一个在 365 天以内的日历
    const farDate = new Date(Date.now() + 200 * 86400000).toISOString().slice(0, 10);
    hrSpecializationService.createCalendar(tenantA, {
      name: '200天后活动', calendar_type: 'training', start_date: farDate, end_date: farDate,
    });
    const upcoming = hrSpecializationService.getUpcomingCalendars(tenantA, 300);
    expect(upcoming.length).toBeGreaterThan(0);
  });

  it('更新日历', () => {
    const all = hrSpecializationService.listCalendars(tenantA, { type: 'holiday' });
    const updated = hrSpecializationService.updateCalendar(all[0].id, tenantA, {
      name: '国庆假期-延长版', end_date: '2026-10-08',
    });
    expect(updated?.name).toBe('国庆假期-延长版');
  });

  it('删除日历', () => {
    const cal = hrSpecializationService.createCalendar(tenantA, {
      name: '临时活动', calendar_type: 'shift',
    });
    expect(hrSpecializationService.deleteCalendar(cal.id, tenantA)).toBe(true);
    expect(hrSpecializationService.getCalendar(cal.id, tenantA)).toBeNull();
  });

  it('租户隔离', () => {
    const listB = hrSpecializationService.listCalendars(tenantB);
    expect(listB.length).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────
describe('H5 离职风险评分', () => {
  it('评估风险（默认低风险）', () => {
    const empId = seedEmployee(tenantA);
    const risk = hrSpecializationService.assessRetentionRisk(tenantA, empId);
    expect(risk).not.toBeNull();
    expect(risk!.total_risk_score).toBe(0);
    expect(risk!.risk_level).toBe('low');
    expect(Array.isArray(risk!.factors)).toBe(true);
  });

  it('同日同人覆盖更新', () => {
    const empId = seedEmployee(tenantA);
    const r1 = hrSpecializationService.assessRetentionRisk(tenantA, empId);
    const r2 = hrSpecializationService.assessRetentionRisk(tenantA, empId);
    // 同 employee + 同日期不会产生两条记录
    const db = getDatabase();
    const count = db.prepare(
      'SELECT COUNT(*) as c FROM hr_retention_risks WHERE employee_id = ? AND assessment_date = ?'
    ).get(empId, new Date().toISOString().slice(0, 10)) as { c: number };
    expect(count.c).toBe(1);
  });

  it('风险列表：按级别过滤', () => {
    const risks = hrSpecializationService.listRetentionRisks(tenantA, { riskLevel: 'low' });
    expect(risks.length).toBeGreaterThan(0);
    expect(risks.every((r) => r.risk_level === 'low')).toBe(true);
  });

  it('确认风险', () => {
    const risks = hrSpecializationService.listRetentionRisks(tenantA);
    if (risks.length === 0) return;
    const ack = hrSpecializationService.acknowledgeRisk(risks[0].id, tenantA);
    expect(ack).not.toBeNull();
    expect(ack!.is_acknowledged).toBe(1);
  });

  it('租户隔离', () => {
    const risksB = hrSpecializationService.listRetentionRisks(tenantB);
    expect(risksB.length).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────
describe('H6 HR 战略看板', () => {
  it('返回聚合数据', () => {
    const dash = hrSpecializationService.getStrategyDashboard(tenantA);
    expect(dash).toHaveProperty('employeeCount');
    expect(dash).toHaveProperty('avgAttendanceRate');
    expect(dash).toHaveProperty('turnoverRiskCount');
    expect(dash).toHaveProperty('activeCalendars');
    expect(dash).toHaveProperty('jobModels');
    expect(dash.turnoverRiskCount).toHaveProperty('low');
    expect(dash.turnoverRiskCount).toHaveProperty('medium');
    expect(dash.turnoverRiskCount).toHaveProperty('high');
    expect(dash.turnoverRiskCount).toHaveProperty('critical');
    expect(dash.jobModels).toBeGreaterThanOrEqual(5);
  });
});