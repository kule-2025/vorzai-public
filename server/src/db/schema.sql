-- ============================================================
-- Vorzai 电商人力资源与业务解决方案系统 - 数据库架构
-- SQLite | 嵌入式桌面应用（node:sqlite 原生驱动）
-- ============================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

-- ============================================================
-- 1. 多租户与账号体系（对标钉钉模式）
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  role TEXT DEFAULT 'member' CHECK(role IN ('owner', 'admin', 'manager', 'member', 'viewer')),
  department_id TEXT,
  email_verified INTEGER DEFAULT 0,
  mfa_enabled INTEGER DEFAULT 0,
  mfa_secret TEXT,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'suspended', 'pending')),
  last_login_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(tenant_id, username),
  UNIQUE(tenant_id, email)
);

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  industry TEXT DEFAULT 'ecommerce',
  plan TEXT DEFAULT 'free' CHECK(plan IN ('free', 'trial', 'standard', 'professional', 'enterprise')),
  max_users INTEGER DEFAULT 5,
  settings TEXT DEFAULT '{}',
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'archived')),
  trial_started_at TEXT,
  trial_ends_at TEXT,
  license_key TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  revoked INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES departments(id),
  leader_id TEXT REFERENCES users(id),
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  permissions TEXT DEFAULT '[]',
  is_system INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(tenant_id, name)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  details TEXT DEFAULT '{}',
  ip_address TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- 2. OGSM 目标管理体系
-- ============================================================

CREATE TABLE IF NOT EXISTS ogsm_objectives (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  level TEXT DEFAULT 'company' CHECK(level IN ('company', 'department', 'team', 'individual')),
  parent_id TEXT REFERENCES ogsm_objectives(id),
  owner_id TEXT REFERENCES users(id),
  department_id TEXT REFERENCES departments(id),
  start_date TEXT,
  end_date TEXT,
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'completed', 'cancelled', 'archived')),
  progress INTEGER DEFAULT 0 CHECK(progress >= 0 AND progress <= 100),
  priority TEXT DEFAULT 'medium' CHECK(priority IN ('critical', 'high', 'medium', 'low')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ogsm_goals (
  id TEXT PRIMARY KEY,
  objective_id TEXT NOT NULL REFERENCES ogsm_objectives(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  metric_type TEXT DEFAULT 'percentage' CHECK(metric_type IN ('percentage', 'number', 'currency', 'boolean')),
  target_value REAL,
  current_value REAL DEFAULT 0,
  unit TEXT,
  owner_id TEXT REFERENCES users(id),
  deadline TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'achieved', 'missed')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ogsm_strategies (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES ogsm_goals(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  owner_id TEXT REFERENCES users(id),
  status TEXT DEFAULT 'planned' CHECK(status IN ('planned', 'executing', 'completed', 'blocked')),
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ogsm_measures (
  id TEXT PRIMARY KEY,
  strategy_id TEXT NOT NULL REFERENCES ogsm_strategies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  metric_type TEXT DEFAULT 'percentage' CHECK(metric_type IN ('percentage', 'number', 'currency', 'boolean')),
  target_value REAL,
  current_value REAL DEFAULT 0,
  unit TEXT,
  frequency TEXT DEFAULT 'monthly' CHECK(frequency IN ('daily', 'weekly', 'monthly', 'quarterly')),
  owner_id TEXT REFERENCES users(id),
  deadline TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'tracking', 'achieved', 'missed')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- O2: OGSM 时间序列快照（每日打点，回看 ≥90 天）
CREATE TABLE IF NOT EXISTS ogsm_progress_snapshots (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  objective_id TEXT NOT NULL REFERENCES ogsm_objectives(id) ON DELETE CASCADE,
  snapshot_date TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  alignment INTEGER,
  goal_progress_sum REAL,
  goal_count INTEGER,
  is_auto INTEGER DEFAULT 0,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(objective_id, snapshot_date)
);

-- O3: OGSM ↔ 经营指标对标（目标自动拉取 GMV/订单/毛利/转化等实际值）
CREATE TABLE IF NOT EXISTS ogsm_metric_links (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  goal_id TEXT NOT NULL REFERENCES ogsm_goals(id) ON DELETE CASCADE,
  metric_key TEXT NOT NULL CHECK(metric_key IN ('gmv', 'orders', 'aov', 'gross_profit', 'gross_margin_rate', 'conversion', 'refund_rate', 'paid_orders', 'cost', 'active_sku')),
  period_type TEXT DEFAULT 'day' CHECK(period_type IN ('day', 'week', 'month', 'quarter', 'year')),
  scale_factor REAL DEFAULT 1.0,
  auto_sync INTEGER DEFAULT 1,
  last_synced_at TEXT,
  last_value REAL,
  last_progress REAL,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'paused', 'archived')),
  created_by TEXT REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(goal_id, metric_key, period_type)
);

-- O4: OGSM 偏离告警（progress < 计划线 × 80% 触发）
CREATE TABLE IF NOT EXISTS ogsm_deviations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  objective_id TEXT NOT NULL REFERENCES ogsm_objectives(id) ON DELETE CASCADE,
  snapshot_date TEXT NOT NULL,
  actual_progress INTEGER NOT NULL,
  planned_progress INTEGER NOT NULL,
  deviation_ratio REAL NOT NULL,
  severity TEXT DEFAULT 'warning' CHECK(severity IN ('info', 'warning', 'critical')),
  is_acknowledged INTEGER DEFAULT 0,
  acknowledged_by TEXT REFERENCES users(id),
  acknowledged_at TEXT,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- H3: 岗位绩效模型库（五类电商岗位差异化权重模板）
CREATE TABLE IF NOT EXISTS hr_job_models (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_category TEXT NOT NULL CHECK(job_category IN ('operator', 'cs', 'live', 'crossborder', 'hr', 'media')),
  name TEXT NOT NULL,
  description TEXT,
  dimension_weights TEXT NOT NULL DEFAULT '{}',  -- JSON {"achievement":0.4,"collaboration":0.25,"innovation":0.2,"growth":0.15}
  kpi_template TEXT NOT NULL DEFAULT '[]',     -- JSON [{name,type,target,unit,weight}]
  rating_scale TEXT DEFAULT '{"S":5,"A":4,"B":3,"C":2,"D":1}',
  is_default INTEGER DEFAULT 0,
  is_sandbox INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- H4: 行业日历（大促/直播/跨境时差/排班模板）
CREATE TABLE IF NOT EXISTS hr_calendars (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  calendar_type TEXT NOT NULL CHECK(calendar_type IN ('campaign', 'livestream', 'shift', 'crossborder_timezone', 'holiday', 'training')),
  start_date TEXT,
  end_date TEXT,
  payload TEXT DEFAULT '{}',  -- JSON 额外配置（如时区偏移、班次类型、促销规则）
  is_recurring INTEGER DEFAULT 0,
  is_sandbox INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- H5: 离职风险评分（考勤异常+绩效下滑+加班超限）
CREATE TABLE IF NOT EXISTS hr_retention_risks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  assessment_date TEXT NOT NULL,
  attendance_risk REAL DEFAULT 0,
  performance_risk REAL DEFAULT 0,
  overtime_risk REAL DEFAULT 0,
  total_risk_score REAL DEFAULT 0,
  risk_level TEXT DEFAULT 'low' CHECK(risk_level IN ('low', 'medium', 'high', 'critical')),
  factors TEXT DEFAULT '[]',
  is_acknowledged INTEGER DEFAULT 0,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(employee_id, assessment_date)
);

-- RACI 责任人矩阵
CREATE TABLE IF NOT EXISTS raci_matrix (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('objective', 'goal', 'strategy', 'measure', 'project', 'task')),
  entity_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  responsibility TEXT NOT NULL CHECK(responsibility IN ('R', 'A', 'C', 'I')),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(entity_type, entity_id, user_id)
);

-- 激励机制
CREATE TABLE IF NOT EXISTS incentives (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('bonus', 'commission', 'promotion', 'recognition', 'penalty')),
  description TEXT,
  rules TEXT DEFAULT '{}',
  target_type TEXT CHECK(target_type IN ('individual', 'team', 'department', 'company')),
  target_id TEXT,
  amount REAL,
  currency TEXT DEFAULT 'CNY',
  status TEXT DEFAULT 'active' CHECK(status IN ('draft', 'active', 'expired', 'cancelled')),
  effective_from TEXT,
  effective_to TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS incentive_records (
  id TEXT PRIMARY KEY,
  incentive_id TEXT NOT NULL REFERENCES incentives(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount REAL NOT NULL,
  reason TEXT,
  period TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'paid', 'rejected')),
  approved_by TEXT REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

-- 激励规则引擎（V2 · I1）：结构化规则表，替代原 incentives.rules JSON 字段
CREATE TABLE IF NOT EXISTS incentive_rules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rule_type TEXT NOT NULL CHECK(rule_type IN ('commission', 'bonus', 'special', 'points')),
  description TEXT,
  -- 触发条件 JSON：{ trigger_type: 'always'|'order_threshold'|'achievement_threshold', threshold: number, metric?: string }
  trigger_config TEXT DEFAULT '{"trigger_type":"always"}',
  -- 计算式：支持 ${total_gmv} ${order_count} ${achievement_rate} ${profit} ${employee_count} 占位符
  formula TEXT NOT NULL,
  target_type TEXT CHECK(target_type IN ('individual', 'team', 'department', 'company')),
  target_id TEXT,
  min_payout REAL DEFAULT 0,
  max_payout REAL,
  priority INTEGER DEFAULT 0,
  effective_from TEXT,
  effective_to TEXT,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'draft', 'archived')),
  created_by TEXT REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- 3. 人力资源管理
