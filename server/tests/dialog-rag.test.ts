/**
 * W2 RAG 接入单元测试（V2 · 阶段二）
 *
 * 验证 dialogEngine 已打通知识库检索（断层 #2 修复）：
 *   - general 意图命中知识库 → 返回 KB-grounded 回复 + sources + ragContext
 *   - general 意图无命中 → 回退通用帮助（向后兼容）
 *   - 工具意图命中知识库 → 正常调度工具，并附带 sources
 *   - 多租户隔离：A 租户文档不出现在 B 租户回答中
 *   - 检索阈值过滤：完全无关查询不产生命中
 *
 * 全程离线：测试环境无 LLM key，意图解析走关键词降级路径。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDatabase, closeDatabase, getDatabase } from '../src/db';
import { dialogEngine } from '../src/services/dialogEngine';
import { knowledgeService } from '../src/services/knowledgeService';
import { v4 as uuidv4 } from 'uuid';
import { removeDbFiles } from './test-helpers';

const TEST_DB_PATH = process.env.VORZAI_TEST_DB_DIALOG || 'data/test_vorzai_dialog.db';

let tenantA: string;
let tenantB: string;

function seedTenant(name: string): string {
  const db = getDatabase();
  const id = uuidv4();
  db.prepare('INSERT INTO tenants (id, name, slug, status) VALUES (?, ?, ?, ?)')
    .run(id, name, `${name}-${id.slice(0, 8)}`, 'active');
  return id;
}

function seedKbDoc(tenantId: string, title: string, content: string): void {
  const kb = knowledgeService.createKnowledgeBase(tenantId, { name: `${title}-KB` });
  knowledgeService.createDocument(tenantId, kb.id as string, { title, content });
}

beforeAll(() => {
  removeDbFiles(TEST_DB_PATH);
  initDatabase(TEST_DB_PATH);

  tenantA = seedTenant('rag-a');
  tenantB = seedTenant('rag-b');

  // 租户 A 拥有两份知识文档（均自动 published，可被 RAG 检索）
  seedKbDoc(
    tenantA,
    '退换货政策说明',
    '退换货政策：自签收之日起 7 天内，商品不影响二次销售可申请无理由退换货。' +
      '退换货产生的运费由买家承担，质量问题由商家承担。换货需保持吊牌完整。'
  );
  seedKbDoc(
    tenantA,
    '库存管理规范',
    '库存管理规范：当商品现货低于 10 件时触发低库存预警，系统自动生成补货建议单。' +
      '仓库出入库需登记 stock_transactions 流水，确保账实一致。'
  );
  // 租户 B 不建任何知识库（用于隔离验证）
});

afterAll(() => {
  closeDatabase();
  removeDbFiles(TEST_DB_PATH);
});

describe('W2 RAG · 检索层', () => {
  it('知识库检索能命中相关文档', () => {
    const hits = knowledgeService.searchKnowledge(tenantA, '退换货政策是什么');
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].documentName).toBe('退换货政策说明');
    expect(hits[0].score).toBeGreaterThanOrEqual(0.05);
    expect(hits[0].snippet).toContain('退换货');
  });

  it('不命中时返回空结果（阈值过滤生效）', () => {
    // 纯 ASCII 随机串，与中文知识库零字符重叠 → 0 命中
    const hits = knowledgeService.searchKnowledge(tenantA, 'zxqwlkjasd qwertyuiop asdfghjkl');
    expect(hits.length).toBe(0);
  });

  it('租户隔离：B 租户查不到 A 租户的文档', () => {
    const hitsA = knowledgeService.searchKnowledge(tenantA, '退换货政策');
    const hitsB = knowledgeService.searchKnowledge(tenantB, '退换货政策');
    expect(hitsA.length).toBeGreaterThan(0);
    expect(hitsB.length).toBe(0);
  });
});

describe('W2 RAG · general 意图知识库回答', () => {
  it('命中知识库 → 返回 KB-grounded 回复 + sources + ragContext', async () => {
    const result = await dialogEngine.processMessage('我们的退换货政策是什么', tenantA, 'u-a');

    expect(result.reply).toContain('退换货政策');
    expect(result.sources).toBeDefined();
    expect(result.sources!.length).toBeGreaterThanOrEqual(1);
    expect(result.sources![0].documentName).toBe('退换货政策说明');
    expect(result.sources![0].score).toBeGreaterThanOrEqual(0.05);
    expect(typeof result.sources![0].snippet).toBe('string');
    expect(result.ragContext).toBeDefined();
    expect(result.ragContext).toContain('《退换货政策说明》');
  });

  it('无命中 → 回退通用帮助（向后兼容，无 sources）', async () => {
    const result = await dialogEngine.processMessage('苹果手机多少钱一台', tenantA, 'u-a');

    // 该查询不命中任何工具关键词，也不命中知识库 → 通用帮助
    expect(result.reply).toContain('Vorzai');
    expect(result.sources).toBeUndefined();
    expect(result.ragContext).toBeUndefined();
  });

  it('空输入不崩溃，返回引导语', async () => {
    const result = await dialogEngine.processMessage('   ', tenantA, 'u-a');
    expect(result.reply).toContain('请输入');
  });
});

describe('W2 RAG · 工具意图仍正常 + 附带 sources', () => {
  it('库存类查询命中工具并附带知识来源', async () => {
    const result = await dialogEngine.processMessage('低库存预警怎么处理', tenantA, 'u-a');

    expect(result.actions).toBeDefined();
    expect(result.actions!.length).toBeGreaterThan(0);
    expect(result.actions![0].type).toBe('inventory.status');
    // “库存/预警” 同时命中知识库《库存管理规范》
    expect(result.sources).toBeDefined();
    expect(result.sources!.some((s) => s.documentName === '库存管理规范')).toBe(true);
  });

  it('纯工具查询无知识命中 → 正常调度、无 sources', async () => {
    const result = await dialogEngine.processMessage('查一下订单状态', tenantA, 'u-a');
    expect(result.actions).toBeDefined();
    expect(result.actions![0].type).toBe('order.status');
    expect(result.sources).toBeUndefined();
  });
});

describe('W2 RAG · 多租户隔离（端到端）', () => {
  it('B 租户查询 A 的知识 → 不泄露，回退通用帮助', async () => {
    const result = await dialogEngine.processMessage('我们的退换货政策是什么', tenantB, 'u-b');

    expect(result.reply).toContain('Vorzai');
    expect(result.reply).not.toContain('吊牌完整');
    expect(result.sources).toBeUndefined();
  });
});
