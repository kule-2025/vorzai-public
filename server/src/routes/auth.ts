import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authService, createDelegatedPermission, listDelegatedPermissions, revokeDelegatedPermission, checkPermission } from '../services/authService';
import { AuthorizationError, ValidationError } from '../utils/errors';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler, successResponse } from '../middleware/common';
import { validatePasswordStrength } from '../utils/security';

const router = Router();

const registerSchema = z.object({
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/, '用户名只能包含字母、数字、下划线或中文'),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(100),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  tenantName: z.string().optional(),
});

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  tenantSlug: z.string().optional(),
});

const changePasswordSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

// 密码强度校验中间件
function enforcePasswordPolicy(password: string): void {
  const result = validatePasswordStrength(password);
  if (!result.valid) {
    throw new ValidationError(`密码不满足安全要求: ${result.errors.join('; ')}`);
  }
}

const createDelegatedPermissionSchema = z.object({
  delegateeId: z.string().uuid(),
  scope: z.enum(['orders', 'products', 'inventory', 'ogsm', 'hr', 'all']),
  permissionPoint: z.string().min(1).max(200),
  expiresAt: z.string().optional(),
});

const checkPermissionSchema = z.object({
  resource: z.string().min(1),
  action: z.string().min(1),
  userId: z.string().uuid(),
});

// GET /api/auth/delegated-permissions — 列出当前用户的委托权限
router.get('/delegated-permissions', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const { type } = req.query;
  const typeParam = (type === 'granted' || type === 'given') ? type as 'granted' | 'given' : undefined;
  const permissions = listDelegatedPermissions(req.user!.tenantId, req.user!.userId, typeParam);
  successResponse(res, permissions);
}));

// POST /api/auth/delegated-permissions — 创建委托权限
router.post('/delegated-permissions', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const input = createDelegatedPermissionSchema.parse(req.body);
  const permission = createDelegatedPermission(
    req.user!.tenantId,
    req.user!.userId,
    input.delegateeId,
    input.scope,
    input.permissionPoint,
    input.expiresAt
  );
  successResponse(res, permission, '委托权限已创建', 201);
}));

// DELETE /api/auth/delegated-permissions/:id — 撤销委托权限
router.delete('/delegated-permissions/:id', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  revokeDelegatedPermission(req.params.id, req.user!.tenantId);
  successResponse(res, null, '委托权限已撤销');
}));

// POST /api/auth/permissions/check — 检查权限
router.post('/permissions/check', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const input = checkPermissionSchema.parse(req.body);
  const result = checkPermission(req.user!.tenantId, input.userId, input.resource, input.action);
  successResponse(res, result);
}));

// POST /api/auth/register
router.post('/register', asyncHandler(async (req: Request, res: Response) => {
  const input = registerSchema.parse(req.body);
  enforcePasswordPolicy(input.password);
  const result = authService.register(input);
  successResponse(res, result, '注册成功', 201);
}));

// POST /api/auth/login
router.post('/login', asyncHandler(async (req: Request, res: Response) => {
  const input = loginSchema.parse(req.body);
  const result = authService.login(input);
  successResponse(res, result, '登录成功');
}));

// POST /api/auth/refresh
router.post('/refresh', asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = z.object({ refreshToken: z.string() }).parse(req.body);
  const tokens = authService.refreshToken(refreshToken);
  successResponse(res, tokens, '令牌已刷新');
}));

// POST /api/auth/logout
router.post('/logout', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  authService.logout(req.user!.userId);
  successResponse(res, null, '已登出');
}));

// GET /api/auth/profile
router.get('/profile', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const profile = authService.getUserProfile(req.user!.userId);
  successResponse(res, profile);
}));

// PUT /api/auth/password
router.put('/password', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const input = changePasswordSchema.parse(req.body);
  enforcePasswordPolicy(input.newPassword);
  authService.changePassword(req.user!.userId, input.oldPassword, input.newPassword);
  successResponse(res, null, '密码修改成功');
}));

export default router;
