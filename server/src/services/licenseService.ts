import { getDatabase } from '../db';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { NotFoundError, ValidationError, ConflictError, AppError } from '../utils/errors';
import { logger } from '../utils/logger';

// 许可证行类型：validateLicense 实际返回的 license 字段为驼峰结构，
// 此处收窄类型以避免 strict 下 unknown 报错；同时暴露原 snake/camel 字段错位（已修复）。
interface LicenseLike {
  id?: string;
  key?: string;
  type?: string;
  status?: string;
  expiresAt?: string;
  maxUsers?: number;
  maxDevices: number;
  features?: unknown;
  tenantId?: string;
  plan?: string;
}

// ============================================================
// 计划等级定义（商业化核心配置）
// ============================================================
export const PLAN_DEFINITIONS = {
  free: {
    name: '免费版',
    maxUsers: 3,
    maxDevices: 1,
    maxStorageMb: 100,
    maxApiCallsPerDay: 100,
    features: ['dashboard', 'hr_basic', 'ogsm_view', 'business_view'],
    price: 0,
    trialDays: 0,
  },
  trial: {
    name: '试用版',
    maxUsers: 10,
    maxDevices: 2,
    maxStorageMb: 500,
    maxApiCallsPerDay: 1000,
    features: ['dashboard', 'hr_full', 'ogsm_full', 'business_full', 'knowledge', 'skills', 'connectors', 'chat'],
    price: 0,
    trialDays: 14,
  },
  standard: {
    name: '标准版',
    maxUsers: 20,
    maxDevices: 3,
    maxStorageMb: 2000,
    maxApiCallsPerDay: 10000,
    features: ['dashboard', 'hr_full', 'ogsm_full', 'business_full', 'knowledge', 'skills', 'connectors', 'chat'],
    price: 299,
  },
  professional: {
    name: '专业版',
    maxUsers: 50,
    maxDevices: 5,
    maxStorageMb: 10000,
    maxApiCallsPerDay: 50000,
    features: ['dashboard', 'hr_full', 'ogsm_full', 'business_full', 'knowledge', 'skills', 'connectors', 'chat', 'audit', 'abac', 'api_access'],
    price: 999,
  },
  enterprise: {
    name: '企业版',
    maxUsers: -1, // unlimited
    maxDevices: -1,
    maxStorageMb: -1,
    maxApiCallsPerDay: -1,
    features: ['*'],
    price: 4999,
  },
} as const;

export type PlanKey = keyof typeof PLAN_DEFINITIONS;

// ============================================================
// License Service — 许可证生成、验证、管理
// ============================================================
export class LicenseService {

  /**
   * 生成许可证密钥
   * 格式: VORZAI-PLAN-XXXXXXXX-XXXXXXXX-XXXXXXXX
   */
  generateLicenseKey(plan: string, type: string = 'subscription'): string {
    const planPrefix = plan.toUpperCase().slice(0, 4);
    const randomParts = [
      crypto.randomBytes(4).toString('hex').toUpperCase(),
      crypto.randomBytes(4).toString('hex').toUpperCase(),
      crypto.randomBytes(4).toString('hex').toUpperCase(),
    ];
    return `VORZAI-${planPrefix}-${randomParts[0]}-${randomParts[1]}-${randomParts[2]}`;
  }