-- ============================================================

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id),
  employee_no TEXT NOT NULL,
  name TEXT NOT NULL,
  gender TEXT CHECK(gender IN ('male', 'female', 'other')),
  birth_date TEXT,
  phone TEXT,
  email TEXT,
  id_card TEXT,
  department_id TEXT REFERENCES departments(id),
  position TEXT,
  job_level TEXT,
  employment_type TEXT DEFAULT 'full_time' CHECK(employment_type IN ('full_time', 'part_time', 'contract', 'intern', 'outsource')),
  hire_date TEXT,
  leave_date TEXT,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'probation', 'leave', 'resigned', 'terminated')),
  salary_base REAL,
  salary_structure TEXT DEFAULT '{}',
  skills TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(tenant_id, employee_no)
);

CREATE TABLE IF NOT EXISTS attendance_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  check_in TEXT,
  check_out TEXT,
  status TEXT DEFAULT 'normal' CHECK(status IN ('normal', 'late', 'early_leave', 'absent', 'leave', 'overtime', 'business_trip')),
  work_hours REAL DEFAULT 0,
  overtime_hours REAL DEFAULT 0,
  remark TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(employee_id, date)
);

-- ============================================================
-- 调休与休假管理
-- ============================================================

-- 加班记录（用于累积调休额度）
CREATE TABLE IF NOT EXISTS overtime_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  hours REAL NOT NULL,                 -- 加班时长（小时）
  reason TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'converted')),
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT,
  converted_to_leave REAL DEFAULT 0,   -- 已转为调休的时长
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(employee_id, date, start_time)
);

-- 休假类型（年假/事假/病假/调休/婚假/产假等）
CREATE TABLE IF NOT EXISTS leave_types (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                   -- 如：调休、年假、事假、病假
  category TEXT DEFAULT 'other' CHECK(category IN ('annual', 'sick', 'personal', 'compensatory', 'marriage', 'maternity', 'paternity', 'bereavement', 'other')),
  is_paid INTEGER DEFAULT 1,           -- 是否带薪
  max_days_per_year REAL,              -- 年上限天数（NULL=无限）
  min_hours_per_application REAL DEFAULT 0.5,  -- 最小申请时长（小时）
  approval_required INTEGER DEFAULT 1,
  need_attachment INTEGER DEFAULT 0,   -- 是否需要附件（如病假证明）
  overtime_source INTEGER DEFAULT 0,   -- 是否来源于加班时长（调休=1）
  icon TEXT,
  color TEXT,
  sort_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 员工休假余额（按类型累计）
CREATE TABLE IF NOT EXISTS leave_balances (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id TEXT NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,               -- 年度（如 2026）
  total_hours REAL DEFAULT 0,          -- 总额度（小时）
  used_hours REAL DEFAULT 0,           -- 已使用（小时）
  remaining_hours REAL DEFAULT 0,      -- 剩余（小时）
  source TEXT DEFAULT 'system',        -- 来源：system/import/manual
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(employee_id, leave_type_id, year)
);

-- 调休有效期：结转额度默认在转入年度年底过期（如 2025 结转至 2026 → 2026-12-31）
-- 幂等迁移，老库二次启动自动跳过
ALTER TABLE leave_balances ADD COLUMN expires_at TEXT;

-- 休假申请表
CREATE TABLE IF NOT EXISTS leave_applications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id TEXT NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  start_datetime TEXT NOT NULL,
  end_datetime TEXT NOT NULL,
  total_hours REAL NOT NULL,
  reason TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'cancelled', 'taken')),
  submitted_at TEXT DEFAULT (datetime('now')),
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT,
  rejected_reason TEXT,
  cancelled_at TEXT,
  -- 调休关联：从哪条加班记录转换而来
  overtime_record_id TEXT REFERENCES overtime_records(id),
  attachment_path TEXT,                 -- 附件路径（病假证明等）
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS performance_reviews (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  reviewer_id TEXT REFERENCES users(id),
  period TEXT NOT NULL,
  cycle TEXT DEFAULT 'monthly' CHECK(cycle IN ('weekly', 'monthly', 'quarterly', 'semi_annual', 'annual')),
  score REAL,
  rating TEXT CHECK(rating IN ('S', 'A', 'B', 'C', 'D')),
  kpi_data TEXT DEFAULT '{}',
  strengths TEXT,
  improvements TEXT,
  goals_next TEXT,
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'self_review', 'manager_review', 'completed', 'acknowledged')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payroll_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  base_salary REAL DEFAULT 0,
  bonus REAL DEFAULT 0,
  commission REAL DEFAULT 0,
  overtime_pay REAL DEFAULT 0,
  allowance REAL DEFAULT 0,
  deductions REAL DEFAULT 0,
  social_insurance REAL DEFAULT 0,
  housing_fund REAL DEFAULT 0,
  tax REAL DEFAULT 0,
  net_salary REAL DEFAULT 0,
  details TEXT DEFAULT '{}',
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'calculated', 'approved', 'paid')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(employee_id, period)
);

