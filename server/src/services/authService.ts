import { getDatabase } from '../db';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { config } from '../config';
import { AuthenticationError, AuthorizationError, ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import { generateAccessToken, generateRefreshToken, AuthPayload } from '../middleware/auth';
import { logger } from '../utils/logger';
import crypto from 'crypto';

export interface RegisterInput {
  username: string;
  password: string;
  displayName: string;
  email?: string;
  phone?: string;
  tenantName?: string;
}

export interface LoginInput {
  username: string;
  password: string;
  tenantSlug?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface UserProfile {
  id: string;
  tenantId: string;
  username: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  role: string;
  avatarUrl: string | null;
  tenantName: string;
  tenantSlug: string;
}

export interface DelegatedPermission {
  id: string;
  tenant_id: string;
  delegator_id: string;
  delegatee_id: string;
  scope: string;
  permission_point: string;
  expires_at: string | null;
  delegator_name: string;
  created_at: string;
}

export class AuthService {
  /**
   * 注册新用户（同时创建租户）
   */
  register(input: RegisterInput): { user: UserProfile; tokens: AuthTokens } {
    const db = getDatabase();

    // Check username uniqueness (global for simplicity in desktop mode)
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(input.username);
    if (existing) {
      throw new ConflictError('用户名已存在');
    }

    if (input.email) {
      const existingEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(input.email);
      if (existingEmail) {
        throw new ConflictError('邮箱已被注册');
      }
    }

    const passwordHash = bcrypt.hashSync(input.password, config.bcrypt.saltRounds);
    const tenantId = uuidv4();
    const userId = uuidv4();
    const tenantSlug = input.tenantName
      ? input.tenantName.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '-').slice(0, 50)
      : `tenant-${Date.now()}`;

    const insertTenant = db.prepare(
      `INSERT INTO tenants (id, name, slug, industry, plan, max_users, status) VALUES (?, ?, ?, 'ecommerce', 'free', 3, 'active')`
    );
    const insertUser = db.prepare(
      `INSERT INTO users (id, tenant_id, username, email, phone, password_hash, display_name, role, email_verified, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'owner', 0, 'active')`
    );

    db.exec('BEGIN TRANSACTION');
    try {
      insertTenant.run(tenantId, input.tenantName || `${input.displayName}的团队`, tenantSlug);
      insertUser.run(userId, tenantId, input.username, input.email || null, input.phone || null, passwordHash, input.displayName);

      // Create default roles
      this.createDefaultRoles(tenantId);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    logger.info('auth', `User registered: ${input.username}`, { userId, tenantId });

    const user = this.getUserProfile(userId)!;
    const tokens = this.generateTokens(user);

    return { user, tokens };
  }

  /**
   * 用户登录（商业化增强版）
   */
  login(input: LoginInput): { user: UserProfile; tokens: AuthTokens } {
    const db = getDatabase();

    // Record login attempt
    const attemptId = uuidv4();
    db.prepare(
      'INSERT INTO login_attempts (id, username, ip_address) VALUES (?, ?, ?)'
    ).run(attemptId, input.username, '127.0.0.1');

    // Check brute force: max 5 failed attempts in 15 minutes
    const recentFailures = (db.prepare(
      `SELECT COUNT(*) as count FROM login_attempts
       WHERE username = ? AND success = 0 AND attempted_at > datetime('now', '-15 minutes')`
    ).get(input.username) as any).count;

    if (recentFailures >= 5) {
      db.prepare(
        "UPDATE login_attempts SET failure_reason = 'brute_force_blocked' WHERE id = ?"
      ).run(attemptId);
      throw new AuthenticationError('登录失败次数过多，请15分钟后再试');
    }

    let query = 'SELECT * FROM users WHERE username = ? AND status = ?';
    let params: unknown[] = [input.username, 'active'];

    if (input.tenantSlug) {
      query = `SELECT u.* FROM users u JOIN tenants t ON u.tenant_id = t.id
               WHERE u.username = ? AND u.status = ? AND t.slug = ?`;
      params.push(input.tenantSlug);
    }

    const user = db.prepare(query).get(...params) as any;

    if (!user) {
      // Mark attempt as failed
      db.prepare("UPDATE login_attempts SET failure_reason = 'user_not_found' WHERE id = ?").run(attemptId);
      throw new AuthenticationError('用户名或密码错误');
    }

    // Check tenant status
    const tenant = db.prepare('SELECT status, plan, trial_ends_at FROM tenants WHERE id = ?').get(user.tenant_id) as any;
    if (tenant && tenant.status === 'suspended') {
      db.prepare("UPDATE login_attempts SET failure_reason = 'tenant_suspended' WHERE id = ?").run(attemptId);
      throw new AuthenticationError('账号已被暂停，请联系管理员');
    }

    const passwordValid = bcrypt.compareSync(input.password, user.password_hash);
    if (!passwordValid) {
      db.prepare("UPDATE login_attempts SET failure_reason = 'wrong_password' WHERE id = ?").run(attemptId);
      throw new AuthenticationError('用户名或密码错误');
    }

    // Mark attempt as successful
    db.prepare("UPDATE login_attempts SET success = 1 WHERE id = ?").run(attemptId);

    // Update last login
    db.prepare('UPDATE users SET last_login_at = datetime(\'now\') WHERE id = ?').run(user.id);

    // Write audit log
    db.prepare(
      `INSERT INTO audit_logs (id, tenant_id, user_id, action, resource_type, ip_address)
       VALUES (?, ?, ?, 'login', 'auth', '127.0.0.1')`
    ).run(uuidv4(), user.tenant_id, user.id);

    logger.info('auth', `User logged in: ${input.username}`, { userId: user.id });

    const profile = this.getUserProfile(user.id)!;
    const tokens = this.generateTokens(profile);

    return { user: profile, tokens };
  }

  /**
   * 刷新Token
   */
  refreshToken(refreshToken: string): AuthTokens {
    const db = getDatabase();

    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const storedToken = db
      .prepare('SELECT * FROM refresh_tokens WHERE token_hash = ? AND revoked = 0 AND expires_at > datetime(\'now\')')
      .get(tokenHash) as any;

    if (!storedToken) {
      throw new AuthenticationError('刷新令牌无效或已过期');
    }

    const user = this.getUserProfile(storedToken.user_id);
    if (!user) {
      throw new AuthenticationError('用户不存在');
    }

    // Revoke old token
    db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?').run(storedToken.id);

    return this.generateTokens(user);
  }

  /**
   * 登出（撤销刷新令牌）
   */
  logout(userId: string): void {
    const db = getDatabase();
    db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ? AND revoked = 0').run(userId);
  }

  /**
   * 修改密码
   */
  changePassword(userId: string, oldPassword: string, newPassword: string): void {
    const db = getDatabase();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;

    if (!user) {
      throw new NotFoundError('用户');
    }

    if (!bcrypt.compareSync(oldPassword, user.password_hash)) {
      throw new ValidationError('原密码错误');
    }

    const newHash = bcrypt.hashSync(newPassword, config.bcrypt.saltRounds);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?').run(newHash, userId);

    // Revoke all refresh tokens
    db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(userId);

    logger.info('auth', `Password changed for user: ${userId}`);
  }

  getUserProfile(userId: string): UserProfile | null {
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT u.id, u.tenant_id, u.username, u.display_name, u.email, u.phone, u.role, u.avatar_url,
                t.name as tenant_name, t.slug as tenant_slug
         FROM users u JOIN tenants t ON u.tenant_id = t.id
         WHERE u.id = ?`
      )
      .get(userId) as any;

    if (!row) return null;

    return {
      id: row.id,
      tenantId: row.tenant_id,
      username: row.username,
      displayName: row.display_name,
      email: row.email,
      phone: row.phone,
      role: row.role,
      avatarUrl: row.avatar_url,
      tenantName: row.tenant_name,
      tenantSlug: row.tenant_slug,
    };
  }

  private generateTokens(user: UserProfile): AuthTokens {
    const db = getDatabase();

    const payload: AuthPayload = {
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
      username: user.username,
    };

    const accessToken = generateAccessToken(payload);
    const { token: refreshToken, expiresAt } = generateRefreshToken(user.id);

    // Store refresh token hash
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    db.prepare(
      'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)'
    ).run(uuidv4(), user.id, tokenHash, expiresAt);

    return {
      accessToken,
      refreshToken,
      expiresIn: config.jwt.accessTokenExpiry,
    };
  }

  private createDefaultRoles(tenantId: string): void {
    const db = getDatabase();
    const defaultRoles = [
      { name: '管理员', permissions: ['*'], description: '拥有所有权限' },
      { name: '部门经理', permissions: ['hr:read', 'hr:write', 'ogsm:read', 'ogsm:write', 'business:read', 'business:write', 'team:manage'], description: '部门管理权限' },
      { name: '普通成员', permissions: ['hr:read:self', 'ogsm:read', 'business:read', 'business:write:self'], description: '基本操作权限' },
      { name: '只读成员', permissions: ['hr:read:self', 'ogsm:read', 'business:read'], description: '仅查看权限' },
    ];

    const insert = db.prepare(
      'INSERT INTO roles (id, tenant_id, name, description, permissions, is_system) VALUES (?, ?, ?, ?, ?, 1)'
    );

    for (const role of defaultRoles) {
      insert.run(uuidv4(), tenantId, role.name, role.description, JSON.stringify(role.permissions));
    }
  }
}

export const authService = new AuthService();

// ────────── 委托权限扩展方法 ──────────

const ROLE_PERMISSIONS: Record<string, string[]> = {
  owner: ['*'],
  admin: ['*'],
  manager: ['hr:read', 'hr:write', 'ogsm:read', 'ogsm:write', 'business:read', 'business:write', 'team:manage'],
  member: ['hr:read:self', 'ogsm:read', 'business:read', 'business:write:self'],
  viewer: ['hr:read:self', 'ogsm:read', 'business:read'],
};

/**
 * 创建委托权限
 * 对标钉钉的"授权"机制：将某用户在某个范围的权限点委托给另一个用户
 */
export function createDelegatedPermission(
  tenantId: string,
  delegatorId: string,
  delegateeId: string,
  scope: string,
  permissionPoint: string,
  expiresAt?: string
): DelegatedPermission {
  const db = getDatabase();

  if (delegatorId === delegateeId) {
    throw new ValidationError('不能委托权限给自己');
  }

  // 校验委托方有权限
  if (scope !== 'all' && permissionPoint !== 'all') {
    // 委托方必须至少拥有被委托的权限
    const delegator = db.prepare('SELECT role FROM users WHERE id = ? AND tenant_id = ?').get(delegatorId, tenantId) as any;
    if (!delegator) throw new NotFoundError('委托方用户');
    const hasPerm = checkUserPermission(delegator.role, scope, permissionPoint);
    if (!hasPerm) throw new AuthorizationError('委托方不具有该权限，无法委托');
  }

  const id = uuidv4();
  const exp = expiresAt || null;

  db.prepare(
    `INSERT INTO delegated_permissions (id, tenant_id, delegator_id, delegatee_id, scope, permission_point, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, tenantId, delegatorId, delegateeId, scope, permissionPoint, exp);

  return getDelegatedPermissionById(id);
}

/**
 * 列出一用户的委托权限（自己委托出去的 + 被委托给自己的）
 * @param type 'granted' 自己被授予的权限 | 'given' 自己授予出去的
 */
export function listDelegatedPermissions(tenantId: string, userId: string, type?: 'granted' | 'given'): DelegatedPermission[] {
  const db = getDatabase();
  let query = `SELECT dp.*, u.display_name as delegator_name
               FROM delegated_permissions dp
               LEFT JOIN users u ON dp.delegator_id = u.id
               WHERE dp.tenant_id = ?`;
  const params: unknown[] = [tenantId];

  if (type === 'given') {
    query += ' AND dp.delegator_id = ?';
    params.push(userId);
  } else if (type === 'granted') {
    query += ' AND dp.delegatee_id = ?';
    params.push(userId);
  } else {
    query += ' AND (dp.delegator_id = ? OR dp.delegatee_id = ?)';
    params.push(userId, userId);
  }

  query += ' ORDER BY dp.created_at DESC';
  const rows = db.prepare(query).all(...params) as any[];

  return rows.map((r) => ({
    id: r.id,
    tenant_id: r.tenant_id,
    delegator_id: r.delegator_id,
    delegatee_id: r.delegatee_id,
    scope: r.scope,
    permission_point: r.permission_point,
    expires_at: r.expires_at,
    delegator_name: r.delegator_name,
    created_at: r.created_at,
  }));
}

/**
 * 撤销委托权限
 */
export function revokeDelegatedPermission(id: string, tenantId: string): void {
  const db = getDatabase();
  // SECURITY: scope by tenant — without this any authenticated user could revoke
  // another tenant's delegation simply by guessing/obtaining its id.
  const existing = db
    .prepare('SELECT id FROM delegated_permissions WHERE id = ? AND tenant_id = ?')
    .get(id, tenantId);
  if (!existing) throw new NotFoundError('委托权限');
  db.prepare('DELETE FROM delegated_permissions WHERE id = ? AND tenant_id = ?').run(id, tenantId);
  logger.info('auth', `Delegated permission revoked: ${id}`);
}

/**
 * 权限检查（含委托权限）
 * @returns { allowed: boolean, source: 'role' | 'delegation' | 'self', reason?: string }
 */
export function checkPermission(tenantId: string, userId: string, resource: string, action: string): { allowed: boolean; source: 'role' | 'delegation' | 'self'; reason?: string } {
  const db = getDatabase();

  // 1. 检查角色权限
  const user = db.prepare('SELECT role FROM users WHERE id = ? AND tenant_id = ?').get(userId, tenantId) as any;
  if (!user) {
    return { allowed: false, source: 'role', reason: '用户不存在' };
  }

  const perm = `${resource}:${action}`;
  const rolePerms = ROLE_PERMISSIONS[user.role] || [];

  if (rolePerms.includes('*') || rolePerms.includes(perm) || rolePerms.includes(`${resource}:*`)) {
    return { allowed: true, source: 'role' };
  }

  // 2. 检查委托权限
  const delegated = db
    .prepare(
      `SELECT * FROM delegated_permissions
       WHERE tenant_id = ? AND delegatee_id = ?
       AND (scope = ? OR scope = 'all')
       AND (permission_point = ? OR permission_point = 'all')
       AND (expires_at IS NULL OR expires_at > datetime('now', '+0000'))`
    )
    .all(tenantId, userId, resource, perm) as any[];

  if (delegated.length > 0) {
    return { allowed: true, source: 'delegation', reason: `由用户委托` };
  }

  return { allowed: false, source: 'role', reason: '无权限' };
}

/** 内部辅助：检查角色是否包含指定 scope/permissionPoint */
function checkUserPermission(role: string, scope: string, permissionPoint: string): boolean {
  const perms = ROLE_PERMISSIONS[role] || [];
  if (perms.includes('*')) return true;
  const perm = `${scope}:${permissionPoint}`;
  return perms.includes(perm) || perms.includes(`${scope}:*`);
}

/** 内部辅助：查询委托权限记录 */
function getDelegatedPermissionById(id: string): DelegatedPermission {
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT dp.*, u.display_name as delegator_name
       FROM delegated_permissions dp LEFT JOIN users u ON dp.delegator_id = u.id
       WHERE dp.id = ?`
    )
    .get(id) as any;
  if (!row) throw new NotFoundError('委托权限');
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    delegator_id: row.delegator_id,
    delegatee_id: row.delegatee_id,
    scope: row.scope,
    permission_point: row.permission_point,
    expires_at: row.expires_at,
    delegator_name: row.delegator_name,
    created_at: row.created_at,
  };
}
