/**
 * Vorzai 对话引擎（CALM 式）
 *
 * 三层架构：
 *   1. Intent Resolution — LLM 意图理解（LLM 不可用时降级为关键词匹配规则）
 *   2. Flow Execution  — 确定性工具调度（调用 business/ogsm/hr Service）
 *   3. Context Memory   — 多轮上下文维护
 *
 * 支持 11 种 action 类型：
 *   product.select / product.price / order.create / order.status /
 *   assortment.create / ticket.create / ticket.status /
 *   ogsm.progress / ogsm.assign / hr.efficiency / inventory.status
 */

import { config } from '../config';
import { logger } from '../utils/logger';
import { getDatabase } from '../db';
import { businessService } from '../services/businessService';
import { ogsmService } from '../services/ogsmService';
import { hrService } from '../services/hrService';
import { knowledgeService, type SearchHit } from './knowledgeService';

// ==================== Types ====================

export type IntentionType =
  | 'product.select'
  | 'product.price'
  | 'order.create'
  | 'order.status'
  | 'assortment.create'
  | 'ticket.create'
  | 'ticket.status'
  | 'ogsm.progress'
  | 'ogsm.assign'
  | 'hr.efficiency'
  | 'inventory.status'
  | 'general';

export interface Action {
  type: IntentionType;
  payload: Record<string, unknown>;
  status?: 'pending' | 'executing' | 'done' | 'error';
  result?: unknown;
  error?: string;
}

export interface MessageContext {
  history?: { role: string; content: string; actionType?: string }[];
}

export interface ProcessResult {
  reply: string;
  actions?: Action[];
  /** RAG 检索到的知识来源（供前端引用展示） */
  sources?: RagSource[];
  /** 注入 LLM 的检索上下文（透明化 / 调试） */
  ragContext?: string;
}

/** RAG 知识来源条目 */
export interface RagSource {
  documentId: string;
  documentName: string;
  snippet: string;
  score: number;
}

/** RAG 检索阈值：低于该相似度的文档不纳入上下文 */
const RAG_MIN_SCORE = 0.05;
/** RAG 单次最多召回文档数 */
const RAG_TOP_K = 5;

export interface ToolSpec {
  type: IntentionType;
  category: 'product' | 'order' | 'ticket' | 'ogsm' | 'hr' | 'inventory' | 'assortment';
  description: string;
  keywords: string[];
  params?: string[];
}

// ==================== Constants ====================

/** 当前支持的所有工具，供 LLM tool-call 参考 */
export const TOOLS: ToolSpec[] = [
  { type: 'product.select', category: 'product', description: '按类目/关键词/平台筛选候选商品（选品）', keywords: ['选品', '找商品', '搜商品', '推荐商品', '热门商品'], params: ['category', 'keyword', 'platform'] },
  { type: 'product.price', category: 'product', description: '查询指定商品的成本价/售价/市场价/毛利率', keywords: ['价格', '成本', '售价', '毛利', '定价', '成本价', '售价查询'], params: ['sku', 'keyword', 'productId'] },
  { type: 'order.create', category: 'order', description: '创建新订单（需商品ID、数量、金额）', keywords: ['下单', '创建订单', '新建订单', '下订单'], params: ['items', 'customerName', 'remark'] },
  { type: 'order.status', category: 'order', description: '查询订单状态（订单号/客户名）', keywords: ['订单', '查单', '订单状态', '发货', '物流'], params: ['keyword', 'orderId'] },
  { type: 'assortment.create', category: 'assortment', description: '创建商品组合/套餐（组盘）', keywords: ['组盘', '套餐', '组合', '搭配套餐'], params: ['name', 'productIds'] },
  { type: 'ticket.create', category: 'ticket', description: '创建客服工单', keywords: ['工单', '报修', '投诉', '反馈', '售后'], params: ['subject', 'customerName', 'category'] },
  { type: 'ticket.status', category: 'ticket', description: '查询工单状态', keywords: ['工单状态', '工单查询', '投诉处理'], params: ['keyword'] },
  { type: 'ogsm.progress', category: 'ogsm', description: '查询 OGSM 目标/指标进度', keywords: ['目标', 'ogsm', '进度', '目标进度', 'KPI', '指标进度'], params: ['keyword', 'objectiveId'] },
  { type: 'ogsm.assign', category: 'ogsm', description: 'OGSM 任务/目标分配责任人', keywords: ['分配', '指派', 'RACI', '责任人', '分配任务'], params: ['title', 'assignee'] },
  { type: 'hr.efficiency', category: 'hr', description: '查询人效指标（人均GMV/人均订单）', keywords: ['人效', '人均', '人效指标', '团队效率', '效率分析'], params: ['period', 'scope'] },
  { type: 'inventory.status', category: 'inventory', description: '查询商品库存状态', keywords: ['库存', '库存查询', '缺货', '补货', '现货'], params: ['keyword', 'productId'] },
];