-- 人效分析指标
CREATE TABLE IF NOT EXISTS efficiency_metrics (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  scope TEXT DEFAULT 'company' CHECK(scope IN ('company', 'department', 'team', 'individual')),
  scope_id TEXT,
  revenue REAL DEFAULT 0,
  headcount INTEGER DEFAULT 0,
  revenue_per_capita REAL DEFAULT 0,
  profit_per_capita REAL DEFAULT 0,
  cost_per_capita REAL DEFAULT 0,
  order_count INTEGER DEFAULT 0,
  orders_per_capita REAL DEFAULT 0,
  gmv REAL DEFAULT 0,
  gmv_per_capita REAL DEFAULT 0,
  extra_metrics TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(tenant_id, period, scope, scope_id)
);

-- ============================================================
-- 4. 电商业务链（立项→选品→组盘→订单→客服）
-- ============================================================

-- 项目管理（立项）
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  description TEXT,
  business_type TEXT NOT NULL CHECK(business_type IN ('live_commerce', 'cross_border', 'traditional', 'o2o', 'new_media')),
  platform TEXT,
  owner_id TEXT REFERENCES users(id),
  department_id TEXT REFERENCES departments(id),
  budget REAL,
  actual_cost REAL DEFAULT 0,
  expected_revenue REAL,
  start_date TEXT,
  end_date TEXT,
  status TEXT DEFAULT 'planning' CHECK(status IN ('planning', 'approved', 'in_progress', 'paused', 'completed', 'cancelled')),
  priority TEXT DEFAULT 'medium' CHECK(priority IN ('critical', 'high', 'medium', 'low')),
  tags TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(tenant_id, code)
);

-- 选品管理
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id),
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  brand TEXT,
  description TEXT,
  source_platform TEXT,
  source_url TEXT,
  cost_price REAL,
  selling_price REAL,
  market_price REAL,
  margin_rate REAL,
  stock INTEGER DEFAULT 0,
  min_stock INTEGER DEFAULT 0,
  supplier_id TEXT,
  supplier_name TEXT,
  images TEXT DEFAULT '[]',
  attributes TEXT DEFAULT '{}',
  status TEXT DEFAULT 'candidate' CHECK(status IN ('candidate', 'selected', 'listed', 'out_of_stock', 'discontinued')),
  selection_score REAL,
  selection_reason TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(tenant_id, sku)
);

-- 组盘管理（商品组合/套餐）
CREATE TABLE IF NOT EXISTS product_bundles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id),
  name TEXT NOT NULL,
  description TEXT,
  bundle_type TEXT DEFAULT 'combo' CHECK(bundle_type IN ('combo', 'gift', 'promotion', 'seasonal')),
  original_price REAL,
  bundle_price REAL,
  discount_rate REAL,
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'expired', 'cancelled')),
  effective_from TEXT,
  effective_to TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bundle_items (
  id TEXT PRIMARY KEY,
  bundle_id TEXT NOT NULL REFERENCES product_bundles(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity INTEGER DEFAULT 1,
  unit_price REAL,
  sort_order INTEGER DEFAULT 0,
  UNIQUE(bundle_id, product_id)
);

-- 订单管理
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id),
  order_no TEXT NOT NULL,
  platform TEXT,
  platform_order_id TEXT,
  customer_name TEXT,
  customer_phone TEXT,
  customer_email TEXT,
  shipping_address TEXT,
  items TEXT DEFAULT '[]',
  subtotal REAL DEFAULT 0,
  discount REAL DEFAULT 0,
  shipping_fee REAL DEFAULT 0,
  tax REAL DEFAULT 0,
  total_amount REAL DEFAULT 0,
  paid_amount REAL DEFAULT 0,
  payment_method TEXT,
  payment_status TEXT DEFAULT 'unpaid' CHECK(payment_status IN ('unpaid', 'partial', 'paid', 'refunded', 'cancelled')),
  order_status TEXT DEFAULT 'pending' CHECK(order_status IN ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'completed', 'cancelled', 'returned', 'refunded')),
  shipping_no TEXT,
  shipping_company TEXT,
  shipped_at TEXT,
  delivered_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  cancel_reason TEXT,
  remark TEXT,
  is_sandbox INTEGER DEFAULT 0 CHECK(is_sandbox IN (0, 1)),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(tenant_id, order_no)
);

CREATE INDEX IF NOT EXISTS idx_orders_tenant_created ON orders(tenant_id, substr(created_at, 1, 10));
CREATE INDEX IF NOT EXISTS idx_orders_platform ON orders(tenant_id, platform);
CREATE INDEX IF NOT EXISTS idx_orders_payment ON orders(tenant_id, payment_status, substr(created_at, 1, 7));
CREATE INDEX IF NOT EXISTS idx_orders_sandbox ON orders(tenant_id, is_sandbox);
-- 注意：idx_orders_owner 引用 owner_employee_id 列，该列在下方 ALTER TABLE 段追加，
-- 因此索引创建已移至 ALTER TABLE 之后（见 1164 行附近），避免在全新数据库上触发
-- "no such column: owner_employee_id" 导致初始化失败。

-- 客服工单
CREATE TABLE IF NOT EXISTS service_tickets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ticket_no TEXT NOT NULL,
  order_id TEXT REFERENCES orders(id),
  customer_name TEXT,
  customer_contact TEXT,
  channel TEXT DEFAULT 'online' CHECK(channel IN ('online', 'phone', 'email', 'wechat', 'platform')),
  category TEXT DEFAULT 'inquiry' CHECK(category IN ('inquiry', 'complaint', 'return', 'exchange', 'refund', 'logistics', 'after_sales', 'other')),
  subject TEXT NOT NULL,
  description TEXT,
  priority TEXT DEFAULT 'normal' CHECK(priority IN ('urgent', 'high', 'normal', 'low')),
  assigned_to TEXT REFERENCES users(id),
  status TEXT DEFAULT 'open' CHECK(status IN ('open', 'in_progress', 'waiting_customer', 'resolved', 'closed', 'reopened')),
  resolution TEXT,
  satisfaction_score INTEGER CHECK(satisfaction_score >= 1 AND satisfaction_score <= 5),
  first_response_at TEXT,
  resolved_at TEXT,
  closed_at TEXT,
  tags TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(tenant_id, ticket_no)
);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES service_tickets(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK(sender_type IN ('customer', 'agent', 'system')),
  sender_id TEXT,
  content TEXT NOT NULL,
  attachments TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now'))
);

-- 结算对账
CREATE TABLE IF NOT EXISTS settlements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id),
  period TEXT NOT NULL,
  platform TEXT,
  total_orders INTEGER DEFAULT 0,
  total_amount REAL DEFAULT 0,
  platform_fee REAL DEFAULT 0,
  shipping_cost REAL DEFAULT 0,
  refund_amount REAL DEFAULT 0,
  net_amount REAL DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'reconciling', 'confirmed', 'disputed', 'settled')),
  reconciled_by TEXT REFERENCES users(id),
  reconciled_at TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- 5. 知识库与技能中心
-- ============================================================

