/**
 * HRMS + OGSM 类型系统
 * 人力资源管理系统 — 全链路电商业务适配
 */

// ─── OGSM ──────────────────────────────────

/** 电商业务形态 */
export type EcomScenario =
  | 'platform-ecom'     // 平台电商（淘宝/天猫/京东/拼多多）
  | 'live-stream'       // 直播电商（抖音/快手/视频号）
  | 'social-ecom'       // 社交电商（小红书/微信社群）
  | 'independent-site'  // 独立站（Shopify/自建站）

/** OGSM 层级类型 */
export type OgsmLevel = 'objective' | 'strategy' | 'goal' | 'measurement';

/** OGSM 项 */
export interface OgsmItem {
  id: string;              // 全局唯一 ID
  parentId: string | null; // 父级 ID（Objective 为 null）
  level: OgsmLevel;
  title: string;           // 标题
  description?: string;    // 描述
  scenario?: EcomScenario; // 适用业务场景
  status: OgsmStatus;
  orderIndex: number;      // 同级排序
  createdAt: string;
  updatedAt: string;
  // OGSM 各层专属字段
  objective?: string;      // O: 企业定性目标（一句话）
  strategy?: string;       // S: 策略描述
  target?: number;         // G: 量化目标值
  metric?: string;         // M: 衡量指标名称
  unit?: string;           // M: 单位
  baseline?: number;       // 基线值
  currentValue?: number;   // 当前值（实时更新）
}

/** OGSM 状态 */
export type OgsmStatus = 'planned' | 'in-progress' | 'achieved' | 'overdue' | 'archived';

/** 进度计算（用于 M 级项） */
export interface OgsmProgress {
  itemId: string;
  level: OgsmLevel;
  progress: number;        // 0-100
  calculatedAt: string;
}

// ─── 任务 ──────────────────────────────────

export interface Task {
  id: string;
  ogsmId?: string;         // 关联 OGSM 项 ID
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee?: string;       // 负责人（员工 ID）
  assigneeName?: string;   // 负责人姓名
  mentor?: string;         // 指导人（COE）
  approver?: string;       // 审批人
  dueDate?: string;        // 截止日期
  startDate?: string;      // 开始日期
  completedAt?: string;    // 完成时间
  scenario?: EcomScenario; // 适用业务场景
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  // 进度
  progress: number;        // 0-100
  subtasks: Subtask[];
  // 文件/附件（存储引用路径）
  attachments?: string[];
  // RACI
  raci?: RACIEntry[];
}

export type TaskStatus =
  | 'backlog'       // 待办池
  | 'todo'          // 待执行
  | 'in-progress'   // 进行中
  | 'review'        // 待验收
  | 'completed'     // 已完成
  | 'blocked'       // 阻塞
  | 'cancelled';    // 已取消

export type TaskPriority = 'urgent' | 'high' | 'medium' | 'low';

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
  assignee?: string;
}

// ─── RACI ──────────────────────────────────

export type RACIRole = 'R' | 'A' | 'C' | 'I';
export type RACIRoleLabel = '负责人' | '审批人' | '咨询人' | '知情人';

export interface RACIEntry {
  id: string;
  taskId: string;
  employeeId: string;
  employeeName: string;
  role: RACIRole;
  roleLabel: RACIRoleLabel;
}

/** RACI 矩阵视图项 */
export interface RACIMatrixRow {
  taskId: string;
  taskTitle: string;
  roles: Record<RACIRole, RACIEntry | null>;
}

// ─── 风险 ──────────────────────────────────

export interface Risk {
  id: string;
  taskId?: string;
  ogsmId?: string;
  title: string;
  description?: string;
  severity: RiskSeverity;
  status: RiskStatus;
  detectedAt: string;
  resolvedAt?: string;
  assignee?: string;
  assigneeName?: string;
  mitigationPlan?: string;
  impact?: string;
  likelihood: number;     // 0-1
  score: number;          // severity * likelihood
}

export type RiskSeverity = 'critical' | 'high' | 'medium' | 'low';
export type RiskStatus = 'open' | 'mitigating' | 'resolved' | 'accepted';

// ─── 激励 ──────────────────────────────────

export interface Incentive {
  id: string;
  taskId?: string;
  ogsmId?: string;
  type: IncentiveType;
  rule: string;           // 规则描述
  reward: RewardItem;     // 奖励明细
  eligible: string[];     // 适用人员（员工 ID）
  eligibilityCriteria?: string[];
  autoCalculate: boolean; // 是否自动计算
  effectiveFrom?: string; // 生效日期
  effectiveTo?: string;   // 失效日期
  status: 'active' | 'expired' | 'archived';
  createdAt: string;
}

