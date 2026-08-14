/**
 * 7 个平台适配器单元测试（B2 · 覆盖率提升）
 *
 * 策略：全部以 sandbox 模式构造（mode:'sandbox' 且无 live 凭据），
 * 此时 testConnection / fetchOrders / fetchProducts / fetchInventory / pushInventory
 * 均走纯逻辑的沙箱分支（不触网、不依赖 DB），normalizeOrder 为纯函数。
 * 因此可在零网络、零 DB 前提下覆盖每个适配器的归一化与沙箱编排逻辑。
 *
 * 原始字段清单来自各适配器 normalizeOrder 的真实读取路径。
 */
import { describe, it, expect } from 'vitest';
import type { AdapterContext, PlatformCode } from '../src/services/adapters/types';
import { DouyinAdapter } from '../src/services/adapters/douyinAdapter';
import { AmazonAdapter } from '../src/services/adapters/amazonAdapter';
import { ShopifyAdapter } from '../src/services/adapters/shopifyAdapter';
import { TaobaoAdapter } from '../src/services/adapters/taobaoAdapter';
import { JdAdapter } from '../src/services/adapters/jdAdapter';
import { KuaishouAdapter } from '../src/services/adapters/kuaishouAdapter';
import { PddAdapter } from '../src/services/adapters/pddAdapter';

function sandboxCtx(platform: PlatformCode): AdapterContext {
  return {
    connectionId: `conn-${platform}`,
    tenantId: 'tenant-test',
    platform,
    mode: 'sandbox',
    credentials: {},
    shopName: `演练店铺-${platform}`,
  };
}

// ────────────────── 抖店 Douyin ──────────────────
describe('adapter · DouyinAdapter (sandbox)', () => {
  const a = new DouyinAdapter(sandboxCtx('douyin'));

  it('testConnection 返回沙箱结果', async () => {
    const r = await a.testConnection();
    expect(r.success).toBe(true);
    expect(r.status).toBe('sandbox');
    expect(r.sandbox).toBe(true);
    expect(r.shopName).toBe('演练店铺-douyin');
  });

  it('fetchOrders 沙箱产出带 _sandbox 标记且可分页', async () => {
    const page1 = await a.fetchOrders({ pageSize: 5 });
    expect(page1.sandbox).toBe(true);
    expect(page1.items.length).toBeGreaterThan(0);
    expect(page1.items.every((o) => o._sandbox === true)).toBe(true);
    expect(page1.hasMore).toBe(true);
    const page2 = await a.fetchOrders({ pageSize: 5, cursor: page1.nextCursor! });
    expect(page2.hasMore).toBe(false);
  });

  it('fetchProducts / fetchInventory 沙箱产出', async () => {
    const p = await a.fetchProducts();
    expect(p.sandbox).toBe(true);
    expect(p.items.length).toBeGreaterThan(0);
    const inv = await a.fetchInventory();
    expect(inv.sandbox).toBe(true);
    expect(inv.items.every((i) => i._sandbox === true)).toBe(true);
  });

  it('pushInventory 沙箱受理', async () => {
    const r = await a.pushInventory([{ sku: 'SKU1', quantity: 10 }]);
    expect(r.success).toBe(true);
    expect(r.sandbox).toBe(true);
    expect(r.successCount).toBe(1);
  });

  it('normalizeOrder 映射核心字段（已支付 + 达人分销分支）', () => {
    const raw = {
      order_id: '4900123456789012345',
      order_status: '2', // 已支付
      sku_order_list: [
        {
          sku_id: 'SKU1',
          product_id: 'P1',
          outer_product_id: 'OUT1',
          product_name: '测试商品',
          item_num: 2,
          origin_amount: 10000, // 分
          pay_amount: 10000,
        },
      ],
      origin_amount: 12000,
      pay_amount: 10000,
      order_type: '4',
      origin_type: '1',
      room_id: '888',
      author_name: '达人A',
      commission_rate: 1000, // 万分比 → 10%
      estimated_commission: 1000,
      buyer_words: '快点发货',
      logistics_info: [{ tracking_no: 'TN1' }],
      create_time: 1700000000,
      pay_time: 1700000060,
      post_receiver: '张三',
      post_tel: '13800000000',
      post_addr: '广东省深圳市南山区科技园1号',
      category_name: '服饰',
      brand_name: '测试品牌',
      pic: ['http://x/y.jpg'],
      status: 1,
      market_price: 6000,
    };
    const o = a.normalizeOrder(raw as Record<string, unknown>);
    expect(o.platform).toBe('douyin');
    expect(o.platformOrderId).toBe('4900123456789012345');
    expect(o.orderStatus).toBe('confirmed');
    expect(o.paymentStatus).toBe('paid');
    expect(o.paidAmount).toBe(100); // 10000 分 → 100 元
    expect(o.items).toHaveLength(1);
    expect(o.items[0].quantity).toBe(2);
    expect(o.remark).toContain('达人:达人A');
    expect(o.remark).toContain('直播间:888');
    expect(o.remark).toContain('买家留言');
  });

  it('normalizeOrder 沙箱标记透传', () => {
    const o = a.normalizeOrder({ order_id: '1', order_status: '1', _sandbox: true } as Record<string, unknown>);
    expect(o._sandbox).toBe(true);
  });

  it('normalizeOrder 缺 item 列表不崩溃', () => {
    const o = a.normalizeOrder({ order_id: '2', order_status: '6' } as Record<string, unknown>);
    expect(o.platformOrderId).toBe('2');
    expect(o.orderStatus).toBe('cancelled');
  });
});

