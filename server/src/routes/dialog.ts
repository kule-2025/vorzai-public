import { Router, Request, Response } from 'express';
import { z } from 'zod';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db';
import { authenticateToken, tenantIsolation } from '../middleware/auth';
import { asyncHandler, successResponse } from '../middleware/common';
import { dialogEngine } from '../services/dialogEngine';
import { logger } from '../utils/logger';

const router = Router();

// Auth + tenant isolation
router.use(authenticateToken, tenantIsolation);

// Independent rate limit for dialog — 60 requests / 5 min per user
const dialogLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  // 优先按用户限流；匿名/未登录时回退到 ipKeyGenerator（正确处理 IPv6，
  // 避免 ::ffff: 前缀或 IPv6 地址变化导致限流被绕过的安全隐患）。
  keyGenerator: (req) => (req.user?.userId || ipKeyGenerator(req.ip ?? '') || 'anon') as string,
  message: {
    success: false,
    error: { code: 'DIALOG_RATE_LIMIT', message: '对话请求过于频繁，请稍后再试' },
  },
});
router.use(dialogLimiter);

// ==================== Chat ====================

/** POST /api/dialog/chat — 发送消息，返回回复 + actions */
router.post('/chat', asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    message: z.string().min(1),
    sessionId: z.string().optional(),
  }).parse(req.body);

  const db = getDatabase();
  const tenantId = req.user!.tenantId;
  const userId = req.user!.userId;

  // 自动创建会话
  let sessionId = input.sessionId;
  if (!sessionId) {
    sessionId = uuidv4();
    db.prepare(
      `INSERT INTO dialog_sessions (id, tenant_id, user_id, title) VALUES (?, ?, ?, ?)`
    ).run(sessionId, tenantId, userId, input.message.slice(0, 40));
  }

  // 加载对话历史
  const historyRows = db.prepare(
    'SELECT role, content, action_type FROM dialog_messages WHERE session_id = ? ORDER BY created_at ASC'
  ).all(sessionId) as { role: string; content: string; action_type: string }[];

  const history = historyRows.map((r) => ({
    role: r.role,
    content: r.content,
    actionType: r.action_type || undefined,
  }));

  // 保存用户消息
  const userMsgId = uuidv4();
  db.prepare(
    'INSERT INTO dialog_messages (id, session_id, role, content) VALUES (?, ?, ?, ?)'
  ).run(userMsgId, sessionId, 'user', input.message);

  // 引擎处理
  const result = await dialogEngine.processMessage(input.message, tenantId, userId, { history });

  // 保存助手回复 + action 记录
  const assistantMsgId = uuidv4();
  db.prepare(
    'INSERT INTO dialog_messages (id, session_id, role, content) VALUES (?, ?, ?, ?)'
  ).run(assistantMsgId, sessionId, 'assistant', result.reply);

  const actionRecords: Array<{ type: string; status: string; result?: unknown; error?: string }> = [];
  if (result.actions) {
    for (const action of result.actions) {
      const msgId = uuidv4();
      db.prepare(
        'INSERT INTO dialog_messages (id, session_id, role, content, action_type, action_status) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(
        msgId, sessionId, 'tool',
        JSON.stringify({ type: action.type, status: action.status }),
        action.type, action.status || 'pending'
      );
      actionRecords.push({
        type: action.type,
        status: action.status || 'done',
        result: action.result,
        error: action.error,
      });
    }
  }

  // 更新会话
  db.prepare(
    "UPDATE dialog_sessions SET message_count = message_count + 2, updated_at = datetime('now') WHERE id = ?"
  ).run(sessionId);

  successResponse(res, {
    sessionId,
    reply: result.reply,
    actions: actionRecords,
    sources: result.sources || [],
    ragContext: result.ragContext,
  });
}));

/**
 * POST /api/dialog/stream — SSE 流式对话
 *
 * 说明（工程诚信）：当前 dialogEngine.processMessage 为原子调用，底层 LLM 适配层
 * 尚未提供 token 级增量输出。因此本端点推送的是**真实的服务端处理阶段事件**
 * （会话建立 / 开始推理 / 回复就绪 / 逐条 action / 完成），而非伪造的逐字 token 流。
 * 价值在于：长耗时推理期间保持连接、前端可展示真实进度、actions 可逐条落地。
 * 待 LLM 适配层支持 stream 后，可在 `reply` 前插入 `delta` 事件而无需改动前端协议。
 */
