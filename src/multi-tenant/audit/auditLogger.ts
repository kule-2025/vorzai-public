/**
 * 审计日志系统 — 事件驱动型审计追踪
 * 所有安全事件、数据操作、权限变更自动记录
 * 支持按租户/用户/时间/操作类型维度检索
 */

import {
  AuditEntry, AuditAction, AuditSeverity, SecurityEvent,
  AlertConfig, AlertChannel,
} from '@multi-tenant/types';
import { getCurrentContext } from '@multi-tenant/auth/tenantContext';
import { getItem, setItem } from '@utils/storage';

// ─── 存储键 ───

const AUDIT_STORE_KEY = 'mt:audit:logs';
const SECURITY_STORE_KEY = 'mt:security:events';
const MAX_AUDIT_ENTRIES = 10000;
const MAX_SECURITY_EVENTS = 5000;

// ─── ID 生成 ───

function generateId(): string {
  const hex = crypto.getRandomValues(new Uint8Array(4));
  const rand = Array.from(hex, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${Date.now().toString(36)}-${rand}`;
}

function getClientIP(): string {
  return '127.0.0.1';
}

function getUserAgent(): string {
  return navigator.userAgent || 'unknown';
}

// ─── 写入审计日志 ───

export async function writeAuditLog(
  action: AuditAction,
  detail: string,
  opts?: {
    severity?: AuditSeverity;
    resource?: string;
    resourceId?: string;
    userId?: string;
    userName?: string;
    tenantId?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<AuditEntry> {
  const ctx = getCurrentContext();

  const entry: AuditEntry = {
    id: generateId(),
    tenantId: opts?.tenantId || ctx?.tenantId || 'system',
    userId: opts?.userId || ctx?.userId || 'system',
    userName: opts?.userName || ctx?.userName || 'System',
    action,
    severity: opts?.severity || 'info',
    resource: opts?.resource || 'unknown',
    resourceId: opts?.resourceId,
    detail,
    ip: getClientIP(),
    userAgent: getUserAgent(),
    deviceId: ctx?.deviceId || 'unknown',
    sessionId: ctx?.sessionId || 'unknown',
    metadata: opts?.metadata || {},
    timestamp: new Date().toISOString(),
  };

  // 持久化存储
  try {
    const existing = (await getItem<AuditEntry[]>(AUDIT_STORE_KEY)) || [];
    existing.push(entry);
    // 限制最大条目数
    if (existing.length > MAX_AUDIT_ENTRIES) {
      existing.splice(0, existing.length - MAX_AUDIT_ENTRIES);
    }
    await setItem(AUDIT_STORE_KEY, existing);
  } catch {
    // 本地存储降级
    try {
      const raw = localStorage.getItem(AUDIT_STORE_KEY);
      const logs: AuditEntry[] = raw ? JSON.parse(raw) : [];
      logs.push(entry);
      if (logs.length > MAX_AUDIT_ENTRIES) {
        logs.splice(0, logs.length - MAX_AUDIT_ENTRIES);
      }
      localStorage.setItem(AUDIT_STORE_KEY, JSON.stringify(logs));
    } catch { /* ignore */ }
  }

  return entry;
}

// ─── 记录安全事件 ───

export async function recordSecurityEvent(
  type: SecurityEvent['type'],
  detail: string,
  opts?: {
    severity?: AuditSeverity;
    userId?: string;
    userName?: string;
    tenantId?: string;
    requestPath?: string;
    requestMethod?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<SecurityEvent> {
  const ctx = getCurrentContext();

  const event: SecurityEvent = {
    id: generateId(),
    tenantId: opts?.tenantId || ctx?.tenantId || 'system',
    type,
    severity: opts?.severity || 'warning',
    userId: opts?.userId || ctx?.userId || 'system',
    userName: opts?.userName || ctx?.userName || 'System',
    ip: getClientIP(),
    detail,
    requestPath: opts?.requestPath,
    requestMethod: opts?.requestMethod,
    timestamp: new Date().toISOString(),
    resolved: false,
  };

  // 持久化
  try {
    const existing = (await getItem<SecurityEvent[]>(SECURITY_STORE_KEY)) || [];
    existing.push(event);
    if (existing.length > MAX_SECURITY_EVENTS) {
      existing.splice(0, existing.length - MAX_SECURITY_EVENTS);
    }
    await setItem(SECURITY_STORE_KEY, existing);
  } catch {
    try {
      const raw = localStorage.getItem(SECURITY_STORE_KEY);
      const events: SecurityEvent[] = raw ? JSON.parse(raw) : [];
      events.push(event);
      if (events.length > MAX_SECURITY_EVENTS) {
        events.splice(0, events.length - MAX_SECURITY_EVENTS);
      }
      localStorage.setItem(SECURITY_STORE_KEY, JSON.stringify(events));
    } catch { /* ignore */ }
  }

  // 触发告警（同步调用）
  await triggerAlert(event);

  return event;
}

// ─── 告警通知 ───

async function triggerAlert(event: SecurityEvent): Promise<void> {
  try {
    const configs = await getItem<AlertConfig[]>('mt:alert:configs');
    if (!configs) return;

    const matching = configs.filter(
      (c) => c.enabled && c.events.includes(event.type)
    );

    // 本地环境：console 输出
    for (const config of matching) {
      console.warn(
        `[安全告警][${config.channel}] ${config.name}: ${event.detail}`,
        { event, webhook: config.webhook }
      );
    }
  } catch {
    // 静默失败
  }
}

// ─── 查询审计日志 ───

export async function queryAuditLogs(opts?: {
  tenantId?: string;
  userId?: string;
  action?: AuditAction;
  severity?: AuditSeverity;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}): Promise<{ entries: AuditEntry[]; total: number }> {
  try {
    const all = (await getItem<AuditEntry[]>(AUDIT_STORE_KEY)) || [];
    let filtered = all;

    if (opts?.tenantId) filtered = filtered.filter((e) => e.tenantId === opts.tenantId);
    if (opts?.userId) filtered = filtered.filter((e) => e.userId === opts.userId);
    if (opts?.action) filtered = filtered.filter((e) => e.action === opts.action);
    if (opts?.severity) filtered = filtered.filter((e) => e.severity === opts.severity);
    if (opts?.startDate) filtered = filtered.filter((e) => e.timestamp >= opts.startDate!);
    if (opts?.endDate) filtered = filtered.filter((e) => e.timestamp <= opts.endDate!);

    // 倒序（最新在前）
    filtered.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    const total = filtered.length;
    const offset = opts?.offset || 0;
    const limit = opts?.limit || 50;
    const entries = filtered.slice(offset, offset + limit);

    return { entries, total };
  } catch {
    return { entries: [], total: 0 };
  }
}

// ─── 查询安全事件 ───

export async function querySecurityEvents(opts?: {
  tenantId?: string;
  type?: SecurityEvent['type'];
  severity?: AuditSeverity;
  resolved?: boolean;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}): Promise<{ events: SecurityEvent[]; total: number }> {
  try {
    const all = (await getItem<SecurityEvent[]>(SECURITY_STORE_KEY)) || [];
    let filtered = all;

    if (opts?.tenantId) filtered = filtered.filter((e) => e.tenantId === opts.tenantId);
    if (opts?.type) filtered = filtered.filter((e) => e.type === opts.type);
    if (opts?.severity) filtered = filtered.filter((e) => e.severity === opts.severity);
    if (opts?.resolved !== undefined) filtered = filtered.filter((e) => e.resolved === opts.resolved);
    if (opts?.startDate) filtered = filtered.filter((e) => e.timestamp >= opts.startDate!);
    if (opts?.endDate) filtered = filtered.filter((e) => e.timestamp <= opts.endDate!);

    filtered.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    const total = filtered.length;
    const offset = opts?.offset || 0;
    const limit = opts?.limit || 50;
    const events = filtered.slice(offset, offset + limit);

    return { events, total };
  } catch {
    return { events: [], total: 0 };
  }
}

// ─── 解析安全事件 ───

export async function resolveSecurityEvent(
  eventId: string,
  resolvedBy: string
): Promise<boolean> {
  try {
    const existing = (await getItem<SecurityEvent[]>(SECURITY_STORE_KEY)) || [];
    const idx = existing.findIndex((e) => e.id === eventId);
    if (idx === -1) return false;

    existing[idx].resolved = true;
    existing[idx].resolvedAt = new Date().toISOString();
    existing[idx].resolvedBy = resolvedBy;
    await setItem(SECURITY_STORE_KEY, existing);
    return true;
  } catch {
    return false;
  }
}

// ─── 生成审计报表 ───

export async function generateAuditReport(opts: {
  tenantId?: string;
  startDate: string;
  endDate: string;
}): Promise<{
  totalEntries: number;
  byAction: Record<string, number>;
  bySeverity: Record<string, number>;
  topUsers: { userId: string; userName: string; count: number }[];
  securityEvents: number;
  // E-002: 导出原始数据供 UI 层对接 Electron saveFile
  rawEntries?: unknown[];
  rawEvents?: unknown[];
}> {
  const { entries } = await queryAuditLogs({
    tenantId: opts.tenantId,
    startDate: opts.startDate,
    endDate: opts.endDate,
    limit: MAX_AUDIT_ENTRIES,
  });

  const byAction: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  const userCount: Record<string, { name: string; count: number }> = {};

  for (const e of entries) {
    byAction[e.action] = (byAction[e.action] || 0) + 1;
    bySeverity[e.severity] = (bySeverity[e.severity] || 0) + 1;
    if (!userCount[e.userId]) {
      userCount[e.userId] = { name: e.userName, count: 0 };
    }
    userCount[e.userId].count++;
  }

  const topUsers = Object.entries(userCount)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([userId, data]) => ({ userId, userName: data.name, count: data.count }));

  const { events } = await querySecurityEvents({
    tenantId: opts.tenantId,
    startDate: opts.startDate,
    endDate: opts.endDate,
    limit: MAX_SECURITY_EVENTS,
  });

  return {
    totalEntries: entries.length,
    byAction,
    bySeverity,
    topUsers,
    securityEvents: events.length,
    // E-002: 导出原始数据供 UI 层对接 Electron saveFile
    rawEntries: entries as unknown[],
    rawEvents: events as unknown[],
  };
}

// ─── E-002: 审计报告文件导出 ───

/** 生成审计报告 JSON 文件（供 UI 层调 Electron saveFile 下载） */
export async function exportAuditReport(opts: {
  tenantId?: string;
  startDate: string;
  endDate: string;
  format: 'json' | 'csv';
}): Promise<Blob> {
  const report = await generateAuditReport(opts);

  if (opts.format === 'json') {
    const json = JSON.stringify(report, null, 2);
    return new Blob([json], { type: 'application/json' });
  }

  // CSV: byAction + bySeverity + topUsers 三表合并
  const rows = [['metric', 'value']];
  for (const [action, count] of Object.entries(report.byAction)) {
    rows.push([`action:${action}`, String(count)]);
  }
  for (const [severity, count] of Object.entries(report.bySeverity)) {
    rows.push([`severity:${severity}`, String(count)]);
  }
  for (const u of report.topUsers) {
    rows.push([`top-user:${u.userId}`, `${u.userName}(${u.count})`]);
  }
  const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
  return new Blob([csv], { type: 'text/csv' });
}

/** 调用 Electron saveFile 保存审计报告（渲染进程通过 IPC 调用） */
export async function saveAuditReportFile(opts: {
  tenantId?: string;
  startDate: string;
  endDate: string;
  format: 'json' | 'csv';
}): Promise<void> {
  const blob = await exportAuditReport(opts);
  const buffer = await blob.arrayBuffer();

  // E-002: 通过 IPC 调用 Electron saveFile 下载
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const ext = opts.format === 'json' ? 'json' : 'csv';
  const defaultName = `audit-report-${timestamp}.${ext}`;

  const api = (window as any).electronAPI;
  if (api?.saveFile) {
    await api.saveFile({
      data: Array.from(new Uint8Array(buffer)),
      defaultPath: defaultName,
      filters: [
        { name: 'Audit Report', extensions: [ext] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
  } else {
    // 浏览器降级：a download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = defaultName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

// ─── E-006: 审计日志滚动存储（按时间删除超期条目） ───

const MAX_TOTAL_BYTES = 2 * 1024 * 1024; // 2MB 总容量上限
const ROLLBACK_THRESHOLD_RATIO = 0.8;     // 达到 80% 时触发滚动删除

async function rotateOldEntries<T>(
  storeKey: string,
  maxEntries: number,
  maxBytes: number
): Promise<void> {
  const data = await getItem<Record<string, T[]>>(storeKey);
  if (!data) return;

  const entryKeys = Object.keys(data);
  // 按写入时间（key 前缀含时间戳）排序，删除最早条目
  const sorted = entryKeys.sort();

  // 字节数估算
  let totalBytes = 0;
  for (const k of entryKeys) {
    totalBytes += new TextEncoder().encode(JSON.stringify(data[k])).length;
  }

  const thresholdBytes = maxBytes * ROLLBACK_THRESHOLD_RATIO;
  while (totalBytes > thresholdBytes && entryKeys.length > 10) {
    const oldest = sorted.shift()!;
    totalBytes -= new TextEncoder().encode(JSON.stringify(data[oldest])).length;
    delete data[oldest];
  }

  // 同时保证条数上限
  while (entryKeys.length > maxEntries) {
    const oldest = sorted.shift()!;
    delete data[oldest];
  }

  await setItem(storeKey, data);
}

/** 写入审计日志前触发滚动（E-006） */
export async function writeAuditLogWithRotation(
  action: AuditAction,
  detail: string,
  opts?: {
    tenantId?: string;
    userId?: string;
    userName?: string;
    severity?: AuditSeverity;
    resource?: string;
    ip?: string;
    userAgent?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  // 先滚动再写入，保证容量上限
  await rotateOldEntries(AUDIT_STORE_KEY, MAX_AUDIT_ENTRIES, MAX_TOTAL_BYTES);
  await writeAuditLog(action, detail, opts);
}

// ─── 快捷日志辅助函数 ───

export async function logLogin(userId: string, userName: string, success: boolean): Promise<void> {
  await writeAuditLog('login', success ? '登录成功' : '登录失败', {
    severity: success ? 'info' : 'warning',
    resource: 'auth',
    userId,
    userName,
    metadata: { success },
  });
}

export async function logCrossTenantAttempt(
  userId: string, userName: string, fromTenant: string, toTenant: string, path: string
): Promise<void> {
  await recordSecurityEvent('cross-tenant-access',
    `用户 ${userName} 尝试跨租户访问：从 ${fromTenant} 到 ${toTenant}，路径: ${path}`,
    { severity: 'critical', userId, userName, tenantId: fromTenant, requestPath: path }
  );
}

export async function logFileOperation(
  action: 'file:upload' | 'file:download' | 'file:delete' | 'file:preview',
  fileName: string, fileSize: number
): Promise<void> {
  await writeAuditLog(action, `文件操作: ${fileName} (${fileSize} bytes)`, {
    resource: 'file',
    resourceId: fileName,
    metadata: { fileName, fileSize },
  });
}