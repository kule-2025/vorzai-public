/**
 * 端到端验证：下单 → 业绩归属落库 → 人效归因计算
 *
 * 验证目标（组长集成验收项）：
 *   1. createOrder 未显式指定归属人时，能按操作人自动解析 employees.user_id → owner_employee_id
 *   2. 显式指定 ownerEmployeeId 时以显式值为准
 *   3. 跨租户的 ownerEmployeeId 被拒绝（多租户安全红线）
 *   4. 操作人未绑定员工档案时不阻断下单，owner_employee_id 落 null
 *   5. computeAttributions 能基于真实订单产出非空归因，且 GMV/毛利口径正确
 *
 * 使用独立临时工作目录，不触碰真实 data/vorzai.db。
 */
import path from 'path';
import fs from 'fs';

const TMP = path.join(process.cwd(), '.tmp-attr-verify');

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed++;
    console.log(`  [PASS] ${name}`);
  } else {
    failed++;
    console.log(`  [FAIL] ${name}`, detail !== undefined ? JSON.stringify(detail) : '');
  }
}

async function main(): Promise<void> {
  // 清理并切换到临时工作目录（config.ts 按 cwd 定位 data/vorzai.db）
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(path.join(TMP, 'data'), { recursive: true });
  process.chdir(TMP);

  const { initDatabase, getDatabase } = await import('../server/src/db/index');
  const { businessService } = await import('../server/src/services/businessService');
  const { attributionService, currentPeriod } = await import('../server/src/services/inventoryService');

  initDatabase();
  const db = getDatabase();

  // ---------- 构造基础数据 ----------
  const T1 = 'tenant-alpha';
  const T2 = 'tenant-beta';
  db.prepare('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)').run(T1, '甲公司', 'alpha');
  db.prepare('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)').run(T2, '乙公司', 'beta');

  // 甲公司：user-sales 绑定员工 emp-sales；user-admin 不绑定员工
  db.prepare(
    'INSERT INTO users (id, tenant_id, username, password_hash, display_name) VALUES (?, ?, ?, ?, ?)'
  ).run('user-sales', T1, 'sales01', 'x', '销售小王');
  db.prepare(
    'INSERT INTO users (id, tenant_id, username, password_hash, display_name) VALUES (?, ?, ?, ?, ?)'
  ).run('user-admin', T1, 'admin01', 'x', '管理员');

  db.prepare(
    "INSERT INTO employees (id, tenant_id, user_id, employee_no, name, position, status) VALUES (?, ?, ?, ?, ?, ?, 'active')"
  ).run('emp-sales', T1, 'user-sales', 'E001', '小王', '销售专员');
  db.prepare(
    "INSERT INTO employees (id, tenant_id, employee_no, name, position, status) VALUES (?, ?, ?, ?, ?, 'active')"
  ).run('emp-other', T1, 'E002', '小李', '销售专员');
  // 乙公司的员工，用于跨租户越权测试
  db.prepare(
    "INSERT INTO employees (id, tenant_id, employee_no, name, position, status) VALUES (?, ?, ?, ?, ?, 'active')"
  ).run('emp-beta', T2, 'B001', '外部人员', '销售');

  // 商品：售价 100，成本 60 → 单件毛利 40
  db.prepare(
    'INSERT INTO products (id, tenant_id, sku, name, selling_price, cost_price, stock) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run('prod-1', T1, 'SKU001', '测试商品', 100, 60, 500);

  console.log('\n=== 场景 1：操作人绑定了员工档案，自动归属 ===');
  const o1 = businessService.createOrder(
    T1,
    { items: [{ productId: 'prod-1', quantity: 2, unitPrice: 100 }] },
    'user-sales'
  ) as Record<string, unknown>;
  check('owner_employee_id 自动解析为 emp-sales', o1.owner_employee_id === 'emp-sales', o1.owner_employee_id);

  console.log('\n=== 场景 2：显式指定归属人时以显式值为准 ===');
  const o2 = businessService.createOrder(
    T1,
    { items: [{ productId: 'prod-1', quantity: 1, unitPrice: 100 }], ownerEmployeeId: 'emp-other' },
    'user-sales'
  ) as Record<string, unknown>;
  check('显式 emp-other 覆盖了操作人默认值', o2.owner_employee_id === 'emp-other', o2.owner_employee_id);

  console.log('\n=== 场景 3：跨租户归属人必须被拒绝（安全红线）===');
  let rejected = false;
  try {
    businessService.createOrder(
      T1,
      { items: [{ productId: 'prod-1', quantity: 1, unitPrice: 100 }], ownerEmployeeId: 'emp-beta' },
      'user-sales'
    );
  } catch {
    rejected = true;
  }
  check('引用乙公司员工被拒绝', rejected);

  console.log('\n=== 场景 4：操作人无员工档案时不阻断下单 ===');
  const o4 = businessService.createOrder(
    T1,
    { items: [{ productId: 'prod-1', quantity: 1, unitPrice: 100 }] },
    'user-admin'
  ) as Record<string, unknown>;
  check('订单创建成功', !!o4.id);
  check('owner_employee_id 落 null', o4.owner_employee_id === null, o4.owner_employee_id);

  console.log('\n=== 场景 5：归因计算基于真实已支付订单 ===');
  // 把场景 1 的订单标记为已支付（2 件 × 100 = 200，成本 2 × 60 = 120，毛利 80）
  db.prepare(
    "UPDATE orders SET payment_status = 'paid', paid_amount = total_amount, order_status = 'completed' WHERE id = ?"
  ).run(o1.id);

  const period = currentPeriod();
  const computed = attributionService.computeAttributions(T1, period);
  check('归因执行产出订单行', (computed as { orderRows: number }).orderRows > 0, computed);

  // 服务层对外统一返回 camelCase
  const ranking = attributionService.getAttributionRanking(T1, period, 10) as Array<Record<string, unknown>>;
  const wang = ranking.find((r) => r.employeeId === 'emp-sales');
  check('排行榜包含 emp-sales', !!wang, ranking);
  check('GMV = 200', Number(wang?.gmv) === 200, wang?.gmv);
  check('毛利 = 80（200 - 2×60）', Number(wang?.grossProfit) === 80, wang?.grossProfit);
  check('毛利率 = 0.4', Math.abs(Number(wang?.marginRate) - 0.4) < 1e-9, wang?.marginRate);
  check('未支付订单不计入 GMV', Number(wang?.orderCount) === 1, wang?.orderCount);

  console.log('\n=== 场景 6：跨租户归因查询隔离 ===');
  const betaRanking = attributionService.getAttributionRanking(T2, period, 10) as unknown[];
  check('乙公司查不到甲公司业绩', betaRanking.length === 0, betaRanking);

  console.log(`\n===== 结果：通过 ${passed} 项，失败 ${failed} 项 =====`);

  db.close();
  process.chdir(path.join(TMP, '..'));
  console.log(`\n临时库位于 ${TMP}，可自行删除。`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('验证脚本异常:', err);
  process.exit(1);
});
