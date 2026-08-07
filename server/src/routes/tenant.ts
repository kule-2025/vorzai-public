/**
 * 租户管理路由 — 用户 / 角色
 *
 * 替代前端 `mt:mock:users` / `mt:mock:roles` localStorage 假数据。
 * 所有查询强制按 req.user.tenantId 过滤，跨租户不可见。
 */
import { Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { getDatabase } from '../db';
import { config } from '../config';
import { requireRole, authedRouter } from '../middleware/auth';
import { asyncHandler, successResponse } from '../middleware/common';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import { validatePasswordStrength } from '../utils/security';
import { logger } from '../utils/logger';
import { ROLE_LEVELS, roleLevel, canAssignRole } from '../constants/roles';

const router = authedRouter();

const ROLES = ['owner', 'admin', 'manager', 'member', 'viewer'] as const;
const STATUSES = ['active', 'inactive', 'suspended', 'pending'] as const;

interface UserRow {
  id: string;
  tenant_id: string;
  username: string;
  email: string | null;
  phone: string | null;
  display_name: string;
  avatar_url: string | null;
  role: string;
  department_id: string | null;
  status: string;
  mfa_enabled: number;
  email_verified: number;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

const PUBLIC_COLUMNS = `
  id, tenant_id, username, email, phone, display_name, avatar_url,
  role, department_id, status, mfa_enabled, email_verified,
  last_login_at, created_at, updated_at
`;

// ==================== 用户 ====================

/** GET /api/tenant/users — 租户内用户列表（支持搜索/角色/状态过滤） */
router.get('/users', asyncHandler(async (req: Request, res: Response) => {
  const db = getDatabase();
  const tenantId = req.user!.tenantId;

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const role = typeof req.query.role === 'string' ? req.query.role : '';
  const status = typeof req.query.status === 'string' ? req.query.status : '';

  const where: string[] = ['tenant_id = ?'];
  const params: unknown[] = [tenantId];

  if (q) {
    where.push('(username LIKE ? OR display_name LIKE ? OR IFNULL(email, "") LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  if (role && (ROLES as readonly string[]).includes(role)) {
    where.push('role = ?');
    params.push(role);
  }
  if (status && (STATUSES as readonly string[]).includes(status)) {
    where.push('status = ?');
    params.push(status);
  }

  const rows = db.prepare(
    `SELECT ${PUBLIC_COLUMNS} FROM users WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 500`
  ).all(...params) as UserRow[];

  successResponse(res, rows);
}));

/** GET /api/tenant/users/stats — 角色/状态分布统计 */
router.get('/users/stats', asyncHandler(async (req: Request, res: Response) => {
  const db = getDatabase();
  const tenantId = req.user!.tenantId;

  const byRole = db.prepare(
    'SELECT role, COUNT(*) as count FROM users WHERE tenant_id = ? GROUP BY role'
  ).all(tenantId) as { role: string; count: number }[];

  const byStatus = db.prepare(
    'SELECT status, COUNT(*) as count FROM users WHERE tenant_id = ? GROUP BY status'
  ).all(tenantId) as { status: string; count: number }[];

  const total = byRole.reduce((s, r) => s + r.count, 0);
  const activeRow = byStatus.find((s) => s.status === 'active');

  successResponse(res, {
    total,
    active: activeRow?.count ?? 0,
    byRole,
    byStatus,
  });
}));

const createUserSchema = z.object({
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/, '用户名只能包含字母、数字、下划线或中文'),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(100),
  email: z.union([z.string().email(), z.literal('')]).optional(),
  phone: z.union([z.string().max(30), z.literal('')]).optional(),
  role: z.enum(ROLES).default('member'),
  departmentId: z.string().optional(),
});

/** POST /api/tenant/users — 在当前租户下创建用户（admin+） */
router.post('/users', requireRole('owner', 'admin'), asyncHandler(async (req: Request, res: Response) => {
  const input = createUserSchema.parse(req.body);
  const db = getDatabase();
  const tenantId = req.user!.tenantId;
  const operatorRole = req.user!.role;

  // 不得创建权限高于自身的账号
  if (!canAssignRole(operatorRole, input.role)) {
    throw new ValidationError(`无权创建角色为 ${input.role} 的用户`);
  }

  const strength = validatePasswordStrength(input.password);
  if (!strength.valid) {
    throw new ValidationError(`密码不满足安全要求: ${strength.errors.join('; ')}`);
  }

  const dup = db.prepare(
    'SELECT id FROM users WHERE tenant_id = ? AND username = ?'
  ).get(tenantId, input.username);
  if (dup) throw new ConflictError('该用户名在当前租户下已存在');

  if (input.email) {
    const dupEmail = db.prepare(
      'SELECT id FROM users WHERE tenant_id = ? AND email = ?'
    ).get(tenantId, input.email);
    if (dupEmail) throw new ConflictError('该邮箱在当前租户下已存在');
  }

  const id = uuidv4();
  const passwordHash = bcrypt.hashSync(input.password, config.bcrypt.saltRounds);

  db.prepare(
    `INSERT INTO users (id, tenant_id, username, email, phone, password_hash, display_name, role, department_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
  ).run(
    id, tenantId, input.username,
    input.email || null, input.phone || null,
    passwordHash, input.displayName, input.role,
    input.departmentId || null
  );

  logger.info('tenant', 'User created', { tenantId, operator: req.user!.userId, newUserId: id, role: input.role });

  const created = db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`).get(id) as UserRow;
  successResponse(res, created);
}));

const updateUserSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  email: z.union([z.string().email(), z.literal('')]).optional(),
  phone: z.union([z.string().max(30), z.literal('')]).optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(STATUSES).optional(),
  departmentId: z.string().optional(),
});

