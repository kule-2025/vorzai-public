/**
 * Agent 配置服务（P1：AgentConfig 后端落地）
 * 真实 CRUD，按 tenant_id 隔离。
 */
import { getDatabase } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { NotFoundError, ValidationError } from '../utils/errors';
import { logger } from '../utils/logger';

export interface AgentRecord {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  type: string;
  status: 'idle' | 'running' | 'paused' | 'error' | 'completed';
  model: string | null;
  systemPrompt: string | null;
  temperature: number;
  maxTokens: number;
  skills: string[];
  experts: string[];
  connectors: string[];
  createdAt: string;
  updatedAt: string;
}

function rowToAgent(row: any): AgentRecord {
  let cfg: { skills?: string[]; experts?: string[]; connectors?: string[] } = {};
  try {
    cfg = JSON.parse(row.config_json || '{}');
  } catch {
    cfg = {};
  }
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    description: row.description,
    type: row.type,
    status: row.status,
    model: row.model,
    systemPrompt: row.system_prompt,
    temperature: row.temperature,
    maxTokens: row.max_tokens,
    skills: cfg.skills || [],
    experts: cfg.experts || [],
    connectors: cfg.connectors || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const agentService = {
  list(tenantId: string): AgentRecord[] {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT * FROM agents WHERE tenant_id = ? ORDER BY created_at DESC')
      .all(tenantId) as any[];
    return rows.map(rowToAgent);
  },

  getById(id: string, tenantId: string): AgentRecord | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM agents WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
    return row ? rowToAgent(row) : null;
  },

  create(input: {
    tenantId: string;
    name: string;
    description?: string;
    type?: string;
    model?: string;
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    skills?: string[];
    experts?: string[];
    connectors?: string[];
    createdBy?: string;
  }): AgentRecord {
    if (!input.name || !input.name.trim()) {
      throw new ValidationError('Agent 名称不能为空');
    }
    const db = getDatabase();
    const id = uuidv4();
    const config = JSON.stringify({
      skills: input.skills || [],
      experts: input.experts || [],
      connectors: input.connectors || [],
    });
    db.prepare(
      `INSERT INTO agents (id, tenant_id, name, description, type, status, model, system_prompt, temperature, max_tokens, config_json, created_by)
       VALUES (?, ?, ?, ?, ?, 'idle', ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.tenantId,
      input.name.trim(),
      input.description || null,
      input.type || 'custom',
      input.model || null,
      input.systemPrompt || null,
      input.temperature ?? 0.3,
      input.maxTokens ?? 4096,
      config,
      input.createdBy || null
    );
    logger.info('agent', `Agent created: ${input.name}`, { id, tenantId: input.tenantId });
    return this.getById(id, input.tenantId)!;
  },

  update(
    id: string,
    tenantId: string,
    patch: Partial<{
      name: string;
      description: string;
      type: string;
      model: string;
      systemPrompt: string;
      temperature: number;
      maxTokens: number;
      status: AgentRecord['status'];
      skills: string[];
      experts: string[];
      connectors: string[];
    }>
  ): AgentRecord {
    const existing = this.getById(id, tenantId);
    if (!existing) throw new NotFoundError('Agent 不存在');
    const db = getDatabase();

    const fields: string[] = [];
    const values: unknown[] = [];

    if (patch.name !== undefined) { fields.push('name = ?'); values.push(patch.name.trim()); }
    if (patch.description !== undefined) { fields.push('description = ?'); values.push(patch.description); }
    if (patch.type !== undefined) { fields.push('type = ?'); values.push(patch.type); }
    if (patch.model !== undefined) { fields.push('model = ?'); values.push(patch.model); }
    if (patch.systemPrompt !== undefined) { fields.push('system_prompt = ?'); values.push(patch.systemPrompt); }
    if (patch.temperature !== undefined) { fields.push('temperature = ?'); values.push(patch.temperature); }
    if (patch.maxTokens !== undefined) { fields.push('max_tokens = ?'); values.push(patch.maxTokens); }
    if (patch.status !== undefined) { fields.push('status = ?'); values.push(patch.status); }

    // config_json 合并
    if (
      patch.skills !== undefined ||
      patch.experts !== undefined ||
      patch.connectors !== undefined
    ) {
      const cfg = {
        skills: patch.skills ?? existing.skills,
        experts: patch.experts ?? existing.experts,
        connectors: patch.connectors ?? existing.connectors,
      };
      fields.push('config_json = ?');
      values.push(JSON.stringify(cfg));
    }

    if (fields.length === 0) return existing;

    fields.push("updated_at = datetime('now')");
    values.push(id, tenantId);
    db.prepare(`UPDATE agents SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...values);
    return this.getById(id, tenantId)!;
  },

  remove(id: string, tenantId: string): void {
    const db = getDatabase();
    const res = db.prepare('DELETE FROM agents WHERE id = ? AND tenant_id = ?').run(id, tenantId);
    if (res.changes === 0) throw new NotFoundError('Agent 不存在');
  },

  setStatus(id: string, tenantId: string, status: AgentRecord['status'], createdBy?: string): AgentRecord {
    return this.update(id, tenantId, { status, createdBy } as any);
  },
};
