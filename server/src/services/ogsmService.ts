import { getDatabase, paginate, PaginationParams, PaginatedResult } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { NotFoundError, ValidationError } from '../utils/errors';
import { logger } from '../utils/logger';

export interface ObjectiveInput {
  title: string;
  description?: string;
  level?: string;
  parentId?: string;
  ownerId?: string;
  departmentId?: string;
  startDate?: string;
  endDate?: string;
  priority?: string;
}

export interface GoalInput {
  objectiveId: string;
  title: string;
  description?: string;
  metricType?: string;
  targetValue?: number;
  unit?: string;
  ownerId?: string;
  deadline?: string;
}

export interface StrategyInput {
  goalId: string;
  title: string;
  description?: string;
  ownerId?: string;
}

export interface MeasureInput {
  strategyId: string;
  title: string;
  description?: string;
  metricType?: string;
  targetValue?: number;
  unit?: string;
  frequency?: string;
  ownerId?: string;
  deadline?: string;
}

export interface RaciInput {
  entityType: string;
  entityId: string;
  userId: string;
  responsibility: 'R' | 'A' | 'C' | 'I';
}

export interface IncentiveInput {
  name: string;
  type: string;
  description?: string;
  rules?: Record<string, unknown>;
  targetType?: string;
  targetId?: string;
  amount?: number;
  currency?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
}

export class OgsmService {
  // ==================== Objectives ====================

  createObjective(tenantId: string, input: ObjectiveInput): Record<string, unknown> {
    const db = getDatabase();
    const id = uuidv4();

    if (input.parentId) {
      const parent = db.prepare('SELECT id, level FROM ogsm_objectives WHERE id = ? AND tenant_id = ?').get(input.parentId, tenantId);
      if (!parent) throw new NotFoundError('父级目标', input.parentId);
    }

    db.prepare(
      `INSERT INTO ogsm_objectives (id, tenant_id, title, description, level, parent_id, owner_id, department_id, start_date, end_date, priority, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
    ).run(
      id, tenantId, input.title, input.description || null,
      input.level || 'company', input.parentId || null,
      input.ownerId || null, input.departmentId || null,
      input.startDate || null, input.endDate || null,
      input.priority || 'medium'
    );

    logger.info('ogsm', `Objective created: ${input.title}`, { id, tenantId });
    return this.getObjective(id)!;
  }

  getObjective(id: string, tenantId?: string): Record<string, unknown> | null {
    const db = getDatabase();
    let sql = `SELECT o.*, u.display_name as owner_name, d.name as department_name
       FROM ogsm_objectives o
       LEFT JOIN users u ON o.owner_id = u.id
       LEFT JOIN departments d ON o.department_id = d.id
       WHERE o.id = ?`;
    const params: unknown[] = [id];

    // SECURITY: Filter by tenant when provided
    if (tenantId) {
      sql += ' AND o.tenant_id = ?';
      params.push(tenantId);
    }

    const row = db.prepare(sql).get(...params) as any;

    if (!row) return null;

    // Get child counts
    const childCount = db.prepare('SELECT COUNT(*) as count FROM ogsm_objectives WHERE parent_id = ?').get(id) as any;
    const goalCount = db.prepare('SELECT COUNT(*) as count FROM ogsm_goals WHERE objective_id = ?').get(id) as any;

    return { ...row, childCount: childCount.count, goalCount: goalCount.count };
  }

  listObjectives(tenantId: string, params: PaginationParams & { level?: string; status?: string; ownerId?: string; keyword?: string }): PaginatedResult<any> {
    let where = 'WHERE o.tenant_id = @tenantId';
    const queryParams: Record<string, unknown> = { tenantId };

    if (params.keyword) {
      where += ' AND (o.title LIKE @kw OR o.description LIKE @kw)';
      queryParams.kw = `%${params.keyword}%`;
    }
    if (params.level) {
      where += ' AND o.level = @level';
      queryParams.level = params.level;
    }
    if (params.status) {
      where += ' AND o.status = @status';
      queryParams.status = params.status;
    }
    if (params.ownerId) {
      where += ' AND o.owner_id = @ownerId';
      queryParams.ownerId = params.ownerId;
    }

    const query = `SELECT o.*, u.display_name as owner_name, d.name as department_name
                   FROM ogsm_objectives o
                   LEFT JOIN users u ON o.owner_id = u.id
                   LEFT JOIN departments d ON o.department_id = d.id ${where}`;
    const countQuery = `SELECT COUNT(*) as total FROM ogsm_objectives o ${where}`;

    return paginate(query, countQuery, queryParams, params);
  }

  /**
   * 租户级 OGSM 汇总统计（供 Dashboard 四象限 / Tab 角标使用）。
   * 全部按 tenant_id 隔离，通过 ogsm_objectives 关联计数，避免跨租户串数据。
   */
  getOgsmStats(tenantId: string): {
    objectives: number;
    goals: number;
    strategies: number;
    measures: number;
    goalCompletionRate: number;
  } {
    const db = getDatabase();
    const objectives = (db.prepare('SELECT COUNT(*) as c FROM ogsm_objectives WHERE tenant_id = ?').get(tenantId) as { c: number }).c;
    const goals = (db.prepare(`
      SELECT COUNT(*) as c FROM ogsm_goals g
      JOIN ogsm_objectives o ON g.objective_id = o.id
      WHERE o.tenant_id = ?
    `).get(tenantId) as { c: number }).c;
    const strategies = (db.prepare(`
      SELECT COUNT(*) as c FROM ogsm_strategies s
      JOIN ogsm_goals g ON s.goal_id = g.id
      JOIN ogsm_objectives o ON g.objective_id = o.id
      WHERE o.tenant_id = ?
    `).get(tenantId) as { c: number }).c;
    const measures = (db.prepare(`
      SELECT COUNT(*) as c FROM ogsm_measures m
      JOIN ogsm_strategies s ON m.strategy_id = s.id
      JOIN ogsm_goals g ON s.goal_id = g.id
      JOIN ogsm_objectives o ON g.objective_id = o.id
      WHERE o.tenant_id = ?
    `).get(tenantId) as { c: number }).c;

    const goalRows = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN current_value IS NOT NULL AND target_value IS NOT NULL AND current_value >= target_value THEN 1 ELSE 0 END) as done
      FROM ogsm_goals g
      JOIN ogsm_objectives o ON g.objective_id = o.id
      WHERE o.tenant_id = ?
    `).all(tenantId) as { total: number; done: number }[];
    const total = goalRows[0]?.total ?? 0;
    const done = goalRows[0]?.done ?? 0;
    const goalCompletionRate = total > 0 ? (done / total) * 100 : 0;

    return { objectives, goals, strategies, measures, goalCompletionRate };
  }

