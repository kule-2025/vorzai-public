/**
 * RACI 责任人矩阵增强 单元测试 (R1-R5)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
let _idx = 0; function uniq(b: string): string { return `${b}_${Date.now()}_${_idx++}`; }
import { raciEnhancementService } from '../src/services/raciEnhancementService';
import { getDatabase, initDatabase, closeDatabase } from '../src/db';
import { v4 as uuidv4 } from 'uuid';

const TEST_DB_PATH = 'data/test_vorzai_raci_enhancement.db';

function seedTenant() { const db = getDatabase(); const id = uuidv4(); db.prepare(`INSERT INTO tenants (id,name,slug,status) VALUES (?,'test',?,'active')`).run(id, 'raci-' + id.slice(0,6)); return id; }
function seedUser(tenantId: string, name?: string) { const db = getDatabase(); const id = uuidv4(); db.prepare(`INSERT INTO users (id,tenant_id,username,password_hash,display_name,email,role,status) VALUES (?,?,?,?,?,?,?,?)`).run(id, tenantId, 'u' + id.slice(0,4), 'hash', name ?? uniq('用户'), `${id.slice(0,4)}@x.com`, 'member', 'active'); return id; }
function seedObjective(tenantId: string, title?: string) { const db = getDatabase(); const id = uuidv4(); db.prepare(`INSERT INTO ogsm_objectives (id,tenant_id,title,level,status) VALUES (?,?,?,'company','active')`).run(id, tenantId, title ?? uniq('目标')); return id; }
function seedGoal(objectiveId: string, title?: string) { const db = getDatabase(); const id = uuidv4(); db.prepare(`INSERT INTO ogsm_goals (id,objective_id,title,status,metric_type) VALUES (?,?,?,'in_progress','number')`).run(id, objectiveId, title ?? uniq('指标')); return id; }
function seedStrategy(goalId: string) { const db = getDatabase(); const id = uuidv4(); db.prepare(`INSERT INTO ogsm_strategies (id,goal_id,title,status) VALUES (?,?,?,'planned')`).run(id, goalId, uniq('策略')); return id; }
function seedMeasure(strategyId: string) { const db = getDatabase(); const id = uuidv4(); db.prepare(`INSERT INTO ogsm_measures (id,strategy_id,title,status,metric_type) VALUES (?,?,?,'pending','number')`).run(id, strategyId, uniq('措施')); return id; }
function setRaci(tenantId: string, userId: string, entityType: string, entityId: string, resp: string) {
  const db = getDatabase(); db.prepare(`INSERT OR REPLACE INTO raci_matrix (id,tenant_id,entity_type,entity_id,user_id,responsibility) VALUES (?,?,?,?,?,?)`).run(uuidv4(), tenantId, entityType, entityId, userId, resp);
}

let tenantA: string, tenantB: string, userA: string, userB: string;
beforeAll(() => { initDatabase(TEST_DB_PATH); tenantA = seedTenant(); tenantB = seedTenant(); userA = seedUser(tenantA, '张三'); userB = seedUser(tenantA, '李四'); });
afterAll(() => closeDatabase());

describe('R1 A 唯一性校验', () => {
  it('无 A 时返回 hasA=false', () => {
    const objId = seedObjective(tenantA);
    const v = raciEnhancementService.checkAUniqueness(tenantA, 'objective', objId);
    expect(v.hasA).toBe(false);
    expect(v.warning).toBeNull();
  });
  it('有 A 时返回 hasA=true + warning', () => {
    const objId = seedObjective(tenantA);
    setRaci(tenantA, userA, 'objective', objId, 'A');
    const v = raciEnhancementService.checkAUniqueness(tenantA, 'objective', objId);
    expect(v.hasA).toBe(true);
    expect(v.warning).toContain('张三');
  });
  it('重复 A 检测', () => {
    const objId = seedObjective(tenantA);
    setRaci(tenantA, userA, 'objective', objId, 'A');
    setRaci(tenantA, userB, 'objective', objId, 'A');
    const dups = raciEnhancementService.findDuplicateAs(tenantA);
    expect(dups.some((d) => d.entityId === objId)).toBe(true);
  });
});

describe('R2 覆盖度检查', () => {
  it('无 R 目标被检测', () => {
    const objId = seedObjective(tenantA);
    const uncovered = raciEnhancementService.findUncovered(tenantA);
    expect(uncovered.some((u) => u.entityId === objId)).toBe(true);
  });
  it('有 R 有 A 目标不被检测', () => {
    const objId = seedObjective(tenantA);
    setRaci(tenantA, userA, 'objective', objId, 'R');
    setRaci(tenantA, userB, 'objective', objId, 'A');
    const uncovered = raciEnhancementService.findUncovered(tenantA);
    expect(uncovered.some((u) => u.entityId === objId)).toBe(false);
  });
});

describe('R3 负载均衡', () => {
  it('负载统计', () => {
    const stats = raciEnhancementService.getLoadStats(tenantA);
    expect(stats.users.length).toBeGreaterThanOrEqual(1);
    expect(stats.users[0]).toHaveProperty('responsibleCount');
    expect(stats.users[0]).toHaveProperty('accountableCount');
    expect(stats.users[0]).toHaveProperty('overloaded');
    expect(Array.isArray(stats.overloaded)).toBe(true);
  });
});

describe('R5 跨层对齐链', () => {
  it('measure → strategy → goal → objective', () => {
    const objId = seedObjective(tenantA, '公司目标');
    const goalId = seedGoal(objId, 'GMV增长');
    const strategyId = seedStrategy(goalId);
    const measureId = seedMeasure(strategyId);
    const chain = raciEnhancementService.getAlignmentChain(tenantA, 'measure', measureId);
    expect(chain).not.toBeNull();
    expect(chain!.depth).toBe(4);
    expect(chain!.chain[0].entityType).toBe('measure');
    expect(chain!.chain[3].entityType).toBe('objective');
    expect(chain!.chain[3].entityTitle).toBe('公司目标');
  });
  it('不存在实体返回 null', () => {
    expect(raciEnhancementService.getAlignmentChain(tenantA, 'measure', 'fake-id')).toBeNull();
  });
});

describe('R4 我的责任', () => {
  it('返回用户所有 RACI 条目', () => {
    const items = raciEnhancementService.getMyResponsibilities(tenantA, userA);
    expect(Array.isArray(items)).toBe(true);
  });
});

describe('租户隔离', () => {
  it('tenantB 看不到 tenantA 的 RACI', () => {
    const stats = raciEnhancementService.getLoadStats(tenantB);
    expect(stats.users.length).toBe(0);
  });
});