router.post('/stream', asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    message: z.string().min(1),
    sessionId: z.string().optional(),
  }).parse(req.body);

  const db = getDatabase();
  const tenantId = req.user!.tenantId;
  const userId = req.user!.userId;

  // SSE 头（禁用 Nginx 缓冲与压缩，确保事件即时下发）
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let closed = false;
  req.on('close', () => { closed = true; });

  const send = (event: string, data: unknown): void => {
    if (closed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // 心跳：防止代理层因空闲断连
  const heartbeat = setInterval(() => {
    if (closed) return;
    res.write(': ping\n\n');
  }, 15000);

  try {
    // 1. 会话建立
    let sessionId = input.sessionId;
    if (!sessionId) {
      sessionId = uuidv4();
      db.prepare(
        `INSERT INTO dialog_sessions (id, tenant_id, user_id, title) VALUES (?, ?, ?, ?)`
      ).run(sessionId, tenantId, userId, input.message.slice(0, 40));
    }
    send('session', { sessionId });

    // 2. 历史加载 + 用户消息落库
    const historyRows = db.prepare(
      'SELECT role, content, action_type FROM dialog_messages WHERE session_id = ? ORDER BY created_at ASC'
    ).all(sessionId) as { role: string; content: string; action_type: string }[];

    const history = historyRows.map((r) => ({
      role: r.role,
      content: r.content,
      actionType: r.action_type || undefined,
    }));

    db.prepare(
      'INSERT INTO dialog_messages (id, session_id, role, content) VALUES (?, ?, ?, ?)'
    ).run(uuidv4(), sessionId, 'user', input.message);

    send('stage', { stage: 'reasoning', label: '检索知识库并解析意图' });

    // 3. 引擎处理（原子）
    const startedAt = Date.now();
    const result = await dialogEngine.processMessage(input.message, tenantId, userId, { history });
    const elapsedMs = Date.now() - startedAt;

    if (closed) return;

    // 4. 回复落库 + 下发
    const assistantMsgId = uuidv4();
    db.prepare(
      'INSERT INTO dialog_messages (id, session_id, role, content) VALUES (?, ?, ?, ?)'
    ).run(assistantMsgId, sessionId, 'assistant', result.reply);

    send('reply', {
      messageId: assistantMsgId,
      reply: result.reply,
      sources: result.sources || [],
      ragContext: result.ragContext,
      elapsedMs,
    });

    // 5. actions 逐条下发
    if (result.actions) {
      for (const action of result.actions) {
        db.prepare(
          'INSERT INTO dialog_messages (id, session_id, role, content, action_type, action_status) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(
          uuidv4(), sessionId, 'tool',
          JSON.stringify({ type: action.type, status: action.status }),
          action.type, action.status || 'pending'
        );
        send('action', {
          type: action.type,
          status: action.status || 'done',
          result: action.result,
          error: action.error,
        });
      }
    }

    db.prepare(
      "UPDATE dialog_sessions SET message_count = message_count + 2, updated_at = datetime('now') WHERE id = ?"
    ).run(sessionId);

    send('done', { sessionId, messageId: assistantMsgId, elapsedMs });
  } catch (err) {
    logger.error('dialog', 'SSE stream failed', {
      tenantId,
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    send('error', { message: err instanceof Error ? err.message : '对话处理失败' });
  } finally {
    clearInterval(heartbeat);
    if (!closed) res.end();
  }
}));

// ==================== Sessions ====================

/** GET /api/dialog/sessions — 对话会话列表 */
router.get('/sessions', asyncHandler(async (req: Request, res: Response) => {
  const db = getDatabase();
  const sessions = db.prepare(
    `SELECT * FROM dialog_sessions WHERE user_id = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 50`
  ).all(req.user!.userId);
  successResponse(res, sessions);
}));

/** POST /api/dialog/sessions — 创建新会话 */
router.post('/sessions', asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    title: z.string().optional(),
  }).parse(req.body);

  const db = getDatabase();
  const id = uuidv4();

  db.prepare(
    `INSERT INTO dialog_sessions (id, tenant_id, user_id, title) VALUES (?, ?, ?, ?)`
  ).run(id, req.user!.tenantId, req.user!.userId, input.title || '新对话');

  const session = db.prepare('SELECT * FROM dialog_sessions WHERE id = ?').get(id);
  successResponse(res, session, '会话创建成功', 201);
}));

/** GET /api/dialog/sessions/:id/messages — 获取会话消息历史 */
router.get('/sessions/:id/messages', asyncHandler(async (req: Request, res: Response) => {
  const db = getDatabase();

  // SECURITY: 验证会话归属
  const session = db.prepare(
    'SELECT id, user_id FROM dialog_sessions WHERE id = ? AND tenant_id = ?'
  ).get(req.params.id, req.user!.tenantId) as any;

  if (!session || session.user_id !== req.user!.userId) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: '会话不存在' },
    });
    return;
  }

  const messages = db.prepare(
    'SELECT * FROM dialog_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 200'
  ).all(req.params.id);
  successResponse(res, messages);
}));

/** DELETE /api/dialog/sessions/:id — 删除会话 */
router.delete('/sessions/:id', asyncHandler(async (req: Request, res: Response) => {
  const db = getDatabase();

  // SECURITY: 验证归属
  const session = db.prepare(
    'SELECT id FROM dialog_sessions WHERE id = ? AND tenant_id = ? AND user_id = ?'
  ).get(req.params.id, req.user!.tenantId, req.user!.userId);

  if (!session) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: '会话不存在' },
    });
    return;
  }

  // Soft delete — set status to archived (messages cascade)
  db.prepare(
    "UPDATE dialog_sessions SET status = 'archived', updated_at = datetime('now') WHERE id = ?"
  ).run(req.params.id);

  logger.info('dialog', `Session archived: ${req.params.id}`, { userId: req.user!.userId });
  successResponse(res, { id: req.params.id, status: 'archived' }, '会话已删除');
}));

export default router;