/** PATCH /api/tenant/users/:id — 更新用户（admin+） */
router.patch('/users/:id', requireRole('owner', 'admin'), asyncHandler(async (req: Request, res: Response) => {
  const input = updateUserSchema.parse(req.body);
  const db = getDatabase();
  const tenantId = req.user!.tenantId;
  const operatorRole = req.user!.role;
  const targetId = req.params.id;

  const target = db.prepare(
    'SELECT id, role, tenant_id FROM users WHERE id = ? AND tenant_id = ?'
  ).get(targetId, tenantId) as { id: string; role: string } | undefined;
  if (!target) throw new NotFoundError('用户不存在或不属于当前租户');

  // 不得修改权限高于自身的账号，也不得把他人提升到高于自身
  if (!canAssignRole(operatorRole, target.role)) {
    throw new ValidationError('无权修改权限高于自身的用户');
  }
  if (input.role && !canAssignRole(operatorRole, input.role)) {
    throw new ValidationError(`无权将用户提升为 ${input.role}`);
  }
  // 禁止自我降级导致租户失去 owner
  if (targetId === req.user!.userId && input.role && input.role !== target.role) {
    throw new ValidationError('不能修改自己的角色');
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  const map: Record<string, string> = {
    displayName: 'display_name', email: 'email', phone: 'phone',
    role: 'role', status: 'status', departmentId: 'department_id',
  };
  for (const [key, column] of Object.entries(map)) {
    const value = (input as Record<string, unknown>)[key];
    if (value !== undefined) {
      sets.push(`${column} = ?`);
      params.push(value === '' ? null : value);
    }
  }
  if (!sets.length) throw new ValidationError('没有需要更新的字段');

  sets.push("updated_at = datetime('now')");
  params.push(targetId, tenantId);

  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...params);

  logger.info('tenant', 'User updated', { tenantId, operator: req.user!.userId, targetId });

  const updated = db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`).get(targetId) as UserRow;
  successResponse(res, updated);
}));

/** POST /api/tenant/users/:id/reset-password — 重置密码（admin+） */
router.post('/users/:id/reset-password', requireRole('owner', 'admin'), asyncHandler(async (req: Request, res: Response) => {
  const { password } = z.object({ password: z.string().min(8).max(128) }).parse(req.body);
  const db = getDatabase();
  const tenantId = req.user!.tenantId;
  const targetId = req.params.id;

  const target = db.prepare(
    'SELECT id, role FROM users WHERE id = ? AND tenant_id = ?'
  ).get(targetId, tenantId) as { id: string; role: string } | undefined;
  if (!target) throw new NotFoundError('用户不存在或不属于当前租户');
  if (!canAssignRole(req.user!.role, target.role)) {
    throw new ValidationError('无权重置权限高于自身的用户密码');
  }

  const strength = validatePasswordStrength(password);
  if (!strength.valid) {
    throw new ValidationError(`密码不满足安全要求: ${strength.errors.join('; ')}`);
  }

  db.prepare(
    "UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?"
  ).run(bcrypt.hashSync(password, config.bcrypt.saltRounds), targetId, tenantId);

  logger.warn('tenant', 'Password reset by admin', { tenantId, operator: req.user!.userId, targetId });
  successResponse(res, { id: targetId });
}));

/** DELETE /api/tenant/users/:id — 停用用户（软删除，owner/admin） */
router.delete('/users/:id', requireRole('owner', 'admin'), asyncHandler(async (req: Request, res: Response) => {
  const db = getDatabase();
  const tenantId = req.user!.tenantId;
  const targetId = req.params.id;

  if (targetId === req.user!.userId) {
    throw new ValidationError('不能停用自己的账号');
  }

  const target = db.prepare(
    'SELECT id, role FROM users WHERE id = ? AND tenant_id = ?'
  ).get(targetId, tenantId) as { id: string; role: string } | undefined;
  if (!target) throw new NotFoundError('用户不存在或不属于当前租户');
  if (!canAssignRole(req.user!.role, target.role)) {
    throw new ValidationError('无权停用权限高于自身的用户');
  }

  // 软删除：保留历史数据关联（订单/审批等外键引用 users.id）
  db.prepare(
    "UPDATE users SET status = 'inactive', updated_at = datetime('now') WHERE id = ? AND tenant_id = ?"
  ).run(targetId, tenantId);

  logger.warn('tenant', 'User deactivated', { tenantId, operator: req.user!.userId, targetId });
  successResponse(res, { id: targetId, status: 'inactive' });
}));

// ==================== 角色 ====================

/**
 * GET /api/tenant/roles — 系统角色定义 + 各角色实际人数
 *
 * 角色为系统内置的固定层级（schema.sql users.role CHECK 约束），
 * 不支持自定义角色；此处返回定义 + 真实统计，供前端角色权限页展示。
 */
router.get('/roles', asyncHandler(async (req: Request, res: Response) => {
  const db = getDatabase();
  const tenantId = req.user!.tenantId;

  const counts = db.prepare(
    'SELECT role, COUNT(*) as count FROM users WHERE tenant_id = ? GROUP BY role'
  ).all(tenantId) as { role: string; count: number }[];
  const countMap = new Map(counts.map((c) => [c.role, c.count]));

  const definitions: Record<string, { label: string; description: string; permissions: string[] }> = {
    owner: {
      label: '所有者',
      description: '租户最高权限，可管理所有资源与成员，不可被他人停用',
      permissions: ['*'],
    },
    admin: {
      label: '管理员',
      description: '可管理成员、配置与全部业务数据',
      permissions: ['tenant:users', 'tenant:settings', 'business:*', 'hr:*', 'ogsm:*'],
    },
    manager: {
      label: '经理',
      description: '可审批流程、查看团队数据、维护业务记录',
      permissions: ['business:write', 'hr:approve', 'ogsm:write', 'procurement:approve'],
    },
    member: {
      label: '成员',
      description: '可录入与维护自己负责的业务数据',
      permissions: ['business:write', 'hr:self', 'ogsm:read'],
    },
    viewer: {
      label: '只读',
      description: '仅可查看数据，不能修改',
      permissions: ['*:read'],
    },
  };

  const roles = (ROLES as readonly string[]).map((role) => ({
    key: role,
    level: roleLevel(role),
    ...definitions[role],
    userCount: countMap.get(role) ?? 0,
  }));

  successResponse(res, roles);
}));

export default router;
