import { getDatabase, paginate, PaginationParams, PaginatedResult } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { NotFoundError } from '../utils/errors';
import { logger } from '../utils/logger';

// ==================== RAG / Document Management ====================

/** 生成 URL-friendly slug */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u4e00-\u9fff]/g, '')   // 移除中文字符
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40) || 'skill-' + uuidv4().slice(0, 8);
}

export interface SearchHit {
  documentId: string;
  documentName: string;
  score: number;
  matchedKeywords: string[];
  snippet: string;
}

export interface DocUploadInput {
  name: string;
  content: string;
  mimeType: string;
  category?: string;
  tags?: string[];
}

// ==================== Knowledge Base ====================

export class KnowledgeService {
  createKnowledgeBase(tenantId: string, input: { name: string; description?: string; type?: string; visibility?: string; ownerId?: string }): Record<string, unknown> {
    const db = getDatabase();
    const id = uuidv4();

    db.prepare(
      `INSERT INTO knowledge_bases (id, tenant_id, name, description, type, visibility, owner_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`
    ).run(id, tenantId, input.name, input.description || null, input.type || 'general', input.visibility || 'tenant', input.ownerId || null);

    return db.prepare('SELECT * FROM knowledge_bases WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
  }

  listKnowledgeBases(tenantId: string): Record<string, unknown>[] {
    const db = getDatabase();
    return db.prepare(
      `SELECT kb.*, u.display_name as owner_name,
              (SELECT COUNT(*) FROM knowledge_documents d WHERE d.kb_id = kb.id AND d.status = 'published') as published_count
       FROM knowledge_bases kb LEFT JOIN users u ON kb.owner_id = u.id
       WHERE kb.tenant_id = ? AND kb.status = 'active' ORDER BY kb.created_at DESC`
    ).all(tenantId) as any[];
  }

  createDocument(tenantId: string, kbId: string, input: { title: string; content?: string; contentType?: string; category?: string; tags?: string[]; authorId?: string }): Record<string, unknown> {
    const db = getDatabase();
    const kb = db.prepare('SELECT id FROM knowledge_bases WHERE id = ? AND tenant_id = ?').get(kbId, tenantId);
    if (!kb) throw new NotFoundError('知识库', kbId);

    const id = uuidv4();
    db.prepare(
      `INSERT INTO knowledge_documents (id, kb_id, tenant_id, title, content, content_type, category, tags, author_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'published')`
    ).run(id, kbId, tenantId, input.title, input.content || '', input.contentType || 'markdown', input.category || null, JSON.stringify(input.tags || []), input.authorId || null);

    // Update doc count
    db.prepare('UPDATE knowledge_bases SET doc_count = doc_count + 1, updated_at = datetime(\'now\') WHERE id = ? AND tenant_id = ?').run(kbId, tenantId);

    return db.prepare('SELECT * FROM knowledge_documents WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
  }

  listDocumentsPaginated(kbId: string, params: PaginationParams & { keyword?: string; category?: string }): PaginatedResult<any> {
    let where = 'WHERE d.kb_id = @kbId AND d.status = \'published\'';
    const queryParams: Record<string, unknown> = { kbId };

    if (params.keyword) {
      where += ' AND (d.title LIKE @keyword OR d.content LIKE @keyword)';
      queryParams.keyword = `%${params.keyword}%`;
    }
    if (params.category) { where += ' AND d.category = @category'; queryParams.category = params.category; }

    const query = `SELECT d.*, u.display_name as author_name FROM knowledge_documents d LEFT JOIN users u ON d.author_id = u.id ${where}`;
    const countQuery = `SELECT COUNT(*) as total FROM knowledge_documents d ${where}`;

    const result = paginate(query, countQuery, queryParams, params);
    result.data = result.data.map((r: any) => ({ ...r, tags: JSON.parse(r.tags || '[]') }));
    return result;
  }

  searchDocuments(tenantId: string, keyword: string, limit: number = 20): Record<string, unknown>[] {
    const db = getDatabase();
    return db.prepare(
      `SELECT d.*, kb.name as kb_name
       FROM knowledge_documents d JOIN knowledge_bases kb ON d.kb_id = kb.id
       WHERE d.tenant_id = ? AND d.status = 'published'
       AND (d.title LIKE ? OR d.content LIKE ?)
       ORDER BY d.view_count DESC LIMIT ?`
    ).all(tenantId, `%${keyword}%`, `%${keyword}%`, limit) as any[];
  }

  // ─── RAG helpers (private) ───
  private tokenize(text: string): Set<string> {
    return tokenizeText(text);
  }

  private jaccardSimilarity(queryTokens: Set<string>, docTokens: Set<string>, queryText: string): { score: number; matched: string[] } {
    const intersection = new Set<string>();
    const matched: string[] = [];
    for (const t of queryTokens) {
      if (docTokens.has(t)) {
        intersection.add(t);
        matched.push(t);
      }
    }
    const union = new Set([...queryTokens, ...docTokens]);
    const base = union.size === 0 ? 0 : intersection.size / union.size;
    const weight = queryTokens.size > 0 ? matched.length / queryTokens.size * 0.5 + 0.5 : 0;
    return { score: Math.round((base * weight) * 1000) / 1000, matched };
  }

  private makeSnippet(content: string, matchedKeywords: string[]): string {
    if (matchedKeywords.length === 0 || !content) return (content || '').slice(0, 120);
    const first = matchedKeywords[0];
    const idx = (content || '').indexOf(first);
    if (idx === -1) return (content || '').slice(0, 120);
    const start = Math.max(0, idx - 40);
    const end = Math.min(content.length, idx + first.length + 80);
    return (start > 0 ? '...' : '') + content.slice(start, end) + (end < content.length ? '...' : '');
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[\u4e00-\u9fff]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40) || 'skill-' + uuidv4().slice(0, 8);
  }

  // ─── Public RAG methods ───

  /** 文档上传：内部委托给 createDocument */
  uploadDocument(tenantId: string, kbId: string, fileData: DocUploadInput): Record<string, unknown> {
    return this.createDocument(tenantId, kbId, {
      title: fileData.name,
      content: fileData.content,
      contentType: fileData.mimeType?.startsWith('text/') || fileData.mimeType?.startsWith('application/json') ? 'plain' : 'markdown',
      category: fileData.category,
      tags: fileData.tags,
    });
  }

  /** 列出某知识库所有文档（不分页，供 RAG 使用） */
  listDocuments(tenantId: string, kbId: string): Record<string, unknown>[] {
    const db = getDatabase();
    const kb = db.prepare('SELECT id FROM knowledge_bases WHERE id = ? AND tenant_id = ?').get(kbId, tenantId);
    if (!kb) throw new NotFoundError('知识库', kbId);
    const rows = db.prepare(
      `SELECT d.*, u.display_name as author_name
       FROM knowledge_documents d LEFT JOIN users u ON d.author_id = u.id
       WHERE d.kb_id = ? AND d.tenant_id = ? AND d.status = 'published' ORDER BY d.created_at DESC`
    ).all(kbId, tenantId) as any[];
    return rows.map((r) => ({ ...r, tags: JSON.parse(r.tags || '[]') }));
  }

  /** 获取文档详情 */
  getDocument(tenantId: string, kbId: string, documentId: string): Record<string, unknown> | null {
    const db = getDatabase();
    const row = db.prepare(
      `SELECT d.*, u.display_name as author_name
       FROM knowledge_documents d LEFT JOIN users u ON d.author_id = u.id
       JOIN knowledge_bases kb ON d.kb_id = kb.id
       WHERE d.id = ? AND kb.tenant_id = ? AND kb.id = ? AND d.status = 'published'`
    ).get(documentId, tenantId, kbId) as any;
    if (!row) return null;
    row.tags = JSON.parse(row.tags || '[]');
    return row;
  }

  /** 删除文档（软删除：status → archived） */
  deleteDocument(tenantId: string, kbId: string, documentId: string): void {
    const db = getDatabase();
    const row = db.prepare(
      `SELECT d.id FROM knowledge_documents d JOIN knowledge_bases kb ON d.kb_id = kb.id
       WHERE d.id = ? AND kb.id = ? AND kb.tenant_id = ?`
    ).get(documentId, kbId, tenantId);
    if (!row) throw new NotFoundError('文档', documentId);
    db.prepare("UPDATE knowledge_documents SET status = 'archived', updated_at = datetime('now', '+0000') WHERE id = ? AND tenant_id = ?").run(documentId, tenantId);
    db.prepare("UPDATE knowledge_bases SET doc_count = MAX(0, doc_count - 1), updated_at = datetime('now', '+0000') WHERE id = ? AND tenant_id = ?").run(kbId, tenantId);
  }

  /**
   * 知识库检索（RAG）— 基于 Jaccard 相似度 + 词频加权
   * @returns [{ documentId, documentName, kbName, score, matchedKeywords, snippet }]
   */
  searchKnowledge(tenantId: string, query: string, options?: { knowledgeBaseId?: string; limit?: number }): SearchHit[] {
    const limit = options?.limit ?? 10;
    const queryTokens = this.tokenize(query);
    if (queryTokens.size === 0) return [];
    const db = getDatabase();
    let sql = `SELECT d.id as documentId, d.title as documentName, d.content, kb.id as kbId, kb.name as kbName
               FROM knowledge_documents d JOIN knowledge_bases kb ON d.kb_id = kb.id
               WHERE d.tenant_id = ? AND d.status = 'published'`;
    const params: unknown[] = [tenantId];
    if (options?.knowledgeBaseId) { sql += ' AND d.kb_id = ?'; params.push(options.knowledgeBaseId); }
    const rows = db.prepare(sql).all(...params) as any[];
    return rows
      .map((r) => {
        const docTokens = this.tokenize((r.content || '') + ' ' + (r.title || ''));
        const { score, matched } = this.jaccardSimilarity(queryTokens, docTokens, query);
        return {
          documentId: r.documentId,
          documentName: r.documentName,
          kbName: r.kbName,
          score,
          matchedKeywords: matched,
          snippet: this.makeSnippet(r.content || '', matched),
        } as SearchHit;
      })
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

// ==================== Skill Center ====================

export class SkillService {
  createSkill(tenantId: string, input: { name: string; slug: string; description?: string; category?: string; triggerKeywords?: string[]; inputSchema?: Record<string, unknown>; outputSchema?: Record<string, unknown>; executionConfig?: Record<string, unknown>; authorId?: string }): Record<string, unknown> {
    const db = getDatabase();
    const id = uuidv4();

    db.prepare(
      `INSERT INTO skills (id, tenant_id, name, slug, description, category, trigger_keywords, input_schema, output_schema, execution_config, author_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
    ).run(
      id, tenantId, input.name, input.slug, input.description || null,
      input.category || 'custom', JSON.stringify(input.triggerKeywords || []),
      JSON.stringify(input.inputSchema || {}), JSON.stringify(input.outputSchema || {}),
      JSON.stringify(input.executionConfig || {}), input.authorId || null
    );

    return db.prepare('SELECT * FROM skills WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
  }

  listSkills(tenantId: string, params: PaginationParams & { category?: string; keyword?: string }): PaginatedResult<any> {
    let where = 'WHERE s.tenant_id = @tenantId AND s.status IN (\'active\', \'system\')';
    const queryParams: Record<string, unknown> = { tenantId };

    if (params.category) { where += ' AND s.category = @category'; queryParams.category = params.category; }
    if (params.keyword) {
      where += ' AND (s.name LIKE @keyword OR s.description LIKE @keyword)';
      queryParams.keyword = `%${params.keyword}%`;
    }

    const query = `SELECT s.*, u.display_name as author_name FROM skills s LEFT JOIN users u ON s.author_id = u.id ${where}`;
    const countQuery = `SELECT COUNT(*) as total FROM skills s ${where}`;

    const result = paginate(query, countQuery, queryParams, params);
    result.data = result.data.map((r: any) => ({
      ...r,
      trigger_keywords: JSON.parse(r.trigger_keywords || '[]'),
      input_schema: JSON.parse(r.input_schema || '{}'),
      output_schema: JSON.parse(r.output_schema || '{}'),
      execution_config: JSON.parse(r.execution_config || '{}'),
    }));
    return result;
  }

  executeSkill(skillId: string, tenantId: string, userId: string, input: Record<string, unknown>): Record<string, unknown> {
    const db = getDatabase();
    const skill = db.prepare('SELECT * FROM skills WHERE id = ? AND tenant_id = ?').get(skillId, tenantId) as any;
    if (!skill) throw new NotFoundError('技能', skillId);

    const executionId = uuidv4();
    const startTime = Date.now();

    db.prepare(
      `INSERT INTO skill_executions (id, skill_id, tenant_id, user_id, input, status) VALUES (?, ?, ?, ?, ?, 'running')`
    ).run(executionId, skillId, tenantId, userId, JSON.stringify(input));

    try {
      // Execute skill based on its configuration
      const execConfig = JSON.parse(skill.execution_config || '{}');
      const output = this.runSkillExecution(execConfig, input, tenantId);
      const duration = Date.now() - startTime;

      db.prepare(
        `UPDATE skill_executions SET output = ?, status = 'completed', duration_ms = ?, completed_at = datetime('now', '+0000') WHERE id = ?`
      ).run(JSON.stringify(output), duration, executionId);

      // Increment usage count
      db.prepare('UPDATE skills SET usage_count = usage_count + 1 WHERE id = ? AND tenant_id = ?').run(skillId, tenantId);

      return { executionId, status: 'completed', output, durationMs: duration };
    } catch (error) {
      const duration = Date.now() - startTime;
      db.prepare(
        `UPDATE skill_executions SET status = 'failed', error_message = ?, duration_ms = ?, completed_at = datetime('now', '+0000') WHERE id = ?`
      ).run(String(error), duration, executionId);

      return { executionId, status: 'failed', error: String(error), durationMs: duration };
    }
  }

  private runSkillExecution(config: Record<string, unknown>, input: Record<string, unknown>, tenantId: string): Record<string, unknown> {
    // Skill execution engine - processes based on config type
    const type = config.type as string || 'transform';

    switch (type) {
      case 'transform': {
        // Data transformation skill
        const template = config.template as string || '';
        const result = template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(input[key] || ''));
        return { result };
      }
      case 'calculate': {
        // SECURITY: Safe arithmetic evaluation - no eval/new Function
        const formula = config.formula as string || '';
        try {
          const result = this.safeEvalArithmetic(formula, input);
          return { result };
        } catch (e) {
          return { result: null, error: `Formula evaluation failed: ${String(e)}` };
        }
      }
      case 'lookup': {
        // Knowledge lookup - SECURITY: always use the executing user's tenantId
        const knowledgeService = new KnowledgeService();
        const keyword = String(input.keyword || input.query || '');
        const results = knowledgeService.searchDocuments(tenantId, keyword);
        return { results };
      }
      default:
        return { message: 'Skill executed', input };
    }
  }

  /**
   * Safe arithmetic expression evaluator.
   * Only allows: numbers, +, -, *, /, %, parentheses, decimal points, whitespace.
   * Variables from input are substituted by name before evaluation.
   */
  private safeEvalArithmetic(formula: string, variables: Record<string, unknown>): number {
    // Substitute variable names with their numeric values
    let expr = formula;
    for (const [key, value] of Object.entries(variables)) {
      const num = Number(value);
      if (!isNaN(num)) {
        expr = expr.replace(new RegExp(`\\b${key}\\b`, 'g'), `(${num})`);
      }
    }

    // SECURITY: Only allow safe arithmetic characters
    if (!/^[\d\s+\-*/%().]+$/.test(expr)) {
      throw new Error('Formula contains invalid characters');
    }

    // Parse and evaluate using a simple recursive descent parser
    return this.parseExpression(expr.trim(), { pos: 0 });
  }

  private parseExpression(expr: string, ctx: { pos: number }): number {
    let result = this.parseTerm(expr, ctx);
    while (ctx.pos < expr.length) {
      while (ctx.pos < expr.length && expr[ctx.pos] === ' ') ctx.pos++;
      if (ctx.pos >= expr.length) break;
      const ch = expr[ctx.pos];
      if (ch === '+' || ch === '-') {
        ctx.pos++;
        const right = this.parseTerm(expr, ctx);
        result = ch === '+' ? result + right : result - right;
      } else break;
    }
    return result;
  }

  private parseTerm(expr: string, ctx: { pos: number }): number {
    let result = this.parseFactor(expr, ctx);
    while (ctx.pos < expr.length) {
      while (ctx.pos < expr.length && expr[ctx.pos] === ' ') ctx.pos++;
      if (ctx.pos >= expr.length) break;
      const ch = expr[ctx.pos];
      if (ch === '*' || ch === '/' || ch === '%') {
        ctx.pos++;
        const right = this.parseFactor(expr, ctx);
        if (ch === '*') result *= right;
        else if (ch === '/') result = right !== 0 ? result / right : 0;
        else result %= right;
      } else break;
    }
    return result;
  }

  private parseFactor(expr: string, ctx: { pos: number }): number {
    // Skip whitespace
    while (ctx.pos < expr.length && expr[ctx.pos] === ' ') ctx.pos++;

    if (expr[ctx.pos] === '(') {
      ctx.pos++; // skip '('
      const result = this.parseExpression(expr, ctx);
      if (expr[ctx.pos] === ')') ctx.pos++; // skip ')'
      return result;
    }

    if (expr[ctx.pos] === '-') {
      ctx.pos++;
      return -this.parseFactor(expr, ctx);
    }

    // Parse number
    let numStr = '';
    while (ctx.pos < expr.length && /[\d.]/.test(expr[ctx.pos])) {
      numStr += expr[ctx.pos++];
    }
    const num = parseFloat(numStr);
    if (isNaN(num)) throw new Error(`Invalid number at position ${ctx.pos}`);
    return num;
  }

  /**
   * 从文档内容自动生成企业 Skill
   * - 提取标题作为 Skill name
   * - 提取关键词作为 triggerKeywords
   * - 将文档内容组织为步骤（按空行 / 序号行切分）
   * - 写入 skills 表，category='custom'，并记录 source_document
   */
  generateSkillFromDocument(tenantId: string, kbId: string, documentId: string, skillName: string): Record<string, unknown> {
    const db = getDatabase();

    // 权限校验：知识库与文档归属
    const kb = db.prepare('SELECT id FROM knowledge_bases WHERE id = ? AND tenant_id = ?').get(kbId, tenantId);
    if (!kb) throw new NotFoundError('知识库', kbId);
    const doc = db.prepare(
      `SELECT d.content, d.title FROM knowledge_documents d
       JOIN knowledge_bases kb ON d.kb_id = kb.id
       WHERE d.id = ? AND kb.tenant_id = ? AND d.status = 'published'`
    ).get(documentId, tenantId) as any;
    if (!doc) throw new NotFoundError('文档', documentId);

    const content = doc.content || '';
    const tokens = tokenizeText(content);
    const triggerKeywords: string[] = Array.from(tokens).slice(0, 10);

    // 从文档内容切分出执行步骤（按双换行 / 编号行分步）
    const stepRegex = /\n\s*\n|\n\s*[\d]+[\.、\s]/;
    const rawSteps = content.split(stepRegex).map((s: string) => s.trim()).filter(Boolean).slice(0, 15);
    const steps = rawSteps.length > 0 ? rawSteps : [content.slice(0, 500)];
    const description = doc.title ? `${doc.title} — ${steps.slice(0, 2).join('；')}` : skillName;

    // 生成 slug
    const slug = slugify(skillName);

    // 构建执行配置：将步骤写入 execution_config.steps
    const executionConfig: Record<string, unknown> = {
      type: 'lookup',
      source: 'knowledge-document',
      sourceDocumentId: documentId,
      sourceKbId: kbId,
      steps,
    };

    const skill = this.createSkill(tenantId, {
      name: skillName,
      slug,
      description,
      category: 'custom',
      triggerKeywords,
      inputSchema: { query: { type: 'string', description: '查询内容' } },
      outputSchema: { steps: { type: 'array', description: '执行步骤' }, summary: { type: 'string', description: '结果摘要' } },
      executionConfig,
    });

    return skill;
  }

  /**
   * 列出企业自建 Skill（category='custom'），区分系统 Skill
   */
  listEnterpriseSkills(tenantId: string): Record<string, unknown>[] {
    const db = getDatabase();
    const rows = db.prepare(
      `SELECT s.*, u.display_name as author_name,
              (SELECT kb.name FROM knowledge_documents d JOIN knowledge_bases kb ON d.kb_id = kb.id
               WHERE JSON_EXTRACT(s.execution_config, '$.sourceDocumentId') = d.id LIMIT 1) as source_kb_name
       FROM skills s LEFT JOIN users u ON s.author_id = u.id
       WHERE s.tenant_id = ? AND s.category = 'custom' AND s.status IN ('active', 'draft')
       ORDER BY s.created_at DESC`
    ).all(tenantId) as any[];

    return rows.map((r) => ({
      ...r,
      trigger_keywords: JSON.parse(r.trigger_keywords || '[]'),
      input_schema: JSON.parse(r.input_schema || '{}'),
      output_schema: JSON.parse(r.output_schema || '{}'),
      execution_config: JSON.parse(r.execution_config || '{}'),
      isEnterprise: r.category === 'custom',
    }));
  }
}

// ==================== Connectors ====================

export class ConnectorService {
  createConnector(tenantId: string, createdBy: string, input: { name: string; type: string; description?: string; config?: Record<string, unknown> }): Record<string, unknown> {
    const db = getDatabase();
    const id = uuidv4();

    db.prepare(
      `INSERT INTO connectors (id, tenant_id, name, type, description, config, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'disconnected', ?)`
    ).run(id, tenantId, input.name, input.type, input.description || null, JSON.stringify(input.config || {}), createdBy);

    return db.prepare('SELECT * FROM connectors WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
  }

  listConnectors(tenantId: string): Record<string, unknown>[] {
    const db = getDatabase();
    const rows = db.prepare(
      `SELECT c.*, u.display_name as created_by_name
       FROM connectors c LEFT JOIN users u ON c.created_by = u.id
       WHERE c.tenant_id = ? ORDER BY c.created_at DESC`
    ).all(tenantId) as any[];

    return rows.map((r) => ({
      ...r,
      config: JSON.parse(r.config || '{}'),
      credentials: undefined, // Never expose credentials
    }));
  }

  updateConnectorStatus(id: string, tenantId: string, status: string, config?: Record<string, unknown>): Record<string, unknown> {
    const db = getDatabase();
    const existing = db.prepare('SELECT id FROM connectors WHERE id = ? AND tenant_id = ?').get(id, tenantId);
    if (!existing) throw new NotFoundError('连接器', id);

    let sql = "UPDATE connectors SET status = ?, updated_at = datetime('now', '+0000')";
    const values: unknown[] = [status];

    if (status === 'connected') { sql += ", last_sync_at = datetime('now', '+0000')"; }
    if (config) { sql += ', config = ?'; values.push(JSON.stringify(config)); }

    sql += ' WHERE id = ?';
    values.push(id);
    db.prepare(sql).run(...values);

    const row = db.prepare('SELECT * FROM connectors WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
    return { ...row, config: JSON.parse(row.config || '{}'), credentials: undefined };
  }

  // 同步连接器数据（诚实实现：返回该连接器关联知识库的文档真实数量，不再伪造随机数）
  triggerSync(connectorId: string, tenantId: string, syncType: string): Record<string, unknown> {
    const db = getDatabase();
    const connector = db.prepare('SELECT * FROM connectors WHERE id = ? AND tenant_id = ?').get(connectorId, tenantId) as any;
    if (!connector) throw new NotFoundError('连接器', connectorId);

    const logId = uuidv4();
    db.prepare(
      `INSERT INTO connector_sync_logs (id, connector_id, sync_type, status) VALUES (?, ?, ?, 'running')`
    ).run(logId, connectorId, syncType);

    // 真实统计：统计租户下所有知识库的文档总数（取代 Math.random() 伪造）
    const kbRows = db
      .prepare('SELECT id FROM knowledge_bases WHERE tenant_id = ?')
      .all(tenantId) as any[];
    let recordsSynced = 0;
    for (const kb of kbRows) {
      const cnt = (db.prepare('SELECT COUNT(*) as c FROM knowledge_documents WHERE knowledge_base_id = ? AND tenant_id = ?').get(kb.id, tenantId) as any).c;
      recordsSynced += cnt;
    }

    db.prepare(
      `UPDATE connector_sync_logs SET status = 'success', records_synced = ?, completed_at = datetime('now', '+0000') WHERE id = ?`
    ).run(recordsSynced, logId);

    db.prepare("UPDATE connectors SET last_sync_at = datetime('now', '+0000'), status = 'connected' WHERE id = ? AND tenant_id = ?").run(connectorId, tenantId);

    return { logId, status: 'success', recordsSynced, note: '外部源实时拉取为规划中能力，当前统计知识库内已索引文档数' };
  }
}

export const knowledgeService = new KnowledgeService();
export const skillService = new SkillService();
export const connectorService = new ConnectorService();

/**
 * 中英文混合分词（模块级共享工具）
 * 中文按单字切分，英文/数字按词切分，统一转小写。
 * KnowledgeService（RAG 检索）与 SkillService（技能触发词提取）共用。
 */
export function tokenizeText(text: string): Set<string> {
  const tokens = new Set<string>();
  const normalized = (text || '').toLowerCase();
  const re = /[\u4e00-\u9fff]|[\w]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalized)) !== null) {
    if (m[0].length > 0) tokens.add(m[0]);
  }
  return tokens;
}
