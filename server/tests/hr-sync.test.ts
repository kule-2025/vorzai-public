/**
 * HR 前后端打通单元测试（V2 · M2 / H1-H2）
 *
 * 覆盖：
 *   H1 组织架构树：层级挂载 / 在岗人数累加 / 未分配部门 / 脏数据降级 / 环形防御
 *   H2 员工批量同步：幂等键 / 新增更新 / 部门自动建档 / 状态映射 / 脏数据跳过
 *   多租户隔离：跨租户不可见
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDatabase, closeDatabase, getDatabase } from '../src/db';
import { hrService } from '../src/services/hrService';
import { v4 as uuidv4 } from 'uuid';
import { removeDbFiles } from './test-helpers';

const TEST_DB_PATH = process.env.VORZAI_TEST_DB_HR || 'data/test_vorzai_hr_sync.db';

let tenantA: string;
let tenantB: string;

function seedTenant(name: string): string {
  const db = getDatabase();
  const id = uuidv4();
  db.prepare('INSERT INTO tenants (id, name, slug, status) VALUES (?, ?, ?, ?)')
    .run(id, name, `${name}-${id.slice(0, 8)}`, 'active');
  return id;
}

function seedDepartment(tenantId: string, name: string, parentId?: string): string {
  const db = getDatabase();
  const id = uuidv4();
  db.prepare('INSERT INTO departments (id, tenant_id, name, parent_id) VALUES (?, ?, ?, ?)')
    .run(id, tenantId, name, parentId || null);
  return id;
}

function seedEmployee(
  tenantId: string,
  no: string,
  name: string,
  departmentId?: string | null,
  status = 'active'
): string {
  const db = getDatabase();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO employees (id, tenant_id, employee_no, name, department_id, status)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, tenantId, no, name, departmentId || null, status);
  return id;
}

/** 在树中按名称找节点 */
function findNode(nodes: any[], name: string): any | undefined {
  for (const n of nodes) {
    if (n.name === name) return n;
    const hit = findNode(n.children || [], name);
    if (hit) return hit;
  }
  return undefined;
}

// ════════════════════════════════════════════════════════════
// H1 组织架构树
// ════════════════════════════════════════════════════════════