  /**
   * 创建新许可证
   */
  createLicense(input: {
    plan: string;
    type?: string;
    tenantId?: string;
    issuedTo?: string;
    issuedBy?: string;
    expiresInDays?: number;
    maxUsers?: number;
    maxDevices?: number;
    maxStorageMb?: number;
    maxApiCallsPerDay?: number;
    features?: string[];
  }): Record<string, unknown> {
    const db = getDatabase();
    const id = uuidv4();
    const licenseKey = this.generateLicenseKey(input.plan, input.type);
    const planDef = PLAN_DEFINITIONS[input.plan as PlanKey];
    if (!planDef) throw new ValidationError(`无效的计划: ${input.plan}`);

    const expiresAt = input.expiresInDays
      ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

    db.prepare(
      `INSERT INTO licenses (id, license_key, tenant_id, plan, type, max_users, max_devices, max_storage_mb, max_api_calls_per_day, features, status, issued_to, issued_by, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
    ).run(
      id, licenseKey, input.tenantId || null, input.plan,
      input.type || 'subscription',
      input.maxUsers ?? planDef.maxUsers,
      input.maxDevices ?? planDef.maxDevices,
      input.maxStorageMb ?? planDef.maxStorageMb,
      input.maxApiCallsPerDay ?? planDef.maxApiCallsPerDay,
      JSON.stringify(input.features || planDef.features),
      input.issuedTo || null, input.issuedBy || null, expiresAt
    );

    logger.info('license', `License created: ${licenseKey} (plan: ${input.plan})`);
    return db.prepare('SELECT * FROM licenses WHERE id = ? AND tenant_id = ?').get(id, input.tenantId) as any;
  }

  /**
   * 验证许可证密钥（核心方法）
   * 返回许可证信息或抛出异常
   */
  validateLicense(licenseKey: string): {
    valid: boolean;
    license?: LicenseLike;
    plan?: string;
    error?: string;
  } {
    const db = getDatabase();
    const license = db.prepare('SELECT * FROM licenses WHERE license_key = ?').get(licenseKey) as any;

    if (!license) {
      return { valid: false, error: '许可证密钥无效' };
    }

    if (license.status === 'revoked') {
      return { valid: false, license, error: '许可证已被吊销' };
    }

    if (license.status === 'expired') {
      return { valid: false, license, error: '许可证已过期' };
    }

    if (license.status === 'suspended') {
      return { valid: false, license, error: '许可证已被暂停' };
    }

    if (license.expires_at) {
      const expiry = new Date(license.expires_at);
      if (expiry < new Date()) {
        db.prepare("UPDATE licenses SET status = 'expired' WHERE id = ? AND tenant_id = ?").run(license.id, license.tenant_id);
        return { valid: false, license, error: '许可证已过期' };
      }
    }

    return { valid: true, license, plan: license.plan };
  }

  /**
   * 激活许可证（绑定到租户）
   */
  activateLicense(licenseKey: string, tenantId: string, deviceId?: string): Record<string, unknown> {
    const db = getDatabase();
    const result = this.validateLicense(licenseKey);

    if (!result.valid) {
      throw new AppError(result.error || '许可证无效', 403, 'LICENSE_INVALID');
    }

    const license = result.license!;

    // Check if license already activated for different tenant
    if (license.tenantId && license.tenantId !== tenantId) {
      throw new ConflictError('许可证已被其他租户激活');
    }

    // Check device limit
    if (deviceId) {
      const activeDevices = (db.prepare(
        "SELECT COUNT(*) as count FROM device_registrations WHERE tenant_id = ? AND status = 'active'"
      ).get(tenantId) as any).count;

      if (activeDevices >= license.maxDevices) {
        throw new AppError(
          `设备数量已达上限 (${license.maxDevices})，请先停用其他设备`,
          403, 'DEVICE_LIMIT_EXCEEDED'
        );
      }
    }

    // Activate license
    db.prepare(
      `UPDATE licenses SET tenant_id = ?, activated_at = datetime('now', '+0000'), status = 'active' WHERE id = ?`
    ).run(tenantId, license.id);

    // Update tenant plan
    db.prepare(
      `UPDATE tenants SET plan = ?, license_key = ?, updated_at = datetime('now', '+0000') WHERE id = ?`
    ).run(license.plan, licenseKey, tenantId);

    // Create subscription record
    const subId = uuidv4();
    const now = new Date().toISOString();
    const periodEnd = license.expiresAt || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

    db.prepare(
      `INSERT OR REPLACE INTO subscriptions (id, tenant_id, plan, status, billing_cycle, amount, current_period_start, current_period_end, auto_renew)
       VALUES (?, ?, ?, 'active', 'annual', 0, ?, ?, 1)`
    ).run(subId, tenantId, license.plan, now, periodEnd);

    logger.info('license', `License activated: ${licenseKey} for tenant ${tenantId}`);

    return this.getTenantLicenseInfo(tenantId);
  }

  /**
   * 吊销许可证
   */
  revokeLicense(licenseKey: string, reason: string, revokedBy: string): void {
    const db = getDatabase();
    const result = this.validateLicense(licenseKey);
    if (!result.license) throw new NotFoundError('许可证');

    db.prepare(
      "UPDATE licenses SET status = 'revoked', revoked_at = datetime('now', '+0000'), revoke_reason = ? WHERE license_key = ?"
    ).run(reason, licenseKey);

    // Downgrade tenant to free plan
    if (result.license.tenantId) {
      db.prepare(
        "UPDATE tenants SET plan = 'free', license_key = NULL, updated_at = datetime('now', '+0000') WHERE id = ?"
      ).run(result.license.tenantId);

      // Cancel subscription
      db.prepare(
        "UPDATE subscriptions SET status = 'canceled', canceled_at = datetime('now', '+0000') WHERE tenant_id = ? AND status = 'active'"
      ).run(result.license.tenantId);
    }

    logger.warn('license', `License revoked: ${licenseKey} (reason: ${reason})`);
  }

  /**
   * 获取租户的许可证和订阅信息
   */
  getTenantLicenseInfo(tenantId: string): Record<string, unknown> {
    const db = getDatabase();

    const tenant = db.prepare('SELECT plan, license_key, trial_started_at, trial_ends_at FROM tenants WHERE id = ?').get(tenantId) as any;
    if (!tenant) throw new NotFoundError('租户');

    const license = tenant.license_key
      ? db.prepare('SELECT * FROM licenses WHERE license_key = ?').get(tenant.license_key) as any
      : null;

    const subscription = db.prepare(
      "SELECT * FROM subscriptions WHERE tenant_id = ? AND status IN ('active', 'trialing') ORDER BY created_at DESC LIMIT 1"
    ).get(tenantId) as any;

    const planDef = PLAN_DEFINITIONS[tenant.plan as PlanKey] || PLAN_DEFINITIONS.free;

    // Check trial expiry
    let trialExpired = false;
    if (tenant.plan === 'trial' && tenant.trial_ends_at) {
      if (new Date(tenant.trial_ends_at) < new Date()) {
        trialExpired = true;
      }
    }

    return {
      plan: tenant.plan,
      planName: planDef.name,
      license: license ? {
        id: license.id,
        key: license.license_key,
        type: license.type,
        status: license.status,
        expiresAt: license.expires_at,
        maxUsers: license.max_users,
        maxDevices: license.max_devices,
        features: JSON.parse(license.features || '[]'),
        tenantId: license.tenant_id,
        plan: license.plan,
      } : null,
      subscription: subscription ? {
        status: subscription.status,
        billingCycle: subscription.billing_cycle,
        currentPeriodEnd: subscription.current_period_end,
        autoRenew: subscription.auto_renew,
      } : null,
      limits: {
        maxUsers: planDef.maxUsers,
        maxDevices: planDef.maxDevices,
        maxStorageMb: planDef.maxStorageMb,
        maxApiCallsPerDay: planDef.maxApiCallsPerDay,
      },
      features: planDef.features,
      trial: tenant.plan === 'trial' ? {
        startedAt: tenant.trial_started_at,
        endsAt: tenant.trial_ends_at,
        expired: trialExpired,
        daysRemaining: tenant.trial_ends_at
          ? Math.max(0, Math.ceil((new Date(tenant.trial_ends_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
          : 0,
      } : null,
    };
  }

  /**
   * 启动试用期
   */
  startTrial(tenantId: string, trialDays: number = 14): Record<string, unknown> {
    const db = getDatabase();
    const now = new Date().toISOString();
    const endsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString();

    db.prepare(
      `UPDATE tenants SET plan = 'trial', trial_started_at = ?, trial_ends_at = ?, updated_at = datetime('now', '+0000') WHERE id = ?`
    ).run(now, endsAt, tenantId);

    // Create trial subscription
    const subId = uuidv4();
    db.prepare(
      `INSERT INTO subscriptions (id, tenant_id, plan, status, billing_cycle, amount, trial_started_at, trial_ends_at, current_period_start, current_period_end, auto_renew)
       VALUES (?, ?, 'trial', 'trialing', 'monthly', 0, ?, ?, ?, ?, 0)`
    ).run(subId, tenantId, now, endsAt, now, endsAt);

    // Create trial license
    this.createLicense({
      plan: 'trial',
      type: 'trial',
      tenantId,
      expiresInDays: trialDays,
      issuedBy: 'system',
    });

    logger.info('license', `Trial started for tenant ${tenantId}, ends at ${endsAt}`);
    return this.getTenantLicenseInfo(tenantId);
  }

  /**
   * 检查功能权限（商业化核心）
   */
  hasFeature(tenantId: string, feature: string): boolean {
    const db = getDatabase();
    const tenant = db.prepare('SELECT plan FROM tenants WHERE id = ? AND status = ?').get(tenantId, 'active') as any;

    if (!tenant) return false;

    const planDef = PLAN_DEFINITIONS[tenant.plan as PlanKey] || PLAN_DEFINITIONS.free;
    const planFeatures = planDef.features as readonly string[];
    return planFeatures.includes('*') || planFeatures.includes(feature);
  }

  /**
   * 检查配额（每日API调用限制等）
   */
  checkQuota(tenantId: string, metric: string): { exceeded: boolean; current: number; limit: number } {
    const db = getDatabase();
    const today = new Date().toISOString().slice(0, 10);

    const tenant = db.prepare('SELECT plan FROM tenants WHERE id = ?').get(tenantId) as any;
    if (!tenant) return { exceeded: true, current: 0, limit: 0 };

    const planDef = PLAN_DEFINITIONS[tenant.plan as PlanKey] || PLAN_DEFINITIONS.free;

    let limit = -1;
    switch (metric) {
      case 'api_calls': limit = planDef.maxApiCallsPerDay; break;
      case 'storage_mb': limit = planDef.maxStorageMb; break;
      default: return { exceeded: false, current: 0, limit: -1 };
    }

    if (limit === -1) return { exceeded: false, current: 0, limit: -1 }; // unlimited

    const usage = db.prepare(
      'SELECT * FROM usage_tracking WHERE tenant_id = ? AND date = ?'
    ).get(tenantId, today) as any;

    const current = usage ? (usage[metric] || 0) : 0;
    return { exceeded: current >= limit, current, limit };
  }

  /**
   * 记录用量
   */
  recordUsage(tenantId: string, metric: string, amount: number = 1): void {
    const db = getDatabase();
    const today = new Date().toISOString().slice(0, 10);

    db.prepare(
      `INSERT INTO usage_tracking (id, tenant_id, date, ${metric}, created_at, updated_at)
       VALUES (?, ?, ?, ?, datetime('now', '+0000'), datetime('now', '+0000'))
       ON CONFLICT(tenant_id, date) DO UPDATE SET
         ${metric} = usage_tracking.${metric} + ?,
         updated_at = datetime('now', '+0000')`
    ).run(uuidv4(), tenantId, today, amount, amount);
  }

  /**
   * 注册设备（设备绑定）
   */
  registerDevice(input: {
    tenantId: string;
    userId: string;
    deviceId: string;
    deviceName?: string;
    osPlatform?: string;
    osVersion?: string;
    appVersion?: string;
    machineFingerprint?: string;
  }): Record<string, unknown> {
    const db = getDatabase();

    // Check device limit
    const tenant = db.prepare('SELECT plan FROM tenants WHERE id = ?').get(input.tenantId) as any;
    if (!tenant) throw new NotFoundError('租户');

    const planDef = PLAN_DEFINITIONS[tenant.plan as PlanKey] || PLAN_DEFINITIONS.free;
    if (planDef.maxDevices !== -1) {
      const activeDevices = (db.prepare(
        "SELECT COUNT(*) as count FROM device_registrations WHERE tenant_id = ? AND status = 'active'"
      ).get(input.tenantId) as any).count;

      // Check if this device is already registered
      const existing = db.prepare(
        'SELECT * FROM device_registrations WHERE tenant_id = ? AND device_id = ?'
      ).get(input.tenantId, input.deviceId) as any;

      if (!existing && activeDevices >= planDef.maxDevices) {
        throw new AppError(
          `设备数量已达上限 (${planDef.maxDevices})，请先停用其他设备或升级计划`,
          403, 'DEVICE_LIMIT_EXCEEDED'
        );
      }
    }

    // Upsert device
    const id = uuidv4();
    db.prepare(
      `INSERT INTO device_registrations (id, tenant_id, user_id, device_id, device_name, os_platform, os_version, app_version, machine_fingerprint, status, first_activated_at, last_active_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', datetime('now', '+0000'), datetime('now', '+0000'))
       ON CONFLICT(tenant_id, device_id) DO UPDATE SET
         user_id = excluded.user_id,
         device_name = excluded.device_name,
         os_platform = excluded.os_platform,
         os_version = excluded.os_version,
         app_version = excluded.app_version,
         machine_fingerprint = excluded.machine_fingerprint,
         status = 'active',
         last_active_at = datetime('now', '+0000')`
    ).run(
      id, input.tenantId, input.userId, input.deviceId,
      input.deviceName || null, input.osPlatform || null,
      input.osVersion || null, input.appVersion || null,
      input.machineFingerprint || null
    );

    return db.prepare(
      'SELECT * FROM device_registrations WHERE tenant_id = ? AND device_id = ?'
    ).get(input.tenantId, input.deviceId) as any;
  }

  /**
   * 获取租户设备列表
   */
  listDevices(tenantId: string): Record<string, unknown>[] {
    const db = getDatabase();
    return db.prepare(
      `SELECT d.*, u.display_name as user_name
       FROM device_registrations d LEFT JOIN users u ON d.user_id = u.id
       WHERE d.tenant_id = ? ORDER BY d.last_active_at DESC`
    ).all(tenantId) as any[];
  }

  /**
   * 停用设备
   */
  deactivateDevice(tenantId: string, deviceId: string): void {
    const db = getDatabase();
    const result = db.prepare(
      "UPDATE device_registrations SET status = 'deactivated', deactivated_at = datetime('now', '+0000') WHERE tenant_id = ? AND device_id = ?"
    ).run(tenantId, deviceId) as { changes?: number };
    if (result.changes === 0) throw new NotFoundError('设备');
  }

  /**
   * 获取用量统计
   */
  getUsageStats(tenantId: string, days: number = 30): Record<string, unknown> {
    const db = getDatabase();
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const stats = db.prepare(
      `SELECT date, api_calls, storage_used_mb, active_users, employees, orders, ai_messages, skill_executions
       FROM usage_tracking WHERE tenant_id = ? AND date >= ? ORDER BY date`
    ).all(tenantId, startDate) as any[];

    const tenant = db.prepare('SELECT plan FROM tenants WHERE id = ?').get(tenantId) as any;
    const planDef = PLAN_DEFINITIONS[tenant?.plan as PlanKey] || PLAN_DEFINITIONS.free;

    return {
      plan: tenant?.plan,
      limits: {
        maxUsers: planDef.maxUsers,
        maxDevices: planDef.maxDevices,
        maxStorageMb: planDef.maxStorageMb,
        maxApiCallsPerDay: planDef.maxApiCallsPerDay,
      },
      dailyStats: stats,
      totalApiCalls: stats.reduce((sum, s) => sum + (s.api_calls || 0), 0),
      avgApiCallsPerDay: stats.length > 0 ? Math.round(stats.reduce((sum, s) => sum + (s.api_calls || 0), 0) / stats.length) : 0,
    };
  }

  /**
   * 检查租户账号状态（商业化强制）
   */
  checkTenantStatus(tenantId: string): { active: boolean; reason?: string } {
    const db = getDatabase();
    const tenant = db.prepare('SELECT status, plan, trial_ends_at FROM tenants WHERE id = ?').get(tenantId) as any;

    if (!tenant) return { active: false, reason: '租户不存在' };
    if (tenant.status === 'suspended') return { active: false, reason: '账号已被暂停，请联系管理员' };
    if (tenant.status === 'archived') return { active: false, reason: '账号已被归档' };

    // Check trial expiry
    if (tenant.plan === 'trial' && tenant.trial_ends_at) {
      if (new Date(tenant.trial_ends_at) < new Date()) {
        // Auto-downgrade to free
        db.prepare("UPDATE tenants SET plan = 'free', updated_at = datetime('now', '+0000') WHERE id = ?").run(tenantId);
        db.prepare("UPDATE subscriptions SET status = 'expired' WHERE tenant_id = ? AND status = 'trialing'").run(tenantId);
        return { active: true, reason: '试用已过期，已自动降级为免费版' };
      }
    }

    return { active: true };
  }
}

export const licenseService = new LicenseService();
