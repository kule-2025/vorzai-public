/**
 * 拼多多开放平台适配器
 *
 * 网关：https://gw-api.pinduoduo.com/api/router
 * 鉴权：client_id + client_secret + access_token
 * 签名：MD5 —— sign = MD5(client_secret + 排序拼接的 keyvalue 串 + client_secret).toUpperCase()
 * 文档：https://open.pinduoduo.com/application/document/api
 *
 * 已实现 API（真实 type 名）：
 *   pdd.mall.info.get           店铺信息（连接探针）
 *   pdd.order.list.get          订单列表（按成交时间段）
 *   pdd.order.information.get   订单详情
 *   pdd.goods.list.get          商品列表
 *   pdd.goods.quantity.update   商品库存更新
 *
 * 特殊约定：
 *   1. 业务参数与公共参数「平铺在同一层」共同参与签名（不同于淘宝/京东的 param_json 模式）
 *   2. timestamp 为 unix 秒
 *   3. 金额单位为「分」
 */
import { BaseAdapter, fenToYuan, toAmount, toIso, AdapterError } from './baseAdapter';
import { pddSign, unixSeconds } from './signing';
import { maskAddress, maskName, maskPhone } from './crypto';
import {
  ConnectionTestResult, FetchOptions, FetchResult, InventoryPushItem,
  NormalizedInventory, NormalizedOrder, NormalizedOrderItem, NormalizedProduct,
  PlatformCode, PushResult, ResourceType, UnifiedOrderStatus, UnifiedPaymentStatus,
} from './types';

const GATEWAY = 'https://gw-api.pinduoduo.com/api/router';

/** 拼多多订单状态 → Vorzai 统一状态（order_status） */
const ORDER_STATUS_MAP: Record<string, { order: UnifiedOrderStatus; pay: UnifiedPaymentStatus }> = {
  '0': { order: 'pending', pay: 'unpaid' },     // 待付款
  '1': { order: 'processing', pay: 'paid' },    // 已付款待发货
  '2': { order: 'shipped', pay: 'paid' },       // 已发货待签收
  '3': { order: 'delivered', pay: 'paid' },     // 已签收
  '4': { order: 'completed', pay: 'paid' },     // 交易完成
  '-1': { order: 'cancelled', pay: 'cancelled' }, // 已取消
};

/** 拼多多售后状态：命中退款成功时覆盖主状态 */
const REFUND_SUCCESS_CODES = new Set(['4', '5', '11']);

export class PddAdapter extends BaseAdapter {
  readonly platform: PlatformCode = 'pdd';
  readonly displayName = '拼多多';
  readonly capabilities: ResourceType[] = ['orders', 'products', 'inventory', 'logistics'];
  readonly gateway = GATEWAY;
  protected readonly orderNoPrefix = 'PDD';

  protected hasLiveCredentials(): boolean {
    return !!(this.creds.appKey && this.creds.appSecret && this.creds.accessToken);
  }

  private async call<T = Record<string, unknown>>(type: string, bizParams: Record<string, unknown>): Promise<T> {
    this.requireLive(GATEWAY);

    const params: Record<string, string> = {
      type,
      client_id: String(this.creds.appKey),
      access_token: String(this.creds.accessToken),
      timestamp: unixSeconds(),
      data_type: 'JSON',
      version: 'V1',
    };
    for (const [k, v] of Object.entries(bizParams)) {
      if (v !== undefined && v !== null && v !== '') {
        params[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
      }
    }
    params.sign = pddSign(params, String(this.creds.appSecret));

    const res = await this.http<Record<string, unknown>>(GATEWAY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams(params).toString(),
    });

    if (!res.ok || !res.data) {
      throw new AdapterError(res.error || '拼多多返回内容无法解析', GATEWAY, res.status);
    }
    const errorResponse = res.data.error_response as Record<string, unknown> | undefined;
    if (errorResponse) {
      throw new AdapterError(
        `拼多多接口报错 code=${errorResponse.error_code} ${errorResponse.sub_msg || errorResponse.error_msg || ''}`.trim(),
        GATEWAY,
        res.status
      );
    }

    // pdd.order.list.get → order_list_get_response
    const responseKey = `${type.replace(/^pdd\./, '').replace(/\./g, '_')}_response`;
    return (res.data[responseKey] || res.data) as T;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    if (this.isSandbox) {
      return this.sandboxTestResult('未配置拼多多 client_id / client_secret / access_token');
    }
    const endpoint = `${GATEWAY} (pdd.mall.info.get)`;
    try {
      const data = await this.call<{ mall_info?: Record<string, unknown> }>('pdd.mall.info.get', {});
      return {
        success: true,
        status: 'connected',
        message: '拼多多连接成功，MD5 签名与 access_token 校验通过',
        endpoint,
        mode: 'live',
        shopName: data?.mall_info?.mall_name ? String(data.mall_info.mall_name) : this.ctx.shopName,
        sandbox: false,
      };
    } catch (e) {
      const msg = e instanceof AdapterError ? e.message : String(e);
      return {
        success: false,
        status: /token|授权|expire|10019|10020/i.test(msg) ? 'expired' : 'error',
        message: msg,
        endpoint,
        mode: 'live',
        sandbox: false,
      };
    }
  }