describe('HR 前后端打通 · H1 组织架构树', () => {
  let deptTech: string;
  let deptFE: string;
  let deptBE: string;
  let deptSales: string;

  beforeAll(() => {
    removeDbFiles(TEST_DB_PATH);
    initDatabase(TEST_DB_PATH);
    tenantA = seedTenant('组织树租户A');
    tenantB = seedTenant('组织树租户B');

    // 技术部 ├ 前端组 └ 后端组 ；销售部（平级）
    deptTech = seedDepartment(tenantA, '技术部');
    deptFE = seedDepartment(tenantA, '前端组', deptTech);
    deptBE = seedDepartment(tenantA, '后端组', deptTech);
    deptSales = seedDepartment(tenantA, '销售部');

    seedEmployee(tenantA, 'T001', '技术总监', deptTech);
    seedEmployee(tenantA, 'F001', '前端甲', deptFE);
    seedEmployee(tenantA, 'F002', '前端乙', deptFE);
    seedEmployee(tenantA, 'F003', '前端离职', deptFE, 'resigned');
    seedEmployee(tenantA, 'B001', '后端甲', deptBE, 'probation');
    seedEmployee(tenantA, 'S001', '销售甲', deptSales);
    seedEmployee(tenantA, 'U001', '游离员工', null);

    // 他租户数据，用于验证隔离
    const deptOther = seedDepartment(tenantB, '他司技术部');
    seedEmployee(tenantB, 'X001', '他司员工', deptOther);
  });

  afterAll(() => { closeDatabase(); removeDbFiles(TEST_DB_PATH); });

  it('应按父子关系构建层级树', () => {
    const { tree } = hrService.getOrgTree(tenantA) as any;
    const tech = findNode(tree, '技术部');
    expect(tech).toBeDefined();
    expect(tech.children.map((c: any) => c.name).sort()).toEqual(['前端组', '后端组']);
    // 销售部为根节点，不应挂在技术部下
    expect(findNode(tech.children, '销售部')).toBeUndefined();
  });

  it('memberCount 只统计在岗（active/probation），离职不计', () => {
    const { tree } = hrService.getOrgTree(tenantA) as any;
    const fe = findNode(tree, '前端组');
    // 前端甲 + 前端乙 在岗，前端离职不计
    expect(fe.memberCount).toBe(2);
    expect(fe.members.length).toBe(3); // members 保留全量便于前端展示
    const be = findNode(tree, '后端组');
    expect(be.memberCount).toBe(1); // probation 计入在岗
  });

  it('totalHeadcount 应自底向上累加子部门在岗人数', () => {
    const { tree } = hrService.getOrgTree(tenantA) as any;
    const tech = findNode(tree, '技术部');
    // 技术总监1 + 前端组2 + 后端组1 = 4
    expect(tech.totalHeadcount).toBe(4);
    expect(tech.memberCount).toBe(1);
  });

  it('未分配部门的员工应归入虚拟节点', () => {
    const { tree, summary } = hrService.getOrgTree(tenantA) as any;
    const un = tree.find((n: any) => n.id === '__unassigned__');
    expect(un).toBeDefined();
    expect(un.members.map((m: any) => m.name)).toContain('游离员工');
    expect(summary.unassignedCount).toBe(1);
  });

  it('summary 汇总口径正确', () => {
    const { summary } = hrService.getOrgTree(tenantA) as any;
    expect(summary.departmentCount).toBe(4);
    expect(summary.employeeTotal).toBe(7);
    expect(summary.activeTotal).toBe(6); // 7 - 1 离职
    expect(summary.resignedTotal).toBe(1);
    expect(summary.maxDepth).toBe(2); // 技术部 → 前端组
  });

  it('跨租户隔离：不应看到他租户部门与员工', () => {
    const { tree, summary } = hrService.getOrgTree(tenantB) as any;
    expect(findNode(tree, '技术部')).toBeUndefined();
    expect(findNode(tree, '他司技术部')).toBeDefined();
    expect(summary.employeeTotal).toBe(1);
  });

  it('父部门属于他租户（可穿透外键的脏数据）应降级为根节点而非丢失', () => {
    const db = getDatabase();
    // 外键约束只校验 departments.id 存在，不校验租户，这是真实可能出现的脏数据
    const foreignParent = seedDepartment(tenantB, '他租户父部门');
    const orphan = uuidv4();
    db.prepare('INSERT INTO departments (id, tenant_id, name, parent_id) VALUES (?, ?, ?, ?)')
      .run(orphan, tenantA, '跨租户挂载部门', foreignParent);

    const { tree } = hrService.getOrgTree(tenantA) as any;
    const node = tree.find((n: any) => n.name === '跨租户挂载部门');
    expect(node).toBeDefined();          // 未丢失
    expect(node.parentId).toBe(foreignParent); // 保留原始引用供排障

    // 清理，避免影响后续断言
    db.prepare('DELETE FROM departments WHERE id = ?').run(orphan);
    db.prepare('DELETE FROM departments WHERE id = ?').run(foreignParent);
  });

  it('自引用部门不应导致死循环', () => {
    const db = getDatabase();
    const selfRef = uuidv4();
    // 先插入无父级，再自引用，绕开外键的插入时序限制
    db.prepare('INSERT INTO departments (id, tenant_id, name) VALUES (?, ?, ?)')
      .run(selfRef, tenantA, '自环部门');
    db.prepare('UPDATE departments SET parent_id = ? WHERE id = ?').run(selfRef, selfRef);

    const { tree } = hrService.getOrgTree(tenantA) as any;
    expect(tree.find((n: any) => n.name === '自环部门')).toBeDefined();

    db.prepare('UPDATE departments SET parent_id = NULL WHERE id = ?').run(selfRef);
    db.prepare('DELETE FROM departments WHERE id = ?').run(selfRef);
  });

  it('空租户应返回空树而非报错', () => {
    const empty = seedTenant('空租户');
    const { tree, summary } = hrService.getOrgTree(empty) as any;
    expect(tree).toEqual([]);
    expect(summary.employeeTotal).toBe(0);
    expect(summary.maxDepth).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════
// H2 员工批量同步
// ════════════════════════════════════════════════════════════

describe('HR 前后端打通 · H2 员工批量同步', () => {
  beforeAll(() => {
    removeDbFiles(TEST_DB_PATH);
    initDatabase(TEST_DB_PATH);
    tenantA = seedTenant('同步租户A');
    tenantB = seedTenant('同步租户B');
  });

  afterAll(() => { closeDatabase(); removeDbFiles(TEST_DB_PATH); });

  it('首次同步应全部新增，并自动建部门', () => {
    const r = hrService.syncEmployees(tenantA, [
      { employeeNo: 'E001', name: '张三', department: '运营部', position: '运营专员' },
      { employeeNo: 'E002', name: '李四', department: '运营部', position: '运营主管' },
      { employeeNo: 'E003', name: '王五', department: '技术部' },
    ]) as any;

    expect(r.created).toBe(3);
    expect(r.updated).toBe(0);
    expect(r.skipped).toBe(0);
    expect(r.createdDepartments).toBe(2); // 运营部 + 技术部，运营部只建一次
  });

  it('重复同步应幂等：转为更新而非重复插入', () => {
    const r = hrService.syncEmployees(tenantA, [
      { employeeNo: 'E001', name: '张三丰', department: '运营部', position: '运营总监' },
    ]) as any;

    expect(r.created).toBe(0);
    expect(r.updated).toBe(1);
    expect(r.createdDepartments).toBe(0); // 部门已存在，不重复创建

    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM employees WHERE tenant_id = ? AND employee_no = ?')
      .all(tenantA, 'E001') as any[];
    expect(rows.length).toBe(1); // 未产生重复行
    expect(rows[0].name).toBe('张三丰');
    expect(rows[0].position).toBe('运营总监');
  });

  it('部门名匹配大小写与空格不敏感', () => {
    const before = getDatabase()
      .prepare('SELECT COUNT(*) AS c FROM departments WHERE tenant_id = ?').get(tenantA) as any;
    const r = hrService.syncEmployees(tenantA, [
      { employeeNo: 'E004', name: '赵六', department: '  运营部  ' },
    ]) as any;
    const after = getDatabase()
      .prepare('SELECT COUNT(*) AS c FROM departments WHERE tenant_id = ?').get(tenantA) as any;

    expect(r.createdDepartments).toBe(0);
    expect(after.c).toBe(before.c);
  });

  it('前端 inactive 状态应映射为后端 resigned', () => {
    hrService.syncEmployees(tenantA, [
      { employeeNo: 'E005', name: '离职员工', status: 'inactive' },
    ]);
    const row = getDatabase()
      .prepare('SELECT status FROM employees WHERE tenant_id = ? AND employee_no = ?')
      .get(tenantA, 'E005') as any;
    expect(row.status).toBe('resigned');
  });

  it('非法状态应兜底为 active，不写入违反 CHECK 约束的值', () => {
    hrService.syncEmployees(tenantA, [
      { employeeNo: 'E006', name: '状态异常', status: '在职中' },
    ]);
    const row = getDatabase()
      .prepare('SELECT status FROM employees WHERE tenant_id = ? AND employee_no = ?')
      .get(tenantA, 'E006') as any;
    expect(row.status).toBe('active');
  });

  it('缺少工号应跳过并给出原因，不阻断其余记录', () => {
    const r = hrService.syncEmployees(tenantA, [
      { name: '无工号者' },
      { employeeNo: 'E007', name: '正常者' },
    ]) as any;

    expect(r.skipped).toBe(1);
    expect(r.created).toBe(1);
    const skipped = r.details.find((d: any) => d.action === 'skipped');
    expect(skipped.reason).toContain('employeeNo');
  });

  it('缺少姓名应跳过', () => {
    const r = hrService.syncEmployees(tenantA, [
      { employeeNo: 'E008', name: '   ' },
    ]) as any;
    expect(r.skipped).toBe(1);
    expect(r.created).toBe(0);
  });

  it('更新时未提供部门不应清空原有部门', () => {
    hrService.syncEmployees(tenantA, [
      { employeeNo: 'E009', name: '有部门者', department: '财务部' },
    ]);
    const before = getDatabase()
      .prepare('SELECT department_id FROM employees WHERE tenant_id = ? AND employee_no = ?')
      .get(tenantA, 'E009') as any;
    expect(before.department_id).toBeTruthy();

    hrService.syncEmployees(tenantA, [
      { employeeNo: 'E009', name: '有部门者改名', position: '会计' },
    ]);
    const after = getDatabase()
      .prepare('SELECT department_id, name FROM employees WHERE tenant_id = ? AND employee_no = ?')
      .get(tenantA, 'E009') as any;
    expect(after.department_id).toBe(before.department_id);
    expect(after.name).toBe('有部门者改名');
  });

  it('技能数组应序列化落库', () => {
    hrService.syncEmployees(tenantA, [
      { employeeNo: 'E010', name: '多技能者', skills: ['直播', '选品', 'Excel'] },
    ]);
    const row = getDatabase()
      .prepare('SELECT skills FROM employees WHERE tenant_id = ? AND employee_no = ?')
      .get(tenantA, 'E010') as any;
    expect(JSON.parse(row.skills)).toEqual(['直播', '选品', 'Excel']);
  });

  it('空数组应安全返回零结果', () => {
    const r = hrService.syncEmployees(tenantA, []) as any;
    expect(r.created).toBe(0);
    expect(r.updated).toBe(0);
    expect(r.skipped).toBe(0);
  });

  it('跨租户同工号互不影响', () => {
    hrService.syncEmployees(tenantB, [{ employeeNo: 'E001', name: '他司张三' }]);
    const a = getDatabase()
      .prepare('SELECT name FROM employees WHERE tenant_id = ? AND employee_no = ?')
      .get(tenantA, 'E001') as any;
    const b = getDatabase()
      .prepare('SELECT name FROM employees WHERE tenant_id = ? AND employee_no = ?')
      .get(tenantB, 'E001') as any;
    expect(a.name).toBe('张三丰');
    expect(b.name).toBe('他司张三');
  });

  it('同步后的员工应能被组织树正确统计', () => {
    const { summary, tree } = hrService.getOrgTree(tenantB) as any;
    expect(summary.employeeTotal).toBe(1);
    // 未指定部门 → 归入未分配节点
    expect(tree.find((n: any) => n.id === '__unassigned__')).toBeDefined();
  });
});
