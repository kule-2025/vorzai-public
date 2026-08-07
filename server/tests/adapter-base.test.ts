/**
 * 适配器基类与公共工具单测（B2 覆盖率提升专项）
 * 覆盖 server/src/services/adapters/baseAdapter.ts —— 金额/时间映射、确定性伪随机、沙箱数据生成、AdapterError。
 */
import { describe, it, expect } from 'vitest';
import {
  BaseAdapter,
  AdapterError,
  fenToYuan,
  toAmount,
  toIso,
  mulberry32,
  seedFrom,
  pick,
  digits,
} from '../src/services/adapters/baseAdapter';
import type { AdapterContext, NormalizedOrder, ResourceType } from '../src/services/adapters/types';

class TestAdapter extends BaseAdapter {
  readonly platform: 'douyin' = 'douyin';
  readonly displayName = 'TestPlatform';
  readonly capabilities: ResourceType[] = ['orders', 'products', 'inventory'];
  readonly gateway = 'https://test.example.com';
  protected readonly orderNoPrefix = 'TB';
  protected hasLiveCredentials(): boolean {
    return false;
  }
  requireLivePublic(endpoint: string): void {
    this.requireLive(endpoint);
  }
  async testConnection() {
    return this.sandboxTestResult('演练就绪');
  }
  async fetchOrders(o?: Parameters<BaseAdapter['fetchOrders']>[0]) {
    return this.buildSandboxOrders(o);
  }
  async fetchProducts(o?: Parameters<BaseAdapter['fetchProducts']>[0]) {
    return this.buildSandboxProducts(o);
  }
  async fetchInventory(o?: Parameters<BaseAdapter['fetchInventory']>[0]) {
    return this.buildSandboxInventory(o);
  }
  async pushInventory(items: Parameters<BaseAdapter['pushInventory']>[0]) {
    return this.buildSandboxPushResult(items);
  }
  normalizeOrder(raw: Record<string, unknown>): NormalizedOrder {
    return raw as unknown as NormalizedOrder;
  }
}

function makeCtx(mode: 'live' | 'sandbox' = 'sandbox'): AdapterContext {
  return { connectionId: 'conn-1', tenantId: 't-1', platform: 'douyin', mode, credentials: {}, shopName: 'Shop' };
}

describe('baseAdapter — 金额 / 时间工具', () => {
  it('fenToYuan：分转元并对非有限值兜底', () => {
    expect(fenToYuan(12345)).toBe(123.45);
    expect(fenToYuan(100.7)).toBe(1.01);
    expect(fenToYuan(undefined)).toBe(0);
    expect(fenToYuan('abc')).toBe(0);
    expect(fenToYuan(null)).toBe(0);
  });
  it('toAmount：保留两位小数并对非有限值兜底', () => {
    expect(toAmount(123.456)).toBe(123.46);
    expect(toAmount('12.3')).toBe(12.3);
    expect(toAmount('x')).toBe(0);
    expect(toAmount(undefined)).toBe(0);
  });
  it('toIso：10位秒 / 13位毫秒 / ISO 字符串均归一化', () => {
    expect(toIso(1700000000)).toBe(new Date(1700000000 * 1000).toISOString());
    expect(toIso(1700000000000)).toBe(new Date(1700000000000).toISOString());
    expect(toIso('2024-01-01T00:00:00Z')).toBe('2024-01-01T00:00:00.000Z');
    expect(toIso('')).toBeNull();
    expect(toIso(null)).toBeNull();
    expect(toIso('not-a-date')).toBeNull();
  });
});

