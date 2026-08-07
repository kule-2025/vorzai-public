/**
 * RACI 责任人矩阵增强服务 (R1-R5)
 *
 * R1: A 唯一性校验 — setRaci('A') 时检查同 entity 是否已有 A
 * R2: 覆盖度检查 — 列出无 A 且无 R 的目标/指标
 * R3: 负载均衡 — 统计每人 A/R 数量，超阈值预警
 * R4: 任务关联 — 扩展 entity_type 支持 ticket/project/campaign
 * R5: 跨层对齐 — 目标→目标→目标的有序依赖链
 */

import { getDatabase } from '../db';
import { logger } from '../utils/logger';

// ── 类型 ──────────────────────────────────────────────────────
export interface RaciValidation {
  /** 同 entity 是否已存在 A 担当（设置前检查） */
  hasA: boolean;
  existingA: { userId: string; userName: string } | null;
  warning: string | null;
}

export interface UncoveredEntity {
  entityType: string;
  entityId: string;
  entityTitle: string;
  hasR: boolean;
  hasA: boolean;
}

export interface UserLoad {
  userId: string;
  userName: string;
  role: string;
  responsibleCount: number;   // A 数量
  accountableCount: number;   // R 数量
  total: number;
  overloaded: boolean;
  warning?: string;
}

export interface CrossLayer {
  /** 从公司到个人的逐级承接链 */
  chain: { level: string; entityType: string; entityId: string; entityTitle: string; owner: string }[];
  /** total layers in chain */
  depth: number;
}

// ── 阈值 ──────────────────────────────────────────────────────
const OVERLOAD_A = 5;  // A ≥ 5 预警
const OVERLOAD_R = 10; // R ≥ 10 预警

// ── Service ──────────────────────────────────────────────────
export class RaciEnhancementService {
  // ── R1: A 唯一性 ──────────────────────────────────────────
  /**
   * 检查 entity 是否已有 A 担当
   * 返回 validation + warning，供前端在 setRaci 前调用
   */
  checkAUniqueness(tenantId: string, entityType: string, entityId: string): RaciValidation {
    const db = getDatabase();
    const row = db.prepare(
      `SELECT u.id as userId, u.display_name as userName FROM raci_matrix r
       JOIN users u ON r.user_id = u.id
       WHERE r.tenant_id = ? AND r.entity_type = ? AND r.entity_id = ? AND r.responsibility = 'A'`
    ).get(tenantId, entityType, entityId) as { userId: string; userName: string } | undefined;

    const hasA = !!row;
    return {
      hasA,
      existingA: row ?? null,
      warning: hasA ? `该${entityType}已有A担当：${row.userName}。确认替换？` : null,
    };
  }

  /**
   * 全量扫描：找出所有多 A 的实体（数据修复工具）
   */
  findDuplicateAs(tenantId: string): { entityType: string; entityId: string; users: { userId: string; userName: string }[] }[] {
    const db = getDatabase();
    const rows = db.prepare(
      `SELECT r.entity_type, r.entity_id, r.user_id, u.display_name as userName
       FROM raci_matrix r JOIN users u ON r.user_id = u.id
       WHERE r.tenant_id = ? AND r.responsibility = 'A'
       ORDER BY r.entity_type, r.entity_id`
    ).all(tenantId) as { entity_type: string; entity_id: string; user_id: string; userName: string }[];

    // 按 entity 分组
    const groups = new Map<string, { entityType: string; entityId: string; users: { userId: string; userName: string }[] }>();
    rows.forEach((r) => {
      const key = `${r.entity_type}:${r.entity_id}`;
      if (!groups.has(key)) groups.set(key, { entityType: r.entity_type, entityId: r.entity_id, users: [] });
      groups.get(key)!.users.push({ userId: r.user_id, userName: r.userName });
    });
    return Array.from(groups.values()).filter((g) => g.users.length > 1);
  }

