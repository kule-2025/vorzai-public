/**
 * Vorzai 电商 Agent — 全局类型定义
 * 电商行业 Agent 桌面应用核心数据模型
 */

// ────────── 主题 ──────────
export type Theme = 'light' | 'dark' | 'system';

// ────────── 用户/租户 ──────────
export interface Tenant {
  id: string;
  name: string;
  plan: 'free' | 'pro' | 'enterprise';
  maxAgents: number;
  maxConnectors: number;
  createdAt: string;
}

export interface UserProfile {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  avatar?: string;
  role: 'admin' | 'operator' | 'analyst' | 'viewer';
  permissions: string[];
  createdAt: string;
}

// ────────── 连接器（Connectors）───
export interface Connector {
  id: string;
  name: string;
  type: ConnectorType;
  status: ConnectorStatus;
  config: Record<string, unknown>;
  lastSyncAt?: string;
  errorMessage?: string;
}

export type ConnectorType =
  | 'hr-system'       // 人力系统对接
  | 'erp'             // ERP 系统
  | 'crm'             // CRM 系统
  | 'payment'         // 支付系统
  | 'logistics'       // 物流系统
  | 'platform-taobao' // 淘宝
  | 'platform-tmall'  // 天猫
  | 'platform-jd'     // 京东
  | 'platform-pdd'    // 拼多多
  | 'platform-douyin' // 抖音电商
  | 'platform-kuaishou' // 快手电商
  | 'platform-xiaohongshu' // 小红书
  | 'platform-shopify'  // Shopify 跨境
  | 'platform-amazon'    // Amazon 跨境
  | 'platform-email'     // 邮箱连接器
  | 'custom-webhook';

export type ConnectorStatus = 'connected' | 'disconnected' | 'syncing' | 'error';

// ────────── Agent / 智能体 ──────────
export interface Agent {
  id: string;
  name: string;
  description: string;
  type: AgentType;
  status: AgentStatus;
  config: AgentConfig;
  skills: string[];
  experts: string[];
  connectors: string[];
  createdAt: string;
  updatedAt: string;
}

export type AgentType =
  | 'hr-assistant'       // 人力助手
  | 'order-manager'      // 订单管理
  | 'inventory-analyst'  // 库存分析
  | 'marketing-agent'    // 营销助手
  | 'live-stream-host'   // 直播助手
  | 'cross-border-agent' // 跨境助手
  | 'finance-auditor'    // 财务审计
  | 'customer-service'   // 客服
  | 'custom';

export type AgentStatus = 'idle' | 'running' | 'paused' | 'error' | 'completed';

export interface AgentConfig {
  model: string;
  temperature?: number;
  systemPrompt: string;
  maxTokens?: number;
  retryCount?: number;
}

// ────────── 专家/技能 ──────────
export interface Expert {
  id: string;
  name: string;
  category: ExpertCategory;
  description: string;
  skills: string[];
  isActive: boolean;
  avatar?: string;
}

export type ExpertCategory =
  | 'legal'              // 法务专家团
  | 'hr-operations'      // 人力资源运营
  | 'live-stream'        // 直播电商运营
  | 'traditional-ecom'   // 传统电商运营
  | 'cross-border'       // 跨境电商运营
  | 'new-media'          // 新媒体电商运营
  | 'analytics'          // 数据分析
  | 'operations-director' // 经营总管
  | 'process-flow'       // 智能体流程
  | 'ai-coding';          // AICoding

export interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  version: string;
  isActive: boolean;
}

// ────────── 大模型 ──────────
export interface LLMPlatform {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  isActive: boolean;
  rateLimit?: number;
}

export interface LLMRequest {
  model: string;
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface LLMResponse {
  content: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  model: string;
}

// ────────── 业务数据 ──────────
export interface Order {
  id: string;
  orderNo: string;
  platform: string;
  status: OrderStatus;
  amount: number;
  currency: string;
  buyer: string;
  createdAt: string;
}

export type OrderStatus = 'pending' | 'paid' | 'shipped' | 'delivered' | 'completed' | 'cancelled' | 'refunded';

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  price: number;
  inventory: number;
  status: 'active' | 'inactive' | 'out-of-stock';
}

export interface AnalyticsMetric {
  period: string;
  revenue: number;
  orders: number;
  visitors: number;
  conversionRate: number;
  avgOrderValue: number;
  platformBreakdown: Record<string, number>;
}

// ────────── 应用状态 ──────────
export type CurrentView =
  | 'dashboard'        // 工作台
  | 'agent-config'     // Agent配置
  | 'analytics'        // 数据分析
  | 'hrms'             // HRMS 人力资源
  | 'business-chain'   // 业务链
  | 'growth-engine'    // 业务倍增
  | 'skill-center'     // 技能/专家中心
  | 'connectors'       // 连接器
  | 'llm-platform'     // 大模型平台
  | 'ogsm-board'       // OGSM 看板
  | 'import-export'    // 数据导入导出
  | 'tenant-admin'     // 多租户管理
  | 'settings'         // 系统设置
  | 'business-cockpit' // 业务驾驶舱
  | 'livestream'       // 直播电商
  | 'crossborder'      // 跨境电商
  | 'platform-hub'     // 平台对接中心
  | 'inventory-alerts' // 库存预警
  | 'procurement'      // 采购供应链
  | 'execution-monitor' // 执行监控面板（M3）
  | 'aftersales'        // 售后闭环
  | 'conversion'        // 转化与运营（C2/C3）
  | 'workflow-studio';  // 工作流编排（W5 前端入口，B1）

export interface AppState {
  currentView: CurrentView;
  theme: Theme;
  sidebarCollapsed: boolean;
  tenant: Tenant | null;
  user: UserProfile | null;
  agents: Agent[];
  connectors: Connector[];
  experts: Expert[];
  skills: Skill[];
  llmPlatforms: LLMPlatform[];
}

// ────────── 路由 ──────────
export interface RouteConfig {
  path: string;
  label: string;
  icon?: string;
  component: string;
  requiresAuth?: boolean;
  permissions?: string[];
}

// ────────── 事件总线 ──────────
export type EventName =
  | 'agent:status-change'
  | 'agent:running'
  | 'agent:completed'
  | 'agent:error'
  | 'connector:status-change'
  | 'connector:sync-complete'
  | 'connector:sync-error'
  | 'data:metric-update'
  | 'data:realtime-update'
  | 'ui:theme-change'
  | 'ui:sidebar-toggle'
  | 'llm:model-change'
  | 'llm:request'
  | 'llm:response';

export interface EventPayload {
  name: EventName;
  data: Record<string, unknown>;
  timestamp: string;
}

// ────────── 电商模块间通信协议 ──────────
export interface ModuleMessage {
  from: string;
  to: string;
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export * from './hrms';

export interface ModuleRegistry {
  [moduleId: string]: {
    name: string;
    version: string;
    endpoints: string[];
    events: string[];
    dependencies: string[];
  };
}
