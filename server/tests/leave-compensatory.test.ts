/**
 * 调休业务规则单元测试
 *
 * 覆盖（V2 调休完整落地）：
 *   - 加班审批通过 → 自动 1:1 累积调休额度
 *   - 调休申请校验有效余额、审批扣减、流水账记录
 *   - 有效期感知：过期结转额度不参与有效余额（year-semantics + expires_at）
 *   - 多租户隔离：B 租户看不到 A 租户额度
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { rmSync } from 'fs';
import { getDatabase, initDatabase, closeDatabase } from '../src/db';
import { overtimeService, leaveService } from '../src/services/leaveService';

const TEST_DB_PATH = 'data/test_vorzai_leave.db';

function seedTenant(): string {
  const db = getDatabase();
  const id = uuidv4();
  db.prepare(`INSERT INTO tenants (id, name, slug, status) VALUES (?, ?, ?, ?)`)
    .run(id, '调休测试租户', 'leave-' + id.slice(0, 8), 'active');
  return id;
}

function seedEmployee(tenantId: string): string {
  const db = getDatabase();
  const id = uuidv4();
  db.prepare(`INSERT INTO employees (id, tenant_id, employee_no, name, status) VALUES (?, ?, ?, ?, 'active')`)
    .run(id, tenantId, 'EMP-' + id.slice(0, 6), '员工_' + id.slice(0, 4));
  return id;
}

function seedUser(tenantId: string, username: string): string {
  const db = getDatabase();
  const id = uuidv4();
  db.prepare(`INSERT INTO users
    (id, tenant_id, username, password_hash, display_name, role, status)
    VALUES (?, ?, ?, 'seed-hash', ?, 'manager', 'active')`)
    .run(id, tenantId, username, '主管_' + id.slice(0, 4));
  return id;
}

function seedCompensatoryType(tenantId: string): void {
  const db = getDatabase();
  db.prepare(`INSERT INTO leave_types
    (id, tenant_id, name, category, is_paid, max_days_per_year, min_hours_per_application, approval_required, overtime_source, icon, sort_order, is_active)
    VALUES (?, ?, '调休', 'compensatory', 1, NULL, 1, 1, 1, 'comp', 1, 1)`)
    .run('lt_compensatory', tenantId);
  // 注意：leave_types.category 受 CHECK 约束，调休必须使用 'compensatory'
}

let tenantA: string;
let tenantB: string;
let empA: string;
let empB: string;
let mgrA: string;

beforeAll(() => {
  try { rmSync(TEST_DB_PATH); } catch { /* 首次运行无文件 */ }
  initDatabase(TEST_DB_PATH);
  tenantA = seedTenant();
  tenantB = seedTenant();
  seedCompensatoryType(tenantA);
  empA = seedEmployee(tenantA);
  empB = seedEmployee(tenantB);
  mgrA = seedUser(tenantA, 'mgr_a');
});

afterAll(() => {
  closeDatabase();
  try { rmSync(TEST_DB_PATH); } catch { /* 忽略 */ }
});

describe('调休额度累积（加班 → 审批 → 调休）', () => {
  it('加班审批通过后自动累积 1:1 调休额度', () => {
    const ot = overtimeService.createOvertime({
      tenant_id: tenantA, employee_id: empA, date: '2026-08-10',
      start_time: '18:00', end_time: '21:00', hours: 4, reason: '大促备战',
    });
    expect(ot.status).toBe('pending');

    const approved = overtimeService.approveOvertime(ot.id, tenantA, mgrA, 'approved');
    expect(approved?.status).toBe('converted');

    const summary = leaveService.getCompensatorySummary(tenantA, empA);
    expect(summary.effectiveRemaining).toBe(4);
    expect(summary.totalHours).toBe(4);
    expect(summary.usedHours).toBe(0);
    // 流水账含一条累积记录
    expect(summary.ledger.some((l) => l.type === 'accrual' && l.hours === 4)).toBe(true);
  });

  it('调休申请校验有效余额并审批扣减', () => {
    const checkBefore = leaveService.checkCompensatoryBalance(empA, tenantA, 2);
    expect(checkBefore.sufficient).toBe(true);
    expect(checkBefore.remaining).toBe(4);

    const app = leaveService.applyLeave({
      tenant_id: tenantA, employee_id: empA, leave_type_id: 'lt_compensatory',
      start_datetime: '2026-08-15T09:00', end_datetime: '2026-08-15T11:00',
      total_hours: 2, reason: '有事',
    });
    expect(app.application?.status).toBe('pending');

    const approved = leaveService.approveLeave(app.application!.id, tenantA, mgrA, 'approved');
    expect(approved?.status).toBe('approved');

    const summary = leaveService.getCompensatorySummary(tenantA, empA);
    expect(summary.effectiveRemaining).toBe(2);
    expect(summary.usedHours).toBe(2);
    expect(summary.ledger.some((l) => l.type === 'consume' && l.hours === 2)).toBe(true);

    // 余额不足时拒绝
    const overCheck = leaveService.checkCompensatoryBalance(empA, tenantA, 100);
    expect(overCheck.sufficient).toBe(false);
    expect(overCheck.deficit).toBe(98);
  });
});

describe('调休有效期感知', () => {
  it('过期的结转额度不计入有效余额', () => {
    const db = getDatabase();
    // 模拟一条 2020 年结转、已于 2020-12-31 过期的额度
    db.prepare(`INSERT INTO leave_balances
      (id, tenant_id, employee_id, leave_type_id, year, total_hours, used_hours, remaining_hours, source, expires_at)
      VALUES (?, ?, ?, 'lt_compensatory', 2020, 10, 0, 10, 'carry_over', '2020-12-31')`)
      .run(uuidv4(), tenantA, empA);

    const summary = leaveService.getCompensatorySummary(tenantA, empA);
    // 有效余额仍只来自当年未过期的额度（4 - 2 = 2），过期 10h 被排除
    expect(summary.effectiveRemaining).toBe(2);
  });
});

describe('多租户隔离', () => {
  it('B 租户员工看不到 A 租户的调休额度', () => {
    const summaryB = leaveService.getCompensatorySummary(tenantB, empB);
    expect(summaryB.effectiveRemaining).toBe(0);
    expect(summaryB.totalHours).toBe(0);

    const checkB = leaveService.checkCompensatoryBalance(empB, tenantB, 1);
    expect(checkB.sufficient).toBe(false);
  });
});