  // ── R2: 覆盖度检查 ────────────────────────────────────────
  /**
   * 列出无 A 且无 R 的目标/策略/措施
   */
  findUncovered(tenantId: string): UncoveredEntity[] {
    const db = getDatabase();
    const uncovered: UncoveredEntity[] = [];

    // 检查 objectives（已有 RACI 覆盖度逻辑，这里重点关注无 R 的）
    const objectives = db.prepare(
      "SELECT id, title FROM ogsm_objectives WHERE tenant_id = ? AND status = 'active'"
    ).all(tenantId) as { id: string; title: string }[];
    for (const obj of objectives) {
      const raci = db.prepare(
        "SELECT responsibility FROM raci_matrix WHERE tenant_id = ? AND entity_type = 'objective' AND entity_id = ?"
      ).all(tenantId, obj.id) as { responsibility: string }[];
      const hasR = raci.some((r) => r.responsibility === 'R');
      const hasA = raci.some((r) => r.responsibility === 'A');
      if (!hasR && !hasA) {
        uncovered.push({ entityType: 'objective', entityId: obj.id, entityTitle: obj.title, hasR, hasA });
      }
    }

    // 检查 goals
    const goals = db.prepare(
      `SELECT g.id, g.title FROM ogsm_goals g JOIN ogsm_objectives o ON g.objective_id = o.id
       WHERE o.tenant_id = ? AND o.status = 'active'`
    ).all(tenantId) as { id: string; title: string }[];
    for (const goal of goals) {
      const raci = db.prepare(
        "SELECT responsibility FROM raci_matrix WHERE tenant_id = ? AND entity_type = 'goal' AND entity_id = ?"
      ).all(tenantId, goal.id) as { responsibility: string }[];
      const hasR = raci.some((r) => r.responsibility === 'R');
      const hasA = raci.some((r) => r.responsibility === 'A');
      if (!hasR && !hasA) {
        uncovered.push({ entityType: 'goal', entityId: goal.id, entityTitle: goal.title, hasR, hasA });
      }
    }

    return uncovered;
  }

  // ── R3: 负载均衡 ──────────────────────────────────────────
  getLoadStats(tenantId: string): { users: UserLoad[]; overloaded: UserLoad[] } {
    const db = getDatabase();
    const users = db.prepare(
      `SELECT u.id as userId, u.display_name as userName, u.role
       FROM users u WHERE u.tenant_id = ? AND u.status = 'active'
       ORDER BY u.display_name`
    ).all(tenantId) as { userId: string; userName: string; role: string }[];

    const loads: UserLoad[] = [];
    for (const user of users) {
      const accountable = db.prepare(
        "SELECT COUNT(*) as c FROM raci_matrix WHERE tenant_id = ? AND user_id = ? AND responsibility = 'A'"
      ).get(tenantId, user.userId) as { c: number };
      const responsible = db.prepare(
        "SELECT COUNT(*) as c FROM raci_matrix WHERE tenant_id = ? AND user_id = ? AND responsibility = 'R'"
      ).get(tenantId, user.userId) as { c: number };
      const total = accountable.c + responsible.c;
      const overloaded = accountable.c >= OVERLOAD_A || responsible.c >= OVERLOAD_R;
      const warnings: string[] = [];
      if (accountable.c >= OVERLOAD_A) warnings.push(`A 担当 ${accountable.c} 项（≥${OVERLOAD_A}）`);
      if (responsible.c >= OVERLOAD_R) warnings.push(`R 执行 ${responsible.c} 项（≥${OVERLOAD_R}）`);

      loads.push({
        userId: user.userId,
        userName: user.userName,
        role: user.role,
        responsibleCount: responsible.c,
        accountableCount: accountable.c,
        total,
        overloaded,
        warning: warnings.length > 0 ? warnings.join('; ') : undefined,
      });
    }

    return {
      users: loads.sort((a, b) => b.total - a.total),
      overloaded: loads.filter((l) => l.overloaded),
    };
  }

  // ── R4: 扩展 entity_type 支持 ─────────────────────────────
  /**
   * 获取指定用户负责任的所有实体列表
   * 支持 ticket/project/campaign + objective/goal/strategy/measure
   */
  getMyResponsibilities(tenantId: string, userId: string): {
    entityType: string;
    entityId: string;
    responsibility: string;
    entityTitle: string;
  }[] {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT entity_type, entity_id, responsibility FROM raci_matrix WHERE tenant_id = ? AND user_id = ?'
    ).all(tenantId, userId) as { entity_type: string; entity_id: string; responsibility: string }[];

