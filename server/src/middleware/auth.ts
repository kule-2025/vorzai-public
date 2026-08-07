import { Request, Response, NextFunction, Router } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config';
import { AuthenticationError, AuthorizationError } from '../utils/errors';
import { getDatabase } from '../db';
import { logger } from '../utils/logger';
import { ROLE_LEVELS, roleLevel } from '../constants/roles';

export interface AuthPayload {
  userId: string;
  tenantId: string;
  role: string;
  username: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
      traceId?: string;
    }
  }
}

export function generateAccessToken(payload: AuthPayload): string {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.accessTokenExpiry,
  });
}

export function generateRefreshToken(userId: string): { token: string; expiresAt: string } {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  // SECURITY: Add random jti to ensure uniqueness even within the same second
  const jti = crypto.randomUUID();
  const token = jwt.sign({ userId, type: 'refresh', jti }, config.jwt.secret, {
    expiresIn: config.jwt.refreshTokenExpiry,
  });
  return { token, expiresAt };
}

export function authenticateToken(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    throw new AuthenticationError('缺少访问令牌');
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret) as AuthPayload;
    req.user = decoded;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new AuthenticationError('访问令牌已过期');
    }
    throw new AuthenticationError('无效的访问令牌');
  }
}

// RBAC middleware factory
// 角色层级统一来自 constants/roles（单一真相源），避免与 tenant.ts 尺度不一致。
const ROLE_HIERARCHY = ROLE_LEVELS;

export function requireRole(...allowedRoles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new AuthenticationError();
    }

    const userLevel = roleLevel(req.user.role);
    const hasAccess = allowedRoles.some((role) => {
      const requiredLevel = roleLevel(role);
      return userLevel >= requiredLevel;
    });

    if (!hasAccess) {
      logger.warn('auth', 'Access denied', {
        userId: req.user.userId,
        role: req.user.role,
        requiredRoles: allowedRoles,
        path: req.path,
      });
      throw new AuthorizationError();
    }

    next();
  };
}

// Permission-based access control
export function requirePermission(permission: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new AuthenticationError();
    }

    // Owner and admin have all permissions
    if (['owner', 'admin'].includes(req.user.role)) {
      next();
      return;
    }

    const db = getDatabase();
    const userRoles = db
      .prepare(
        `SELECT r.permissions FROM roles r
         JOIN user_roles ur ON ur.role_id = r.id
         WHERE ur.user_id = ?`
      )
      .all(req.user.userId) as { permissions: string }[];

    const allPermissions = userRoles.flatMap((r) => {
      try {
        return JSON.parse(r.permissions) as string[];
      } catch {
        return [];
      }
    });

    if (!allPermissions.includes(permission) && !allPermissions.includes('*')) {
      throw new AuthorizationError(`缺少权限: ${permission}`);
    }

    next();
  };
}

// Tenant isolation middleware - ensures users can only access their tenant's data
export function tenantIsolation(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    throw new AuthenticationError();
  }
  // Attach tenantId to query params for downstream use
  (req as any).tenantId = req.user.tenantId;
  next();
}

/**
 * 创建已强制鉴权 + 租户隔离的 Router 工厂（B7 修复）。
 *
 * 所有业务路由应使用本工厂替代散落的 `router.use(authenticateToken, tenantIsolation)`，
 * 以杜绝「漏加中间件 = 未鉴权端点」的风险。租户隔离仍依赖各 service 在查询中
 * 传入 `req.user.tenantId` / `req.tenantId`（数据完整性测试已覆盖）。
 */
export function authedRouter(): Router {
  const r = Router();
  r.use(authenticateToken, tenantIsolation);
  return r;
}
