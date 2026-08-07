/**
 * 多租户存储隔离层 — IndexedDB + 租户命名空间
 * 所有业务数据强制注入 TenantID，支持 schema 级别隔离
 * 提供统一的 get/set/delete 接口，自动注入租户上下文
 */

import { requireTenantId } from '@multi-tenant/auth/tenantContext';
import { getItem, setItem, delItem, listKeys } from '@utils/storage';

// ─── 租户命名空间前缀 ───

function tenantKey(tenantId: string, key: string): string {
  return `tenant:${tenantId}:${key}`;
}

// ─── 严格模式：强制要求租户上下文 ───

function assertTenantId(tenantId?: string): string {
  if (tenantId) return tenantId;
  return requireTenantId();
}

// ─── 租户隔离的存储操作 ───

export async function tenantGetItem<T>(
  key: string,
  tenantId?: string
): Promise<T | null> {
  const tid = assertTenantId(tenantId);
  return getItem<T>(tenantKey(tid, key));
}

export async function tenantSetItem<T>(
  key: string,
  value: T,
  tenantId?: string
): Promise<void> {
  const tid = assertTenantId(tenantId);
  return setItem(tenantKey(tid, key), value);
}

export async function tenantDelItem(
  key: string,
  tenantId?: string
): Promise<void> {
  const tid = assertTenantId(tenantId);
  return delItem(tenantKey(tid, key));
}

// ─── 列出租户下的所有键 ───

export async function tenantListKeys(tenantId?: string): Promise<string[]> {
  const tid = assertTenantId(tenantId);
  const allKeys = await listKeys();
  const prefix = `tenant:${tid}:`;
  return allKeys
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.substring(prefix.length));
}

// ─── 清除租户的所有数据 ───

export async function tenantClearAll(tenantId?: string): Promise<void> {
  const tid = assertTenantId(tenantId);
  const allKeys = await listKeys();
  const prefix = `tenant:${tid}:`;
  for (const key of allKeys) {
    if (key.startsWith(prefix)) {
      await delItem(key);
    }
  }
}

// ─── 租户数据导出 ───

export async function tenantExportAll(tenantId?: string): Promise<Record<string, unknown>> {
  const tid = assertTenantId(tenantId);
  const allKeys = await listKeys();
  const prefix = `tenant:${tid}:`;
  const result: Record<string, unknown> = {};

  for (const key of allKeys) {
    if (key.startsWith(prefix)) {
      const shortKey = key.substring(prefix.length);
      result[shortKey] = await getItem(key);
    }
  }

  result['_tenantId'] = tid;
  result['_exportedAt'] = new Date().toISOString();
  return result;
}

// ─── 租户数据导入 ───

export async function tenantImportData(
  data: Record<string, unknown>,
  tenantId?: string
): Promise<{ imported: number; skipped: number }> {
  const tid = assertTenantId(tenantId);
  let imported = 0;
  let skipped = 0;

  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith('_')) { skipped++; continue; }
    await setItem(tenantKey(tid, key), value);
    imported++;
  }

  return { imported, skipped };
}

// ─── 行级租户过滤（前端用） ───

export function filterByTenantId<T extends { tenantId?: string }>(
  items: T[],
  tenantId: string
): T[] {
  return items.filter((item) => item.tenantId === tenantId);
}

// ─── ORM 层拦截器模拟 ───

export function withTenantFilter<T>(
  items: T[],
  tenantId?: string
): T[] {
  const tid = assertTenantId(tenantId);
  return items.filter((item) => {
    const record = item as Record<string, unknown>;
    return !record.tenantId || record.tenantId === tid;
  });
}

// ─── 租户初始化 ───

export async function initializeTenantStorage(
  tenantId: string
): Promise<{ created: string[] }> {
  const created: string[] = [];
  const defaultKeys = [
    'ogsm', 'tasks', 'raci', 'risks', 'incentives',
    'incentive-results', 'pilots', 'policies', 'employees',
    'scenarios', 'config',
  ];

  for (const key of defaultKeys) {
    const fullKey = tenantKey(tenantId, key);
    const existing = await getItem(fullKey);
    if (existing === null) {
      await setItem(fullKey, []);
      created.push(fullKey);
    }
  }

  return { created };
}

// ─── 测试夹具 ───

export async function createTestStore(): Promise<{ tenantId: string }> {
  const tenantId = 'test-tenant-mt-001';
  await initializeTenantStorage(tenantId);
  return { tenantId };
}