    return rows.map((r) => {
      let entityTitle = r.entity_id;
      // try resolve title from common entity tables
      try {
        if (r.entity_type === 'objective') {
          const obj = db.prepare('SELECT title FROM ogsm_objectives WHERE id = ? AND tenant_id = ?').get(r.entity_id, tenantId) as any;
          if (obj) entityTitle = obj.title;
        } else if (r.entity_type === 'goal') {
          // ogsm_goals has no tenant_id column — scope through the parent objective.
          const g = db.prepare(
            `SELECT g.title FROM ogsm_goals g
             JOIN ogsm_objectives o ON g.objective_id = o.id
             WHERE g.id = ? AND o.tenant_id = ?`
          ).get(r.entity_id, tenantId) as any;
          if (g) entityTitle = g.title;
        } else if (r.entity_type === 'ticket') {
          // FIX: the table is `service_tickets` (not `business_tickets`) and the
          // column is `subject` (not `title`). The old query always threw and was
          // silently swallowed by the catch below, so ticket rows never resolved
          // a title and always fell back to showing the raw id.
          const t = db.prepare('SELECT subject FROM service_tickets WHERE id = ? AND tenant_id = ?').get(r.entity_id, tenantId) as any;
          if (t) entityTitle = t.subject;
        }
      } catch {
        // ignore resolution failures
      }
      return {
        entityType: r.entity_type,
        entityId: r.entity_id,
        responsibility: r.responsibility,
        entityTitle,
      };
    });
  }

  // ── R5: 跨层对齐链 ────────────────────────────────────────
  /**
   * 追踪目标从测量→策略→指标→目标的完整承担链
   * 从任意 measure 开始，逐级向上找到其 objective
   */
  getAlignmentChain(tenantId: string, startType: string, startId: string): CrossLayer | null {
    const db = getDatabase();
    const chain: CrossLayer['chain'] = [];

    let entityType = startType;
    let entityId = startId;

    while (entityType) {
      // check entity exists first
      let exists = false;
      try {
        if (entityType === 'objective') {
          const r = db.prepare('SELECT id FROM ogsm_objectives WHERE id = ? AND tenant_id = ?').get(entityId, tenantId);
          exists = !!r;
        } else if (entityType === 'goal') {
          const r = db.prepare('SELECT id FROM ogsm_goals WHERE id = ?').get(entityId);
          exists = !!r;
        } else if (entityType === 'strategy') {
          const r = db.prepare('SELECT id FROM ogsm_strategies WHERE id = ?').get(entityId);
          exists = !!r;
        } else if (entityType === 'measure') {
          const r = db.prepare('SELECT id FROM ogsm_measures WHERE id = ?').get(entityId);
          exists = !!r;
        }
      } catch { /* ignore */ }
      if (!exists) return null;

      let title = entityId;
      let owner = '未指定';

      try {
        // resolve title
        if (entityType === 'objective') {
          const obj = db.prepare('SELECT title FROM ogsm_objectives WHERE id = ? AND tenant_id = ?').get(entityId, tenantId) as any;
          if (obj) title = obj.title;
        } else if (entityType === 'goal') {
          const g = db.prepare('SELECT title FROM ogsm_goals WHERE id = ?').get(entityId) as any;
          if (g) title = g.title;
        } else if (entityType === 'strategy') {
          const s = db.prepare('SELECT title FROM ogsm_strategies WHERE id = ?').get(entityId) as any;
          if (s) title = s.title;
        } else if (entityType === 'measure') {
          const m = db.prepare('SELECT title FROM ogsm_measures WHERE id = ?').get(entityId) as any;
          if (m) title = m.title;
        }
      } catch { /* ignore */ }

      // get current entity's A/R owner
      const raci = db.prepare(
        "SELECT u.display_name FROM raci_matrix r JOIN users u ON r.user_id = u.id WHERE r.entity_type = ? AND r.entity_id = ? AND r.responsibility IN ('A', 'R') LIMIT 1"
      ).get(entityType, entityId) as { display_name: string } | undefined;
      owner = raci?.display_name ?? '未指定';

      chain.push({ level: entityType, entityType, entityId, entityTitle: title, owner });

      // move up one level
      if (entityType === 'measure') {
        const s = db.prepare('SELECT strategy_id FROM ogsm_measures WHERE id = ?').get(entityId) as any;
        if (!s) break;
        entityType = 'strategy'; entityId = s.strategy_id;
      } else if (entityType === 'strategy') {
        const g = db.prepare('SELECT goal_id FROM ogsm_strategies WHERE id = ?').get(entityId) as any;
        if (!g) break;
        entityType = 'goal'; entityId = g.goal_id;
      } else if (entityType === 'goal') {
        const o = db.prepare('SELECT objective_id FROM ogsm_goals WHERE id = ?').get(entityId) as any;
        if (!o) break;
        entityType = 'objective'; entityId = o.objective_id;
      } else {
        break; // objective is top
      }
    }

    return chain.length > 0 ? { chain, depth: chain.length } : null;
  }
}

export const raciEnhancementService = new RaciEnhancementService();