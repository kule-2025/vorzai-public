/**
 * OGSM 时间序列追踪 + 经营对标服务（O2/O3/O4）
 *
 * O2: 每日/每周自动打点，progress/alignment 时间序列回看
 * O3: OGSM 目标 ↔ analytics 指标对标，自动拉取 GMV/订单/毛利/转化实际值
 * O4: 进度偏离计划线 80% 自动生成告警
 */

import { getDatabase, transaction, type DatabaseSync } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import { analyticsService } from './analyticsService';

// ── 类型 ──────────────────────────────────────────────────────
export interface ProgressSnapshot {
  id: string;
  tenant_id: string;
  objective_id: string;
  snapshot_date: string;
  progress: number;
  alignment: number | null;
  goal_progress_sum: number | null;
  goal_count: number | null;
  is_auto: number;
  note: string | null;
  created_at: string;
}

export interface MetricLink {
  id: string;
  tenant_id: string;
  goal_id: string;
  metric_key: string;
  period_type: 'day' | 'week' | 'month' | 'quarter' | 'year';
  scale_factor: number;
  auto_sync: number;
  last_synced_at: string | null;
  last_value: number | null;
  last_progress: number | null;
  status: 'active' | 'paused' | 'archived';
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Deviation {
  id: string;
  tenant_id: string;
  objective_id: string;
  snapshot_date: string;
  actual_progress: number;
  planned_progress: number;
  deviation_ratio: number;
  severity: 'info' | 'warning' | 'critical';
  is_acknowledged: number;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  note: string | null;
  created_at: string;
}

export interface TimeSeries {
  objectiveId: string;
  objectiveTitle: string;
  startDate: string;
  endDate: string;
  points: { date: string; progress: number; alignment: number | null }[];
  averageProgress: number;
  latestProgress: number;
  trend: 'up' | 'down' | 'flat';
}

export interface DeviationSummary {
  total: number;
  critical: number;
  warning: number;
  info: number;
  unacknowledged: number;
  items: (Deviation & { objectiveTitle?: string })[];
}

// ── Service ──────────────────────────────────────────────────
export class OgsmTrackingService {
  // ── O2: 进度快照 ─────────────────────────────────────────
  createSnapshot(
    tenantId: string,
    objectiveId: string,
    snapshotDate?: string,
    note?: string,
    isAuto: boolean = false
  ): ProgressSnapshot {
    const db = getDatabase();
    const id = uuidv4();
    const date = snapshotDate ?? new Date().toISOString().slice(0, 10);

    // 计算当前进度
    const obj = db.prepare(
      'SELECT id, progress FROM ogsm_objectives WHERE id = ? AND tenant_id = ?'
    ).get(objectiveId, tenantId) as { id: string; progress: number } | undefined;
    if (!obj) throw new Error(`目标 ${objectiveId} 不存在或不属于租户`);

    const goals = db.prepare(
      'SELECT id, target_value, current_value FROM ogsm_goals WHERE objective_id = ?'
    ).all(objectiveId) as { id: string; target_value: number | null; current_value: number | null }[];
    const goalProgresses = goals.map((g) =>
      g.target_value && g.target_value > 0 ? Math.min(100, ((g.current_value || 0) / g.target_value) * 100) : 0
    );
    const progressSum = goalProgresses.reduce((s, p) => s + p, 0);
    const alignment = goalProgresses.length > 0
      ? Math.round(progressSum / goalProgresses.length)
      : null;

    transaction(() => {
      db.prepare(
        `INSERT INTO ogsm_progress_snapshots (id, tenant_id, objective_id, snapshot_date, progress, alignment, goal_progress_sum, goal_count, is_auto, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(objective_id, snapshot_date) DO UPDATE SET
           progress = excluded.progress,
           alignment = excluded.alignment,
           goal_progress_sum = excluded.goal_progress_sum,
           goal_count = excluded.goal_count,
           is_auto = excluded.is_auto,
           note = excluded.note`
      ).run(
        id,
        tenantId,
        objectiveId,
        date,
        obj.progress || 0,
        alignment,
        progressSum,
        goalProgresses.length,
        isAuto ? 1 : 0,
        note ?? null
      );
    });

    return db.prepare('SELECT * FROM ogsm_progress_snapshots WHERE objective_id = ? AND snapshot_date = ?')
      .get(objectiveId, date) as ProgressSnapshot;
  }

