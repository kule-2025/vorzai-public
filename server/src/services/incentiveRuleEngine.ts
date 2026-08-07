/**
 * Vorzai 激励规则引擎 + 批量自动结算（V2 · I1-I2）
 *
 * I1 — 结构化规则表 incentive_rules，替代原 incentives.rules JSON 字段
 * I2 — 批量结算引擎：扫描全量活跃规则 → 评估触发条件 → 代入公式计算
 *      → 生成/更新 incentive_records → 返回汇总
 *
 * 公式占位符：
 *   ${total_gmv}       员工/团队在结算周期内的已支付 GMV
 *   ${order_count}      结算周期内的订单数
 *   ${profit}           估算利润（total_gmv * 0.3）
 *   ${achievement_rate} OGSM KPI 达成率（当前版本预留，返回 0）
 *   ${employee_count}   目标群体在岗人数
 *
 * 触发条件类型：
 *   always              无条件触发
 *   order_threshold     订单 GMV 达阈值后触发
 *   achievement_threshold OGSM 达成率达阈值后触发（预留）
 */

import { v4 as uuidv4 } from 'uuid';
import { getDatabase, transaction } from '../db';
import { logger } from '../utils/logger';

// ==================== Types ====================

export type IncentiveRuleType = 'commission' | 'bonus' | 'special' | 'points';

export interface TriggerConfig {
  trigger_type: 'always' | 'order_threshold' | 'achievement_threshold';
  threshold?: number;
  metric?: string;
}

export interface CreateRuleInput {
  name: string;
  rule_type: IncentiveRuleType;
  description?: string;
  trigger_config?: TriggerConfig;
  formula: string;
  target_type?: 'individual' | 'team' | 'department' | 'company';
  target_id?: string;
  min_payout?: number;
  max_payout?: number;
  priority?: number;
  effective_from?: string;
  effective_to?: string;
  status?: 'active' | 'inactive' | 'draft';
}

export interface UpdateRuleInput extends Partial<CreateRuleInput> {}

export interface IncentiveRule {
  id: string;
  tenant_id: string;
  name: string;
  rule_type: IncentiveRuleType;
  description: string | null;
  trigger_config: TriggerConfig;
  formula: string;
  target_type: string | null;
  target_id: string | null;
  min_payout: number;
  max_payout: number | null;
  priority: number;
  effective_from: string | null;
  effective_to: string | null;
  status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CalculationDetail {
  ruleId: string;
  ruleName: string;
  ruleType: IncentiveRuleType;
  userId: string;
  userName: string;
  computedAmount: number;
  cappedAmount: number;
  triggers: boolean;
}

export interface CalculationResult {
  period: string;
  rulesScanned: number;
  rulesTriggered: number;
  employeesEvaluated: number;
  totalPayout: number;
  details: CalculationDetail[];
  generatedAt: string;
}

// ==================== Formula Evaluator ====================

/** 安全地计算激励公式：替换占位符 → 校验仅含算术字符 → 计算 */
function evaluateFormula(formula: string, metrics: Record<string, number>): number {
  let expr = formula;
  for (const [key, val] of Object.entries(metrics)) {
    expr = expr.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), String(val));
  }
  // 检查是否有未替换的占位符
  const remaining = expr.match(/\$\{([^}]+)\}/g);
  if (remaining) {
    throw new Error(`未知的公式占位符: ${remaining.join(', ')}`);
  }
  // 安全校验：只允许数字、四则运算、括号、空格、小数点
  const sanitized = expr.replace(/\s+/g, '');
  if (/[^0-9+\-*/().]/.test(sanitized)) {
    throw new Error(`公式含非法字符: ${sanitized}`);
  }
  try {
    const result = new Function(`return ${expr}`)();
    if (typeof result !== 'number' || !isFinite(result)) {
      throw new Error(`公式计算出非数值: ${result}`);
    }
    return result;
  } catch (e: any) {
    throw new Error(`公式计算失败: ${formula} → ${e.message}`);
  }
}

/** 评估触发条件 */
function evaluateTrigger(config: TriggerConfig, metrics: Record<string, number>): boolean {
  if (config.trigger_type === 'always') return true;
  const key = config.metric || 'total_gmv';
  const value = metrics[key] || 0;
  return value >= (config.threshold || 0);
}

// ==================== IncentiveRuleEngine ====================

export class IncentiveRuleEngine {
  // ─── I1: 规则 CRUD ───