// 关键词匹配权重（更高优先级关键词优先）
const INTENT_KEYWORD_MAP: Record<IntentionType, string[]> = {
  'product.select': TOOLS[0].keywords,
  'product.price': TOOLS[1].keywords,
  'order.create': TOOLS[2].keywords,
  'order.status': TOOLS[3].keywords,
  'assortment.create': TOOLS[4].keywords,
  'ticket.create': TOOLS[5].keywords,
  'ticket.status': TOOLS[6].keywords,
  'ogsm.progress': TOOLS[7].keywords,
  'ogsm.assign': TOOLS[8].keywords,
  'hr.efficiency': TOOLS[9].keywords,
  'inventory.status': TOOLS[10].keywords,
  general: [],
};

// ==================== Dialog Engine ====================

export class DialogEngine {
  /**
   * 处理用户消息，返回回复 + actions
   *
   * @param input 用户输入文本
   * @param tenantId 租户 ID
   * @param userId 用户 ID
   * @param context 上下文（含对话历史）
   */
  async processMessage(
    input: string,
    tenantId: string,
    userId: string,
    context: MessageContext = {}
  ): Promise<ProcessResult> {
    if (!input.trim()) {
      return { reply: '请输入您的问题或指令。' };
    }

    const trimmed = input.trim();

    // 0. RAG 知识检索（先于意图解析，用于 grounding）
    const ragHits = this.retrieveKnowledge(trimmed, tenantId);
    const ragContext = ragHits.length ? this.buildRagContext(ragHits) : '';

    // 1. 意图解析（LLM → 降级关键词匹配；LLM 提示注入 RAG 上下文）
    const intention = await this.resolveIntention(trimmed, tenantId, context.history, ragContext);

    logger.info('dialog', `Intent resolved: ${intention.type}`, {
      tenantId,
      userId,
      input: trimmed.slice(0, 60),
      ragHits: ragHits.length,
    });

    // 2. 若无法归类到具体操作，优先用知识库回答
    if (intention.type === 'general') {
      const kbReply = this.buildKnowledgeReply(tenantId, ragHits);
      if (kbReply) return kbReply;
      return this.buildGeneralReply(tenantId);
    }

    // 3. 工具调度执行
    const actions = await this.dispatchTools(tenantId, userId, trimmed, intention, context.history);
    const reply = this.buildReplyFromActions(trimmed, intention.type, actions);

    return {
      reply,
      actions,
      ...(ragHits.length ? { sources: this.toRagSources(ragHits), ragContext } : {}),
    };
  }

  // ---------- Intent Resolution ----------

  /** 意图解析：LLM 优先，失败则降级关键词匹配 */
  private async resolveIntention(
    input: string,
    tenantId: string,
    history?: { role: string; content: string; actionType?: string }[],
    ragContext?: string
  ): Promise<{ type: IntentionType; params: Record<string, unknown>; confidence: number }> {
    // 尝试 LLM
    if (config.llm.apiKey) {
      try {
        const llmIntent = await this.callIntentLLM(input, tenantId, history, ragContext);
        if (llmIntent && llmIntent.type !== 'general') {
          logger.debug('dialog', 'LLM intent resolved', { type: llmIntent.type });
          return llmIntent;
        }
        if (llmIntent) return llmIntent;
      } catch (err) {
        logger.warn('dialog', 'LLM intent resolution failed, falling back', { error: String(err) });
      }
    }

    // 降级：关键词匹配
    const keywordIntent = this.matchByKeywords(input);
    logger.debug('dialog', 'Keyword intent resolved', { type: keywordIntent.type, confidence: keywordIntent.confidence });
    return keywordIntent;
  }

