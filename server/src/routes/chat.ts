import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDatabase } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { authenticateToken, tenantIsolation } from '../middleware/auth';
import { asyncHandler, successResponse } from '../middleware/common';
import { config } from '../config';
import { logger } from '../utils/logger';

const router = Router();
router.use(authenticateToken, tenantIsolation);

// ==================== Conversations ====================

router.post('/conversations', asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    title: z.string().optional(),
    contextType: z.enum(['general', 'hr', 'business', 'ogsm', 'knowledge', 'skill']).optional(),
    contextId: z.string().optional(),
  }).parse(req.body);

  const db = getDatabase();
  const id = uuidv4();

  db.prepare(
    `INSERT INTO conversations (id, tenant_id, user_id, title, context_type, context_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, req.user!.tenantId, req.user!.userId, input.title || '新对话', input.contextType || 'general', input.contextId || null);

  const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  successResponse(res, conversation, '对话创建成功', 201);
}));

router.get('/conversations', asyncHandler(async (req: Request, res: Response) => {
  const db = getDatabase();
  const conversations = db.prepare(
    `SELECT * FROM conversations WHERE user_id = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 50`
  ).all(req.user!.userId);
  successResponse(res, conversations);
}));

router.get('/conversations/:id/messages', asyncHandler(async (req: Request, res: Response) => {
  const db = getDatabase();
  // SECURITY: Verify conversation belongs to requesting user
  const conversation = db.prepare(
    'SELECT id, user_id FROM conversations WHERE id = ? AND tenant_id = ?'
  ).get(req.params.id, req.user!.tenantId) as any;

  if (!conversation || conversation.user_id !== req.user!.userId) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '对话不存在' } });
    return;
  }

  const messages = db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 200'
  ).all(req.params.id);
  successResponse(res, messages);
}));

// POST /api/chat/send - Send message and get AI response
router.post('/send', asyncHandler(async (req: Request, res: Response) => {
  const input = z.object({
    conversationId: z.string().optional(),
    message: z.string().min(1),
    contextType: z.enum(['general', 'hr', 'business', 'ogsm', 'knowledge', 'skill']).optional(),
  }).parse(req.body);

  const db = getDatabase();

  // Create conversation if not provided
  let conversationId = input.conversationId;
  if (!conversationId) {
    conversationId = uuidv4();
    db.prepare(
      `INSERT INTO conversations (id, tenant_id, user_id, title, context_type)
       VALUES (?, ?, ?, ?, ?)`
    ).run(conversationId, req.user!.tenantId, req.user!.userId, input.message.slice(0, 50), input.contextType || 'general');
  }

  // Save user message
  const userMsgId = uuidv4();
  db.prepare(
    'INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)'
  ).run(userMsgId, conversationId, 'user', input.message);

  // Generate AI response
  const aiResponse = await generateAIResponse(req.user!.tenantId, input.message, input.contextType || 'general');

  // Save AI response
  const aiMsgId = uuidv4();
  db.prepare(
    'INSERT INTO messages (id, conversation_id, role, content, metadata) VALUES (?, ?, ?, ?, ?)'
  ).run(aiMsgId, conversationId, 'assistant', aiResponse.content, JSON.stringify(aiResponse.metadata || {}));

  // Update conversation
  db.prepare(
    "UPDATE conversations SET message_count = message_count + 2, updated_at = datetime('now') WHERE id = ?"
  ).run(conversationId);

  successResponse(res, {
    conversationId,
    userMessage: { id: userMsgId, role: 'user', content: input.message },
    assistantMessage: { id: aiMsgId, role: 'assistant', content: aiResponse.content, metadata: aiResponse.metadata },
  });
}));

// AI Response generation with context awareness
async function generateAIResponse(
  tenantId: string,
  message: string,
  contextType: string
): Promise<{ content: string; metadata?: Record<string, unknown> }> {
  const db = getDatabase();

  // Try to use configured LLM
  if (config.llm.apiKey) {
    try {
      const response = await callLLM(tenantId, message, contextType);
      return response;
    } catch (error) {
      logger.warn('chat', 'LLM call failed, falling back to local response', { error: String(error) });
    }
  }

  // Local intelligent response based on context
  return generateLocalResponse(tenantId, message, contextType);
}

async function callLLM(
  tenantId: string,
  message: string,
  contextType: string
): Promise<{ content: string; metadata?: Record<string, unknown> }> {
  const systemPrompts: Record<string, string> = {
    general: '你是Vorzai电商智能助手，帮助用户解决电商业务和人力资源管理问题。回答简洁专业。',
    hr: '你是人力资源管理专家，精通电商行业的HR管理、绩效考核、薪酬设计、人效分析。',
    business: '你是电商业务专家，精通选品、运营、订单管理、客服、结算对账等全链路业务。',
    ogsm: '你是目标管理专家，精通OGSM方法论，帮助用户进行目标分解、策略制定和进度追踪。',
    knowledge: '你是知识库助手，帮助用户查找和管理企业知识。',
    skill: '你是技能执行助手，帮助用户使用企业专属技能完成重复性工作。',
  };

  const body = {
    model: config.llm.model,
    messages: [
      { role: 'system', content: systemPrompts[contextType] || systemPrompts.general },
      { role: 'user', content: message },
    ],
    temperature: 0.7,
    max_tokens: 2000,
  };

  // SECURITY: Add timeout to prevent hanging requests
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  const response = await fetch(`${config.llm.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.llm.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  });

  clearTimeout(timeout);

  if (!response.ok) {
    throw new Error(`LLM API error: ${response.status}`);
  }

  const data = await response.json() as any;
  return {
    content: data.choices[0]?.message?.content || '抱歉，我无法生成回复。',
    metadata: { model: config.llm.model, tokensUsed: data.usage?.total_tokens },
  };
}

