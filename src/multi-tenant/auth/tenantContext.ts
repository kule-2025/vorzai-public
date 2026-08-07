/**
 * 租户身份认证 — HMAC 签名校验
 * 所有请求上下文中的租户身份须经 HMAC 签名，防止伪造/篡改
 */

import {
  TenantContext, TenantToken, TenantUser, TenantConfig,
  TenantUserRole,
} from '@multi-tenant/types';

// ─── HMAC 密钥（从环境变量读取，渲染进程通过 IPC 获取，Electron 主进程直接读取） ───

let __hmacSecret: string | undefined;

/**
 * 获取 HMAC 密钥
 * 优先级：环境变量 VORZAI_MT_HMAC_SECRET > 默认值
 * 无环境变量时输出警告但仍工作，保证开发环境可用性
 */
export function getHmacSecret(): string {
  if (!__hmacSecret) {
    const envVar =
      typeof globalThis !== 'undefined' &&
      typeof (globalThis as any).process !== 'undefined'
        ? (globalThis as any).process?.env?.VORZAI_MT_HMAC_SECRET
        : undefined;
    if (envVar) {
      __hmacSecret = envVar;
    } else {
      __hmacSecret = 'vorzai-ecommerce-mt-hmac-secret-2026';
      console.warn(
        '[TenantContext] 警告：BISU_MT_HMAC_SECRET 环境变量未设置，正在使用默认密钥。' +
        '生产环境必须通过环境变量或 IPC 注入密钥。'
      );
    }
  }
  return __hmacSecret!;
}

/**
 * 注入 HMAC 密钥（渲染进程通过 IPC 调用此函数注入）
 */
export function setHmacSecret(secret: string): void {
  __hmacSecret = secret;
}

const HMAC_ALGORITHM = 'SHA-256';

// ─── 会话管理 ───

let currentSessionId: string | null = null;
let currentContext: TenantContext | null = null;

// ─── 工具函数 ───

function generateId(): string {
  const hex = crypto.getRandomValues(new Uint8Array(4));
  const rand = Array.from(hex, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${Date.now().toString(36)}-${rand}`;
}

function getClientIP(): string {
  return '127.0.0.1'; // 本地环境取回环地址
}

function getDeviceId(): string {
  try {
    const stored = localStorage.getItem('vorzai:deviceId');
    if (stored) return stored;
    const id = `device-${generateId()}`;
    localStorage.setItem('vorzai:deviceId', id);
    return id;
  } catch {
    return `device-${generateId()}`;
  }
}

// ─── HMAC 签名与验证 ───

async function hmacSign(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: HMAC_ALGORITHM },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacVerify(payload: string, signature: string, secret: string): Promise<boolean> {
  const expected = await hmacSign(payload, secret);
  // 恒定时间比较
  if (expected.length !== signature.length) return false;
  let result = 0;
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return result === 0;
}

// ─── 构建签名字符串 ───

function buildSignaturePayload(context: Omit<TenantContext, 'signature'>): string {
  return `${context.tenantId}|${context.userId}|${context.role}|${context.sessionId}|${context.signedAt}`;
}

// ─── 创建租户上下文 ───

export async function createTenantContext(
  tenant: TenantConfig,
  user: TenantUser,
  ip?: string
): Promise<TenantContext> {
  const sessionId = currentSessionId || `session-${generateId()}`;
  currentSessionId = sessionId;

  const contextBase: Omit<TenantContext, 'signature'> = {
    tenantId: tenant.id,
    userId: user.id,
    userName: user.name,
    role: user.role,
    permissions: user.permissions,
    department: user.department,
    ip: ip || getClientIP(),
    deviceId: getDeviceId(),
    sessionId,
    signedAt: new Date().toISOString(),
  };

  const payload = buildSignaturePayload(contextBase);
  const signature = await hmacSign(payload, getHmacSecret());

  currentContext = { ...contextBase, signature };
  return currentContext;
}

// ─── 验证租户上下文 ───

export async function verifyTenantContext(context: TenantContext): Promise<boolean> {
  const { signature, ...base } = context;
  const payload = buildSignaturePayload(base);
  return hmacVerify(payload, signature, getHmacSecret());
}

// ─── 获取当前上下文 ───

export function getCurrentContext(): TenantContext | null {
  return currentContext;
}

// ─── 清除上下文（登出） ───

export function clearContext(): void {
  currentContext = null;
  currentSessionId = null;
  try {
    localStorage.removeItem('vorzai:session');
  } catch { /* ignore */ }
}

// ─── 持久化上下文 ───

export async function persistContext(context: TenantContext): Promise<void> {
  try {
    localStorage.setItem('vorzai:session', JSON.stringify(context));
  } catch { /* ignore */ }
}

export async function restoreContext(): Promise<TenantContext | null> {
  try {
    const raw = localStorage.getItem('vorzai:session');
    if (!raw) return null;
    const context = JSON.parse(raw) as TenantContext;
    const valid = await verifyTenantContext(context);
    if (!valid) {
      localStorage.removeItem('vorzai:session');
      return null;
    }
    currentContext = context;
    return context;
  } catch {
    return null;
  }
}

// ─── JWT Token 生成/验证（模拟） ───

export async function generateToken(
  user: TenantUser,
  tenant: TenantConfig,
  durationMinutes = 60
): Promise<TenantToken> {
  const now = Math.floor(Date.now() / 1000);
  const token: TenantToken = {
    sub: user.id,
    tenantId: tenant.id,
    role: user.role,
    permissions: user.permissions,
    iat: now,
    exp: now + durationMinutes * 60,
    jti: generateId(),
    hmac: '',
  };

  const payload = `${token.sub}|${token.tenantId}|${token.iat}|${token.exp}|${token.jti}`;
  token.hmac = await hmacSign(payload, getHmacSecret());

  return token;
}

export async function verifyToken(token: TenantToken): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  if (token.exp < now) return false;

  const payload = `${token.sub}|${token.tenantId}|${token.iat}|${token.exp}|${token.jti}`;
  return hmacVerify(payload, token.hmac, getHmacSecret());
}

// ─── 租户身份注入器（用于数据操作层） ───

export function requireTenantId(): string {
  const ctx = getCurrentContext();
  if (!ctx) throw new Error('TenantContextError: 未找到租户上下文，操作被拒绝');
  return ctx.tenantId;
}

export function requireUserId(): string {
  const ctx = getCurrentContext();
  if (!ctx) throw new Error('TenantContextError: 未找到用户上下文，操作被拒绝');
  return ctx.userId;
}

// ─── 测试夹具 ───

export async function createTestContext(
  overrides?: Partial<TenantContext>
): Promise<TenantContext> {
  const defaultCtx: Omit<TenantContext, 'signature'> = {
    tenantId: 'test-tenant-001',
    userId: 'test-user-001',
    userName: '测试管理员',
    role: 'tenant_admin',
    permissions: ['*'],
    department: '技术部',
    ip: '127.0.0.1',
    deviceId: 'test-device-001',
    sessionId: 'test-session-001',
    signedAt: new Date().toISOString(),
    ...overrides,
  };

  const payload = buildSignaturePayload(defaultCtx);
  const signature = await hmacSign(payload, getHmacSecret());
  return { ...defaultCtx, signature };
}