  /**
   * 为租户内所有目标批量打点（可作为定时任务入口）
   * 默认给每个目标补当天的快照（已存在则更新）
   */
  captureDailySnapshots(tenantId: string, snapshotDate?: string): { captured: number; updated: number } {
    const db = getDatabase();
    const objectives = db.prepare(
      'SELECT id FROM ogsm_objectives WHERE tenant_id = ? AND status = ?'
    ).all(tenantId, 'active') as { id: string }[];

    let captured = 0;
    let updated = 0;
    for (const obj of objectives) {
      const existed = db.prepare(
        'SELECT id FROM ogsm_progress_snapshots WHERE objective_id = ? AND snapshot_date = ?'
      ).get(obj.id, snapshotDate ?? new Date().toISOString().slice(0, 10));
      this.createSnapshot(tenantId, obj.id, snapshotDate, '自动每日打点', true);
      if (existed) updated++; else captured++;
    }
    logger.info('ogsm-tracking', `批量打点完成：${captured} 新增 / ${updated} 更新`);
    return { captured, updated };
  }

  /**
   * 获取目标的时间序列
   */
  getTimeSeries(
    tenantId: string,
    objectiveId: string,
    fromDate: string,
    toDate: string
  ): TimeSeries | null {
    const db = getDatabase();
    const obj = db.prepare(
      'SELECT id, title, progress, start_date, end_date FROM ogsm_objectives WHERE id = ? AND tenant_id = ?'
    ).get(objectiveId, tenantId) as { id: string; title: string; progress: number; start_date: string | null; end_date: string | null } | undefined;
    if (!obj) return null;

    const rows = db.prepare(
      `SELECT snapshot_date, progress, alignment FROM ogsm_progress_snapshots
       WHERE objective_id = ? AND snapshot_date BETWEEN ? AND ?
       ORDER BY snapshot_date`
    ).all(objectiveId, fromDate, toDate) as { snapshot_date: string; progress: number; alignment: number | null }[];

    const points = rows.map((r) => ({
      date: r.snapshot_date,
      progress: r.progress,
      alignment: r.alignment,
    }));

    const progresses = points.map((p) => p.progress);
    const averageProgress = progresses.length > 0
      ? Math.round(progresses.reduce((s, v) => s + v, 0) / progresses.length)
      : 0;
    const latestProgress = progresses.length > 0 ? progresses[progresses.length - 1] : 0;

    let trend: 'up' | 'down' | 'flat' = 'flat';
    if (progresses.length >= 2) {
      const diff = progresses[progresses.length - 1] - progresses[0];
      if (diff > 2) trend = 'up';
      else if (diff < -2) trend = 'down';
    }

    return {
      objectiveId: obj.id,
      objectiveTitle: obj.title,
      startDate: fromDate,
      endDate: toDate,
      points,
      averageProgress,
      latestProgress,
      trend,
    };
  }

  /**
   * 获取租户所有目标的时间序列概览（执行监控面板用）
   */
  getTenantOverview(tenantId: string, days: number = 30): {
    objectives: { id: string; title: string; progress: number; trend: 'up' | 'down' | 'flat'; snapshots: number }[];
    aggregateTrend: { date: string; avgProgress: number }[];
  } {
    const db = getDatabase();
    const toDate = new Date().toISOString().slice(0, 10);
    const fromDate = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);

    const objectives = db.prepare(
      `SELECT o.id, o.title, o.progress FROM ogsm_objectives o WHERE o.tenant_id = ? AND o.status = 'active'`
    ).all(tenantId) as { id: string; title: string; progress: number }[];

    const enriched = objectives.map((obj) => {
      const snaps = db.prepare(
        `SELECT snapshot_date, progress FROM ogsm_progress_snapshots
         WHERE objective_id = ? AND snapshot_date BETWEEN ? AND ? ORDER BY snapshot_date`
      ).all(obj.id, fromDate, toDate) as { snapshot_date: string; progress: number }[];
      const progresses = snaps.map((s) => s.progress);
      let trend: 'up' | 'down' | 'flat' = 'flat';
      if (progresses.length >= 2) {
        const diff = progresses[progresses.length - 1] - progresses[0];
        if (diff > 2) trend = 'up';
        else if (diff < -2) trend = 'down';
      }
      return { id: obj.id, title: obj.title, progress: obj.progress, trend, snapshots: snaps.length };
    });

