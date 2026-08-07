import { getDatabase } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { NotFoundError, ValidationError, ConflictError } from '../utils/errors';
import { logger } from '../utils/logger';

// ────────── 接口定义 ──────────

export type EmailProvider = 'smtp' | 'imap' | 'api';
export type EmailConnectorStatus = 'connected' | 'disconnected' | 'error' | 'pending';

export interface EmailConnectorConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  ssl: boolean;
  tls: boolean;
  [key: string]: unknown;
}

export interface EmailConnector {
  id: string;
  tenant_id: string;
  name: string;
  provider: EmailProvider;
  config: EmailConnectorConfig;
  status: EmailConnectorStatus;
  email_address: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateEmailConnectorInput {
  tenantId: string;
  name: string;
  provider: EmailProvider;
  config: EmailConnectorConfig;
  emailAddress?: string;
}

export interface UpdateEmailConnectorInput {
  name?: string;
  config?: EmailConnectorConfig;
  emailAddress?: string;
}

export interface SyncLog {
  id: string;
  connector_id: string;
  tenant_id: string;
  action: 'sync_inbox' | 'sync_sent' | 'send' | 'receive' | 'connect';
  status: 'success' | 'failed' | 'planned';
  details: string | null;
  created_at: string;
}

export interface EmailMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  received_at: string;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  body: string;
}

// ────────── 服务类 ──────────

export class EmailConnectorService {
  /** 创建邮箱连接器配置 */
  createEmailConnector(input: CreateEmailConnectorInput): EmailConnector {
    const db = getDatabase();

    const existing = db
      .prepare('SELECT id FROM email_connectors WHERE tenant_id = ? AND provider = ?')
      .get(input.tenantId, input.provider) as any;

    if (existing) {
      throw new ConflictError(`该租户下 ${input.provider} 类型的邮箱连接器已存在`);
    }

    if (!input.config.host || !input.config.port) {
      throw new ValidationError('邮箱配置必须包含 host 和 port');
    }

    const id = uuidv4();
    db.prepare(
      `INSERT INTO email_connectors (id, tenant_id, name, provider, config, status, email_address)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`
    ).run(id, input.tenantId, input.name, input.provider, JSON.stringify(input.config), input.emailAddress || null);

    const row = db.prepare('SELECT * FROM email_connectors WHERE id = ?').get(id) as any;
    logger.info('email', `Connector created: ${row.id} (${input.provider})`);
    return this.rowToConnector(row);
  }

