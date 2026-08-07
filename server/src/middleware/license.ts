import { Request, Response, NextFunction } from 'express';
import { licenseService, PLAN_DEFINITIONS, PlanKey } from '../services/licenseService';
import { AppError, AuthorizationError } from '../utils/errors';
import { getDatabase } from '../db';
import { logger } from '../utils/logger';

// ============================================================
// 许可证校验中间件 — 每个API请求强制检查账号状态和计划权限
// ============================================================

/**
 * 检查租户账号状态（是否激活/暂停/试用过期）
 * 已在 authenticateToken 之后执行，req.user 已存在
 */
export function checkAccountStatus(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    throw new AppError('未认证', 401, 'AUTHENTICATION_ERROR');
  }

  const result = licenseService.checkTenantStatus(req.user.tenantId);

  if (!result.active) {
    throw new AppError(result.reason || '账号不可用', 403, 'ACCOUNT_SUSPENDED');
  }

  // Record usage (API call count)
  licenseService.recordUsage(req.user.tenantId, 'api_calls', 1);

  // Check API quota
  const quota = licenseService.checkQuota(req.user.tenantId, 'api_calls');
  if (quota.exceeded) {
    throw new AppError(
      `今日API调用已达上限 (${quota.limit}次/天)，请升级计划获取更多配额`,
      429, 'QUOTA_EXCEEDED',
      { current: quota.current, limit: quota.limit }
    );
  }

  next();
}

/**
 * 功能权限检查中间件工厂
 * 用法: router.get('/ogsm/...', requireFeature('ogsm_full'), handler)
 */
export function requireFeature(feature: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new AppError('未认证', 401, 'AUTHENTICATION_ERROR');
    }

    if (!licenseService.hasFeature(req.user.tenantId, feature)) {
      const db = getDatabase();
      const tenant = db.prepare('SELECT plan FROM tenants WHERE id = ?').get(req.user.tenantId) as any;
      const planName = PLAN_DEFINITIONS[tenant?.plan as PlanKey]?.name || '当前计划';

      throw new AuthorizationError(
        `${planName}不包含此功能 (${feature})，请升级到更高级别的计划`
      );
    }

    next();
  };
}

/**
 * 设备绑定检查中间件
 * 客户端通过 X-Device-Id 头传递设备ID
 */
export function checkDeviceBinding(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    throw new AppError('未认证', 401, 'AUTHENTICATION_ERROR');
  }

  const deviceId = req.headers['x-device-id'] as string;
  if (!deviceId) {
    // 允许无设备ID的请求（向后兼容），但记录警告
    logger.warn('auth', 'Request without device ID', {
      userId: req.user.userId,
      path: req.path,
    });
    next();
    return;
  }

  const db = getDatabase();

  // Check if device is registered and active
  const device = db.prepare(
    "SELECT * FROM device_registrations WHERE tenant_id = ? AND device_id = ? AND status = 'active'"
  ).get(req.user.tenantId, deviceId) as any;

  if (!device) {
    // Auto-register device if under limit
    try {
      licenseService.registerDevice({
        tenantId: req.user.tenantId,
        userId: req.user.userId,
        deviceId,
        deviceName: req.headers['x-device-name'] as string || 'Unknown',
        osPlatform: req.headers['x-os-platform'] as string || process.platform,
        appVersion: req.headers['x-app-version'] as string,
      });
      logger.info('auth', `Auto-registered device: ${deviceId}`, { userId: req.user.userId });
    } catch (e) {
      if (e instanceof AppError && e.code === 'DEVICE_LIMIT_EXCEEDED') {
        throw e;
      }
      // Other errors are non-fatal
      logger.warn('auth', `Device registration failed: ${String(e)}`);
    }
  } else {
    // Update last active time
    db.prepare(
      "UPDATE device_registrations SET last_active_at = datetime('now') WHERE id = ?"
    ).run(device.id);
  }

  next();
}

/**
 * 写入审计日志
 */
export function auditLog(action: string, resourceType: string, getResourceId?: (req: Request) => string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    // Store for after-response logging
    (req as any)._auditAction = action;
    (req as any)._auditResourceType = resourceType;
    (req as any)._auditGetResourceId = getResourceId;

    res_finished_hook(_res, () => {
      try {
        const db = getDatabase();
        const resourceId = getResourceId ? getResourceId(req) : null;
        db.prepare(
          `INSERT INTO audit_logs (id, tenant_id, user_id, action, resource_type, resource_id, ip_address)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          require('uuid').v4(),
          req.user?.tenantId || null,
          req.user?.userId || null,
          action,
          resourceType,
          resourceId,
          req.ip || '127.0.0.1'
        );
      } catch (e) {
        // Audit logging is non-blocking
      }
    });

    next();
  };
}

// Helper: call callback when response finishes
function res_finished_hook(res: Response, callback: () => void): void {
  res.on('finish', callback);
}