  updateObjective(id: string, tenantId: string, input: Partial<ObjectiveInput> & { status?: string; progress?: number }): Record<string, unknown> {
    const db = getDatabase();
    const existing = db.prepare('SELECT id FROM ogsm_objectives WHERE id = ? AND tenant_id = ?').get(id, tenantId);
    if (!existing) throw new NotFoundError('目标', id);

    const fields: string[] = [];
    const values: unknown[] = [];

    const allowedFields: Record<string, string> = {
      title: 'title', description: 'description', level: 'level',
      ownerId: 'owner_id', departmentId: 'department_id',
      startDate: 'start_date', endDate: 'end_date',
      priority: 'priority', status: 'status', progress: 'progress',
    };

    for (const [key, column] of Object.entries(allowedFields)) {
      if ((input as any)[key] !== undefined) {
        fields.push(`${column} = ?`);
        values.push((input as any)[key]);
      }
    }

    if (fields.length === 0) throw new ValidationError('没有需要更新的字段');

    fields.push("updated_at = datetime('now', '+0000')");
    values.push(id, tenantId);

    db.prepare(`UPDATE ogsm_objectives SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...values);

    return this.getObjective(id)!;
  }

  deleteObjective(id: string, tenantId: string): void {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM ogsm_objectives WHERE id = ? AND tenant_id = ?').run(id, tenantId);
    if ((result as any).changes === 0) throw new NotFoundError('目标', id);
  }

  // ==================== Goals ====================

  createGoal(tenantId: string, input: GoalInput): Record<string, unknown> {
    const db = getDatabase();
    const objective = db.prepare('SELECT id FROM ogsm_objectives WHERE id = ? AND tenant_id = ?').get(input.objectiveId, tenantId);
    if (!objective) throw new NotFoundError('目标', input.objectiveId);

    const id = uuidv4();
    db.prepare(
      `INSERT INTO ogsm_goals (id, objective_id, title, description, metric_type, target_value, unit, owner_id, deadline, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    ).run(id, input.objectiveId, input.title, input.description || null,
      input.metricType || 'percentage', input.targetValue || null,
      input.unit || null, input.ownerId || null, input.deadline || null);

    // NOTE: ogsm_goals has no tenant_id column; isolation is enforced above
    // by verifying the parent objective belongs to this tenant.
    return db.prepare('SELECT * FROM ogsm_goals WHERE id = ?').get(id) as any;
  }

  // ── 租户归属校验（子表无 tenant_id 列，需沿 FK 链回溯源头的 tenant）──
  verifyObjectiveOwnership(objectiveId: string, tenantId: string): boolean {
    const db = getDatabase();
    const row = db.prepare('SELECT id FROM ogsm_objectives WHERE id = ? AND tenant_id = ?').get(objectiveId, tenantId);
    return !!row;
  }

  verifyGoalOwnership(goalId: string, tenantId: string): boolean {
    const db = getDatabase();
    const row = db.prepare(
      `SELECT g.id FROM ogsm_goals g
       JOIN ogsm_objectives o ON g.objective_id = o.id
       WHERE g.id = ? AND o.tenant_id = ?`
    ).get(goalId, tenantId);
    return !!row;
  }

  verifyStrategyOwnership(strategyId: string, tenantId: string): boolean {
    const db = getDatabase();
    const row = db.prepare(
      `SELECT s.id FROM ogsm_strategies s
       JOIN ogsm_goals g ON s.goal_id = g.id
       JOIN ogsm_objectives o ON g.objective_id = o.id
       WHERE s.id = ? AND o.tenant_id = ?`
    ).get(strategyId, tenantId);
    return !!row;
  }

  listGoals(objectiveId: string): Record<string, unknown>[] {
    const db = getDatabase();
    return db.prepare(
      `SELECT g.*, u.display_name as owner_name
       FROM ogsm_goals g LEFT JOIN users u ON g.owner_id = u.id
       WHERE g.objective_id = ? ORDER BY g.created_at`
    ).all(objectiveId) as any[];
  }

  updateGoalProgress(id: string, currentValue: number, tenantId?: string): Record<string, unknown> {
    const db = getDatabase();
    // SECURITY: Verify tenant ownership through parent objective
    const goal = db.prepare(
      `SELECT g.* FROM ogsm_goals g
       JOIN ogsm_objectives o ON g.objective_id = o.id
       WHERE g.id = ?${tenantId ? ' AND o.tenant_id = ?' : ''}`
    ).get(id, ...(tenantId ? [tenantId] : [])) as any;
    if (!goal) throw new NotFoundError('目标指标', id);

    const progress = goal.target_value > 0 ? Math.min(100, (currentValue / goal.target_value) * 100) : 0;
    const status = progress >= 100 ? 'achieved' : 'in_progress';

    // Ownership already verified above via the objective JOIN; ogsm_goals itself
    // carries no tenant_id column, so the PK predicate is sufficient here.
    db.prepare(
      `UPDATE ogsm_goals SET current_value = ?, status = ?, updated_at = datetime('now', '+0000') WHERE id = ?`
    ).run(currentValue, status, id);

    // Update parent objective progress
    this.recalculateObjectiveProgress(goal.objective_id);

    return db.prepare('SELECT * FROM ogsm_goals WHERE id = ?').get(id) as any;
  }

  // ==================== Strategies ====================

  createStrategy(tenantId: string, input: StrategyInput): Record<string, unknown> {
    const db = getDatabase();
    // SECURITY: Verify goal belongs to this tenant through objective hierarchy
    const goal = db.prepare(
      `SELECT g.id FROM ogsm_goals g
       JOIN ogsm_objectives o ON g.objective_id = o.id
       WHERE g.id = ? AND o.tenant_id = ?`
    ).get(input.goalId, tenantId);
    if (!goal) throw new NotFoundError('目标指标', input.goalId);

    const id = uuidv4();

    db.prepare(
      `INSERT INTO ogsm_strategies (id, goal_id, title, description, owner_id, status)
       VALUES (?, ?, ?, ?, ?, 'planned')`
    ).run(id, input.goalId, input.title, input.description || null, input.ownerId || null);

    // NOTE: ogsm_strategies has no tenant_id column; isolation enforced above via goal→objective JOIN.
    return db.prepare('SELECT * FROM ogsm_strategies WHERE id = ?').get(id) as any;
  }

  listStrategies(goalId: string): Record<string, unknown>[] {
    const db = getDatabase();
    return db.prepare(
      `SELECT s.*, u.display_name as owner_name
       FROM ogsm_strategies s LEFT JOIN users u ON s.owner_id = u.id
       WHERE s.goal_id = ? ORDER BY s.sort_order`
    ).all(goalId) as any[];
  }

  // ==================== Measures ====================

  createMeasure(tenantId: string, input: MeasureInput): Record<string, unknown> {
    const db = getDatabase();
    // SECURITY: Verify strategy belongs to this tenant through strategy→goal→objective hierarchy
    const strategy = db.prepare(
      `SELECT s.id FROM ogsm_strategies s
       JOIN ogsm_goals g ON s.goal_id = g.id
       JOIN ogsm_objectives o ON g.objective_id = o.id
       WHERE s.id = ? AND o.tenant_id = ?`
    ).get(input.strategyId, tenantId);
    if (!strategy) throw new NotFoundError('策略', input.strategyId);

    const id = uuidv4();

    db.prepare(
      `INSERT INTO ogsm_measures (id, strategy_id, title, description, metric_type, target_value, unit, frequency, owner_id, deadline, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    ).run(id, input.strategyId, input.title, input.description || null,
      input.metricType || 'percentage', input.targetValue || null,
      input.unit || null, input.frequency || 'monthly',
      input.ownerId || null, input.deadline || null);

    // NOTE: ogsm_measures has no tenant_id column; isolation enforced above via strategy→goal→objective JOIN.
    return db.prepare('SELECT * FROM ogsm_measures WHERE id = ?').get(id) as any;
  }

  listMeasures(strategyId: string): Record<string, unknown>[] {
    const db = getDatabase();
    return db.prepare(
      `SELECT m.*, u.display_name as owner_name
       FROM ogsm_measures m LEFT JOIN users u ON m.owner_id = u.id
       WHERE m.strategy_id = ? ORDER BY m.created_at`
    ).all(strategyId) as any[];
  }

  // ==================== RACI Matrix ====================

  setRaci(tenantId: string, input: RaciInput): Record<string, unknown> {
    const db = getDatabase();
    const id = uuidv4();

    // FIX: Use ON CONFLICT DO UPDATE for proper upsert behavior
    db.prepare(
      `INSERT INTO raci_matrix (id, tenant_id, entity_type, entity_id, user_id, responsibility)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(entity_type, entity_id, user_id) DO UPDATE SET
         responsibility = excluded.responsibility,
         tenant_id = excluded.tenant_id`
    ).run(id, tenantId, input.entityType, input.entityId, input.userId, input.responsibility);

    // Return the upserted record
    return db.prepare(
      'SELECT * FROM raci_matrix WHERE entity_type = ? AND entity_id = ? AND user_id = ?'
    ).get(input.entityType, input.entityId, input.userId) as any;
  }

  getRaciMatrix(entityType: string, entityId: string): Record<string, unknown>[] {
    const db = getDatabase();
    return db.prepare(
      `SELECT r.*, u.display_name as user_name, u.role as user_role
       FROM raci_matrix r JOIN users u ON r.user_id = u.id
       WHERE r.entity_type = ? AND r.entity_id = ?
       ORDER BY CASE r.responsibility WHEN 'A' THEN 1 WHEN 'R' THEN 2 WHEN 'C' THEN 3 WHEN 'I' THEN 4 END`
    ).all(entityType, entityId) as any[];
  }

  // ==================== Incentives ====================

  createIncentive(tenantId: string, createdBy: string, input: IncentiveInput): Record<string, unknown> {
    const db = getDatabase();
    const id = uuidv4();

    db.prepare(
      `INSERT INTO incentives (id, tenant_id, name, type, description, rules, target_type, target_id, amount, currency, status, effective_from, effective_to, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
    ).run(id, tenantId, input.name, input.type, input.description || null,
      JSON.stringify(input.rules || {}), input.targetType || null,
      input.targetId || null, input.amount || null, input.currency || 'CNY',
      input.effectiveFrom || null, input.effectiveTo || null, createdBy);

    return db.prepare('SELECT * FROM incentives WHERE id = ?').get(id) as any;
  }

  listIncentives(tenantId: string, params: PaginationParams & { type?: string; status?: string }): PaginatedResult<any> {
    let where = 'WHERE tenant_id = @tenantId';
    const queryParams: Record<string, unknown> = { tenantId };

    if (params.type) { where += ' AND type = @type'; queryParams.type = params.type; }
    if (params.status) { where += ' AND status = @status'; queryParams.status = params.status; }

    return paginate(
      `SELECT * FROM incentives ${where}`,
      `SELECT COUNT(*) as total FROM incentives ${where}`,
      queryParams, params
    );
  }

  // ==================== Helpers ====================

  private recalculateObjectiveProgress(objectiveId: string): void {
    const db = getDatabase();
    const goals = db.prepare('SELECT target_value, current_value FROM ogsm_goals WHERE objective_id = ?').all(objectiveId) as any[];

    if (goals.length === 0) return;

    const totalTarget = goals.reduce((sum, g) => sum + (g.target_value || 0), 0);
    const totalCurrent = goals.reduce((sum, g) => sum + (g.current_value || 0), 0);
    const progress = totalTarget > 0 ? Math.min(100, Math.round((totalCurrent / totalTarget) * 100)) : 0;

    db.prepare("UPDATE ogsm_objectives SET progress = ?, updated_at = datetime('now', '+0000') WHERE id = ?").run(progress, objectiveId);
  }

  // Get full OGSM tree for an objective
  getOgsmTree(objectiveId: string, tenantId?: string): Record<string, unknown> | null {
    const objective = this.getObjective(objectiveId, tenantId);
    if (!objective) return null;

    const goals = this.listGoals(objectiveId);
    const goalsWithStrategies = goals.map((goal: any) => {
      const strategies = this.listStrategies(goal.id);
      const strategiesWithMeasures = strategies.map((strategy: any) => ({
        ...strategy,
        measures: this.listMeasures(strategy.id),
      }));
      return { ...goal, strategies: strategiesWithMeasures };
    });

    return { ...objective, goals: goalsWithStrategies };
  }

  // ==================== Dashboard / Analytics ====================

  getObjectProgress(objectiveId: string, tenantId: string): {
    objective: Record<string, unknown> | null;
    goalsProgress: { id: string; title: string; progress: number; status: string }[];
    overallProgress: number;
  } {
    const db = getDatabase();
    const objective = db.prepare('SELECT * FROM ogsm_objectives WHERE id = ? AND tenant_id = ?').get(objectiveId, tenantId) as any;
    if (!objective) throw new NotFoundError('目标', objectiveId);

    const goals = db.prepare(
      'SELECT id, title, target_value, current_value, status FROM ogsm_goals WHERE objective_id = ?'
    ).all(objectiveId) as any[];

    const goalsProgress = goals.map((g) => {
      const progress = g.target_value && g.target_value > 0
        ? Math.min(100, Math.round((g.current_value || 0) / g.target_value * 100))
        : 0;
      return { id: g.id, title: g.title, progress, status: g.status };
    });

    const weights = goals.map((g) => g.target_value || 1);
    const progresses = goals.map((g) => g.target_value && g.target_value > 0
      ? Math.min(100, (g.current_value || 0) / g.target_value * 100) : 0);
    const totalWeight = weights.reduce((s, w) => s + w, 0);
    const overallProgress = totalWeight > 0
      ? Math.round(progresses.reduce((s, p, i) => s + p * weights[i], 0) / totalWeight)
      : 0;

    return { objective, goalsProgress, overallProgress };
  }

  getGoalAlignment(goalId: string, tenantId: string): {
    goal: Record<string, unknown> | null;
    objective: Record<string, unknown> | null;
    alignment: number;
    factors: { label: string; value: number; weight: number }[];
  } {
    const db = getDatabase();
    const goal = db.prepare('SELECT * FROM ogsm_goals WHERE id = ?').get(goalId) as any;
    if (!goal) throw new NotFoundError('目标指标', goalId);
    const objective = db.prepare('SELECT * FROM ogsm_objectives WHERE id = ? AND tenant_id = ?').get(goal.objective_id, tenantId) as any;
    if (!objective) throw new NotFoundError('目标', goal.objective_id);

    const goalProgress = goal.target_value && goal.target_value > 0
      ? Math.min(100, (goal.current_value || 0) / goal.target_value * 100) : 0;
    const objectiveProgress = objective.progress || 0;

    let onTrackScore = 100;
    if (goal.deadline && objective.end_date) {
      const dlMs = new Date(goal.deadline).getTime();
      const nowMs = Date.now();
      if (dlMs > nowMs) {
        const endMs = new Date(objective.end_date).getTime();
        const span = dlMs - endMs;
        onTrackScore = span !== 0 ? Math.max(0, 100 - (nowMs - endMs) / span * 20) : 100;
      } else if (goal.status === 'achieved') {
        onTrackScore = 100;
      } else {
        onTrackScore = 50;
      }
    } else if (goal.status === 'achieved') {
      onTrackScore = 100;
    }

    const factors = [
      { label: '目标自身进度', value: Math.round(goalProgress), weight: 50 },
      { label: '上级目标进度', value: Math.round(objectiveProgress), weight: 30 },
      { label: '按期推进', value: Math.round(onTrackScore), weight: 20 },
    ];
    const alignment = Math.round(factors.reduce((s, f) => s + f.value * f.weight, 0) / 100);
    return { goal, objective, alignment, factors };
  }

  getOGSMStats(tenantId: string): OGSMStats {
    const db = getDatabase();
    const countRow = <T>(sql: string, ...params: unknown[]): T => db.prepare(sql).get(...params) as T;

    const objTotal = countRow<{ total: number }>('SELECT COUNT(*) as total FROM ogsm_objectives WHERE tenant_id = ?', tenantId).total;
    const objStatuses = db.prepare('SELECT status, COUNT(*) as c FROM ogsm_objectives WHERE tenant_id = ? GROUP BY status').all(tenantId) as { status: string; c: number }[];
    const objMap: Record<string, number> = {}; objStatuses.forEach((s) => { objMap[s.status] = s.c; });

    const goals = db.prepare(
      'SELECT id, target_value, current_value, deadline, status FROM ogsm_goals g JOIN ogsm_objectives o ON g.objective_id = o.id WHERE o.tenant_id = ?'
    ).all(tenantId) as any[];
    const goalTotal = goals.length;
    const goalAchieved = goals.filter((g) => g.status === 'achieved').length;
    const goalInProgress = goals.filter((g) => g.status === 'in_progress').length;
    const goalsWithDeadline = goals.filter((g) => g.deadline);
    const onTimeCount = goalsWithDeadline.filter((g) => g.status === 'achieved' && g.target_value > 0 && (g.current_value || 0) >= g.target_value).length;
    const onTimeRate = goalsWithDeadline.length > 0 ? Math.round(onTimeCount / goalsWithDeadline.length * 100) : null;

    const strategies = db.prepare(
      'SELECT s.status FROM ogsm_strategies s JOIN ogsm_goals g ON s.goal_id = g.id JOIN ogsm_objectives o ON g.objective_id = o.id WHERE o.tenant_id = ?'
    ).all(tenantId) as { status: string }[];
    const strategyTotal = strategies.length;
    const strategyCompleted = strategies.filter((s) => s.status === 'completed').length;
    const strategyCompletionRate = strategyTotal > 0 ? Math.round(strategyCompleted / strategyTotal * 100) : null;

    const measures = db.prepare(
      'SELECT m.status FROM ogsm_measures m JOIN ogsm_strategies s ON m.strategy_id = s.id JOIN ogsm_goals g ON s.goal_id = g.id JOIN ogsm_objectives o ON g.objective_id = o.id WHERE o.tenant_id = ?'
    ).all(tenantId) as { status: string }[];
    const measureTotal = measures.length;
    const measureAchieved = measures.filter((m) => m.status === 'achieved').length;
    const measureCompletionRate = measureTotal > 0 ? Math.round(measureAchieved / measureTotal * 100) : null;

    const avgProgressRow = countRow<{ avgProgress: number }>(
      'SELECT COALESCE(AVG(progress), 0) as avgProgress FROM ogsm_objectives WHERE tenant_id = ? AND progress IS NOT NULL', tenantId
    );
    const averageProgress = Math.round(avgProgressRow.avgProgress);

    const goalAlignments: number[] = [];
    goals.forEach((goal) => {
      const og = db.prepare('SELECT progress FROM ogsm_objectives WHERE id = ?').get(goal.objective_id) as any;
      const gp = goal.target_value && goal.target_value > 0 ? Math.min(100, (goal.current_value || 0) / goal.target_value * 100) : 0;
      const op = og?.progress || 0;
      goalAlignments.push(Math.round(gp * 0.5 + op * 0.3 + (goal.status === 'achieved' ? 100 : 75) * 0.2));
    });
    const averageAlignment = goalAlignments.length > 0 ? Math.round(goalAlignments.reduce((s, v) => s + v, 0) / goalAlignments.length) : null;

    const coveredGoals = db.prepare(
      'SELECT COUNT(DISTINCT g.id) as c FROM ogsm_goals g JOIN ogsm_objectives o ON g.objective_id = o.id JOIN raci_matrix r ON r.entity_type = "goal" AND r.entity_id = g.id WHERE o.tenant_id = ? AND r.responsibility IN ("R", "A")'
    ).get(tenantId) as { c: number };
    const raciCoverage = goalTotal > 0 ? Math.round(coveredGoals.c / goalTotal * 100) : null;

    const raciRecords = countRow<{ total: number }>('SELECT COUNT(*) as total FROM raci_matrix WHERE tenant_id = ? AND responsibility IN ("R", "A")', tenantId).total;

    const incTotal = countRow<{ total: number }>('SELECT COUNT(*) as total FROM incentives WHERE tenant_id = ?', tenantId).total;
    const incActive = countRow<{ total: number }>('SELECT COUNT(*) as total FROM incentives WHERE tenant_id = ? AND status = "active"', tenantId).total;
    const incByType = db.prepare('SELECT type, COUNT(*) as c, COALESCE(SUM(amount), 0) as totalAmount FROM incentives WHERE tenant_id = ? GROUP BY type').all(tenantId) as { type: string; c: number; totalAmount: number }[];
    const incByTypeMap: Record<string, number> = {};
    let incTotalAmount = 0; incByType.forEach((i) => { incByTypeMap[i.type] = i.c; incTotalAmount += i.totalAmount; });
    const incByStatus = db.prepare('SELECT status, COUNT(*) as c FROM incentives WHERE tenant_id = ? GROUP BY status').all(tenantId) as { status: string; c: number }[];
    const incByStatusMap: Record<string, number> = {}; incByStatus.forEach((s) => { incByStatusMap[s.status] = s.c; });

    return {
      objectives: { total: objTotal, active: objMap.active || 0, completed: objMap.completed || 0, inProgress: objMap.in_progress || 0, cancelled: objMap.cancelled || 0 },
      goals: { total: goalTotal, achieved: goalAchieved, inProgress: goalInProgress, onTimeRate },
      strategies: { total: strategyTotal, completed: strategyCompleted, completionRate: strategyCompletionRate },
      measures: { total: measureTotal, achieved: measureAchieved, completionRate: measureCompletionRate },
      averageProgress,
      averageAlignment,
      raciCoverage,
      incentives: { total: incTotal, active: incActive, totalAmount: incTotalAmount, byType: incByTypeMap, byStatus: incByStatusMap },
      raciRecords,
    };
  }

  getRACIMatrix(tenantId: string): RACIMatrix {
    const db = getDatabase();

    const owners = db.prepare(
      "SELECT DISTINCT r.user_id, u.display_name as user_name, u.role FROM raci_matrix r JOIN users u ON r.user_id = u.id WHERE r.tenant_id = ? AND r.responsibility IN ('R', 'A') ORDER BY u.display_name"
    ).all(tenantId) as { user_id: string; user_name: string; role: string }[];

    const rows: RaciCoverageEntry[] = [];

    const goals = db.prepare(
      'SELECT g.id, g.title, g.status, o.title as objective_title FROM ogsm_goals g JOIN ogsm_objectives o ON g.objective_id = o.id WHERE o.tenant_id = ? ORDER BY g.objective_id, g.created_at'
    ).all(tenantId) as { id: string; title: string; status: string; objective_title: string }[];

    for (const goal of goals) {
      const assignments = db.prepare(
        'SELECT u.id as user_id, u.display_name as user_name, r.responsibility FROM raci_matrix r JOIN users u ON r.user_id = u.id WHERE r.entity_type = ? AND r.entity_id = ? ORDER BY r.responsibility'
      ).all('goal', goal.id) as { user_id: string; user_name: string; responsibility: 'R' | 'A' | 'C' | 'I' }[];
      rows.push({ entityType: 'goal', entityId: goal.id, entityTitle: `${goal.title}（${goal.objective_title}）`, assignedUsers: assignments.length, hasA: assignments.some((a) => a.responsibility === 'A'), hasR: assignments.some((a) => a.responsibility === 'R'), assignments });
    }

    const objectives = db.prepare(
      'SELECT id, title, status FROM ogsm_objectives WHERE tenant_id = ? AND id NOT IN (SELECT DISTINCT objective_id FROM ogsm_goals) ORDER BY created_at'
    ).all(tenantId) as { id: string; title: string; status: string }[];

    for (const obj of objectives) {
      const assignments = db.prepare(
        'SELECT u.id as user_id, u.display_name as user_name, r.responsibility FROM raci_matrix r JOIN users u ON r.user_id = u.id WHERE r.entity_type = ? AND r.entity_id = ? ORDER BY r.responsibility'
      ).all('objective', obj.id) as { user_id: string; user_name: string; responsibility: 'R' | 'A' | 'C' | 'I' }[];
      rows.push({ entityType: 'objective', entityId: obj.id, entityTitle: obj.title, assignedUsers: assignments.length, hasA: assignments.some((a) => a.responsibility === 'A'), hasR: assignments.some((a) => a.responsibility === 'R'), assignments });
    }

    return {
      owners: owners.map((o) => ({ userId: o.user_id, userName: o.user_name, role: o.role })),
      rows,
    };
  }

  getIncentiveSummary(tenantId: string): IncentiveSummary {
    const db = getDatabase();
    const countRow = <T>(sql: string, ...params: unknown[]): T => db.prepare(sql).get(...params) as T;

    const total = countRow<{ total: number }>('SELECT COUNT(*) as total FROM incentives WHERE tenant_id = ?', tenantId).total;
    const active = countRow<{ total: number }>('SELECT COUNT(*) as total FROM incentives WHERE tenant_id = ? AND status = "active"', tenantId).total;
    const byType = db.prepare('SELECT type, COUNT(*) as count, COALESCE(SUM(amount), 0) as totalAmount FROM incentives WHERE tenant_id = ? GROUP BY type ORDER BY type').all(tenantId) as { type: string; count: number; totalAmount: number }[];
    const totalAmountRow = countRow<{ total: number }>('SELECT COALESCE(SUM(amount), 0) as total FROM incentives WHERE tenant_id = ?', tenantId);
    const currencyRow = db.prepare('SELECT DISTINCT currency FROM incentives WHERE tenant_id = ? AND currency IS NOT NULL LIMIT 1').get(tenantId) as { currency: string } | undefined;

    const records = db.prepare(
      'SELECT ir.status, COUNT(*) as cnt, COALESCE(SUM(ir.amount), 0) as total FROM incentives i LEFT JOIN incentive_records ir ON ir.incentive_id = i.id WHERE i.tenant_id = ? GROUP BY ir.status'
    ).all(tenantId) as { status: string; cnt: number; total: number }[];
    const recMap: Record<string, number> = {}; let recAmount = 0;
    records.forEach((r) => { recMap[r.status] = r.cnt; recAmount += r.total; });

    return {
      total, active,
      totalAmount: totalAmountRow.total,
      currency: currencyRow?.currency || 'CNY',
      byType,
      records: { pending: recMap.pending || 0, approved: recMap.approved || 0, paid: recMap.paid || 0, rejected: recMap.rejected || 0, totalAmount: recAmount },
    };
  }
}

export const ogsmService = new OgsmService();

// ==================== 类型定义（class 外部导出） ====================

export interface OGSMStats {
  objectives: { total: number; active: number; completed: number; inProgress: number; cancelled: number };
  goals: { total: number; achieved: number; inProgress: number; onTimeRate: number | null };
  strategies: { total: number; completed: number; completionRate: number | null };
  measures: { total: number; achieved: number; completionRate: number | null };
  averageProgress: number;
  averageAlignment: number | null;
  raciCoverage: number | null;
  incentives: { total: number; active: number; totalAmount: number; byType: Record<string, number>; byStatus: Record<string, number> };
  raciRecords: number;
}

export interface RaciCoverageEntry {
  entityType: string;
  entityId: string;
  entityTitle: string;
  assignedUsers: number;
  hasA: boolean;
  hasR: boolean;
  assignments: { user_id: string; user_name: string; responsibility: 'R' | 'A' | 'C' | 'I' }[];
}

export interface RACIMatrix {
  owners: { userId: string; userName: string; role: string }[];
  rows: RaciCoverageEntry[];
}

export interface IncentiveSummary {
  total: number;
  active: number;
  totalAmount: number;
  currency: string;
  byType: { type: string; count: number; totalAmount: number }[];
  records: { pending: number; approved: number; paid: number; rejected: number; totalAmount: number };
}