  /** LLM 意图理解（输出 JSON） */
  private async callIntentLLM(
    input: string,
    tenantId: string,
    history?: { role: string; content: string }[],
    ragContext?: string
  ): Promise<{ type: IntentionType; params: Record<string, unknown>; confidence: number } | null> {
    const ragBlock = ragContext
      ? `\n\n以下是与用户问题相关的知识库内容（仅供参考，用于辅助意图判断）：\n${ragContext}\n`
      : '';
    const systemPrompt = `你是Vorzai电商对话引擎的意图理解模块。
将用户输入分类为以下之一，并以严格 JSON 输出：
${TOOLS.map((t) => `"${t.type}" — ${t.description}`).join('\n')}
若用户只是闲聊或无法归类，type 返回 "general"。
输出格式：{"type": "...", "params": {}, "confidence": 0.9}
只输出 JSON，不要其他内容。${ragBlock}`;

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...(history || []).filter((m) => m.role === 'user' || m.role === 'assistant').slice(-4),
      { role: 'user' as const, content: input },
    ];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(`${config.llm.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.llm.apiKey}`,
        },
        body: JSON.stringify({
          model: config.llm.model,
          messages,
          temperature: 0,
          max_tokens: 300,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) throw new Error(`LLM API ${response.status}`);

      const data = await response.json() as any;
      const raw = data.choices[0]?.message?.content || '{}';

      let parsed: any;
      try {
        // 提取可能的 JSON 块
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
      } catch {
        return null;
      }

      const validTypes: IntentionType[] = [...Object.keys(INTENT_KEYWORD_MAP) as IntentionType[]];
      const type = validTypes.includes(parsed.type) ? parsed.type : 'general';

      return {
        type,
        params: parsed.params || {},
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.8,
      };
    } catch (err) {
      logger.warn('dialog', 'LLM intent call failed', { error: String(err) });
      throw err;
    }
  }

  /** 关键词匹配降级 */
  private matchByKeywords(input: string): { type: IntentionType; params: Record<string, unknown>; confidence: number } {
    const lower = input.toLowerCase();
    let bestType: IntentionType = 'general';
    let bestScore = 0;

    for (const [type, keywords] of Object.entries(INTENT_KEYWORD_MAP)) {
      if (type === 'general') continue;
      let score = 0;
      for (const kw of keywords) {
        if (lower.includes(kw)) {
          // 长关键词权重更高
          score += kw.length;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestType = type as IntentionType;
      }
    }

    return {
      type: bestType,
      params: { keyword: input },
      confidence: bestScore > 0 ? Math.min(1, bestScore / 4) : 0,
    };
  }

  // ---------- Tool Dispatch ----------

  private async dispatchTools(
    tenantId: string,
    userId: string,
    input: string,
    intention: { type: IntentionType },
    history?: { role: string; content: string; actionType?: string }[]
  ): Promise<Action[]> {
    const handlers: Record<string, (i: string) => Promise<Action>> = {
      'product.select': () => this.handleProductSelect(tenantId, input),
      'product.price': () => this.handleProductPrice(tenantId, input),
      'order.create': () => this.handleOrderCreate(tenantId, userId, input),
      'order.status': () => this.handleOrderStatus(tenantId, input, history),
      'assortment.create': () => this.handleAssortmentCreate(tenantId, input),
      'ticket.create': () => this.handleTicketCreate(tenantId, input),
      'ticket.status': () => this.handleTicketStatus(tenantId, input),
      'ogsm.progress': () => this.handleOgsmProgress(tenantId, input),
      'ogsm.assign': () => this.handleOgsmAssign(tenantId, input),
      'hr.efficiency': () => this.handleHrEfficiency(tenantId, input),
      'inventory.status': () => this.handleInventoryStatus(tenantId, input),
    };

    const handler = handlers[intention.type];
    if (!handler) {
      return [{ type: 'general', payload: {}, status: 'done', result: '暂无对应工具。' }];
    }

    try {
      return [await handler(input)];
    } catch (err: any) {
      logger.error('dialog', `Tool execution failed: ${intention.type}`, { error: String(err) });
      return [{
        type: intention.type,
        payload: { input },
        status: 'error',
        error: err.message || '工具执行失败',
      }];
    }
  }

  // ---------- Tool Handlers ----------

  private async handleProductSelect(tenantId: string, input: string): Promise<Action> {
    const keyword = this.extractKeyword(input, ['选', '找', '搜', '推']);
    const products = businessService.listProducts(tenantId, { keyword: keyword || undefined, limit: 8, page: 1 });
    return {
      type: 'product.select',
      payload: { keyword: keyword || input },
      status: 'done',
      result: products,
    };
  }

  private async handleProductPrice(tenantId: string, input: string): Promise<Action> {
    const keyword = this.extractKeyword(input, ['价格', '成本', '毛利', '定价', '售价']);
    const products = businessService.listProducts(tenantId, { keyword: keyword || undefined, limit: 5, page: 1 });
    const summary = products.data.map((p: any) => ({
      name: p.name,
      sku: p.sku,
      costPrice: p.cost_price,
      sellingPrice: p.selling_price,
      marketPrice: p.market_price,
      marginRate: p.margin_rate,
    }));
    return {
      type: 'product.price',
      payload: { keyword: keyword || input },
      status: 'done',
      result: summary,
    };
  }

  private async handleOrderCreate(tenantId: string, _userId: string, input: string): Promise<Action> {
    // 解析简单订单：用户需指定商品和数量
    const items = this.parseOrderItems(input);
    if (items.length === 0) {
      return {
        type: 'order.create',
        payload: { input },
        status: 'done',
        result: { note: '无法解析订单商品。请提供商品SKU/名称和数量，如"下单苹果5个，香蕉3个"' },
      };
    }
    const order = businessService.createOrder(tenantId, { items });
    return {
      type: 'order.create',
      payload: { items },
      status: 'done',
      result: order,
    };
  }

  private async handleOrderStatus(tenantId: string, input: string, history?: { actionType?: string; content?: string }[]): Promise<Action> {
    const lastOrderId = history?.slice().reverse().find((m) => m.actionType)?.content;
    const keyword = this.extractKeyword(input, ['订单号', '客户']);
    const orders = businessService.listOrders(tenantId, { keyword: keyword || lastOrderId || undefined, limit: 5, page: 1 });
    return {
      type: 'order.status',
      payload: { keyword: keyword || lastOrderId || input },
      status: 'done',
      result: orders,
    };
  }

  private async handleAssortmentCreate(tenantId: string, input: string): Promise<Action> {
    // 组盘：通过 products 查询匹配商品作为推荐
    const keyword = this.extractKeyword(input, ['组盘', '套餐', '组合', '搭配']);
    const products = businessService.listProducts(tenantId, { keyword: keyword || undefined, limit: 10, page: 1 });
    return {
      type: 'assortment.create',
      payload: { name: keyword || input },
      status: 'done',
      result: {
        note: '已为您推荐以下商品用于组盘',
        recommended: products.data.slice(0, 6),
      },
    };
  }

  private async handleTicketCreate(tenantId: string, input: string): Promise<Action> {
    const subject = this.extractKeyword(input, ['问题', '故障', '投诉']);
    const ticket = businessService.createTicket(tenantId, {
      subject: subject || input,
      category: 'inquiry',
    });
    return {
      type: 'ticket.create',
      payload: { subject: subject || input },
      status: 'done',
      result: ticket,
    };
  }

  private async handleTicketStatus(tenantId: string, input: string): Promise<Action> {
    const keyword = this.extractKeyword(input, ['工单']);
    const tickets = businessService.listTickets(tenantId, { keyword, limit: 5, page: 1 });
    return {
      type: 'ticket.status',
      payload: { keyword: keyword || input },
      status: 'done',
      result: tickets,
    };
  }

  private async handleOgsmProgress(tenantId: string, input: string): Promise<Action> {
    const keyword = this.extractKeyword(input, ['目标']);
    const objectives = ogsmService.listObjectives(tenantId, { keyword, limit: 5, page: 1 });
    return {
      type: 'ogsm.progress',
      payload: { keyword: keyword || input },
      status: 'done',
      result: objectives,
    };
  }

  private async handleOgsmAssign(tenantId: string, input: string): Promise<Action> {
    const keyword = this.extractKeyword(input, ['分配', '指派', '责任人']);
    const objectives = ogsmService.listObjectives(tenantId, { keyword, limit: 5, page: 1 });
    return {
      type: 'ogsm.assign',
      payload: { keyword: keyword || input },
      status: 'done',
      result: {
        note: '以下目标可供分配责任人',
        objectives: objectives.data,
      },
    };
  }

  private async handleHrEfficiency(tenantId: string, input: string): Promise<Action> {
    const periodMatch = input.match(/(\d{4}-\d{2})/);
    const period = periodMatch?.[1] || new Date().toISOString().slice(0, 7);
    const metrics = hrService.getEfficiencyMetrics(tenantId, period, 'company');
    return {
      type: 'hr.efficiency',
      payload: { period },
      status: 'done',
      result: metrics,
    };
  }

  private async handleInventoryStatus(tenantId: string, input: string): Promise<Action> {
    const keyword = this.extractKeyword(input, ['库存', '缺货', '补货']);
    const products = businessService.listProducts(tenantId, { keyword: keyword || undefined, limit: 10, page: 1 });
    const inventory = products.data.map((p: any) => ({
      name: p.name,
      sku: p.sku,
      stock: p.stock,
      status: p.stock <= 0 ? 'out_of_stock' : p.stock <= 10 ? 'low_stock' : 'in_stock',
    }));
    return {
      type: 'inventory.status',
      payload: { keyword: keyword || input },
      status: 'done',
      result: inventory,
    };
  }

  // ---------- Reply Building ----------

  private buildReplyFromActions(
    input: string,
    type: IntentionType,
    actions: Action[]
  ): string {
    const action = actions[0];
    if (!action || action.status === 'error') {
      return action?.error
        ? `执行 "${type}" 时出错：${action.error}`
        : `暂无可用工具处理"${input}"。您可以试试：\n• 选品：查热门商品\n• 订单：查订单状态\n• 库存：查库存\n• 工单：创建售后工单\n• OGSM：查目标进度\n• 人效：查人效指标`;
    }

    const result = action.result;
    if (!result) return `已执行操作 "${type}"。`;

    const resultStr = this.formatResultForReply(type, result);
    return resultStr;
  }

  // ---------- RAG (Retrieval-Augmented Generation) ----------

  /** 检索与 query 相关的知识库文档（已按阈值过滤 + 排序 + 截断） */
  private retrieveKnowledge(query: string, tenantId: string): SearchHit[] {
    if (!query.trim()) return [];
    const hits = knowledgeService.searchKnowledge(tenantId, query, { limit: RAG_TOP_K });
    return hits.filter((h) => h.score >= RAG_MIN_SCORE);
  }

  /** 将检索结果组装为可供 LLM 消费的上下文块（纯函数） */
  private buildRagContext(hits: SearchHit[]): string {
    return hits
      .map((h, i) => `[知识 ${i + 1}] 《${h.documentName}》\n${h.snippet}`)
      .join('\n\n');
  }

  /** 将检索命中转换为前端友好的来源条目 */
  private toRagSources(hits: SearchHit[]): RagSource[] {
    return hits.map((h) => ({
      documentId: h.documentId,
      documentName: h.documentName,
      snippet: h.snippet,
      score: Number(h.score.toFixed(3)),
    }));
  }

  /** 当意图为 general 时，优先用知识库内容组织回答；无命中返回 null */
  private buildKnowledgeReply(tenantId: string, hits: SearchHit[]): ProcessResult | null {
    if (!hits.length) return null;
    const top = hits[0];
    const sources = this.toRagSources(hits);
    const reply = [
      `根据知识库《${top.documentName}》，为您找到相关信息：`,
      '',
      top.snippet,
      hits.length > 1 ? `\n（另附 ${hits.length - 1} 条相关文档，可进一步追问获取细节）` : '',
      '\n\n如需具体操作（如查库存、建工单、看目标），请直接告诉我。',
    ].join('');
    return { reply, sources, ragContext: this.buildRagContext(hits) };
  }

  private buildGeneralReply(tenantId: string): ProcessResult {
    const db = getDatabase();
    const orderCount = (db.prepare("SELECT COUNT(*) as c FROM orders WHERE tenant_id = ?").get(tenantId) as any).c || 0;
    const empCount = (db.prepare("SELECT COUNT(*) as c FROM employees WHERE tenant_id = ?").get(tenantId) as any).c || 0;
    const objCount = (db.prepare("SELECT COUNT(*) as c FROM ogsm_objectives WHERE tenant_id = ?").get(tenantId) as any).c || 0;

    return {
      reply: `您好！我是Vorzai电商智能助手。

当前概览：${orderCount} 笔订单 · ${empCount} 名员工 · ${objCount} 个目标

我可以帮您完成以下操作：
• **选品** — 搜商品、查价格、查库存
• **订单** — 创建订单、查订单状态
• **组盘** — 创建商品组合套餐
• **客服** — 创建工单、查工单状态
• **OGSM** — 查目标进度、分配责任人
• **人效** — 查询团队人效指标

请直接描述您的需求，如"查一下库存"、"创建售后工单"、"目标进度"。`,
    };
  }

  private formatResultForReply(type: IntentionType, result: unknown): string {
    try {
      // 对分页结果提取 data 数组
      let data: unknown[] = [];
      if (result && typeof result === 'object' && 'data' in result) {
        data = (result as any).data || [];
      } else if (Array.isArray(result)) {
        data = result;
      } else if (result && typeof result === 'object' && 'recommended' in result) {
        data = (result as any).recommended || [];
      } else if (result && typeof result === 'object' && 'objectives' in result) {
        data = (result as any).objectives || [];
      } else if (result && typeof result === 'object' && 'note' in result) {
        return (result as any).note || '操作已完成。';
      }

      const labelMap: Record<string, string> = {
        'product.select': '候选商品',
        'product.price': '商品价格',
        'order.create': '订单',
        'order.status': '订单',
        'assortment.create': '组盘推荐',
        'ticket.create': '工单',
        'ticket.status': '工单',
        'ogsm.progress': '目标',
        'ogsm.assign': '目标',
        'hr.efficiency': '人效指标',
        'inventory.status': '库存',
      };

      const label = labelMap[type] || '结果';

      if (!data.length) {
        // 单条记录展示
        const display = typeof result === 'object'
          ? JSON.stringify(result, null, 2).slice(0, 300)
          : String(result);
        return `${label}：${display}`;
      }

      const limit = Math.min(data.length, 5);
      const lines = data.slice(0, limit).map((item: any, i: number) => {
        if (typeof item === 'object') {
          const keys = Object.keys(item).slice(0, 5);
          return `${i + 1}. ${keys.map((k) => `${k}=${item[k]}`).join(' ')}`;
        }
        return `${i + 1}. ${item}`;
      });

      const total = data.length;
      const summary = total > limit ? `（共 ${total} 条，仅展示前 ${limit} 条）` : '';

      return `${label}（${total}条）：\n${lines.join('\n')}\n${summary}`;
    } catch {
      return `已执行操作 "${type}"，共 ${Array.isArray(result) ? result.length : 1} 条结果。`;
    }
  }

  // ---------- Helpers ----------

  private extractKeyword(text: string, excludeWords: string[]): string {
    let keyword = text;
    for (const w of excludeWords) {
      keyword = keyword.replace(new RegExp(w, 'g'), '');
    }
    // 去除常见助词
    keyword = keyword.replace(/[，。、？！的了吗呢吧啊是进行一下帮我查询一下]/g, '').trim();
    return keyword.slice(0, 40) || text;
  }

  private parseOrderItems(input: string): Array<{ productId: string; quantity: number; unitPrice: number }> {
    // 简单解析："苹果5个" / "SKU001 * 3" / "商品A 2 件"
    const items: Array<{ productId: string; quantity: number; unitPrice: number }> = [];
    const patterns = [
      /(\S+?)[\s*×x]+(\d+)\s*[\u4e00-\u9fa5]*个/g,
      /(\S+?)[\s*×x]+(\d+)\s*件/g,
      /SKU(\S+?)[\s*×x]+(\d+)/gi,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(input)) !== null) {
        const name = match[1].trim();
        const qty = parseInt(match[2], 10);
        if (name && qty > 0) {
          // productId 用名称占位，实际应由前端传入 ID
          items.push({ productId: name, quantity: qty, unitPrice: 0 });
        }
      }
    }
    return items;
  }
}

export const dialogEngine = new DialogEngine();