  async fetchOrders(options: FetchOptions = {}): Promise<FetchResult<NormalizedOrder>> {
    if (this.isSandbox) return this.buildSandboxOrders(options);

    const page = options.cursor ? Number(options.cursor) || 1 : 1;
    const pageSize = Math.min(options.pageSize || 50, 100);
    // 拼多多按成交时间段查询，单次跨度不得超过 24 小时
    const since = options.since ? new Date(options.since) : new Date(Date.now() - 24 * 3600 * 1000);
    const until = options.until ? new Date(options.until) : new Date();

    const data = await this.call<{ order_list?: Array<Record<string, unknown>>; total_count?: number }>(
      'pdd.order.list.get',
      {
        start_confirm_at: Math.floor(since.getTime() / 1000),
        end_confirm_at: Math.floor(until.getTime() / 1000),
        page,
        page_size: pageSize,
        refund_status: 1,
      }
    );

    const list = data?.order_list || [];
    const total = Number(data?.total_count || list.length);
    const hasMore = page * pageSize < total;

    return {
      items: list.map((raw) => this.normalizeOrder(raw)),
      nextCursor: hasMore ? String(page + 1) : null,
      hasMore,
      sandbox: false,
      totalHint: total,
    };
  }

  async fetchProducts(options: FetchOptions = {}): Promise<FetchResult<NormalizedProduct>> {
    if (this.isSandbox) return this.buildSandboxProducts(options);

    const page = options.cursor ? Number(options.cursor) || 1 : 1;
    const pageSize = Math.min(options.pageSize || 50, 100);
    const data = await this.call<{ goods_list?: Array<Record<string, unknown>>; total_count?: number }>(
      'pdd.goods.list.get',
      { page, page_size: pageSize, is_onsale: 1 }
    );

    const list = data?.goods_list || [];
    const total = Number(data?.total_count || list.length);
    const items: NormalizedProduct[] = list.map((g) => ({
      platform: this.platform,
      platformProductId: String(g.goods_id ?? ''),
      sku: String(g.outer_goods_id || g.out_goods_id || g.goods_id || ''),
      title: String(g.goods_name ?? ''),
      category: g.cat_id ? String(g.cat_id) : undefined,
      price: fenToYuan(g.market_price ?? g.min_group_price),
      stock: Number(g.total_quantity || g.quantity || 0),
      status: Number(g.is_onsale) === 1 ? 'on_sale' : 'off_sale',
      imageUrl: g.thumb_url ? String(g.thumb_url) : undefined,
      _sandbox: false,
    }));

    const hasMore = page * pageSize < total;
    return { items, nextCursor: hasMore ? String(page + 1) : null, hasMore, sandbox: false, totalHint: total };
  }

  async fetchInventory(options: FetchOptions = {}): Promise<FetchResult<NormalizedInventory>> {
    if (this.isSandbox) return this.buildSandboxInventory(options);

    const products = await this.fetchProducts(options);
    const now = new Date().toISOString();
    return {
      items: products.items.map((p) => ({
        platform: this.platform,
        platformProductId: p.platformProductId,
        sku: p.sku,
        available: p.stock,
        updatedAt: now,
        _sandbox: false,
      })),
      nextCursor: products.nextCursor,
      hasMore: products.hasMore,
      sandbox: false,
    };
  }