CREATE TABLE IF NOT EXISTS knowledge_bases (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT DEFAULT 'general' CHECK(type IN ('general', 'product', 'process', 'faq', 'training', 'policy')),
  visibility TEXT DEFAULT 'tenant' CHECK(visibility IN ('private', 'team', 'tenant', 'public')),
  owner_id TEXT REFERENCES users(id),
  doc_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'archived')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id TEXT PRIMARY KEY,
  kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT,
  content_type TEXT DEFAULT 'markdown' CHECK(content_type IN ('markdown', 'html', 'plain', 'json')),
  category TEXT,
  tags TEXT DEFAULT '[]',
  author_id TEXT REFERENCES users(id),
  version INTEGER DEFAULT 1,
  status TEXT DEFAULT 'published' CHECK(status IN ('draft', 'published', 'archived')),
  view_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  category TEXT DEFAULT 'custom' CHECK(category IN ('system', 'custom', 'marketplace')),
  trigger_keywords TEXT DEFAULT '[]',
  input_schema TEXT DEFAULT '{}',
  output_schema TEXT DEFAULT '{}',
  execution_config TEXT DEFAULT '{}',
  version TEXT DEFAULT '1.0.0',
  author_id TEXT REFERENCES users(id),
  status TEXT DEFAULT 'active' CHECK(status IN ('draft', 'active', 'deprecated', 'disabled', 'system')),
  usage_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(tenant_id, slug)
);

CREATE TABLE IF NOT EXISTS skill_executions (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id),
  input TEXT DEFAULT '{}',
  output TEXT,
  status TEXT DEFAULT 'running' CHECK(status IN ('running', 'completed', 'failed', 'cancelled')),
  error_message TEXT,
  duration_ms INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

-- ============================================================
-- 6. 连接器管理
-- ============================================================

CREATE TABLE IF NOT EXISTS connectors (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('dingtalk', 'feishu', 'email', 'wechat_work', 'custom')),
  description TEXT,
  config TEXT DEFAULT '{}',
  credentials TEXT DEFAULT '{}',
  status TEXT DEFAULT 'disconnected' CHECK(status IN ('connected', 'disconnected', 'error', 'expired')),
  last_sync_at TEXT,
  sync_interval_minutes INTEGER DEFAULT 60,
  created_by TEXT REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(tenant_id, type)
);

CREATE TABLE IF NOT EXISTS connector_sync_logs (
  id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  sync_type TEXT NOT NULL,
  status TEXT DEFAULT 'running' CHECK(status IN ('running', 'success', 'failed', 'partial')),
  records_synced INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

-- ============================================================
-- 7. 对话式工作流
-- ============================================================

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT DEFAULT '新对话',
  context_type TEXT DEFAULT 'general' CHECK(context_type IN ('general', 'hr', 'business', 'ogsm', 'knowledge', 'skill')),
  context_id TEXT,
  message_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'archived', 'deleted')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT NOT NULL,
  metadata TEXT DEFAULT '{}',
  tokens_used INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- 7.5 对话引擎会话 (Dialog Sessions)
-- ============================================================

CREATE TABLE IF NOT EXISTS dialog_sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT DEFAULT '新对话',
  message_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'archived')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dialog_sessions_user ON dialog_sessions(user_id, status);

CREATE TABLE IF NOT EXISTS dialog_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES dialog_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'tool')),
  content TEXT NOT NULL,
  metadata TEXT DEFAULT '{}',
  action_type TEXT,
  action_status TEXT CHECK(action_status IN ('pending', 'executing', 'done', 'error')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dialog_messages_session ON dialog_messages(session_id);

-- ============================================================
-- 8. 系统配置与通知
-- ============================================================

CREATE TABLE IF NOT EXISTS system_settings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  updated_by TEXT REFERENCES users(id),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(tenant_id, key)
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT,
  type TEXT DEFAULT 'info' CHECK(type IN ('info', 'success', 'warning', 'error', 'action_required')),
  resource_type TEXT,
  resource_id TEXT,
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- 9. 商业化账号体系（许可/订阅/配额/设备/验证）
-- ============================================================

-- 许可证表（离线激活码，适用于桌面应用分发）
CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY,
  license_key TEXT NOT NULL UNIQUE,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
  plan TEXT NOT NULL DEFAULT 'free' CHECK(plan IN ('free', 'trial', 'standard', 'professional', 'enterprise')),
  type TEXT NOT NULL DEFAULT 'subscription' CHECK(type IN ('subscription', 'perpetual', 'trial', 'educational')),
  max_users INTEGER DEFAULT 5,
  max_devices INTEGER DEFAULT 1,
  max_storage_mb INTEGER DEFAULT 500,
  max_api_calls_per_day INTEGER DEFAULT 1000,
  features TEXT DEFAULT '[]',
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'expired', 'revoked')),
  issued_to TEXT,
  issued_by TEXT,
  issued_at TEXT DEFAULT (datetime('now')),
  activated_at TEXT,
  expires_at TEXT,
  revoked_at TEXT,
  revoke_reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 订阅表（在线订阅管理）
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'free' CHECK(plan IN ('free', 'trial', 'standard', 'professional', 'enterprise')),
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'trialing', 'past_due', 'canceled', 'expired')),
  billing_cycle TEXT DEFAULT 'monthly' CHECK(billing_cycle IN ('monthly', 'quarterly', 'annual', 'lifetime')),
  amount REAL DEFAULT 0,
  currency TEXT DEFAULT 'CNY',
  trial_started_at TEXT,
  trial_ends_at TEXT,
  current_period_start TEXT,
  current_period_end TEXT,
  canceled_at TEXT,
  payment_method TEXT,
  payment_id TEXT,
  auto_renew INTEGER DEFAULT 1,
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 用量追踪表（按天聚合，用于配额检查）
CREATE TABLE IF NOT EXISTS usage_tracking (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  api_calls INTEGER DEFAULT 0,
  storage_used_mb REAL DEFAULT 0,
  active_users INTEGER DEFAULT 0,
  employees INTEGER DEFAULT 0,
  orders INTEGER DEFAULT 0,
  ai_messages INTEGER DEFAULT 0,
  skill_executions INTEGER DEFAULT 0,
  extra_metrics TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(tenant_id, date)
);

-- 设备注册表（设备绑定与激活管理）
CREATE TABLE IF NOT EXISTS device_registrations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  device_name TEXT,
  device_type TEXT DEFAULT 'desktop' CHECK(device_type IN ('desktop', 'laptop', 'server', 'mobile', 'other')),
  os_platform TEXT,
  os_version TEXT,
  app_version TEXT,
  machine_fingerprint TEXT,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'deactivated', 'blocked')),
  first_activated_at TEXT DEFAULT (datetime('now')),
  last_active_at TEXT DEFAULT (datetime('now')),
  deactivated_at TEXT,
  UNIQUE(tenant_id, device_id)
);