// ────────────────── 亚马逊 Amazon ──────────────────
describe('adapter · AmazonAdapter (sandbox)', () => {
  const a = new AmazonAdapter(sandboxCtx('amazon'));

  it('testConnection 沙箱结果', async () => {
    const r = await a.testConnection();
    expect(r.sandbox).toBe(true);
    expect(r.success).toBe(true);
  });

  it('fetchOrders 沙箱产出（USD 币种）', async () => {
    const p = await a.fetchOrders();
    expect(p.sandbox).toBe(true);
    expect(p.items[0].currency).toBe('USD');
  });

  it('fetchProducts / fetchInventory / pushInventory 沙箱', async () => {
    expect((await a.fetchProducts()).sandbox).toBe(true);
    expect((await a.fetchInventory()).sandbox).toBe(true);
    expect((await a.pushInventory([{ sku: 'S', quantity: 1 }])).sandbox).toBe(true);
  });

  it('normalizeOrder 映射 Amazon 字段', () => {
    const raw = {
      AmazonOrderId: 'AMZ-123',
      OrderStatus: 'Shipped',
      OrderTotal: { Amount: '50.00', CurrencyCode: 'USD' },
      ShippingAddress: { Name: 'John Doe' },
      BuyerInfo: { Email: 'j@x.com' },
      PurchaseDate: 1700000000,
      PaymentMethod: 'CC',
      FulfillmentChannel: 'Amazon',
      OrderType: 'Standard',
    };
    const o = a.normalizeOrder(raw as Record<string, unknown>);
    expect(o.platform).toBe('amazon');
    expect(o.platformOrderId).toBe('AMZ-123');
    expect(o.orderStatus).toBe('shipped');
    expect(o.totalAmount).toBe(50);
    expect(o.remark).toBe('OrderType=Standard');
    expect(o.items).toEqual([]);
  });

  it('normalizeOrder 缺金额不崩溃', () => {
    const o = a.normalizeOrder({ AmazonOrderId: 'X', OrderStatus: 'Pending' } as Record<string, unknown>);
    expect(o.platformOrderId).toBe('X');
  });
});

// ────────────────── Shopify ──────────────────
describe('adapter · ShopifyAdapter (sandbox)', () => {
  const a = new ShopifyAdapter(sandboxCtx('shopify'));

  it('testConnection 沙箱结果', async () => {
    const r = await a.testConnection();
    expect(r.sandbox).toBe(true);
  });

  it('fetchOrders 沙箱产出', async () => {
    const p = await a.fetchOrders();
    expect(p.sandbox).toBe(true);
    expect(p.items[0].platform).toBe('shopify');
  });

  it('fetchProducts / fetchInventory / pushInventory 沙箱', async () => {
    expect((await a.fetchProducts()).sandbox).toBe(true);
    expect((await a.fetchInventory()).sandbox).toBe(true);
    expect((await a.pushInventory([{ sku: 'S', quantity: 1 }])).sandbox).toBe(true);
  });

  it('normalizeOrder 映射 Shopify 字段（含 line_items/地址/邮箱脱敏）', () => {
    const raw = {
      id: '123',
      name: '#1001',
      financial_status: 'paid',
      fulfillment_status: 'fulfilled',
      line_items: [{ title: 'A', quantity: 2, price: '10.00', sku: 'SKU1', product_id: 'P1' }],
      subtotal_price: '20.00',
      shipping_lines: [{ price: '5.00' }],
      total_discounts: '0.00',
      total_tax: '0.00',
      total_price: '25.00',
      customer: { email: 'buyer@example.com' },
      shipping_address: { phone: '13800000000' },
      email: 'buyer@example.com',
      fulfillments: [{ tracking_number: 'TN', company: 'SF' }],
      payment_gateway_names: ['shopify_payments'],
      created_at: '2023-11-01T00:00:00Z',
      processed_at: '2023-11-01T00:00:00Z',
      currency: 'USD',
      note: 'hi',
    };
    const o = a.normalizeOrder(raw as Record<string, unknown>);
    expect(o.platformOrderId).toBe('123');
    expect(o.paymentStatus).toBe('paid');
    expect(o.totalAmount).toBe(25);
    expect(o.items).toHaveLength(1);
    expect(o.items[0].quantity).toBe(2);
    expect(o.buyerEmail).toContain('*'); // maskEmail
    expect(o.remark).toBe('hi');
  });

  it('normalizeOrder 取消/关闭状态分支', () => {
    const cancelled = a.normalizeOrder({ id: '1', cancelled_at: '2023-11-02T00:00:00Z' } as Record<string, unknown>);
    expect(cancelled.orderStatus).toBe('cancelled');
    const refunded = a.normalizeOrder({ id: '2', financial_status: 'refunded', cancelled_at: '2023-11-02T00:00:00Z' } as Record<string, unknown>);
    expect(refunded.orderStatus).toBe('refunded');
    const closed = a.normalizeOrder({ id: '3', closed_at: '2023-11-02T00:00:00Z' } as Record<string, unknown>);
    expect(closed.orderStatus).toBe('completed');
  });
});

