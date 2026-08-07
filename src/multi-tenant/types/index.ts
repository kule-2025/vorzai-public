/**
 * 多租户隔离体系 — 类型系统
 * 覆盖租户、用户、权限、审计、安全策略、合规文档
 */

// ─── 租户基础 ───

export type TenantPlan = 'free' | 'starter' | 'pro' | 'enterprise' | 'whitelabel';

export interface TenantConfig {
  id: string;
  name: string;
  domain: string;
  plan: TenantPlan;
  logo?: string;
  contactEmail: string;
  contactPhone?: string;
  createdAt: string;
  updatedAt: string;
  status: 'active' | 'suspended' | 'disabled';
  isolation: {
    db: 'shared-schema' | 'shared-tenant-id' | 'dedicated-db' | 'dedicated-instance';
    storage: 'directory' | 'bucket';
    cache: 'namespace' | 'dedicated';
  };
  limits: {
    maxUsers: number;
    maxStorageGB: number;
    maxApiCalls: number;
    maxAgents: number;
  };
  features: string[]; // 已启用的功能特性
  settings: Record<string, unknown>;
}

// ─── 用户与身份 ───

export type TenantUserRole = 'super_admin' | 'tenant_admin' | 'dept_head' | 'member' | 'external_collaborator';

export interface TenantUser {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  avatar?: string;
  department: string;
  position: string;
  grade: number; // 职级 1-10
  role: TenantUserRole;
  roles: string[]; // 分配的角色 ID 列表
  permissions: string[]; // 直接权限列表
  status: 'active' | 'disabled' | 'pending' | 'invited';
  mfaEnabled: boolean;
  lastLogin?: string;
  lastIp?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── 认证 Token ───

export interface TenantToken {
  sub: string;       // userId
  tenantId: string;
  role: TenantUserRole;
  permissions: string[];
  iat: number;
  exp: number;
  jti: string;       // JWT ID（防重放）
  hmac: string;      // HMAC 签名
}

// ─── HMAC 签名的租户上下文 ───

export interface TenantContext {
  tenantId: string;
  userId: string;
  userName: string;
  role: TenantUserRole;
  permissions: string[];
  department: string;
  ip: string;
  deviceId: string;
  sessionId: string;
  signedAt: string;
  signature: string; // HMAC-SHA256 签名
}

// ─── 权限模型 ───

export type ResourceType =
  | 'menu'       // 菜单
  | 'button'     // 按钮
  | 'data_row'   // 数据行
  | 'field'      // 字段
  | 'api'        // API 接口
  | 'file'       // 文件
  | 'report';    // 报表

export type PermissionEffect = 'allow' | 'deny';

export interface Permission {
  id: string;
  name: string;
  code: string;          // 权限编码，如 'hrms:employee:read'
  resourceType: ResourceType;
  resource: string;      // 资源匹配模式，如 'hrms:employee:*'
  effect: PermissionEffect;
  description: string;
}

// ─── 角色 ───

export interface Role {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  description: string;
  permissions: string[];    // 权限 ID 列表
  isSystem: boolean;        // 系统预置角色
  isDefault: boolean;       // 新用户默认角色
  createdAt: string;
  updatedAt: string;
}

// ─── ABAC 策略 ───

export type AttributeSource = 'user' | 'resource' | 'environment';

export interface ABACCondition {
  attribute: string;       // 属性名
  source: AttributeSource; // 属性来源
  operator: 'eq' | 'neq' | 'in' | 'not_in' | 'lt' | 'gt' | 'lte' | 'gte' | 'contains' | 'starts_with' | 'between' | 'time_between' | 'ip_in_range';
  value: unknown;
}

export interface ABACPolicy {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  effect: PermissionEffect;
  resource: string;           // 资源匹配模式
  conditions: ABACCondition[]; // 全部满足才生效
  priority: number;           // 优先级（高优先匹配）
  enabled: boolean;
  createdAt: string;
}

// ─── 审计日志 ───

export type AuditAction =
  | 'login' | 'logout'
  | 'tenant:create' | 'tenant:update' | 'tenant:delete' | 'tenant:switch'
  | 'user:create' | 'user:update' | 'user:delete' | 'user:disable'
  | 'role:create' | 'role:update' | 'role:delete' | 'role:assign'
  | 'permission:change'
  | 'file:upload' | 'file:download' | 'file:delete' | 'file:preview'
  | 'data:export' | 'data:import' | 'data:delete'
  | 'security:cross-tenant:attempt' | 'security:unauthorized:attempt'
  | 'security:mfa:fail' | 'security:ip-blocked'
  | 'config:change' | 'policy:change';

export type AuditSeverity = 'info' | 'warning' | 'critical';

export interface AuditEntry {
  id: string;
  tenantId: string;
  userId: string;
  userName: string;
  action: AuditAction;
  severity: AuditSeverity;
  resource: string;         // 被操作资源
  resourceId?: string;
  detail: string;           // 操作详情
  ip: string;
  userAgent: string;
  deviceId: string;
  sessionId: string;
  metadata: Record<string, unknown>;
  timestamp: string;
}

// ─── 安全事件 ───

export interface SecurityEvent {
  id: string;
  tenantId: string;
  type: 'cross-tenant-access' | 'unauthorized-access' | 'multiple-tenant-switch' | 'brute-force' | 'suspicious-ip' | 'file-tamper' | 'token-replay' | 'rate-limit-exceeded';
  severity: AuditSeverity;
  userId: string;
  userName: string;
  ip: string;
  detail: string;
  requestPath?: string;
  requestMethod?: string;
  headers?: Record<string, string>;
  timestamp: string;
  resolved: boolean;
  resolvedAt?: string;
  resolvedBy?: string;
}

// ─── 通知渠道 ───

export type AlertChannel = 'dingtalk' | 'feishu' | 'wecom' | 'email' | 'sms';

export interface AlertConfig {
  id: string;
  tenantId: string;
  name: string;
  channel: AlertChannel;
  webhook: string;
  secret?: string;
  enabled: boolean;
  events: string[];       // 触发告警的事件类型
  rateLimit: number;      // 每分钟最大告警数
  createdAt: string;
}

// ─── 文件隔离 ───

export interface TenantFile {
  id: string;
  tenantId: string;
  userId: string;
  userName: string;
  originalName: string;
  storedName: string;
  path: string;            // 存储路径（含租户目录）
  mimeType: string;
  size: number;
  hash: string;            // SHA256 文件指纹
  hashAlgorithm: 'sha256' | 'md5';
  status: 'uploading' | 'ready' | 'scanning' | 'clean' | 'infected' | 'deleted';
  type: 'image' | 'document' | 'spreadsheet' | 'archive' | 'other';
  metadata: Record<string, unknown>;
  expiresAt?: string;      // 文件过期时间
  createdAt: string;
  updatedAt: string;
}

// ─── 水印配置 ───

export interface WatermarkConfig {
  enabled: boolean;
  text: string;
  opacity: number;
  fontSize: number;
  color: string;
  position: 'center' | 'tile' | 'bottom-right';
  rotation: number;
}

// ─── 权限评估结果 ───

export interface PermissionResult {
  allowed: boolean;
  reason: string;
  matchedBy: 'role' | 'abac' | 'super_admin' | 'deny_all';
  matchedPolicies: string[];
  evaluatedAt: string;
}

// ─── 合规文档 ───

export interface ComplianceDocument {
  id: string;
  tenantId: string;
  type: 'user-agreement' | 'privacy-policy' | 'disclaimer' | 'terms-of-service' | 'data-processing' | 'sla';
  title: string;
  content: string;
  version: string;
  status: 'draft' | 'published' | 'archived';
  effectiveDate: string;
  publishedAt?: string;
  acceptedBy: { userId: string; userName: string; acceptedAt: string }[];
  createdAt: string;
  updatedAt: string;
}

// ─── 租户初始化参数 ───

export interface TenantInitParams {
  adminEmail: string;
  adminName: string;
  adminPassword: string;
  companyName: string;
  domain: string;
  plan: TenantPlan;
  industry?: string;
  features?: string[];
}

// ─── 测试夹具 ───

export interface TenantTestFixture {
  tenant: TenantConfig;
  admin: TenantUser;
  token: TenantToken;
  context: TenantContext;
  roles: Role[];
  permissions: Permission[];
  abacPolicies: ABACPolicy[];
}

// 默认角色（系统预置）
export const SYSTEM_ROLES: Role[] = [
  {
    id: 'role-super-admin',
    tenantId: '*',
    name: '超级管理员',
    code: 'super_admin',
    description: '系统全局权限，可管理所有租户',
    permissions: ['*'],
    isSystem: true,
    isDefault: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'role-tenant-admin',
    tenantId: '*',
    name: '租户管理员',
    code: 'tenant_admin',
    description: '租户内最高权限，可管理租户成员、配置、安全策略',
    permissions: ['tenant:*', 'user:*', 'role:*', 'config:*', 'audit:*', 'file:*'],
    isSystem: true,
    isDefault: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'role-dept-head',
    tenantId: '*',
    name: '部门主管',
    code: 'dept_head',
    description: '本部门数据管理，成员查看',
    permissions: ['hrms:employee:read', 'hrms:task:read', 'hrms:task:write', 'hrms:report:read', 'file:upload', 'file:download'],
    isSystem: true,
    isDefault: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'role-member',
    tenantId: '*',
    name: '普通成员',
    code: 'member',
    description: '基础权限，可查看和编辑本人相关的数据',
    permissions: ['hrms:task:read:own', 'hrms:task:write:own', 'hrms:goal:read', 'file:upload:own', 'file:download:own'],
    isSystem: true,
    isDefault: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'role-external',
    tenantId: '*',
    name: '外部协作者',
    code: 'external_collaborator',
    description: '有限外部协作权限',
    permissions: ['hrms:task:read:assigned', 'file:upload:own', 'file:download:own'],
    isSystem: true,
    isDefault: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
];