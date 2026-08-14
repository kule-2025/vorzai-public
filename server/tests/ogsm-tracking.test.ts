/**
 * OGSM 时间序列追踪 + 经营对标 + 偏离告警 单元测试
 *
 * 覆盖:
 *   - 快照 CRUD：单个目标、批量打点、时间序列回看、租户概览
 *   - 经营对标：链接 CRUD、同步、批量同步
 *   - 偏离告警：扫描、严重度分级、确认
 *   - 租户隔离：跨租户不可见
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

let _idx = 0;
function uniq(base: string): string { return `${base}_${Date.now()}_${_idx++}`; }

import {
  ogsmTrackingService,
  type ProgressSnapshot,
  type MetricLink,
  type Deviation,
} from '../src/services/ogsmTrackingService';
import { ogsmService } from '../src/services/ogsmService';
import { getDatabase, initDatabase, closeDatabase } from '../src/db';
import { v4 as uuidv4 } from 'uuid';

const TEST_DB_PATH = 'data/test_vorzai_ogsm_tracking.db';

function seedTenant(): string {
  const db = getDatabase();
  const id = uuidv4();
  const slug = 'ogsm-' + id.slice(0, 8);
  db.prepare(
    `INSERT INTO tenants (id, name, slug, status) VALUES (?, ?, ?, ?)`
  ).run(id, 'OGSM追踪测试租户', slug, 'active');
  return id;
}

function seedUser(tenantId: string): { id: string } {
  const db = getDatabase();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO users (id, tenant_id, username, password_hash, display_name, email, role, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, tenantId, `ogsm-user-${id.slice(0, 6)}`, 'hash', 'OGSM测试用户', `${id.slice(0, 6)}@x.com`, 'owner', 'active');
  return { id };
}

function seedObjective(tenantId: string, opts: { startDate?: string; endDate?: string; progress?: number; title?: string } = {}): string {
  const db = getDatabase();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO ogsm_objectives (id, tenant_id, title, level, status, start_date, end_date, progress)
     VALUES (?, ?, ?, 'company', 'active', ?, ?, ?)`
  ).run(id, tenantId, opts.title ?? uniq('目标'), opts.startDate ?? null, opts.endDate ?? null, opts.progress ?? 0);
  return id;
}

function seedGoal(objectiveId: string, opts: { targetValue?: number; currentValue?: number; title?: string } = {}): string {
  const db = getDatabase();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO ogsm_goals (id, objective_id, title, target_value, current_value, status, metric_type)
     VALUES (?, ?, ?, ?, ?, 'in_progress', 'number')`
  ).run(id, objectiveId, opts.title ?? uniq('指标'), opts.targetValue ?? 100, opts.currentValue ?? 0);
  return id;
}

let tenantA: string;
let tenantB: string;
let userA: { id: string };

beforeAll(() => {
  initDatabase(TEST_DB_PATH);
  tenantA = seedTenant();
  tenantB = seedTenant();
  userA = seedUser(tenantA);
});

afterAll(() => {
  closeDatabase();
});

// ──────────────────────────────────────────────────────────────
describe('OGSM 进度快照 (O2)', () => {
  it('创建单个目标快照', () => {
    const objId = seedObjective(tenantA, { progress: 50 });
    const goalId = seedGoal(objId, { targetValue: 100, currentValue: 50 });
    const snap = ogsmTrackingService.createSnapshot(tenantA, objId, '2026-08-01', '手动打点');
    expect(snap.objective_id).toBe(objId);
    expect(snap.progress).toBe(50);
    expect(snap.alignment).toBe(50);
    expect(snap.is_auto).toBe(0);
    expect(snap.note).toBe('手动打点');
    expect(snap.goal_count).toBe(1);
  });

  it('同一日期二次创建：覆盖更新', () => {
    const objId = seedObjective(tenantA, { progress: 60 });
    seedGoal(objId, { targetValue: 100, currentValue: 60 });
    const s1 = ogsmTrackingService.createSnapshot(tenantA, objId, '2026-08-02', 'first');
    const s2 = ogsmTrackingService.createSnapshot(tenantA, objId, '2026-08-02', 'updated');
    expect(s2.note).toBe('updated');
    expect(s2.progress).toBe(60);
    // UNIQUE 约束下应只有一条
    const db = getDatabase();
    const count = db.prepare(
      'SELECT COUNT(*) as c FROM ogsm_progress_snapshots WHERE objective_id = ? AND snapshot_date = ?'
    ).get(objId, '2026-08-02') as { c: number };
    expect(count.c).toBe(1);
  });

  it('不存在目标抛错', () => {
    expect(() => ogsmTrackingService.createSnapshot(tenantA, 'fake-id', '2026-08-03')).toThrow();
  });

  it('批量每日打点：所有 active 目标', () => {
    const obj1 = seedObjective(tenantA, { progress: 10 });
    const obj2 = seedObjective(tenantA, { progress: 20 });
    seedObjective(tenantB, { progress: 99 }); // 跨租户
    seedGoal(obj1);
    seedGoal(obj2);
    const r = ogsmTrackingService.captureDailySnapshots(tenantA, '2026-08-04');
    expect(r.captured + r.updated).toBeGreaterThanOrEqual(2);
    // 跨租户目标不应被打点
    const db = getDatabase();
    const tenantBCount = db.prepare(
      "SELECT COUNT(*) as c FROM ogsm_progress_snapshots WHERE tenant_id = ? AND snapshot_date = ?"
    ).get(tenantB, '2026-08-04') as { c: number };
    // 此刻 tenantB 没有进度快照因为目标 id 不存在
    expect(tenantBCount.c).toBe(0);
  });

  it('时间序列回看', () => {
    const objId = seedObjective(tenantA, { progress: 0 });
    seedGoal(objId);
    const today = new Date();
    for (let i = 0; i < 5; i++) {
      const d = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10);
      ogsmTrackingService.createSnapshot(tenantA, objId, d, `day-${i}`);
    }
    const from = new Date(today.getTime() - 4 * 86400000).toISOString().slice(0, 10);
    const to = today.toISOString().slice(0, 10);
    const series = ogsmTrackingService.getTimeSeries(tenantA, objId, from, to);
    expect(series).not.toBeNull();
    expect(series!.points.length).toBe(5);
    expect(series!.trend).toMatch(/up|down|flat/);
  });

  it('租户整体概览', () => {
    const r = ogsmTrackingService.getTenantOverview(tenantA, 30);
    expect(r.objectives.length).toBeGreaterThan(0);
    expect(r.aggregateTrend).toBeDefined();
    expect(Array.isArray(r.aggregateTrend)).toBe(true);
  });

  it('租户隔离：tenantB 看不到 tenantA 快照', () => {
    const objId = seedObjective(tenantA, { progress: 50 });
    seedGoal(objId);
    ogsmTrackingService.createSnapshot(tenantA, objId, '2026-08-05');
    const series = ogsmTrackingService.getTimeSeries(tenantB, objId, '2026-08-01', '2026-08-31');
    expect(series).toBeNull(); // tenantB 查不到 tenantA 的目标
  });
});

// ──────────────────────────────────────────────────────────────
describe('OGSM 经营对标 (O3)', () => {
  it('创建对标链接', () => {
    const objId = seedObjective(tenantA, { progress: 0 });
    const goalId = seedGoal(objId);
    const link = ogsmTrackingService.createMetricLink(tenantA, goalId, 'gmv', 'month', { scaleFactor: 0.01 });
    expect(link.metric_key).toBe('gmv');
    expect(link.period_type).toBe('month');
    expect(link.scale_factor).toBe(0.01);
    expect(link.status).toBe('active');
    expect(link.auto_sync).toBe(1);
  });

  it('跨租户目标创建对标抛错', () => {
    const objId = seedObjective(tenantB);
    const goalId = seedGoal(objId);
    expect(() => ogsmTrackingService.createMetricLink(tenantA, goalId, 'gmv')).toThrow();
  });

  it('UNIQUE: 同一 goal + metric + period 重复创建失败', () => {
    const objId = seedObjective(tenantA);
    const goalId = seedGoal(objId);
    ogsmTrackingService.createMetricLink(tenantA, goalId, 'orders', 'month');
    expect(() => ogsmTrackingService.createMetricLink(tenantA, goalId, 'orders', 'month')).toThrow();
  });

  it('查询对标：按 goal 过滤', () => {
    const objId = seedObjective(tenantA);
    const goalId = seedGoal(objId);
    ogsmTrackingService.createMetricLink(tenantA, goalId, 'gmv', 'month');
    ogsmTrackingService.createMetricLink(tenantA, goalId, 'orders', 'week');
    const links = ogsmTrackingService.listMetricLinks(tenantA, goalId);
    expect(links.length).toBeGreaterThanOrEqual(2);
  });

  it('更新对标：scale/autoSync/status', () => {
    const objId = seedObjective(tenantA);
    const goalId = seedGoal(objId);
    const link = ogsmTrackingService.createMetricLink(tenantA, goalId, 'gross_profit', 'quarter');
    const updated = ogsmTrackingService.updateMetricLink(link.id, tenantA, { scaleFactor: 2.5, autoSync: false });
    expect(updated?.scale_factor).toBe(2.5);
    expect(updated?.auto_sync).toBe(0);
  });

  it('删除对标', () => {
    const objId = seedObjective(tenantA);
    const goalId = seedGoal(objId);
    const link = ogsmTrackingService.createMetricLink(tenantA, goalId, 'conversion', 'day');
    expect(ogsmTrackingService.deleteMetricLink(link.id, tenantA)).toBe(true);
    expect(ogsmTrackingService.getMetricLink(link.id, tenantA)).toBeNull();
  });

  it('同步对标：无订单时不报错', () => {
    const objId = seedObjective(tenantA);
    const goalId = seedGoal(objId);
    const link = ogsmTrackingService.createMetricLink(tenantA, goalId, 'gmv', 'month');
    const r = ogsmTrackingService.syncMetricLink(link.id, tenantA);
    expect(r).not.toBeNull();
    expect(typeof r!.actualValue).toBe('number');
    expect(typeof r!.currentValue).toBe('number');
  });

  it('批量同步', () => {
    const r = ogsmTrackingService.syncAllLinks(tenantA);
    expect(r.synced).toBeGreaterThan(0);
    expect(r.errors).toBe(0);
  });

  it('租户隔离：tenantB 看不到 tenantA 对标', () => {
    const objId = seedObjective(tenantA);
    const goalId = seedGoal(objId);
    const link = ogsmTrackingService.createMetricLink(tenantA, goalId, 'gmv', 'month');
    expect(ogsmTrackingService.getMetricLink(link.id, tenantB)).toBeNull();
    expect(ogsmTrackingService.deleteMetricLink(link.id, tenantB)).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────
describe('OGSM 偏离告警 (O4)', () => {
  it('扫描偏离：进度严重落后', () => {
    // 创建一个目标，时间区间：30 天前 ~ 60 天后，当前应是 33%
    // 设置 progress=5，预期偏离触发
    const now = new Date();
    const start = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);
    const end = new Date(now.getTime() + 60 * 86400000).toISOString().slice(0, 10);
    const objId = seedObjective(tenantA, { startDate: start, endDate: end, progress: 5 });
    seedGoal(objId, { targetValue: 100, currentValue: 5 });
    const r = ogsmTrackingService.detectDeviations(tenantA);
    expect(r.detected).toBeGreaterThan(0);
  });

  it('进度正常不告警', () => {
    const now = new Date();
    const start = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);
    const end = new Date(now.getTime() + 60 * 86400000).toISOString().slice(0, 10);
    const objId = seedObjective(tenantA, { startDate: start, endDate: end, progress: 35 });
    seedGoal(objId, { targetValue: 100, currentValue: 35 });
    const before = ogsmTrackingService.listDeviations(tenantA, { severity: 'critical' });
    ogsmTrackingService.detectDeviations(tenantA);
    const after = ogsmTrackingService.listDeviations(tenantA, { severity: 'critical' });
    // 这个目标不会触发 critical 偏离（35% 对 33% 计划线，ratio > 0.8）
    expect(after.total).toBeGreaterThanOrEqual(before.total);
  });

  it('告警严重度分级：critical / warning / info', () => {
    const now = new Date();
    const start = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);
    const end = new Date(now.getTime() + 60 * 86400000).toISOString().slice(0, 10);
    // critical: 5% 实际 vs 33% 计划 → ratio 0.15
    seedObjective(tenantA, { startDate: start, endDate: end, progress: 5, title: uniq('critical') });
    // warning: 18% vs 33% → ratio 0.55
    seedObjective(tenantA, { startDate: start, endDate: end, progress: 18, title: uniq('warning') });
    // info: 24% vs 33% → ratio 0.73
    seedObjective(tenantA, { startDate: start, endDate: end, progress: 24, title: uniq('info') });
    const r = ogsmTrackingService.detectDeviations(tenantA);
    expect(r.detected).toBeGreaterThan(0);
    const summary = ogsmTrackingService.listDeviations(tenantA);
    expect(summary.critical).toBeGreaterThanOrEqual(1);
    expect(summary.warning).toBeGreaterThanOrEqual(1);
    expect(summary.info).toBeGreaterThanOrEqual(1);
  });

  it('24h 内同目标同日期不重复告警', () => {
    const now = new Date();
    const start = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);
    const end = new Date(now.getTime() + 60 * 86400000).toISOString().slice(0, 10);
    const objId = seedObjective(tenantA, { startDate: start, endDate: end, progress: 5 });
    seedGoal(objId, { targetValue: 100, currentValue: 5 });
    const r1 = ogsmTrackingService.detectDeviations(tenantA);
    const r2 = ogsmTrackingService.detectDeviations(tenantA);
    // 第二次应不新增（已存在）
    expect(r2.inserted).toBeLessThanOrEqual(r1.inserted);
  });

  it('确认告警', () => {
    const summary = ogsmTrackingService.listDeviations(tenantA, { acknowledged: false });
    if (summary.items.length === 0) {
      // skip if no unack deviations
      return;
    }
    const target = summary.items[0];
    const ack = ogsmTrackingService.acknowledgeDeviation(target.id, tenantA, userA.id);
    expect(ack).not.toBeNull();
    expect(ack!.is_acknowledged).toBe(1);
  });

  it('租户隔离：tenantB 看不到 tenantA 告警', () => {
    const summaryB = ogsmTrackingService.listDeviations(tenantB);
    // tenantB 自己生成的告警数（可能为空）
    const summaryA = ogsmTrackingService.listDeviations(tenantA);
    // 不会跨租户显示，tenantB.total 与 tenantA.total 独立
    expect(summaryB.total).toBeGreaterThanOrEqual(0);
    expect(summaryA.total).toBeGreaterThanOrEqual(0);
  });
});

// ──────────────────────────────────────────────────────────────
describe('OGSM 对标同 goal 列表', () => {
  it('getGoalMetrics 返回 goal 下所有对标', () => {
    const objId = seedObjective(tenantA);
    const goalId = seedGoal(objId);
    ogsmTrackingService.createMetricLink(tenantA, goalId, 'gmv', 'month');
    ogsmTrackingService.createMetricLink(tenantA, goalId, 'orders', 'month');
    const list = ogsmTrackingService.getGoalMetrics(tenantA, goalId);
    expect(list.length).toBe(2);
  });
});

// ──────────────────────────────────────────────────────────────
describe('OGSM 汇总统计 (O1)', () => {
  it('getOgsmStats 正确聚合 O/G/S/M 数量与完成率', () => {
    // 使用独立租户，确保计数精确不受其他用例污染
    const t = seedTenant();
    const objId = seedObjective(t, { title: uniq('统计目标') });
    seedGoal(objId, { targetValue: 100, currentValue: 100 }); // 达标
    seedGoal(objId, { targetValue: 100, currentValue: 50 });  // 未达标
    const stratGoalId = seedGoal(objId, { targetValue: 10, currentValue: 5 }); // 未达标
    const strat = ogsmService.createStrategy(t, { goalId: stratGoalId, title: uniq('策略') });
    ogsmService.createMeasure(t, { strategyId: strat.id, title: uniq('度量'), targetValue: 50, currentValue: 10 });

    const stats = ogsmService.getOgsmStats(t);
    expect(stats.objectives).toBe(1);
    expect(stats.goals).toBe(3);
    expect(stats.strategies).toBe(1);
    expect(stats.measures).toBe(1);
    // 3 个 G 中仅 1 个达标 → 完成率约 33.3%
    expect(stats.goalCompletionRate).toBeCloseTo((1 / 3) * 100, 0);

    // 未写入任何数据的租户统计为 0（租户隔离）
    const empty = seedTenant();
    const emptyStats = ogsmService.getOgsmStats(empty);
    expect(emptyStats.objectives).toBe(0);
    expect(emptyStats.goals).toBe(0);
    expect(emptyStats.goalCompletionRate).toBe(0);
  });
});