// ────────────────── 淘宝 Taobao ──────────────────
describe('adapter · TaobaoAdapter (sandbox)', () => {
  const a = new TaobaoAdapter(sandboxCtx('taobao'));

  it('testConnection / fetch* 沙箱', async () => {
    expect((await a.testConnection()).sandbox).toBe(true);
    expect((await a.fetchOrders()).sandbox).toBe(true);
    expect((await a.fetchProducts()).sandbox).toBe(true);
    expect((await a.fetchInventory()).sandbox).toBe(true);
    expect((await a.pushInventory([{ sku: 'S', quantity: 1 }])).sandbox).toBe(true);
  });

  it('normalizeOrder 映射子订单列表', () => {
    const raw = {
      tid: 'TB-999',
      status: 'TRADE_FINISHED',
      orders: {
        order: [
          { num_iid: 'P1', title: '商品A', price: '5.00', num: 2, payment: '10.00', pic_path: 'http://x/y.jpg', sku_properties_name: '规格:均码' },
        ],
      },
      total_fee: '10.00',
      post_fee: '5.00',
      discount_fee: '1.00',
      payment: '14.00',
      receiver_state: '广东',
      receiver_city: '深圳',
      receiver_district: '南山',
      receiver_address: '科技园1号',
      created: '2023-11-01 00:00:00',
      pay_time: '2023-11-01 00:01:00',
      buyer_nick: '淘宝买家',
      receiver_name: '李四',
      receiver_mobile: '13800000000',
      pay_type: 'ALIPAY',
      consign_time: '2023-11-01 12:00:00',
      buyer_message: '请尽快',
      seller_memo: '内部备注',
    };
    const o = a.normalizeOrder(raw as Record<string, unknown>);
    expect(o.platformOrderId).toBe('TB-999');
    expect(o.orderStatus).toBe('completed');
    expect(o.totalAmount).toBe(10);
    expect(o.items).toHaveLength(1);
    expect(o.items[0].title).toBe('商品A');
    expect(o.remark).toBe('请尽快');
    expect(o.shippingAddress).toContain('广东');
  });
});

// ────────────────── 京东 JD ──────────────────
describe('adapter · JdAdapter (sandbox)', () => {
  const a = new JdAdapter(sandboxCtx('jd'));

  it('testConnection / fetch* 沙箱', async () => {
    expect((await a.testConnection()).sandbox).toBe(true);
    expect((await a.fetchOrders()).sandbox).toBe(true);
    expect((await a.fetchProducts()).sandbox).toBe(true);
    expect((await a.fetchInventory()).sandbox).toBe(true);
    expect((await a.pushInventory([{ sku: 'S', quantity: 1 }])).sandbox).toBe(true);
  });

  it('normalizeOrder 映射京东字段', () => {
    const raw = {
      orderId: 'JD-1',
      orderState: 'FINISHED',
      itemInfoList: [{ skuId: 'SKU1', skuName: '商品', itemTotal: '10.00', jdPrice: '5.00', quantity: 2 }],
      consigneeInfo: { name: '王五' },
      orderSellerPrice: '10.00',
      freightPrice: '5.00',
      sellerDiscount: '1.00',
      orderTotalPrice: '14.00',
      orderPayment: '14.00',
      orderStartTime: '2023-11-01 00:00:00',
      paymentConfirmTime: '2023-11-01 00:01:00',
      pin: 'jduser',
      payType: '1',
      waybill: 'WB1',
      logisticsId: 'SF',
      deliveryConfirmTime: '2023-11-02 00:00:00',
      orderRemark: '备注',
      venderRemark: '商家备注',
    };
    const o = a.normalizeOrder(raw as Record<string, unknown>);
    expect(o.platformOrderId).toBe('JD-1');
    expect(o.totalAmount).toBe(14);
    expect(o.items).toHaveLength(1);
    expect(o.paymentMethod).toContain('京东支付方式');
    expect(o.remark).toBe('备注');
    expect(typeof o.orderStatus).toBe('string'); // 未识别的 orderState 走默认映射分支
  });
});