-- 密码重置令牌
CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 邮箱验证令牌
CREATE TABLE IF NOT EXISTS email_verifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  verified INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 登录尝试追踪（防暴力破解）
CREATE TABLE IF NOT EXISTS login_attempts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  ip_address TEXT,
  device_id TEXT,
  success INTEGER DEFAULT 0,
  failure_reason TEXT,
  attempted_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- 索引优化
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(tenant_id, role);
CREATE INDEX IF NOT EXISTS idx_users_department ON users(department_id);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_time ON audit_logs(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_ogsm_obj_tenant ON ogsm_objectives(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_ogsm_obj_owner ON ogsm_objectives(owner_id);
CREATE INDEX IF NOT EXISTS idx_ogsm_obj_parent ON ogsm_objectives(parent_id);
CREATE INDEX IF NOT EXISTS idx_ogsm_goals_obj ON ogsm_goals(objective_id);
CREATE INDEX IF NOT EXISTS idx_ogsm_strategies_goal ON ogsm_strategies(goal_id);
CREATE INDEX IF NOT EXISTS idx_ogsm_measures_strategy ON ogsm_measures(strategy_id);
CREATE INDEX IF NOT EXISTS idx_raci_entity ON raci_matrix(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_raci_user ON raci_matrix(user_id);

CREATE INDEX IF NOT EXISTS idx_employees_tenant ON employees(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_employees_dept ON employees(department_id);
CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON attendance_records(employee_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_tenant_date ON attendance_records(tenant_id, date);
CREATE INDEX IF NOT EXISTS idx_performance_employee ON performance_reviews(employee_id, period);
CREATE INDEX IF NOT EXISTS idx_payroll_employee ON payroll_records(employee_id, period);

CREATE INDEX IF NOT EXISTS idx_projects_tenant ON projects(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_products_tenant ON products(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_products_project ON products(project_id);
CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders(tenant_id, order_status);
CREATE INDEX IF NOT EXISTS idx_orders_project ON orders(project_id);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tickets_tenant ON service_tickets(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned ON service_tickets(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_tickets_order ON service_tickets(order_id);
CREATE INDEX IF NOT EXISTS idx_settlements_tenant ON settlements(tenant_id, period);

CREATE INDEX IF NOT EXISTS idx_knowledge_docs_kb ON knowledge_documents(kb_id, status);
CREATE INDEX IF NOT EXISTS idx_skills_tenant ON skills(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_connectors_tenant ON connectors(tenant_id, type);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, status);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at);

-- Additional indexes for performance (added in v0.1.0 audit)
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id, revoked);
CREATE INDEX IF NOT EXISTS idx_skill_executions_skill ON skill_executions(skill_id, created_at);
CREATE INDEX IF NOT EXISTS idx_skill_executions_tenant ON skill_executions(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_settlements_project ON settlements(project_id);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON ticket_messages(ticket_id, created_at);
CREATE INDEX IF NOT EXISTS idx_efficiency_metrics_lookup ON efficiency_metrics(tenant_id, period);

-- Commercialization indexes
CREATE INDEX IF NOT EXISTS idx_licenses_key ON licenses(license_key);
CREATE INDEX IF NOT EXISTS idx_licenses_tenant ON licenses(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_licenses_expiry ON licenses(expires_at, status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant ON subscriptions(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_usage_tenant_date ON usage_tracking(tenant_id, date);
CREATE INDEX IF NOT EXISTS idx_devices_tenant ON device_registrations(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_devices_user ON device_registrations(user_id, status);
CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token_hash, used, expires_at);
CREATE INDEX IF NOT EXISTS idx_email_verifs_token ON email_verifications(token_hash, verified);
CREATE INDEX IF NOT EXISTS idx_login_attempts_username ON login_attempts(username, attempted_at);

-- Add email_verified column to users (safe migration for existing databases)
-- Note: SQLite doesn't support IF NOT EXISTS for ALTER TABLE ADD COLUMN, so we use a pragma check
-- This will be executed by the migration system or manually for existing databases
-- For new databases, the column is already in the CREATE TABLE statement above

-- ============================================================
-- 邮箱连接器扩展（email connector + 委托权限）
-- ============================================================

-- 邮箱连接器配置
CREATE TABLE IF NOT EXISTS email_connectors (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('smtp', 'imap', 'api')),
  config TEXT NOT NULL DEFAULT '{}',
  status TEXT DEFAULT 'disconnected' CHECK(status IN ('connected', 'disconnected', 'error', 'pending')),
  email_address TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(tenant_id, provider)
);

-- 邮箱同步日志
CREATE TABLE IF NOT EXISTS email_sync_logs (
  id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL REFERENCES email_connectors(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN ('sync_inbox', 'sync_sent', 'send', 'receive')),
  status TEXT NOT NULL CHECK(status IN ('success', 'failed')),
  details TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 委托权限点（对标钉钉）
CREATE TABLE IF NOT EXISTS delegated_permissions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  delegator_id TEXT NOT NULL REFERENCES users(id),
  delegatee_id TEXT NOT NULL REFERENCES users(id),
  scope TEXT NOT NULL CHECK(scope IN ('orders', 'products', 'inventory', 'ogsm', 'hr', 'all')),
  permission_point TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(tenant_id, delegator_id, delegatee_id, permission_point)
);

-- 邮箱连接器索引
CREATE INDEX IF NOT EXISTS idx_email_connectors_tenant ON email_connectors(tenant_id, provider);
CREATE INDEX IF NOT EXISTS idx_email_connectors_status ON email_connectors(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_email_sync_connector ON email_sync_logs(connector_id, created_at);
CREATE INDEX IF NOT EXISTS idx_email_sync_tenant ON email_sync_logs(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_delegated_permissions_tenant ON delegated_permissions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_delegated_permissions_delegatee ON delegated_permissions(tenant_id, delegatee_id);
CREATE INDEX IF NOT EXISTS idx_delegated_permissions_delegator ON delegated_permissions(tenant_id, delegator_id);

-- ============================================================
-- 10. 跨境电商扩展（Cross-Border Trade）
-- HS Code、原产国、申报价值、VAT/IOSS/EORI、多币种汇率快照
-- 所有 ALTER TABLE 都是向后兼容的非破坏性变更
-- ============================================================

-- 商品跨境字段（追加到现有 products 表）
ALTER TABLE products ADD COLUMN hs_code TEXT;
ALTER TABLE products ADD COLUMN origin_country TEXT;
ALTER TABLE products ADD COLUMN declared_value REAL DEFAULT 0;
ALTER TABLE products ADD COLUMN is_prohibited INTEGER DEFAULT 0;
ALTER TABLE products ADD COLUMN product_weight_kg REAL DEFAULT 0;

-- 订单跨境字段（追加到现有 orders 表）
ALTER TABLE orders ADD COLUMN vat_amount REAL DEFAULT 0;
ALTER TABLE orders ADD COLUMN vat_rate REAL DEFAULT 0;
ALTER TABLE orders ADD COLUMN vat_number TEXT;
ALTER TABLE orders ADD COLUMN ioss_number TEXT;
ALTER TABLE orders ADD COLUMN eori_number TEXT;
ALTER TABLE orders ADD COLUMN destination_country TEXT;
ALTER TABLE orders ADD COLUMN shipping_method TEXT;
ALTER TABLE orders ADD COLUMN exchange_rate REAL DEFAULT 1.0;
ALTER TABLE orders ADD COLUMN currency_code TEXT DEFAULT 'CNY';

-- 多币种汇率快照表
CREATE TABLE IF NOT EXISTS exchange_rates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_currency TEXT NOT NULL,
  to_currency TEXT NOT NULL,
  rate REAL NOT NULL,
  effective_date TEXT NOT NULL,
  source TEXT DEFAULT 'manual',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_tenant_date ON exchange_rates(tenant_id, effective_date);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_pair ON exchange_rates(tenant_id, from_currency, to_currency, effective_date);

-- 跨境索引
CREATE INDEX IF NOT EXISTS idx_products_hs_code ON products(hs_code);
CREATE INDEX IF NOT EXISTS idx_orders_destination ON orders(destination_country);
CREATE INDEX IF NOT EXISTS idx_orders_currency ON orders(currency_code);

-- ============================================================
-- 11. 直播电商（Live Commerce）
-- 场次 / 脚本 / 选品排期 / 实时指标 / 主播绩效 / 复盘
-- ============================================================

CREATE TABLE IF NOT EXISTS live_sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id),
  title TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'douyin',
  room_id TEXT,
  anchor_employee_id TEXT REFERENCES employees(id),
  assistant_employee_id TEXT REFERENCES employees(id),
  planned_start TEXT,
  planned_end TEXT,
  actual_start TEXT,
  actual_end TEXT,
  duration_minutes INTEGER DEFAULT 0,
  target_gmv REAL DEFAULT 0,
  actual_gmv REAL DEFAULT 0,
  target_orders INTEGER DEFAULT 0,
  actual_orders INTEGER DEFAULT 0,
  status TEXT DEFAULT 'planned' CHECK(status IN ('planned','ready','living','ended','reviewed','cancelled')),
  cover_url TEXT,
  remark TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS live_scripts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  segment_no INTEGER NOT NULL DEFAULT 1,
  segment_type TEXT DEFAULT 'sell' CHECK(segment_type IN ('warmup','sell','interact','flashsale','lottery','closing')),
  title TEXT NOT NULL,
  product_id TEXT REFERENCES products(id),
  duration_minutes INTEGER DEFAULT 5,
  talk_track TEXT,
  selling_points TEXT DEFAULT '[]',
  objection_handling TEXT DEFAULT '[]',
  cta_text TEXT,
  compliance_flags TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS live_session_products (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  planned_slot_start TEXT,
  planned_duration_minutes INTEGER DEFAULT 5,
  live_price REAL,
  stock_locked INTEGER DEFAULT 0,
  explained_count INTEGER DEFAULT 0,
  sold_qty INTEGER DEFAULT 0,
  gmv REAL DEFAULT 0,
  conversion_rate REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(session_id, product_id)
);

CREATE TABLE IF NOT EXISTS live_metrics (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  captured_at TEXT NOT NULL DEFAULT (datetime('now')),
  online_users INTEGER DEFAULT 0,
  cumulative_uv INTEGER DEFAULT 0,
  new_followers INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  cart_clicks INTEGER DEFAULT 0,
  orders INTEGER DEFAULT 0,
  gmv REAL DEFAULT 0,
  avg_stay_seconds REAL DEFAULT 0,
  source TEXT DEFAULT 'manual'
);

CREATE TABLE IF NOT EXISTS live_reviews (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  gmv_achievement_rate REAL DEFAULT 0,
  uv_value REAL DEFAULT 0,
  conversion_rate REAL DEFAULT 0,
  avg_stay_seconds REAL DEFAULT 0,
  best_product_id TEXT REFERENCES products(id),
  worst_product_id TEXT REFERENCES products(id),
  highlights TEXT DEFAULT '[]',
  problems TEXT DEFAULT '[]',
  actions TEXT DEFAULT '[]',
  anchor_score REAL DEFAULT 0,
  reviewer_id TEXT REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(session_id)
);

CREATE INDEX IF NOT EXISTS idx_live_sessions_tenant ON live_sessions(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_live_sessions_anchor ON live_sessions(tenant_id, anchor_employee_id);
CREATE INDEX IF NOT EXISTS idx_live_sessions_time ON live_sessions(tenant_id, planned_start);
CREATE INDEX IF NOT EXISTS idx_live_scripts_session ON live_scripts(session_id, segment_no);
CREATE INDEX IF NOT EXISTS idx_live_products_session ON live_session_products(session_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_live_metrics_session ON live_metrics(session_id, captured_at);

-- 直播脚本合规报告历史（LC-02：checkScriptCompliance 结果落库）
CREATE TABLE IF NOT EXISTS compliance_reports (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  scanned_segments INTEGER DEFAULT 0,
  total_issues INTEGER DEFAULT 0,
  high_count INTEGER DEFAULT 0,
  medium_count INTEGER DEFAULT 0,
  low_count INTEGER DEFAULT 0,
  passed INTEGER DEFAULT 0,
  issues TEXT DEFAULT '[]',
  by_category TEXT DEFAULT '[]',
  checked_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_compliance_reports_session ON compliance_reports(session_id, checked_at DESC);

-- ============================================================
-- 12. 平台对接（Platform Integration）
-- 抖店 / Amazon SP-API / 淘宝 / 京东 / 快手 / Shopify 统一适配层
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_connections (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK(platform IN ('douyin','amazon','taobao','jd','kuaishou','shopify','pdd','shopee','tiktok')),
  shop_name TEXT,
  shop_id TEXT,
  region TEXT,
  auth_mode TEXT DEFAULT 'oauth' CHECK(auth_mode IN ('oauth','apikey','manual')),
  app_key TEXT,
  app_secret_enc TEXT,
  access_token_enc TEXT,
  refresh_token_enc TEXT,
  token_expires_at TEXT,
  status TEXT DEFAULT 'disconnected' CHECK(status IN ('disconnected','connected','expired','error','sandbox')),
  last_error TEXT,
  last_sync_at TEXT,
  sync_interval_minutes INTEGER DEFAULT 30,
  capabilities TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(tenant_id, platform, shop_id)
);

CREATE TABLE IF NOT EXISTS platform_sync_jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES platform_connections(id) ON DELETE CASCADE,
  resource TEXT NOT NULL CHECK(resource IN ('orders','products','inventory','finance','reviews','logistics')),
  direction TEXT DEFAULT 'pull' CHECK(direction IN ('pull','push')),
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','running','success','failed','partial')),
  cursor TEXT,
  since_time TEXT,
  until_time TEXT,
  total_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS platform_sync_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id TEXT REFERENCES platform_sync_jobs(id) ON DELETE CASCADE,
  connection_id TEXT REFERENCES platform_connections(id) ON DELETE CASCADE,
  level TEXT DEFAULT 'info' CHECK(level IN ('info','warn','error')),
  message TEXT NOT NULL,
  payload TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_platform_conn_tenant ON platform_connections(tenant_id, platform);
CREATE INDEX IF NOT EXISTS idx_platform_jobs_conn ON platform_sync_jobs(connection_id, created_at);
CREATE INDEX IF NOT EXISTS idx_platform_logs_job ON platform_sync_logs(job_id, created_at);

-- 订单来源追溯（非破坏性追加）
ALTER TABLE orders ADD COLUMN source_connection_id TEXT;
ALTER TABLE orders ADD COLUMN live_session_id TEXT;
ALTER TABLE orders ADD COLUMN owner_employee_id TEXT;
ALTER TABLE orders ADD COLUMN is_crossborder INTEGER DEFAULT 0 CHECK(is_crossborder IN (0, 1));
CREATE INDEX IF NOT EXISTS idx_orders_live_session ON orders(live_session_id);
-- 补建 owner_employee_id 索引（该列由上方 ALTER TABLE 追加，索引须在其后创建，
-- 否则全新数据库初始化会因前向引用报 "no such column" 而失败）
CREATE INDEX IF NOT EXISTS idx_orders_owner ON orders(tenant_id, owner_employee_id);
-- DA-13: idx_orders_owner 已在 443 行定义为 (tenant_id, owner_employee_id)，此处移除重复的单列版本
-- CREATE INDEX IF NOT EXISTS idx_orders_owner ON orders(owner_employee_id);

-- ============================================================
-- 13. 库存预警（Inventory Alerting）
-- ============================================================

CREATE TABLE IF NOT EXISTS inventory_alert_rules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  scope TEXT DEFAULT 'all' CHECK(scope IN ('all','category','product')),
  scope_value TEXT,
  rule_type TEXT NOT NULL CHECK(rule_type IN ('low_stock','out_of_stock','overstock','slow_moving','stockout_eta')),
  threshold REAL NOT NULL DEFAULT 0,
  window_days INTEGER DEFAULT 7,
  severity TEXT DEFAULT 'warning' CHECK(severity IN ('info','warning','critical')),
  notify_channels TEXT DEFAULT '["inapp"]',
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inventory_alerts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rule_id TEXT REFERENCES inventory_alert_rules(id) ON DELETE SET NULL,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL,
  severity TEXT DEFAULT 'warning',
  current_stock INTEGER DEFAULT 0,
  threshold REAL DEFAULT 0,
  daily_sales_avg REAL DEFAULT 0,
  days_of_supply REAL,
  suggested_qty INTEGER DEFAULT 0,
  message TEXT,
  status TEXT DEFAULT 'open' CHECK(status IN ('open','acknowledged','resolved','ignored')),
  acknowledged_by TEXT REFERENCES users(id),
  resolved_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inv_rules_tenant ON inventory_alert_rules(tenant_id, enabled);
CREATE INDEX IF NOT EXISTS idx_inv_alerts_tenant ON inventory_alerts(tenant_id, status, severity);
CREATE INDEX IF NOT EXISTS idx_inv_alerts_product ON inventory_alerts(product_id, created_at);

-- ============================================================
-- 14. 业务-HR 打通（Attribution & Analytics）
-- 订单/GMV 归因到员工，驱动人效、绩效、激励闭环
-- ============================================================

CREATE TABLE IF NOT EXISTS performance_attributions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK(source_type IN ('order','live_session','ticket','project','bundle')),
  source_id TEXT NOT NULL,
  period TEXT NOT NULL,
  role_in_source TEXT,
  attribution_ratio REAL DEFAULT 1.0,
  gmv REAL DEFAULT 0,
  gross_profit REAL DEFAULT 0,
  order_count INTEGER DEFAULT 0,
  ticket_count INTEGER DEFAULT 0,
  computed_at TEXT DEFAULT (datetime('now')),
  UNIQUE(tenant_id, employee_id, source_type, source_id)
);

CREATE TABLE IF NOT EXISTS analytics_snapshots (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  metric_key TEXT NOT NULL,
  dimension TEXT DEFAULT 'total',
  dimension_value TEXT,
  period_type TEXT DEFAULT 'day' CHECK(period_type IN ('day','week','month','quarter','year')),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  value REAL DEFAULT 0,
  extra TEXT DEFAULT '{}',
  computed_at TEXT DEFAULT (datetime('now')),
  UNIQUE(tenant_id, metric_key, dimension, dimension_value, period_type, period_start)
);

CREATE INDEX IF NOT EXISTS idx_attr_tenant_emp ON performance_attributions(tenant_id, employee_id, period);
CREATE INDEX IF NOT EXISTS idx_attr_source ON performance_attributions(tenant_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_lookup ON analytics_snapshots(tenant_id, metric_key, period_type, period_start);

-- ============================================================
-- 14. 大促活动管理
-- ============================================================
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id),
  name TEXT NOT NULL,
  code TEXT,
  platform TEXT,
  campaign_type TEXT DEFAULT 'promotional' CHECK(campaign_type IN ('promotional', 'festival', 'flash_sale', 'new_user', 'clearance')),
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'paused', 'completed', 'cancelled')),
  start_date TEXT,
  end_date TEXT,
  discount_type TEXT CHECK(discount_type IN ('percentage', 'fixed', 'buy_one_get_one', 'tiered')),
  discount_value REAL DEFAULT 0,
  threshold_amount REAL DEFAULT 0,
  budget REAL DEFAULT 0,
  actual_spend REAL DEFAULT 0,
  target_gmv REAL,
  target_orders INTEGER DEFAULT 0,
  actual_gmv REAL DEFAULT 0,
  actual_orders INTEGER DEFAULT 0,
  description TEXT,
  conditions TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_campaigns_tenant ON campaigns(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_campaigns_period ON campaigns(tenant_id, start_date, end_date);

-- 活动商品关联
CREATE TABLE IF NOT EXISTS campaign_products (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  discount_type TEXT,
  discount_value REAL DEFAULT 0,
  priority INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(campaign_id, product_id)
);

-- ============================================================
-- 15. 投流记录
-- ============================================================
CREATE TABLE IF NOT EXISTS ad_spend (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK(platform IN ('douyin', 'taobao', 'jd', 'pdd', 'kuaishou', 'bilibili', 'other')),
  campaign_id TEXT REFERENCES campaigns(id),
  project_id TEXT REFERENCES projects(id),
  channel TEXT,
  plan_name TEXT,
  spend REAL NOT NULL DEFAULT 0,
  impression INTEGER DEFAULT 0,
  click INTEGER DEFAULT 0,
  cvr REAL DEFAULT 0,
  cpc REAL DEFAULT 0,
  cpm REAL DEFAULT 0,
  order_count INTEGER DEFAULT 0,
  gmv REAL DEFAULT 0,
  roi REAL DEFAULT 0,
  note TEXT,
  spend_date TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ad_spend_tenant ON ad_spend(tenant_id, spend_date);
CREATE INDEX IF NOT EXISTS idx_ad_spend_platform ON ad_spend(tenant_id, platform, spend_date);
CREATE INDEX IF NOT EXISTS idx_ad_spend_campaign ON ad_spend(campaign_id);

-- ============================================================
-- 16. 商品评价/DSR评分
-- ============================================================
CREATE TABLE IF NOT EXISTS product_reviews (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  order_id TEXT REFERENCES orders(id),
  user_id TEXT REFERENCES users(id),
  rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
  description TEXT,
  images TEXT DEFAULT '[]',
  is_anonymous INTEGER DEFAULT 0 CHECK(is_anonymous IN (0, 1)),
  seller_reply TEXT,
  reply_at TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'hidden')),
  helpful_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reviews_product ON product_reviews(product_id, status);
CREATE INDEX IF NOT EXISTS idx_reviews_tenant ON product_reviews(tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_reviews_user ON product_reviews(user_id, status);
-- DA-14: 以上 product_reviews 表及索引为唯一保留的定义；1333-1356 行重复定义已删除

-- ============================================================
-- 17. V2 采购供应链闭环（S1-S3）
--     供应商台账 / 采购单 / 采购明细 / 出入库流水
--     全部幂等 DDL，带 tenant_id 隔离，向后兼容
-- ============================================================

-- 17.1 供应商台账
CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT,
  name TEXT NOT NULL,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  address TEXT,
  category TEXT,
  grade TEXT DEFAULT 'B' CHECK(grade IN ('A', 'B', 'C', 'D')),
  payment_terms TEXT DEFAULT 'net30',
  lead_time_days INTEGER DEFAULT 7,
  rating REAL DEFAULT 0,
  on_time_rate REAL DEFAULT 0,
  total_purchase_amount REAL DEFAULT 0,
  currency TEXT DEFAULT 'CNY',
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'archived')),
  remark TEXT,
  is_sandbox INTEGER DEFAULT 0 CHECK(is_sandbox IN (0, 1)),
  created_by TEXT REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_suppliers_tenant ON suppliers(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_suppliers_grade ON suppliers(tenant_id, grade);

-- 17.2 采购单主表
CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  po_no TEXT NOT NULL,
  supplier_id TEXT REFERENCES suppliers(id),
  supplier_name TEXT,
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'submitted', 'approved', 'receiving', 'completed', 'cancelled')),
  source TEXT DEFAULT 'manual' CHECK(source IN ('manual', 'replenish_suggestion', 'import')),
  source_ref TEXT,
  total_amount REAL DEFAULT 0,
  received_amount REAL DEFAULT 0,
  currency TEXT DEFAULT 'CNY',
  expected_date TEXT,
  received_date TEXT,
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT,
  created_by TEXT REFERENCES users(id),
  remark TEXT,
  is_sandbox INTEGER DEFAULT 0 CHECK(is_sandbox IN (0, 1)),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_po_tenant ON purchase_orders(tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders(supplier_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_po_no ON purchase_orders(tenant_id, po_no);

-- 17.3 采购单明细
CREATE TABLE IF NOT EXISTS purchase_items (
  id TEXT PRIMARY KEY,
  purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES products(id),
  product_sku TEXT,
  product_name TEXT,
  quantity INTEGER NOT NULL DEFAULT 0,
  received_quantity INTEGER DEFAULT 0,
  qualified_quantity INTEGER DEFAULT 0,
  unit_price REAL NOT NULL DEFAULT 0,
  subtotal REAL DEFAULT 0,
  remark TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pitem_po ON purchase_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_pitem_product ON purchase_items(product_id);

-- 17.4 出入库流水（库存变动唯一真相源）
CREATE TABLE IF NOT EXISTS stock_transactions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_sku TEXT,
  product_name TEXT,
  txn_type TEXT NOT NULL CHECK(txn_type IN ('purchase_in', 'sale_out', 'return_in', 'return_out', 'adjust', 'transfer', 'scrap')),
  quantity INTEGER NOT NULL,
  stock_before INTEGER DEFAULT 0,
  stock_after INTEGER DEFAULT 0,
  unit_cost REAL DEFAULT 0,
  ref_type TEXT,
  ref_id TEXT,
  operator_id TEXT REFERENCES users(id),
  remark TEXT,
  is_sandbox INTEGER DEFAULT 0 CHECK(is_sandbox IN (0, 1)),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_stock_txn_tenant ON stock_transactions(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_txn_product ON stock_transactions(product_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_txn_ref ON stock_transactions(ref_type, ref_id);

-- ============================================================
-- 17.5 工作流编排（W5 可视化工作流 v1）
-- ============================================================
-- 工作流定义
CREATE TABLE IF NOT EXISTS workflow_definition (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'archived')),
  created_by TEXT REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wf_tenant ON workflow_definition(tenant_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wf_name ON workflow_definition(tenant_id, name);

-- 工作流节点
CREATE TABLE IF NOT EXISTS workflow_node (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflow_definition(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  node_type TEXT NOT NULL CHECK(node_type IN ('tool', 'condition', 'input', 'output')),
  tool_type TEXT,
  position TEXT DEFAULT '{"x":0,"y":0}',
  input_schema TEXT DEFAULT '{}',
  output_schema TEXT DEFAULT '{}',
  config TEXT DEFAULT '{}',
  retries INTEGER DEFAULT 1,
  timeout_seconds INTEGER DEFAULT 30,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wfnode_wf ON workflow_node(workflow_id);
CREATE INDEX IF NOT EXISTS idx_wfnode_type ON workflow_node(node_type);

-- 工作流边（DAG 有向边）
CREATE TABLE IF NOT EXISTS workflow_edge (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflow_definition(id) ON DELETE CASCADE,
  from_node_id TEXT NOT NULL REFERENCES workflow_node(id) ON DELETE CASCADE,
  to_node_id TEXT NOT NULL REFERENCES workflow_node(id) ON DELETE CASCADE,
  condition TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wfedge_wf ON workflow_edge(workflow_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wfedge_unique ON workflow_edge(workflow_id, from_node_id, to_node_id);

-- 工作流执行记录
CREATE TABLE IF NOT EXISTS workflow_run (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflow_definition(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'running' CHECK(status IN ('running', 'succeeded', 'failed', 'cancelled')),
  inputs TEXT DEFAULT '{}',
  outputs TEXT DEFAULT '{}',
  started_at TEXT DEFAULT (datetime('now')),
  finished_at TEXT,
  error TEXT,
  triggered_by TEXT REFERENCES users(id),
  triggered_by_type TEXT DEFAULT 'manual' CHECK(triggered_by_type IN ('manual', 'schedule', 'api', 'auto')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wfrun_wf ON workflow_run(workflow_id);
CREATE INDEX IF NOT EXISTS idx_wfrun_tenant ON workflow_run(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_wfrun_started ON workflow_run(started_at);

-- 工作流节点执行日志
CREATE TABLE IF NOT EXISTS workflow_run_log (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES workflow_run(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES workflow_node(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  input TEXT DEFAULT '{}',
  output TEXT DEFAULT '{}',
  error TEXT,
  retry_count INTEGER DEFAULT 0,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wfrunlog_run ON workflow_run_log(run_id);
CREATE INDEX IF NOT EXISTS idx_wfrunlog_node ON workflow_run_log(node_id);

-- C1: 退货工单闭环（售后工单 → 退货审批 → 退货入库 → 退款联动）
CREATE TABLE IF NOT EXISTS return_requests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ticket_id TEXT REFERENCES service_tickets(id),
  order_id TEXT REFERENCES orders(id),
  return_no TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'in_transit', 'received', 'refunded')),
  reason TEXT,
  return_items TEXT NOT NULL DEFAULT '[]',  -- JSON [{productId, sku, quantity, unitPrice}]
  refund_amount REAL DEFAULT 0,
  refund_method TEXT DEFAULT 'original',
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT,
  received_at TEXT,
  refunded_at TEXT,
  note TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- C2: 客户标签（定向营销 + 分层运营）
CREATE TABLE IF NOT EXISTS customer_tags (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL,
  customer_name TEXT,
  tag TEXT NOT NULL,
  category TEXT DEFAULT 'behavior' CHECK(category IN ('behavior', 'demographic', 'value', 'risk', 'custom')),
  score REAL DEFAULT 0,
  source TEXT DEFAULT 'manual',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(tenant_id, customer_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_return_orders ON return_requests(order_id);
CREATE INDEX IF NOT EXISTS idx_customer_tags_cid ON customer_tags(tenant_id, customer_id);

-- ============================================================
-- Agent 管理（P1：AgentConfig 后端落地）
-- ============================================================
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT DEFAULT 'custom',
  status TEXT DEFAULT 'idle' CHECK(status IN ('idle', 'running', 'paused', 'error', 'completed')),
  model TEXT,
  system_prompt TEXT,
  temperature REAL DEFAULT 0.3,
  max_tokens INTEGER DEFAULT 4096,
  config_json TEXT DEFAULT '{}',   -- { skills: [], experts: [], connectors: [] }
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agents_tenant ON agents(tenant_id);

-- ============================================================
-- LLM 平台管理（P1：LLMPlatformView 后端落地）
-- api_key_secret 使用 AES-256-GCM 加密存储（adapters/crypto.ts）
-- ============================================================
CREATE TABLE IF NOT EXISTS llm_platforms (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  base_url TEXT,
  api_key_secret TEXT,            -- 加密后的密钥，明文绝不落库
  models_json TEXT DEFAULT '[]',  -- 可用模型列表
  is_active INTEGER DEFAULT 1,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_llm_tenant ON llm_platforms(tenant_id);