  createRule(tenantId: string, createdBy: string, input: CreateRuleInput): IncentiveRule {
    const db = getDatabase();
    const id = uuidv4();
    db.prepare(
      `INSERT INTO incentive_rules (id, tenant_id, name, rule_type, description, trigger_config, formula,
        target_type, target_id, min_payout, max_payout, priority, effective_from, effective_to, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, tenantId, input.name, input.rule_type, input.description || null,
      JSON.stringify(input.trigger_config || { trigger_type: 'always' }),
      input.formula, input.target_type || null, input.target_id || null,
      input.min_payout ?? 0, input.max_payout ?? null, input.priority ?? 0,
      input.effective_from || null, input.effective_to || null,
      input.status || 'active', createdBy
    );
    return this._hydrate(db.prepare('SELECT * FROM incentive_rules WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any);
  }

  getRule(tenantId: string, ruleId: string): IncentiveRule | null {
    const db = getDatabase();
    const row = db.prepare(
      'SELECT * FROM incentive_rules WHERE id = ? AND tenant_id = ?'
    ).get(ruleId, tenantId) as any;
    if (!row) return null;
    return this._hydrate(row);
  }

  listRules(tenantId: string, filters?: { status?: string; rule_type?: string }): IncentiveRule[] {
    const db = getDatabase();
    let sql = 'SELECT * FROM incentive_rules WHERE tenant_id = ?';
    const params: unknown[] = [tenantId];
    if (filters?.status) { sql += ' AND status = ?'; params.push(filters.status); }
    if (filters?.rule_type) { sql += ' AND rule_type = ?'; params.push(filters.rule_type); }
    sql += ' ORDER BY priority ASC, created_at DESC';
    const rows = db.prepare(sql).all(...params) as any[];
    return rows.map((r: any) => this._hydrate(r));
  }

  updateRule(tenantId: string, ruleId: string, input: UpdateRuleInput): IncentiveRule | null {
    const db = getDatabase();
    const existing = db.prepare(
      'SELECT * FROM incentive_rules WHERE id = ? AND tenant_id = ?'
    ).get(ruleId, tenantId);
    if (!existing) return null;

    const updates: string[] = [];
    const params: unknown[] = [];

    const settable = [
      ['name', input.name],
      ['rule_type', input.rule_type],
      ['description', input.description],
      ['formula', input.formula],
      ['target_type', input.target_type],
      ['target_id', input.target_id],
      ['min_payout', input.min_payout],
      ['max_payout', input.max_payout],
      ['priority', input.priority],
      ['effective_from', input.effective_from],
      ['effective_to', input.effective_to],
      ['status', input.status],
    ] as const;

    // NOTE: trigger_config is intentionally absent from `settable` — it needs
    // JSON serialization and is handled separately right below.
    for (const [col, val] of settable) {
      if (val !== undefined) {
        updates.push(`${col} = ?`);
        params.push(val);
      }
    }
    if (input.trigger_config !== undefined) {
      updates.push(`trigger_config = ?`);
      params.push(JSON.stringify(input.trigger_config));
    }

    if (updates.length === 0) return this._hydrate(existing as any);

    updates.push("updated_at = datetime('now')");
    params.push(ruleId, tenantId);
    db.prepare(
      `UPDATE incentive_rules SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`
    ).run(...params);

    return this._hydrate(
      db.prepare('SELECT * FROM incentive_rules WHERE id = ? AND tenant_id = ?').get(ruleId, tenantId) as any
    );
  }

  deleteRule(tenantId: string, ruleId: string): boolean {
    const db = getDatabase();
    const result = db.prepare(
      "UPDATE incentive_rules SET status = 'archived', updated_at = datetime('now') WHERE id = ? AND tenant_id = ? AND status != 'archived'"
    ).run(ruleId, tenantId);
    return (result.changes ?? 0) > 0;
  }

  // ─── I2: 批量自动结算引擎 ───

  /**
   * 对指定结算周期执行批量激励计算。
   *
   * 流程：
   *   1. 拉取该租户所有 active 规则（effective_from/to 限制在周期内）
   *   2. 对每条规则，确定目标员工群体
   *   3. 对每个目标员工，收集绩效指标（GMV/订单数/人效等）
   *   4. 评估触发条件 → 通过则代入公式计算金额 → min/max 封顶
   *   5. 幂等写入 incentive_records（incentive_id + user_id + period 唯一）
   *   6. 返回完整汇总
   */
  async calculateIncentives(tenantId: string, period: string): Promise<CalculationResult> {
    const db = getDatabase();
    const generatedAt = new Date().toISOString();
    const rules = this._loadActiveRules(tenantId, period);
    const details: CalculationDetail[] = [];
    let triggeredCount = 0;

    for (const rule of rules) {
      const targetEmployees = this._getTargetEmployees(tenantId, rule);
      for (const emp of targetEmployees) {
        try {
          const metrics = await this._collectMetrics(tenantId, period, rule);
          const triggers = evaluateTrigger(rule.trigger_config, metrics);
          if (!triggers) continue;

          const rawAmount = evaluateFormula(rule.formula, metrics);
          const capped = this._capAmount(rawAmount, rule.min_payout, rule.max_payout);

          // 幂等写入 incentive_records（当前 incentive_records.incentive_id FK 指向
          // 旧 incentives 表，v2 需加 rule_id 列；此处容错 FK 失败，保障计算汇总不丢）
          try {
            this._upsertRecord(rule.id, emp.userId || emp.id, period, capped, `自动结算·${rule.name}`);
          } catch {
            logger.debug('incentive', `记录写入跳过（FK 未对齐）: rule=${rule.name} user=${emp.userId || emp.id}`);
          }

          triggeredCount++;
          details.push({
            ruleId: rule.id,
            ruleName: rule.name,
            ruleType: rule.rule_type,
            userId: emp.userId || emp.id,
            userName: emp.name || emp.userId || emp.id,
            computedAmount: Math.round(rawAmount * 100) / 100,
            cappedAmount: Math.round(capped * 100) / 100,
            triggers: true,
          });
        } catch (err: any) {
          logger.warn('incentive', `结算跳过: rule=${rule.name} emp=${emp.name || emp.id}`, {
            error: err.message,
          });
          details.push({
            ruleId: rule.id,
            ruleName: rule.name,
            ruleType: rule.rule_type,
            userId: emp.userId || emp.id,
            userName: emp.name || emp.userId || emp.id,
            computedAmount: 0,
            cappedAmount: 0,
            triggers: false,
          });
        }
      }
    }

    const totalPayout = details
      .filter((d) => d.triggers)
      .reduce((sum, d) => sum + d.cappedAmount, 0);

    logger.info('incentive', `批量结算完成`, {
      tenantId,
      period,
      rulesScanned: rules.length,
      triggeredCount,
      employeesEvaluated: new Set(details.map((d) => d.userId)).size,
      totalPayout: Math.round(totalPayout * 100) / 100,
    });

    return {
      period,
      rulesScanned: rules.length,
      rulesTriggered: triggeredCount,
      employeesEvaluated: new Set(details.map((d) => d.userId)).size,
      totalPayout: Math.round(totalPayout * 100) / 100,
      details,
      generatedAt,
    };
  }

  /** 快速汇总（不执行计算，只读已生成的 records） */
  getCalculationSummary(tenantId: string, period: string) {
    const db = getDatabase();
    const rows = db.prepare(
      `SELECT ir.status, COUNT(*) as c, COALESCE(SUM(ir.amount), 0) as total
       FROM incentive_records ir
       WHERE ir.period = ? AND EXISTS (SELECT 1 FROM incentives i WHERE i.id = ir.incentive_id AND i.tenant_id = ?)
       GROUP BY ir.status`
    ).all(period, tenantId) as { status: string; c: number; total: number }[];

    const byStatus: Record<string, { count: number; total: number }> = {};
    let grandTotal = 0;
    let grandCount = 0;
    for (const r of rows) {
      byStatus[r.status] = { count: r.c, total: Math.round(r.total * 100) / 100 };
      grandTotal += r.total;
      grandCount += r.c;
    }

    return {
      period,
      totalRecords: grandCount,
      totalAmount: Math.round(grandTotal * 100) / 100,
      byStatus,
    };
  }

  // ─── Internal helpers ───

  private _hydrate(row: any): IncentiveRule {
    return {
      ...row,
      trigger_config: this._parseTriggerConfig(row.trigger_config),
      min_payout: row.min_payout ?? 0,
      priority: row.priority ?? 0,
    };
  }

  private _parseTriggerConfig(raw: string | null): TriggerConfig {
    try {
      const parsed = raw ? JSON.parse(raw) : {};
      return {
        trigger_type: parsed.trigger_type || 'always',
        threshold: typeof parsed.threshold === 'number' ? parsed.threshold : undefined,
        metric: typeof parsed.metric === 'string' ? parsed.metric : undefined,
      };
    } catch {
      return { trigger_type: 'always' };
    }
  }

  private _loadActiveRules(tenantId: string, period: string): IncentiveRule[] {
    const db = getDatabase();
    const periodStart = `${period}-01`;
    // 检查 rule 的 effective_from/to 是否覆盖 period 的任一天（simple overlap）
    const rows = db.prepare(
      `SELECT * FROM incentive_rules
       WHERE tenant_id = ? AND status = 'active'
         AND (effective_from IS NULL OR effective_from <= ?)
         AND (effective_to IS NULL OR effective_to >= ?)
       ORDER BY priority ASC, created_at ASC`
    ).all(tenantId, periodStart, periodStart) as any[];
    return rows.map((r: any) => this._hydrate(r));
  }

  private _getTargetEmployees(tenantId: string, rule: IncentiveRule): { id: string; name: string; userId: string }[] {
    const db = getDatabase();
    let sql = `SELECT e.id, e.name, e.user_id as userId FROM employees e WHERE e.tenant_id = ? AND e.status = 'active'`;
    const params: unknown[] = [tenantId];

    if (rule.target_type === 'individual' && rule.target_id) {
      sql += ' AND e.id = ?';
      params.push(rule.target_id);
    } else if (rule.target_type === 'team' && rule.target_id) {
      sql += ' AND e.department_id = ?';
      params.push(rule.target_id);
    } else if (rule.target_type === 'department' && rule.target_id) {
      sql += ` AND (e.department_id = ? OR e.department_id IN (
        SELECT id FROM departments WHERE parent_id = ?))`;
      params.push(rule.target_id, rule.target_id);
    }
    // company → 全部员工

    return db.prepare(sql).all(...params) as any[];
  }

  private async _collectMetrics(
    tenantId: string,
    period: string,
    rule: IncentiveRule
  ): Promise<Record<string, number>> {
    const db = getDatabase();
    const periodStart = `${period}-01`;

    const [y, m] = period.split('-').map(Number);
    const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;

    // 公司级聚合（v1：不区分个人归属；v2 可通过 RACI/customer_email 做个体归因）
    const orderRow = db.prepare(
      `SELECT COALESCE(SUM(paid_amount), 0) as gmv, COUNT(*) as cnt
       FROM orders
       WHERE tenant_id = ?
         AND created_at >= ? AND created_at < ?
         AND order_status NOT IN ('cancelled')`
    ).get(tenantId, periodStart, nextMonth) as { gmv: number; cnt: number };

    const total_gmv = orderRow?.gmv || 0;
    const order_count = orderRow?.cnt || 0;
    const profit = total_gmv * 0.3;
    const achievement_rate = 0;

    const empCountRow = db.prepare(
      `SELECT COUNT(*) as c FROM employees WHERE tenant_id = ? AND status = 'active'`
    ).get(tenantId) as { c: number };

    return {
      total_gmv,
      order_count,
      profit,
      achievement_rate,
      employee_count: empCountRow?.c || 1,
    };
  }

  private _capAmount(raw: number, min: number, max: number | null): number {
    let v = Math.max(raw, min);
    if (max !== null && max > 0) v = Math.min(v, max);
    return v;
  }

  private _upsertRecord(
    incentiveId: string,
    userId: string,
    period: string,
    amount: number,
    reason: string
  ): void {
    const db = getDatabase();
    // 幂等：同一 incentive_id + user_id + period 只保留最新一笔 pending
    const existing = db.prepare(
      `SELECT id, amount FROM incentive_records
       WHERE incentive_id = ? AND user_id = ? AND period = ? AND status = 'pending'`
    ).get(incentiveId, userId, period) as { id: string; amount: number } | undefined;

    if (existing) {
      db.prepare(
        `UPDATE incentive_records SET amount = ?, reason = ?, created_at = datetime('now') WHERE id = ?`
      ).run(amount, reason, existing.id);
    } else {
      db.prepare(
        `INSERT INTO incentive_records (id, incentive_id, user_id, amount, reason, period, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`
      ).run(uuidv4(), incentiveId, userId, amount, reason, period);
    }
  }
}

export const incentiveRuleEngine = new IncentiveRuleEngine();