// ────────────────── 快手 Kuaishou ──────────────────
describe('adapter · KuaishouAdapter (sandbox)', () => {
  const a = new KuaishouAdapter(sandboxCtx('kuaishou'));

  it('testConnection / fetch* 沙箱', async () => {
    expect((await a.testConnection()).sandbox).toBe(true);
    expect((await a.fetchOrders()).sandbox).toBe(true);
    expect((await a.fetchProducts()).sandbox).toBe(true);
    expect((await a.fetchInventory()).sandbox).toBe(true);
    expect((await a.pushInventory([{ sku: 'S', quantity: 1 }])).sandbox).toBe(true);
  });

  it('normalizeOrder 映射嵌套结构', () => {
    const raw = {
      order_base_info: { oid: 'KS-1', status: 'PAID', pay_amount: 100, createTime: '2023-11-01 00:00:00', payTime: '2023-11-01 00:01:00', expressFee: 0, discountFee: 0, totalFee: 100 },
      order_address: { consigneeName: '赵六', mobile: '13800000000', provinceName: '广东', cityName: '深圳', districtName: '南山', address: '某路1号' },
      order_logistics_info: { expressNo: 'TN', expressName: 'SF' },
      order_item_info: [{ itemId: 'P1', itemTitle: '品', num: 1, price: '10.00', skuId: 'S1' }],
    };
    const o = a.normalizeOrder(raw as Record<string, unknown>);
    expect(o.platformOrderId).toBe('KS-1');
    expect(o.receiverName).toContain('*'); // maskName
  });
});

// ────────────────── 拼多多 PDD ──────────────────
describe('adapter · PddAdapter (sandbox)', () => {
  const a = new PddAdapter(sandboxCtx('pdd'));

  it('testConnection / fetch* 沙箱', async () => {
    expect((await a.testConnection()).sandbox).toBe(true);
    expect((await a.fetchOrders()).sandbox).toBe(true);
    expect((await a.fetchProducts()).sandbox).toBe(true);
    expect((await a.fetchInventory()).sandbox).toBe(true);
    expect((await a.pushInventory([{ sku: 'S', quantity: 1 }])).sandbox).toBe(true);
  });

  it('normalizeOrder 映射 PDD 字段（含退款状态分支）', () => {
    const raw = {
      order_sn: 'PDD-1',
      order_status: '2', // 已支付
      refund_status: '1', // 退款成功码集合外
      item_list: [{ goods_name: '拼购品', goods_count: 2, goods_price: '5.00', sku: 'SKU1' }],
      goods_amount: 1000, // 分
      postage: 200,
      platform_discount: 100,
      discount_amount: 50,
      pay_amount: 1050,
      province: '广东',
      city: '深圳',
      town: '南山',
      address: '科技园1号',
      created_time: 1700000000,
      pay_time: 1700000060,
      receiver_name: '孙七',
      receiver_phone: '13800000000',
      pay_type: 'WECHAT',
      tracking_number: 'TN',
      logistics_id: 'SF',
      shipping_time: 1700001000,
      remark: '留言',
      buyer_memo: '买家备注',
    };
    const o = a.normalizeOrder(raw as Record<string, unknown>);
    expect(o.platformOrderId).toBe('PDD-1');
    expect(o.paymentStatus).toBe('paid');
    expect(o.paidAmount).toBe(10.5); // 1050 分 → 10.5 元
    expect(o.shippingAddress).toContain('广东');
    expect(o.remark).toBe('留言');
  });

  it('normalizeOrder 退款成功状态分支', () => {
    const o = a.normalizeOrder({ order_sn: 'R1', order_status: '1', refund_status: '5' } as Record<string, unknown>);
    expect(o.paymentStatus).toBe('refunded');
  });
});