  /** 更新邮箱连接器配置 */
  updateEmailConnector(id: string, tenantId: string, config: UpdateEmailConnectorInput): EmailConnector {
    const db = getDatabase();
    const connector = this.getEmailConnectorById(id, tenantId);
    if (!connector) throw new NotFoundError('邮箱连接器');

    const existingConfig: EmailConnectorConfig = typeof connector.config === 'string' ? JSON.parse(connector.config) : connector.config;
    const mergedConfig: EmailConnectorConfig = { ...existingConfig, ...(config.config || {}) };

    const updates: string[] = [];
    const params: unknown[] = [];

    if (config.name !== undefined) {
      updates.push('name = ?');
      params.push(config.name);
    }
    if (config.config !== undefined) {
      updates.push('config = ?');
      params.push(JSON.stringify(mergedConfig));
    }
    if (config.emailAddress !== undefined) {
      updates.push('email_address = ?');
      params.push(config.emailAddress);
    }
    updates.push("updated_at = datetime('now', '+0000')");
    params.push(id, tenantId);

    if (updates.length === 1) return this.rowToConnector(this.getEmailConnectorById(id, tenantId)!);

    db.prepare(`UPDATE email_connectors SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...params);
    const row = db.prepare('SELECT * FROM email_connectors WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
    logger.info('email', `Connector updated: ${id}`);
    return this.rowToConnector(row);
  }

  /** 列出租户下的邮箱连接器 */
  listEmailConnectors(tenantId: string): EmailConnector[] {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT * FROM email_connectors WHERE tenant_id = ? ORDER BY created_at DESC')
      .all(tenantId) as any[];

    return rows.map(this.rowToConnector);
  }

  /** 删除邮箱连接器 */
  deleteEmailConnector(id: string, tenantId: string): void {
    const db = getDatabase();
    const existing = db.prepare('SELECT id FROM email_connectors WHERE id = ? AND tenant_id = ?').get(id, tenantId);
    if (!existing) throw new NotFoundError('邮箱连接器');
    db.prepare('DELETE FROM email_connectors WHERE id = ? AND tenant_id = ?').run(id, tenantId);
    logger.info('email', `Connector deleted: ${id}`);
  }

  /** 测试连接：基于配置完整性真实校验，不再用概率模拟 */
  async connectEmailConnector(id: string, tenantId: string): Promise<{ success: boolean; status: EmailConnectorStatus; message: string }> {
    const db = getDatabase();
    const connector = this.getEmailConnectorById(id, tenantId);
    if (!connector) throw new NotFoundError('邮箱连接器');

    const cfg = (connector.config || {}) as Record<string, any>;
    const missing = ['host', 'port', 'username', 'password'].filter((k) => !cfg[k]);
    if (missing.length > 0) {
      const newStatus: EmailConnectorStatus = 'error';
      db.prepare("UPDATE email_connectors SET status = ?, updated_at = datetime('now', '+0000') WHERE id = ? AND tenant_id = ?").run(newStatus, id, tenantId);
      this.logSync(connector.tenant_id, id, 'connect', 'failed', `缺少配置项: ${missing.join(', ')}`);
      return { success: false, status: newStatus, message: `连接失败，缺少配置: ${missing.join(', ')}` };
    }

    db.prepare("UPDATE email_connectors SET status = 'connected', updated_at = datetime('now', '+0000') WHERE id = ? AND tenant_id = ?").run(id, tenantId);
    this.logSync(connector.tenant_id, id, 'connect', 'success', '配置完整，已标记为已连接');
    logger.info('email', `Connector marked connected (config valid): ${id}`);
    return { success: true, status: 'connected', message: '配置完整，已标记为已连接' };
  }

  /** 同步收件箱：诚实标注——真实 IMAP 拉取为规划中能力，不伪造邮件数据 */
  async syncInbox(connectorId: string, tenantId: string): Promise<EmailMessage[]> {
    const connector = this.getEmailConnectorById(connectorId, tenantId);
    if (!connector) throw new NotFoundError('邮箱连接器');

    this.logSync(
      connector.tenant_id,
      connectorId,
      'sync_inbox',
      'planned',
      '收件箱拉取为规划中能力（需接入 IMAP），当前不返回伪造邮件'
    );

    return [];
  }

  /** 发送邮件：真实 SMTP 投递（隐式 TLS + AUTH PLAIN），失败明确返回原因 */
  async sendEmail(connectorId: string, tenantId: string, input: SendEmailInput): Promise<{ success: boolean; messageId: string; message?: string }> {
    const connector = this.getEmailConnectorById(connectorId, tenantId);
    if (!connector) throw new NotFoundError('邮箱连接器');

    const cfg = (connector.config || {}) as Record<string, any>;
    const messageId = uuidv4();

    if (!cfg.host || !cfg.username || !cfg.password) {
      this.logSync(connector.tenant_id, connectorId, 'send', 'failed', 'SMTP 未完整配置');
      return { success: false, messageId, message: 'SMTP 未完整配置（需 host/username/password）' };
    }

    const { sendSmtpMail } = await import('./emailSmtp.js');
    const result = await sendSmtpMail({
      host: String(cfg.host),
      port: Number(cfg.port) || 465,
      secure: cfg.ssl === true || cfg.ssl === 'true' || Number(cfg.port) === 465,
      user: String(cfg.username),
      pass: String(cfg.password),
      from: connector.email_address || String(cfg.username),
      to: input.to,
      subject: input.subject,
      body: input.body,
    });

    this.logSync(
      connector.tenant_id,
      connectorId,
      'send',
      result.ok ? 'success' : 'failed',
      result.ok ? `已发送至 ${input.to}` : result.message
    );
    logger.info('email', `Email send ${result.ok ? 'success' : 'failed'}: ${messageId}`);
    return { success: result.ok, messageId, message: result.message };
  }

  /** 获取同步日志（必须带 tenantId，防止跨租户读取他方邮箱同步日志） */
  getSyncLogs(connectorId: string, tenantId: string): SyncLog[] {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT * FROM email_sync_logs WHERE connector_id = ? AND tenant_id = ? ORDER BY created_at DESC LIMIT 50')
      .all(connectorId, tenantId) as any[];

    return rows.map((r) => ({
      id: r.id,
      connector_id: r.connector_id,
      tenant_id: r.tenant_id,
      action: r.action,
      status: r.status,
      details: r.details,
      created_at: r.created_at,
    }));
  }

  /**
   * SECURITY: tenantId is required — email connectors hold SMTP credentials,
   * so a bare id lookup would expose another tenant's mailbox config.
   */
  private getEmailConnectorById(id: string, tenantId: string): { id: string; tenant_id: string; provider: EmailProvider; name: string; config: EmailConnectorConfig; status: EmailConnectorStatus; email_address: string | null } | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM email_connectors WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
    if (!row) return null;
    return {
      ...row,
      config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config,
    };
  }

  private rowToConnector(row: any): EmailConnector {
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      name: row.name,
      provider: row.provider,
      config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config,
      status: row.status,
      email_address: row.email_address,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private logSync(tenantId: string, connectorId: string, action: SyncLog['action'], status: 'success' | 'failed' | 'planned', details: string): void {
    const db = getDatabase();
    db.prepare(
      `INSERT INTO email_sync_logs (id, connector_id, tenant_id, action, status, details)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(uuidv4(), connectorId, tenantId, action, status, details);
  }
}

export const emailConnectorService = new EmailConnectorService();
