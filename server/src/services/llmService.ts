/**
 * LLM 平台管理服务（P1：LLMPlatformView 后端落地）
 * api_key 在落库前用 AES-256-GCM 加密（adapters/crypto.ts），明文绝不持久化。
 * 列表接口返回脱敏后的 key 预览，详情接口按需解密。
 */
import { getDatabase } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { encryptSecret, decryptSecret } from './adapters/crypto';
import { NotFoundError, ValidationError } from '../utils/errors';
import { logger } from '../utils/logger';

export interface LLMPlatformRecord {
  id: string;
  tenantId: string;
  name: string;
  provider: string;
  baseUrl: string | null;
  apiKeyMasked: string | null; // 脱敏预览
  models: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

function maskKey(decrypted: string | null): string | null {
  if (!decrypted) return null;
  if (decrypted.length <= 8) return '****';
  return decrypted.slice(0, 4) + '****' + decrypted.slice(-4);
}

function rowToPlatform(row: any, includeDecrypted = false): LLMPlatformRecord {
  const decrypted = row.api_key_secret ? decryptSecret(row.api_key_secret) : null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    provider: row.provider,
    baseUrl: row.base_url,
    apiKeyMasked: maskKey(decrypted),
    models: (() => {
      try { return JSON.parse(row.models_json || '[]'); } catch { return []; }
    })(),
    isActive: !!row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const llmService = {
  list(tenantId: string): LLMPlatformRecord[] {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT * FROM llm_platforms WHERE tenant_id = ? ORDER BY created_at DESC')
      .all(tenantId) as any[];
    return rows.map((r) => rowToPlatform(r, false));
  },

  getById(id: string, tenantId: string): LLMPlatformRecord | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM llm_platforms WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
    return row ? rowToPlatform(row, false) : null;
  },

  /** 返回含明文 key 的记录，仅用于内部调用（如真正的 LLM 请求） */
  getDecrypted(id: string, tenantId: string): { baseUrl: string | null; apiKey: string | null } | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM llm_platforms WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
    if (!row) return null;
    return { baseUrl: row.base_url, apiKey: row.api_key_secret ? decryptSecret(row.api_key_secret) : null };
  },

  create(input: {
    tenantId: string;
    name: string;
    provider: string;
    baseUrl?: string;
    apiKey?: string;
    models?: string[];
    isActive?: boolean;
    createdBy?: string;
  }): LLMPlatformRecord {
    if (!input.name || !input.name.trim()) throw new ValidationError('平台名称不能为空');
    if (!input.provider || !input.provider.trim()) throw new ValidationError('供应商不能为空');
    const db = getDatabase();
    const id = uuidv4();
    const encKey = input.apiKey ? encryptSecret(input.apiKey) : null;
    db.prepare(
      `INSERT INTO llm_platforms (id, tenant_id, name, provider, base_url, api_key_secret, models_json, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.tenantId,
      input.name.trim(),
      input.provider.trim(),
      input.baseUrl || null,
      encKey,
      JSON.stringify(input.models || []),
      input.isActive === false ? 0 : 1,
      input.createdBy || null
    );
    logger.info('llm', `LLM platform created: ${input.name}`, { id, tenantId: input.tenantId });
    return this.getById(id, input.tenantId)!;
  },

  update(
    id: string,
    tenantId: string,
    patch: Partial<{
      name: string;
      provider: string;
      baseUrl: string;
      apiKey: string;
      models: string[];
      isActive: boolean;
    }>
  ): LLMPlatformRecord {
    const existing = this.getById(id, tenantId);
    if (!existing) throw new NotFoundError('平台不存在');
    const db = getDatabase();
    const fields: string[] = [];
    const values: unknown[] = [];

    if (patch.name !== undefined) { fields.push('name = ?'); values.push(patch.name.trim()); }
    if (patch.provider !== undefined) { fields.push('provider = ?'); values.push(patch.provider.trim()); }
    if (patch.baseUrl !== undefined) { fields.push('base_url = ?'); values.push(patch.baseUrl); }
    if (patch.apiKey !== undefined) { fields.push('api_key_secret = ?'); values.push(patch.apiKey ? encryptSecret(patch.apiKey) : null); }
    if (patch.models !== undefined) { fields.push('models_json = ?'); values.push(JSON.stringify(patch.models)); }
    if (patch.isActive !== undefined) { fields.push('is_active = ?'); values.push(patch.isActive ? 1 : 0); }

    if (fields.length === 0) return existing;
    fields.push("updated_at = datetime('now')");
    values.push(id, tenantId);
    db.prepare(`UPDATE llm_platforms SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...values);
    return this.getById(id, tenantId)!;
  },

  remove(id: string, tenantId: string): void {
    const db = getDatabase();
    const res = db.prepare('DELETE FROM llm_platforms WHERE id = ? AND tenant_id = ?').run(id, tenantId);
    if (res.changes === 0) throw new NotFoundError('平台不存在');
  },
};