export type IncentiveType = 'completion' | 'milestone' | 'quality' | 'extra-mile';

export interface RewardItem {
  type: 'cash' | 'bonus-points' | 'promotion' | 'recognition';
  amount?: number;        // 现金金额 / 积分
  description?: string;
}

/** 激励计算结果 */
export interface IncentiveResult {
  incentiveId: string;
  employeeId: string;
  employeeName: string;
  reward: RewardItem;
  calculatedAt: string;
  status: 'pending' | 'approved' | 'paid';
}

// ─── 试点与推广 ────────────────────────────

export interface Pilot {
  id: string;
  name: string;
  description?: string;
  ogsmIds: string[];       // 关联的 OGSM 目标
  scope: PilotScope;
  startDate: string;
  endDate?: string;
  status: PilotStatus;
  metrics: PilotMetric[];  // 跟踪指标
  result?: PilotResult;     // 验证报告
  rolloutPlan?: RolloutPlan;
  createdAt: string;
  updatedAt: string;
}

export type PilotScope = {
  department?: string;
  team?: string;
  scenarios: EcomScenario[];
  employeeCount?: number;
};

export type PilotStatus = 'planning' | 'running' | 'completed' | 'failed';

export interface PilotMetric {
  name: string;
  targetValue: number;
  actualValue: number;
  unit?: string;
}

export interface PilotResult {
  conclusion: string;
  recommendations: string[];
  generatedAt: string;
  coverageRate: number;
}

export interface RolloutPlan {
  phases: RolloutPhase[];
  coverageRate: number;    // 已推广覆盖率
  timeline: {
    start: string;
    end?: string;
  };
}

export interface RolloutPhase {
  phase: number;
  name: string;
  scope: string;
  targetEmployees: number;
  completedEmployees: number;
  status: 'planned' | 'in-progress' | 'completed' | 'failed';
}

// ─── 制度文档 ──────────────────────────────

export interface PolicyDocument {
  id: string;
  title: string;
  content?: string;        // Markdown 内容
  version: string;         // 版本号
  category: string;
  status: 'draft' | 'published' | 'archived';
  changeLog?: ChangeRecord[];
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

export interface ChangeRecord {
  version: string;
  change: string;
  changedBy: string;
  changedAt: string;
}

// ─── 三支柱 (COE / HRBP / SSC) ─────────────

export type HRPillar = 'coe' | 'hrbp' | 'ssc';
export type HRPillarLabel = 'COE 专家中心' | 'HRBP 业务伙伴' | 'SSC 共享服务中心';

export interface HREmployee {
  id: string;
  name: string;
  avatar?: string;
  department: string;
  position: string;
  pillar: HRPillar;
  pillarLabel: HRPillarLabel;
  email?: string;
  phone?: string;
  status: 'active' | 'inactive';
  skills?: string[];
  createdAt: string;
  /** 后端工号（V2·M2）。本地新建时由 id 派生，是前后端同步的幂等键 */
  employeeNo?: string;
  /** 最近一次成功回流后端的时间；为空表示该记录尚未进入后端 */
  syncedAt?: string;
}

export interface COEExpert extends HREmployee {
  expertise: string[];     // 专业领域
  mentorCount?: number;    // 指导人数
}

export interface HRBP extends HREmployee {
  businessUnits: string[]; // 对接业务线
  teamSize?: number;
}

export interface SSCMember extends HREmployee {
  serviceArea: string;     // 服务领域（薪酬/社保/档案）
}

// ─── 业务场景配置 ──────────────────────────

export interface ScenarioConfig {
  id: string;
  scenario: EcomScenario;
  label: string;
  description: string;
  defaultTasks: string[];  // 默认任务模板 ID
  defaultMetrics: string[]; // 默认衡量指标
  ogsmTemplates: string[]; // OGSM 模板 ID
  createdAt: string;
}

// ─── OGSM 完整树结构 ───────────────────────

export interface OgsmTreeNode {
  item: OgsmItem;
  children: OgsmTreeNode[];
  tasks?: Task[];
  risks?: Risk[];
  progress: number;
}

// ─── OGSM 视图模式 ─────────────────────────

export type OGSMViewMode = 'tree' | 'board' | 'gantt' | 'list';
