import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { licenseService, PLAN_DEFINITIONS } from '../services/licenseService';
import { authenticateToken, tenantIsolation, requireRole } from '../middleware/auth';
import { checkAccountStatus, requireFeature } from '../middleware/license';
import { asyncHandler, successResponse, paginatedResponse } from '../middleware/common';

const router = Router();
router.use(authenticateToken, tenantIsolation, checkAccountStatus);

// ==================== 许可证管理 ====================

// GET /api/license/info — 获取当前租户的许可证和订阅信息
router.get('/info', asyncHandler(async (req: Request, res: Response) => {
  const info = licenseService.getTenantLicenseInfo(req.user!.tenantId);
  successResponse(res, info);
}));

// POST /api/license/activate — 激活许可证密钥
router.post('/activate', asyncHandler(async (req: Request, res: Response) => {
  const { licenseKey, deviceId } = z.object({
    licenseKey: z.string().min(1),
    deviceId: z.string().optional(),
  }).parse(req.body);

  const result = licenseService.activateLicense(licenseKey, req.user!.tenantId, deviceId);
  successResponse(res, result, '许可证激活成功');
}));

// POST /api/license/trial — 启动试用期
router.post('/trial', asyncHandler(async (req: Request, res: Response) => {
  const db = require('../db').getDatabase();
  const tenant = db.prepare('SELECT plan, trial_started_at FROM tenants WHERE id = ?').get(req.user!.tenantId) as any;

  if (tenant.trial_started_at) {
    throw new Error('试用期已启动过，无法重复启动');
  }

  const result = licenseService.startTrial(req.user!.tenantId, 14);
  successResponse(res, result, '试用期已启动（14天）');
}));

// GET /api/license/usage — 获取用量统计
router.get('/usage', asyncHandler(async (req: Request, res: Response) => {
  const days = Number(req.query.days) || 30;
  const stats = licenseService.getUsageStats(req.user!.tenantId, days);
  successResponse(res, stats);
}));

// GET /api/license/plans — 获取所有计划定义
router.get('/plans', asyncHandler(async (req: Request, res: Response) => {
  const plans = Object.entries(PLAN_DEFINITIONS).map(([key, def]: [string, any]) => ({
    key,
    name: def.name,
    price: def.price,
    maxUsers: def.maxUsers,
    maxDevices: def.maxDevices,
    maxStorageMb: def.maxStorageMb,
    maxApiCallsPerDay: def.maxApiCallsPerDay,
    features: def.features,
  }));
  successResponse(res, plans);
}));

// ==================== 设备管理 ====================

// POST /api/license/devices — 注册/更新设备
router.post('/devices', asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    deviceId: z.string().min(1),
    deviceName: z.string().optional(),
    osPlatform: z.string().optional(),
    osVersion: z.string().optional(),
    appVersion: z.string().optional(),
    machineFingerprint: z.string().optional(),
  }).parse(req.body);

  const result = licenseService.registerDevice({
    tenantId: req.user!.tenantId,
    userId: req.user!.userId,
    ...input,
  });
  successResponse(res, result, '设备注册成功', 201);
}));

// GET /api/license/devices — 获取设备列表
router.get('/devices', asyncHandler(async (req: Request, res: Response) => {
  const devices = licenseService.listDevices(req.user!.tenantId);
  successResponse(res, devices);
}));

// DELETE /api/license/devices/:deviceId — 停用设备
router.delete('/devices/:deviceId', asyncHandler(async (req: Request, res: Response) => {
  licenseService.deactivateDevice(req.user!.tenantId, req.params.deviceId);
  successResponse(res, null, '设备已停用');
}));

// ==================== 数据备份管理（仅 owner/admin） ====================

// POST /api/license/backup — 触发数据库备份
router.post('/backup', requireRole('owner', 'admin'), asyncHandler(async (req: Request, res: Response) => {
  const { createBackup } = require('../db/backup');
  const result = createBackup(req.user!.tenantId);
  successResponse(res, result, '数据库备份已创建', 201);
}));

// GET /api/license/backups — 列出可用备份
router.get('/backups', requireRole('owner', 'admin'), asyncHandler(async (req: Request, res: Response) => {
  const { listBackups } = require('../db/backup');
  const backups = listBackups();
  successResponse(res, backups);
}));

// POST /api/license/backup/restore — 从指定备份恢复（危险操作，仅 owner）
router.post('/backup/restore', requireRole('owner'), asyncHandler(async (req: Request, res: Response) => {
  const { backupId } = z.object({ backupId: z.string().min(1) }).parse(req.body);
  const { restoreBackup } = require('../db/backup');
  const result = restoreBackup(backupId, req.user!.tenantId);
  successResponse(res, result, '数据库已从备份恢复');
}));

// ==================== 管理员：许可证生成（仅 owner/admin） ====================

// POST /api/license/generate — 生成许可证密钥（管理员操作）
router.post('/generate', requireRole('owner', 'admin'), asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    plan: z.enum(['free', 'trial', 'standard', 'professional', 'enterprise']),
    type: z.enum(['subscription', 'perpetual', 'trial', 'educational']).optional(),
    expiresInDays: z.number().optional(),
    issuedTo: z.string().optional(),
    maxUsers: z.number().optional(),
    maxDevices: z.number().optional(),
    features: z.array(z.string()).optional(),
  }).parse(req.body);

  const result = licenseService.createLicense({
    ...input,
    tenantId: req.user!.tenantId,
    issuedBy: req.user!.username,
  });
  successResponse(res, result, '许可证生成成功', 201);
}));

export default router;