function generateLocalResponse(
  tenantId: string,
  message: string,
  contextType: string
): { content: string; metadata?: Record<string, unknown> } {
  const db = getDatabase();
  const lowerMsg = message.toLowerCase();

  // Context-aware local responses
  if (contextType === 'hr' || lowerMsg.includes('员工') || lowerMsg.includes('考勤') || lowerMsg.includes('绩效')) {
    const empCount = (db.prepare("SELECT COUNT(*) as c FROM employees WHERE tenant_id = ? AND status IN ('active', 'probation')").get(tenantId) as any).c;
    return {
      content: `当前团队共有 ${empCount} 名在职员工。我可以帮您：\n\n1. 查看员工信息和考勤记录\n2. 进行绩效评估和薪酬计算\n3. 分析人效指标\n4. 管理部门架构\n\n请告诉我您具体需要什么帮助？`,
      metadata: { source: 'local', context: 'hr' },
    };
  }

  if (contextType === 'business' || lowerMsg.includes('订单') || lowerMsg.includes('商品') || lowerMsg.includes('项目')) {
    const orderStats = db.prepare(
      "SELECT COUNT(*) as c, COALESCE(SUM(total_amount), 0) as total FROM orders WHERE tenant_id = ?"
    ).get(tenantId) as any;
    const projectCount = (db.prepare("SELECT COUNT(*) as c FROM projects WHERE tenant_id = ? AND status != 'cancelled'").get(tenantId) as any).c;

    return {
      content: `业务概览：当前有 ${projectCount} 个活跃项目，累计 ${orderStats.c} 笔订单，总金额 ¥${orderStats.total.toFixed(2)}。\n\n我可以帮您：\n\n1. 管理项目立项和进度\n2. 选品分析和商品管理\n3. 订单处理和物流跟踪\n4. 客服工单管理\n5. 结算对账\n\n请问需要哪方面的帮助？`,
      metadata: { source: 'local', context: 'business' },
    };
  }

  if (contextType === 'ogsm' || lowerMsg.includes('目标') || lowerMsg.includes('ogsm')) {
    const objCount = (db.prepare("SELECT COUNT(*) as c FROM ogsm_objectives WHERE tenant_id = ? AND status = 'active'").get(tenantId) as any).c;
    return {
      content: `当前有 ${objCount} 个活跃目标。OGSM方法论帮您将公司战略层层分解：\n\nO (Objective) → 方向性目标\nG (Goals) → 可量化指标\nS (Strategies) → 实现路径\nM (Measures) → 过程度量\n\n我可以帮您创建目标、分解指标、分配责任人(RACI)、设置激励机制。请告诉我您的目标是什么？`,
      metadata: { source: 'local', context: 'ogsm' },
    };
  }

  // General response
  return {
    content: `您好！我是Vorzai电商智能助手，专注于电商企业的人力资源管理和业务解决方案。\n\n我可以帮助您：\n- 人力资源：员工管理、考勤、绩效、薪酬、人效分析\n- 业务管理：立项、选品、组盘、订单、客服、结算\n- 目标管理：OGSM分解、追踪、RACI矩阵、激励机制\n- 知识管理：企业知识库、专属技能\n\n请描述您的需求，我会为您提供专业建议。`,
    metadata: { source: 'local', context: 'general' },
  };
}

export default router;