    // 聚合每日平均进度
    const dateMap = new Map<string, { sum: number; n: number }>();
    objectives.forEach((obj) => {
      const snaps = db.prepare(
        `SELECT snapshot_date, progress FROM ogsm_progress_snapshots
         WHERE objective_id = ? AND snapshot_date BETWEEN ? AND ?`
      ).all(obj.id, fromDate, toDate) as { snapshot_date: string; progress: number }[];
      snaps.forEach((s) => {
        const cur = dateMap.get(s.snapshot_date) ?? { sum: 0, n: 0 };
        cur.sum += s.progress;
        cur.n += 1;
        dateMap.set(s.snapshot_date, cur);
      });
    });
    const aggregateTrend = Array.from(dateMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, v]) => ({ date, avgProgress: Math.round(v.sum / v.n) }));

    return { objectives: enriched, aggregateTrend };
  }

  // ── O3: 经营对标 ─────────────────────────────────────────
  createMetricLink(
    tenantId: string,
    goalId: string,
    metricKey: string,
    periodType: 'day' | 'week' | 'month' | 'quarter' | 'year' = 'month',
    opts: { scaleFactor?: number; autoSync?: boolean; createdBy?: string } = {}
  ): MetricLink {
    const db = getDatabase();
    const goal = db.prepare(
      `SELECT g.id FROM ogsm_goals g JOIN ogsm_objectives o ON g.objective_id = o.id WHERE g.id = ? AND o.tenant_id = ?`
    ).get(goalId, tenantId);
    if (!goal) throw new Error(`目标指标 ${goalId} 不存在或不属于租户`);

    const id = uuidv4();
    transaction(() => {
      db.prepare(
        `INSERT INTO ogsm_metric_links (id, tenant_id, goal_id, metric_key, period_type, scale_factor, auto_sync, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`
      ).run(
        id,
        tenantId,
        goalId,
        metricKey,
        periodType,
        opts.scaleFactor ?? 1.0,
        opts.autoSync === false ? 0 : 1,
        opts.createdBy ?? null
      );
    });
    return this.getMetricLink(id, tenantId)!;
  }

  getMetricLink(id: string, tenantId: string): MetricLink | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM ogsm_metric_links WHERE id = ? AND tenant_id = ?')
      .get(id, tenantId) as MetricLink | null | undefined;
    return row ?? null;
  }

  listMetricLinks(tenantId: string, goalId?: string): MetricLink[] {
    const db = getDatabase();
    if (goalId) {
      return db.prepare(
        'SELECT * FROM ogsm_metric_links WHERE tenant_id = ? AND goal_id = ? ORDER BY created_at DESC'
      ).all(tenantId, goalId) as MetricLink[];
    }
    return db.prepare(
      'SELECT * FROM ogsm_metric_links WHERE tenant_id = ? ORDER BY created_at DESC'
    ).all(tenantId) as MetricLink[];
  }

  updateMetricLink(
    id: string,
    tenantId: string,
    patch: { scaleFactor?: number; autoSync?: boolean; status?: 'active' | 'paused' | 'archived' }
  ): MetricLink | null {
    const db = getDatabase();
    const existing = this.getMetricLink(id, tenantId);
    if (!existing) return null;
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.scaleFactor !== undefined) { sets.push('scale_factor = ?'); params.push(patch.scaleFactor); }
    if (patch.autoSync !== undefined) { sets.push('auto_sync = ?'); params.push(patch.autoSync ? 1 : 0); }
    if (patch.status) { sets.push('status = ?'); params.push(patch.status); }
    sets.push("updated_at = datetime('now')");
    params.push(id, tenantId);
    db.prepare(`UPDATE ogsm_metric_links SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...params);
    return this.getMetricLink(id, tenantId);
  }

  deleteMetricLink(id: string, tenantId: string): boolean {
    const db = getDatabase();
    const r = db.prepare('DELETE FROM ogsm_metric_links WHERE id = ? AND tenant_id = ?').run(id, tenantId);
    return (r as { changes: number }).changes > 0;
  }

  /**
   * 同步对标：从 analytics 拉取当前周期实际值，更新 goal.current_value
   */
  syncMetricLink(linkId: string, tenantId: string): { link: MetricLink; actualValue: number; currentValue: number } | null {
    const link = this.getMetricLink(linkId, tenantId);
    if (!link || link.status !== 'active') return null;

    const db = getDatabase();
    // NOTE: ogsm_goals has no tenant_id column. Tenant ownership is already
    // guaranteed because the metric link was fetched with a tenant filter above.
    const goal = db.prepare(
      'SELECT id, target_value FROM ogsm_goals WHERE id = ?'
    ).get(link.goal_id) as { id: string; target_value: number | null } | undefined;
    if (!goal) return null;

    // 计算时间窗口
    const { start, end } = this._periodWindow(link.period_type);
    const overview = analyticsService.getOverview(tenantId, { from: start, to: end, compare: 'none' });
    const metric = overview.metrics.find((m) => m.key === link.metric_key);
    const actualValue = metric ? Number(metric.value || 0) : 0;

    // 计算等比 current_value
    const scaled = actualValue * (link.scale_factor ?? 1);
    const targetVal = goal.target_value ?? 0;
    const newProgress = targetVal > 0 ? Math.min(100, (scaled / targetVal) * 100) : 0;

    transaction(() => {
      db.prepare(
        `UPDATE ogsm_metric_links SET last_synced_at = datetime('now'), last_value = ?, last_progress = ? WHERE id = ? AND tenant_id = ?`
      ).run(actualValue, newProgress, linkId, tenantId);
      if (link.auto_sync) {
        db.prepare(
          `UPDATE ogsm_goals SET current_value = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(scaled, link.goal_id);
        // 重算目标进度
        const parent = db.prepare('SELECT objective_id FROM ogsm_goals WHERE id = ?').get(link.goal_id) as { objective_id: string };
        this._recalculateObjectiveProgress(parent.objective_id);
      }
    });

    return { link: this.getMetricLink(linkId, tenantId)!, actualValue, currentValue: scaled };
  }

  /**
   * 批量同步所有 active 链接（手动触发或定时）
   */
  syncAllLinks(tenantId: string): { synced: number; errors: number } {
    const db = getDatabase();
    const links = db.prepare(
      "SELECT id FROM ogsm_metric_links WHERE tenant_id = ? AND status = 'active'"
    ).all(tenantId) as { id: string }[];
    let synced = 0, errors = 0;
    for (const l of links) {
      try {
        this.syncMetricLink(l.id, tenantId);
        synced++;
      } catch (e) {
        errors++;
        logger.warn('ogsm-tracking', `同步链接 ${l.id} 失败: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return { synced, errors };
  }

  /**
   * 列出目标的指标对标（供前端展示）
   */
  getGoalMetrics(tenantId: string, goalId: string): MetricLink[] {
    return this.listMetricLinks(tenantId, goalId);
  }

  // ── O4: 偏离告警 ─────────────────────────────────────────
  /**
   * 计算计划进度：基于目标 start_date/end_date 的线性期望
   */
  private _plannedProgress(startDate: string | null, endDate: string | null, asOf: string): number {
    if (!startDate || !endDate) return 0;
    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate).getTime();
    const nowMs = new Date(asOf).getTime();
    if (endMs <= startMs) return 0;
    if (nowMs <= startMs) return 0;
    if (nowMs >= endMs) return 100;
    return Math.round(((nowMs - startMs) / (endMs - startMs)) * 100);
  }

  /**
   * 扫描目标偏离：actual_progress / planned_progress < 0.8 → 触发告警
   */
  detectDeviations(tenantId: string, snapshotDate?: string): { detected: number; inserted: number } {
    const db = getDatabase();
    const date = snapshotDate ?? new Date().toISOString().slice(0, 10);
    const objectives = db.prepare(
      "SELECT id, progress, start_date, end_date FROM ogsm_objectives WHERE tenant_id = ? AND status = 'active'"
    ).all(tenantId) as { id: string; progress: number; start_date: string | null; end_date: string | null }[];

    let detected = 0;
    let inserted = 0;
    for (const obj of objectives) {
      const planned = this._plannedProgress(obj.start_date, obj.end_date, date);
      const actual = obj.progress || 0;
      if (planned <= 0) continue; // 未到计划起点不告警
      const ratio = actual / planned;
      if (ratio >= 0.8) continue;

      detected++;
      // 24h 内已存在同 objective 同日期告警则不重复插入
      const existing = db.prepare(
        "SELECT id FROM ogsm_deviations WHERE objective_id = ? AND tenant_id = ? AND snapshot_date = ?"
      ).get(obj.id, tenantId, date);
      if (existing) continue;

      const severity = ratio < 0.5 ? 'critical' : ratio < 0.65 ? 'warning' : 'info';
      db.prepare(
        `INSERT INTO ogsm_deviations (id, tenant_id, objective_id, snapshot_date, actual_progress, planned_progress, deviation_ratio, severity)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(uuidv4(), tenantId, obj.id, date, actual, planned, ratio, severity);
      inserted++;
    }
    logger.info('ogsm-tracking', `偏离扫描完成：检测 ${detected}，新增 ${inserted}`);
    return { detected, inserted };
  }

  listDeviations(tenantId: string, opts: { acknowledged?: boolean; severity?: string } = {}): DeviationSummary {
    const db = getDatabase();
    const where = ['d.tenant_id = ?'];
    const params: unknown[] = [tenantId];
    if (opts.acknowledged !== undefined) {
      where.push('d.is_acknowledged = ?');
      params.push(opts.acknowledged ? 1 : 0);
    }
    if (opts.severity) {
      where.push('d.severity = ?');
      params.push(opts.severity);
    }
    const rows = db.prepare(
      `SELECT d.*, o.title as objectiveTitle FROM ogsm_deviations d LEFT JOIN ogsm_objectives o ON d.objective_id = o.id WHERE ${where.join(' AND ')} ORDER BY d.created_at DESC LIMIT 200`
    ).all(...params) as (Deviation & { objectiveTitle?: string })[];
    const summary: DeviationSummary = {
      total: rows.length,
      critical: rows.filter((r) => r.severity === 'critical').length,
      warning: rows.filter((r) => r.severity === 'warning').length,
      info: rows.filter((r) => r.severity === 'info').length,
      unacknowledged: rows.filter((r) => !r.is_acknowledged).length,
      items: rows,
    };
    return summary;
  }

  acknowledgeDeviation(id: string, tenantId: string, userId: string): Deviation | null {
    const db = getDatabase();
    const r = db.prepare(
      `UPDATE ogsm_deviations SET is_acknowledged = 1, acknowledged_by = ?, acknowledged_at = datetime('now') WHERE id = ? AND tenant_id = ?`
    ).run(userId, id, tenantId);
    if ((r as { changes: number }).changes === 0) return null;
    return db.prepare('SELECT * FROM ogsm_deviations WHERE id = ? AND tenant_id = ?').get(id, tenantId) as Deviation;
  }

  // ── 私有 helper ──────────────────────────────────────────
  private _periodWindow(periodType: string): { start: string; end: string } {
    const now = new Date();
    const end = now.toISOString().slice(0, 10);
    let startMs: number;
    switch (periodType) {
      case 'day': startMs = now.getTime() - 1 * 86400000; break;
      case 'week': startMs = now.getTime() - 7 * 86400000; break;
      case 'month': startMs = now.getTime() - 30 * 86400000; break;
      case 'quarter': startMs = now.getTime() - 90 * 86400000; break;
      case 'year': startMs = now.getTime() - 365 * 86400000; break;
      default: startMs = now.getTime() - 30 * 86400000;
    }
    return { start: new Date(startMs).toISOString().slice(0, 10), end };
  }

  private _recalculateObjectiveProgress(objectiveId: string): void {
    const db = getDatabase();
    const goals = db.prepare(
      'SELECT target_value, current_value FROM ogsm_goals WHERE objective_id = ?'
    ).all(objectiveId) as { target_value: number | null; current_value: number | null }[];
    if (goals.length === 0) return;
    const totalTarget = goals.reduce((s, g) => s + (g.target_value || 0), 0);
    const totalCurrent = goals.reduce((s, g) => s + (g.current_value || 0), 0);
    const progress = totalTarget > 0 ? Math.min(100, Math.round((totalCurrent / totalTarget) * 100)) : 0;
    db.prepare("UPDATE ogsm_objectives SET progress = ?, updated_at = datetime('now') WHERE id = ?").run(progress, objectiveId);
  }
}

export const ogsmTrackingService = new OgsmTrackingService();