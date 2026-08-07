/**
 * Vorzai 种子数据 - 初始化演示数据
 * 用于首次启动时填充示例数据，方便开发和演示
 */
import { getDatabase } from './index';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

export function seedDatabase(): void {
  const db = getDatabase();

  // SECURITY: Only seed demo data in development mode
  // Production databases must start clean — no demo users with known passwords
  const isDev = process.env.NODE_ENV === 'development' || process.env.VORZAI_DEV_SEED === 'true';
  if (!isDev) {
    console.log('[Seed] Skipping demo data (production mode)');
    return;
  }

  // Check if already seeded
  const tenantCount = (db.prepare('SELECT COUNT(*) as c FROM tenants').get() as any).c;
  if (tenantCount > 0) return;

  const tenantId = uuidv4();
  const adminId = uuidv4();
  const managerId = uuidv4();
  const memberId = uuidv4();

  const passwordHash = bcrypt.hashSync('admin123', 10);

  // Create tenant
  db.prepare(
    `INSERT INTO tenants (id, name, slug, industry, plan) VALUES (?, '星辰电商科技', 'starec', 'ecommerce', 'professional')`
  ).run(tenantId);

  // Create users
  const insertUser = db.prepare(
    `INSERT INTO users (id, tenant_id, username, email, password_hash, display_name, role, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`
  );
  insertUser.run(adminId, tenantId, 'admin', 'admin@starec.com', passwordHash, '张管理', 'owner');
  insertUser.run(managerId, tenantId, 'manager', 'manager@starec.com', passwordHash, '李经理', 'manager');
  insertUser.run(memberId, tenantId, 'member', 'member@starec.com', passwordHash, '王成员', 'member');

  // Create departments
  const deptOps = uuidv4();
  const deptHr = uuidv4();
  const deptCs = uuidv4();
  const deptTech = uuidv4();

  const insertDept = db.prepare('INSERT INTO departments (id, tenant_id, name, leader_id, sort_order) VALUES (?, ?, ?, ?, ?)');
  insertDept.run(deptOps, tenantId, '运营部', managerId, 1);
  insertDept.run(deptHr, tenantId, '人力资源部', adminId, 2);
  insertDept.run(deptCs, tenantId, '客服部', null, 3);
  insertDept.run(deptTech, tenantId, '技术部', null, 4);

  // Create default roles
  const insertRole = db.prepare('INSERT INTO roles (id, tenant_id, name, description, permissions, is_system) VALUES (?, ?, ?, ?, ?, 1)');
  insertRole.run(uuidv4(), tenantId, '管理员', '拥有所有权限', JSON.stringify(['*']));
  insertRole.run(uuidv4(), tenantId, '部门经理', '部门管理权限', JSON.stringify(['hr:read', 'hr:write', 'ogsm:read', 'ogsm:write', 'business:read', 'business:write']));
  insertRole.run(uuidv4(), tenantId, '普通成员', '基本操作权限', JSON.stringify(['hr:read:self', 'ogsm:read', 'business:read']));

  // Seed leave types (调休/年假/病假/事假 — 幂等插入）
  const insertLeaveType = db.prepare(
    'INSERT OR IGNORE INTO leave_types (id, tenant_id, name, category, is_paid, max_days_per_year, min_hours_per_application, overtime_source, icon, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  insertLeaveType.run('lt_compensatory', tenantId, '调休', 'compensatory', 1, null, 0.5, 1, '↻', 1);
  insertLeaveType.run('lt_annual', tenantId, '年假', 'annual', 1, 15, 4, 0, '☀', 2);
  insertLeaveType.run('lt_sick', tenantId, '病假', 'sick', 0, 30, 0.5, 0, '⚕', 3);
  insertLeaveType.run('lt_personal', tenantId, '事假', 'personal', 0, 20, 0.5, 0, '📋', 4);

  // Create OGSM objectives
  const objId = uuidv4();
  db.prepare(
    `INSERT INTO ogsm_objectives (id, tenant_id, title, description, level, owner_id, department_id, start_date, end_date, status, progress, priority)
     VALUES (?, ?, '2026年度GMV突破5000万', '通过多平台运营和直播电商实现年度GMV目标', 'company', ?, ?, '2026-01-01', '2026-12-31', 'active', 35, 'critical')`
  ).run(objId, tenantId, adminId, deptOps);

  const goalId = uuidv4();
  db.prepare(
    `INSERT INTO ogsm_goals (id, objective_id, title, description, metric_type, target_value, current_value, unit, owner_id, deadline, status)
     VALUES (?, ?, 'Q3直播GMV达到800万', '第三季度通过抖音直播实现800万GMV', 'currency', 8000000, 2800000, '元', ?, '2026-09-30', 'in_progress')`
  ).run(goalId, objId, managerId);

  const strategyId = uuidv4();
  db.prepare(
    `INSERT INTO ogsm_strategies (id, goal_id, title, description, owner_id, status)
     VALUES (?, ?, '打造3个爆款直播间', '通过选品优化和投流策略打造高转化直播间', ?, 'executing')`
  ).run(strategyId, goalId, managerId);

  // Create employees
  const empData = [
    { no: 'EMP001', name: '张管理', dept: deptHr, pos: 'HRD', level: 'P8', salary: 35000 },
    { no: 'EMP002', name: '李经理', dept: deptOps, pos: '运营总监', level: 'P7', salary: 28000 },
    { no: 'EMP003', name: '王成员', dept: deptOps, pos: '直播运营', level: 'P5', salary: 15000 },
    { no: 'EMP004', name: '赵客服', dept: deptCs, pos: '客服主管', level: 'P5', salary: 12000 },
    { no: 'EMP005', name: '陈设计', dept: deptTech, pos: '视觉设计师', level: 'P5', salary: 16000 },
    { no: 'EMP006', name: '刘开发', dept: deptTech, pos: '前端工程师', level: 'P6', salary: 22000 },
  ];

  const insertEmp = db.prepare(
    `INSERT INTO employees (id, tenant_id, employee_no, name, department_id, position, job_level, employment_type, hire_date, salary_base, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'full_time', '2024-03-01', ?, 'active')`
  );
  for (const emp of empData) {
    insertEmp.run(uuidv4(), tenantId, emp.no, emp.name, emp.dept, emp.pos, emp.level, emp.salary);
  }

  // Create a project
  const projectId = uuidv4();
  db.prepare(
    `INSERT INTO projects (id, tenant_id, name, code, description, business_type, platform, owner_id, department_id, budget, expected_revenue, start_date, end_date, status, priority, tags)
     VALUES (?, ?, '抖音直播间矩阵项目', 'PRJ-2026-001', '打造3个垂直类目直播间，实现日播GMV 10万+', 'live_commerce', '抖音', ?, ?, 500000, 8000000, '2026-04-01', '2026-12-31', 'in_progress', 'high', ?)`
  ).run(projectId, tenantId, managerId, deptOps, JSON.stringify(['直播', '抖音', '矩阵']));

  // Create products
  const products = [
    { sku: 'SKU-001', name: '夏季冰丝防晒衣', cat: '服饰', cost: 35, price: 89, stock: 500 },
    { sku: 'SKU-002', name: '便携式果汁杯', cat: '小家电', cost: 45, price: 129, stock: 300 },
    { sku: 'SKU-003', name: '氨基酸洗面奶', cat: '美妆', cost: 22, price: 69, stock: 800 },
    { sku: 'SKU-004', name: '无线蓝牙耳机', cat: '数码', cost: 55, price: 159, stock: 200 },
    { sku: 'SKU-005', name: '有机坚果礼盒', cat: '食品', cost: 68, price: 168, stock: 150 },
  ];

  const insertProduct = db.prepare(
    `INSERT INTO products (id, tenant_id, project_id, sku, name, category, cost_price, selling_price, stock, margin_rate, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'listed')`
  );
  for (const p of products) {
    const margin = Math.round(((p.price - p.cost) / p.price) * 10000) / 100;
    insertProduct.run(uuidv4(), tenantId, projectId, p.sku, p.name, p.cat, p.cost, p.price, p.stock, margin);
  }

  // Create sample orders
  const insertOrder = db.prepare(
    `INSERT INTO orders (id, tenant_id, project_id, order_no, platform, customer_name, items, subtotal, total_amount, payment_status, order_status, created_at)
     VALUES (?, ?, ?, ?, '抖音', ?, ?, ?, ?, 'paid', 'completed', ?)`
  );
  for (let i = 1; i <= 10; i++) {
    const amount = Math.floor(Math.random() * 300) + 50;
    const date = `2026-07-${String(Math.floor(Math.random() * 28) + 1).padStart(2, '0')} 10:30:00`;
    insertOrder.run(
      uuidv4(), tenantId, projectId,
      `ORD202607${String(i).padStart(4, '0')}`,
      `客户${i}`, JSON.stringify([{ productId: 'SKU-001', quantity: 1, unitPrice: amount }]),
      amount, amount, date
    );
  }

  // Create knowledge base
  const kbId = uuidv4();
  db.prepare(
    `INSERT INTO knowledge_bases (id, tenant_id, name, description, type, visibility, owner_id, doc_count, status)
     VALUES (?, ?, '电商运营知识库', '涵盖直播运营、选品策略、客服话术等核心知识', 'process', 'tenant', ?, 3, 'active')`
  ).run(kbId, tenantId, adminId);

  const insertDoc = db.prepare(
    `INSERT INTO knowledge_documents (id, kb_id, tenant_id, title, content, content_type, category, tags, author_id, status)
     VALUES (?, ?, ?, ?, ?, 'markdown', ?, ?, ?, 'published')`
  );
  insertDoc.run(uuidv4(), kbId, tenantId, '直播间选品SOP', '# 直播间选品标准操作流程\n\n## 选品原则\n1. 高性价比：毛利率>50%\n2. 视觉冲击：适合镜头展示\n3. 复购率高：消耗品优先\n4. 供应链稳定：库存>500件', 'process', JSON.stringify(['选品', 'SOP']), adminId);
  insertDoc.run(uuidv4(), kbId, tenantId, '客服话术模板', '# 客服标准话术\n\n## 售前咨询\n- 欢迎光临，请问有什么可以帮您？\n- 这款目前活动价是XX元，性价比非常高\n\n## 售后处理\n- 非常抱歉给您带来不便，我马上为您处理', 'faq', JSON.stringify(['客服', '话术']), adminId);
  insertDoc.run(uuidv4(), kbId, tenantId, '抖音投流指南', '# 千川投流操作指南\n\n## 投放策略\n- 新号冷启动：小预算多计划测试\n- 成熟期：放量投放+ROI管控\n- 大促期：提前3天蓄水', 'training', JSON.stringify(['投流', '千川']), managerId);

  // Create skills
  const insertSkill = db.prepare(
    `INSERT INTO skills (id, tenant_id, name, slug, description, category, trigger_keywords, execution_config, author_id, status, usage_count)
     VALUES (?, ?, ?, ?, ?, 'custom', ?, ?, ?, 'active', ?)`
  );
  insertSkill.run(uuidv4(), tenantId, '选品评分器', 'product-scorer', '根据多维度指标自动评估商品选品得分', JSON.stringify(['选品', '评分', '评估']), JSON.stringify({ type: 'calculate', formula: '(margin * 0.4 + stock_score * 0.3 + trend * 0.3)' }), adminId, 42);
  insertSkill.run(uuidv4(), tenantId, '客服自动回复', 'auto-reply', '基于知识库自动生成客服回复建议', JSON.stringify(['客服', '回复', '自动']), JSON.stringify({ type: 'lookup', tenantId }), adminId, 128);
  insertSkill.run(uuidv4(), tenantId, '日报生成器', 'daily-report', '自动汇总当日业务数据生成运营日报', JSON.stringify(['日报', '汇总', '报告']), JSON.stringify({ type: 'transform', template: '【{{date}}运营日报】\nGMV: {{gmv}}元\n订单: {{orders}}单\n客单价: {{aov}}元' }), managerId, 89);

  // Create connectors (pre-configured)
  const insertConnector = db.prepare(
    `INSERT INTO connectors (id, tenant_id, name, type, description, config, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 'disconnected', ?)`
  );
  insertConnector.run(uuidv4(), tenantId, '钉钉集成', 'dingtalk', '对接钉钉通讯录、审批、考勤', JSON.stringify({ syncContacts: true, syncAttendance: true }), adminId);
  insertConnector.run(uuidv4(), tenantId, '飞书集成', 'feishu', '对接飞书文档、日历、任务', JSON.stringify({ syncDocs: true, syncCalendar: true }), adminId);
  insertConnector.run(uuidv4(), tenantId, '企业邮箱', 'email', '对接企业邮箱收发通知', JSON.stringify({ smtp: '', imap: '' }), adminId);

  console.log('[Seed] Database seeded with demo data successfully');
}