  async pushInventory(items: InventoryPushItem[]): Promise<PushResult> {
    if (this.isSandbox) return this.buildSandboxPushResult(items);

    const failures: Array<{ sku: string; reason: string }> = [];
    let successCount = 0;
    for (const it of items) {
      try {
        // quantity_type=1 表示「设置为绝对值」，避免增量并发错乱
        await this.call('pdd.goods.quantity.update', {
          goods_id: it.platformProductId,
          sku_id: it.platformSkuId,
          delta_quantity: it.quantity,
          quantity_type: 1,
        });
        successCount++;
      } catch (e) {
        failures.push({ sku: it.sku, reason: e instanceof Error ? e.message : String(e) });
      }
    }
    return {
      success: failures.length === 0,
      successCount,
      failedCount: failures.length,
      message: `拼多多库存回写完成：成功 ${successCount} 条，失败 ${failures.length} 条`,
      failures,
      sandbox: false,
    };
  }

  /**
   * 拼多多订单字段映射。
   * 关键点：
   *   - 金额单位为「分」
   *   - discount_amount 是商家优惠，platform_discount 是平台补贴，二者必须分开记账，
   *     否则毛利核算会把平台补贴错算成商家让利
   *   - refund_status 命中退款成功时，覆盖主订单状态为 refunded
   */
  normalizeOrder(raw: Record<string, unknown>): NormalizedOrder {
    const orderSn = String(raw.order_sn ?? '');
    const statusKey = String(raw.order_status ?? '');
    let mapped = ORDER_STATUS_MAP[statusKey] || { order: 'pending' as UnifiedOrderStatus, pay: 'unpaid' as UnifiedPaymentStatus };
    if (REFUND_SUCCESS_CODES.has(String(raw.refund_status ?? ''))) {
      mapped = { order: 'refunded', pay: 'refunded' };
    }

    const itemList = (raw.item_list as Array<Record<string, unknown>>) || [];
    const items: NormalizedOrderItem[] = itemList.map((it) => ({
      platformProductId: String(it.goods_id ?? ''),
      platformSkuId: it.sku_id ? String(it.sku_id) : undefined,
      outerSku: it.outer_id ? String(it.outer_id) : (it.outer_goods_id ? String(it.outer_goods_id) : undefined),
      title: String(it.goods_name ?? ''),
      specs: it.goods_spec ? String(it.goods_spec) : undefined,
      quantity: Number(it.goods_count || 1),
      unitPrice: fenToYuan(it.goods_price),
      itemAmount: fenToYuan(Number(it.goods_price || 0) * Number(it.goods_count || 1)),
      discount: 0,
      imageUrl: it.goods_img ? String(it.goods_img) : undefined,
    }));

    const subtotal = fenToYuan(raw.goods_amount) || items.reduce((s, it) => s + it.itemAmount, 0);
    const shippingFee = fenToYuan(raw.postage);
    const platformSubsidy = fenToYuan(raw.platform_discount);
    const discount = fenToYuan(raw.discount_amount ?? raw.seller_discount);
    const paidAmount = fenToYuan(raw.pay_amount);
    const totalAmount = toAmount(subtotal + shippingFee - discount - platformSubsidy) || paidAmount;

    const addrText = [raw.province, raw.city, raw.town, raw.address].filter(Boolean).join('');

    return {
      platform: this.platform,
      platformOrderId: orderSn,
      orderNo: `${this.orderNoPrefix}-${orderSn}`,
      createdAt: toIso(raw.created_time) || new Date().toISOString(),
      paidAt: toIso(raw.pay_time),
      orderStatus: mapped.order,
      paymentStatus: mapped.pay,
      rawStatus: `${statusKey}/refund:${raw.refund_status ?? '-'}`,
      buyerNick: raw.buyer_memo ? null : null,
      receiverName: maskName(raw.receiver_name as string),
      receiverPhone: maskPhone(raw.receiver_phone as string),
      buyerEmail: null,
      shippingAddress: maskAddress(addrText),
      items,
      subtotal: toAmount(subtotal),
      discount,
      platformSubsidy,
      shippingFee,
      tax: 0,
      totalAmount,
      paidAmount,
      currency: 'CNY',
      paymentMethod: raw.pay_type ? String(raw.pay_type) : null,
      shippingNo: raw.tracking_number ? String(raw.tracking_number) : null,
      shippingCompany: raw.logistics_id ? String(raw.logistics_id) : null,
      shippedAt: toIso(raw.shipping_time),
      remark: raw.remark ? String(raw.remark) : (raw.buyer_memo ? String(raw.buyer_memo) : null),
      _sandbox: false,
    };
  }
}