describe('baseAdapter — 确定性伪随机', () => {
  it('mulberry32 同 seed 产出同序列且落在 [0,1)', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    for (let i = 0; i < 5; i++) {
      const va = a();
      const vb = b();
      expect(va).toBe(vb);
      expect(va).toBeGreaterThanOrEqual(0);
      expect(va).toBeLessThan(1);
    }
  });
  it('seedFrom 由文本产出稳定 uint32', () => {
    expect(seedFrom('conn-1')).toBe(seedFrom('conn-1'));
    expect(typeof seedFrom('x')).toBe('number');
  });
  it('pick 从池中等概率取样且受种子控制', () => {
    const pool = ['a', 'b', 'c'] as const;
    const r = mulberry32(42);
    const got = pick(r, pool);
    expect(pool).toContain(got);
    // 确定性：同一序列两次 pick 结果一致
    const r2 = mulberry32(42);
    expect(pick(r2, pool)).toBe(got);
  });
  it('digits 产出指定长度的全数字串', () => {
    const r = mulberry32(7);
    const d = digits(r, 10);
    expect(d).toHaveLength(10);
    expect(d).toMatch(/^[0-9]+$/);
  });
});

describe('baseAdapter — AdapterError', () => {
  it('携带端点与状态码，name 为 AdapterError', () => {
    const e = new AdapterError('调用失败', '/api/x', 503);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('AdapterError');
    expect(e.endpoint).toBe('/api/x');
    expect(e.status).toBe(503);
    expect(e.message).toBe('调用失败');
  });
});

describe('baseAdapter — 沙箱数据生成', () => {
  it('sandboxTestResult 标记为沙箱且成功', async () => {
    const a = new TestAdapter(makeCtx('sandbox'));
    const res = await a.testConnection();
    expect(res.success).toBe(true);
    expect(res.status).toBe('sandbox');
    expect(res.sandbox).toBe(true);
    expect(res.mode).toBe('sandbox');
    expect(res.message).toContain('沙箱');
  });

  it('buildSandboxOrders 确定且带 _sandbox 标记、分页两页', async () => {
    const a = new TestAdapter(makeCtx('sandbox'));
    const r1 = await a.fetchOrders();
    const r2 = await a.fetchOrders();
    expect(r1.sandbox).toBe(true);
    expect(r1.items.length).toBeGreaterThan(0);
    // 确定性：同一连接同一页游标产出同一批订单号（验证去重 upsert 逻辑）
    expect(r1.items[0].platformOrderId).toBe(r2.items[0].platformOrderId);
    // 字段完整性
    const first = r1.items[0];
    expect(first._sandbox).toBe(true);
    expect(first.items.length).toBeGreaterThan(0);
    expect(typeof first.totalAmount).toBe('number');
    // 分页：第0页 hasMore，cursor 指向第1页；第1页到末页
    expect(r1.hasMore).toBe(true);
    expect(r1.nextCursor).toBe('1');
    const rPage1 = await a.fetchOrders({ cursor: '1' });
    expect(rPage1.hasMore).toBe(false);
    expect(rPage1.nextCursor).toBeNull();
  });

  it('buildSandboxProducts / buildSandboxInventory 结构与标记正确', async () => {
    const a = new TestAdapter(makeCtx('sandbox'));
    const p = await a.fetchProducts();
    expect(p.sandbox).toBe(true);
    expect(p.items.length).toBeGreaterThan(0);
    expect(p.items[0]._sandbox).toBe(true);
    expect(typeof p.items[0].price).toBe('number');

    const inv = await a.fetchInventory();
    expect(inv.sandbox).toBe(true);
    expect(inv.items[0]._sandbox).toBe(true);
    expect(typeof inv.items[0].available).toBe('number');
  });

  it('buildSandboxPushResult 标记沙箱成功', async () => {
    const a = new TestAdapter(makeCtx('sandbox'));
    const res = await a.pushInventory([{ sku: 'DEMO-TS-001', quantity: 5 }]);
    expect(res.success).toBe(true);
    expect(res.sandbox).toBe(true);
    expect(res.successCount).toBe(1);
    expect(res.failedCount).toBe(0);
  });

  it('requireLive 在缺凭据时抛 AdapterError', () => {
    const a = new TestAdapter(makeCtx('sandbox'));
    expect(() => a.requireLivePublic('/orders')).toThrowError(AdapterError);
    try {
      a.requireLivePublic('/orders');
    } catch (e) {
      expect((e as AdapterError).endpoint).toBe('/orders');
    }
  });
});
