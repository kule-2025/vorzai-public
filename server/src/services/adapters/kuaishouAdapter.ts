/**
 * 快手小店（快手开放平台）适配器
 *
 * 网关：https://openapi.kwaixiaodian.com
 * 鉴权：appkey + signSecret + access_token
 * 签名：MD5 —— sign = MD5("k1=v1&k2=v2..." + "&signSecret=" + signSecret)，小写
 *      亦支持 HMAC_SHA256（signMethod=HMAC_SHA256）
 * 文档：https://open.kwaixiaodian.com/zone/new/docs
 *
 * 已实现 API（真实 method 与路径）：
 *   open.order.cursor.list   /open/order/cursor/list   订单游标列表
 *   open.order.detail        /open/order/detail        订单详情
 *   open.item.list           /open/item/list           商品列表
 *   open.item.sku.stock.update /open/item/sku/stock/update  SKU 库存更新
 *
 * 特殊约定：
 *   1. 快手用「游标（cursor / pcursor）」而非页码翻页，返回 "nomore" 表示到底
 *   2. 业务参数整体放在 param（JSON 字符串）中，并参与签名
 *   3. 金额单位为「分」
 */
import { BaseAdapter, fenToYuan, toAmount, toIso, AdapterError } from './baseAdapter';
import { kuaishouSign, stableJsonStringify, unixMillis } from './signing';
import { maskAddress, maskName, maskPhone } from './crypto';
import {
  ConnectionTestResult, FetchOptions, FetchResult, InventoryPushItem,
  NormalizedInventory, NormalizedOrder, NormalizedOrderItem, NormalizedProduct,
  PlatformCode, PushResult, ResourceType, UnifiedOrderStatus, UnifiedPaymentStatus,
} from './types';

const GATEWAY = 'https://openapi.kwaixiaodian.com';
const API_VERSION = '1';

/** 快手订单状态 → Vorzai 统一状态 */
const ORDER_STATUS_MAP: Record<string, { order: UnifiedOrderStatus; pay: UnifiedPaymentStatus }> = {
  '10': { order: 'pending', pay: 'unpaid' },      // 待付款
  '30': { order: 'processing', pay: 'paid' },     // 待发货
  '40': { order: 'shipped', pay: 'paid' },        // 已发货
  '50': { order: 'delivered', pay: 'paid' },      // 已签收
  '70': { order: 'completed', pay: 'paid' },      // 订单成功
  '80': { order: 'cancelled', pay: 'cancelled' }, // 订单关闭
};

export class KuaishouAdapter extends BaseAdapter {
  readonly platform: PlatformCode = 'kuaishou';
  readonly displayName = '快手小店';
  readonly capabilities: ResourceType[] = ['orders', 'products', 'inventory', 'logistics'];
  readonly gateway = GATEWAY;
  protected readonly orderNoPrefix = 'KS';

  protected hasLiveCredentials(): boolean {
    return !!(this.creds.appKey && this.creds.appSecret && this.creds.accessToken);
  }

  private async call<T = Record<string, unknown>>(
    method: string,
    pathname: string,
    bizParams: Record<string, unknown>
  ): Promise<T> {
    this.requireLive(`${GATEWAY}${pathname}`);

    const param = stableJsonStringify(bizParams);
    const params: Record<string, string> = {
      appkey: String(this.creds.appKey),
      access_token: String(this.creds.accessToken),
      method,
      signMethod: 'MD5',
      timestamp: unixMillis(),
      version: API_VERSION,
      param,
    };
    params.sign = kuaishouSign(params, String(this.creds.appSecret), 'MD5');

    const res = await this.http<{ result?: number; error_msg?: string; data?: T }>(`${GATEWAY}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams(params).toString(),
    });

    if (!res.ok || !res.data) {
      throw new AdapterError(res.error || '快手返回内容无法解析', `${GATEWAY}${pathname}`, res.status);
    }
    // 快手成功码 result === 1
    if (Number(res.data.result) !== 1) {
      throw new AdapterError(
        `快手接口报错 result=${res.data.result} ${res.data.error_msg || ''}`.trim(),
        `${GATEWAY}${pathname}`,
        res.status
      );
    }
    return (res.data.data || ({} as T));
  }

  async testConnection(): Promise<ConnectionTestResult> {
    if (this.isSandbox) {
      return this.sandboxTestResult('未配置快手 appkey / signSecret / access_token');
    }
    const endpoint = `${GATEWAY}/open/order/cursor/list`;
    try {
      await this.call('open.order.cursor.list', '/open/order/cursor/list', {
        beginTime: Date.now() - 3600 * 1000,
        endTime: Date.now(),
        pageSize: 1,
        sort: 1,
        queryType: 1,
      });
      return {
        success: true,
        status: 'connected',
        message: '快手小店连接成功，MD5 签名与 access_token 校验通过',
        endpoint,
        mode: 'live',
        shopName: this.ctx.shopName,
        sandbox: false,
      };
    } catch (e) {
      const msg = e instanceof AdapterError ? e.message : String(e);
      return {
        success: false,
        status: /token|授权|expire/i.test(msg) ? 'expired' : 'error',
        message: msg,
        endpoint,
        mode: 'live',
        sandbox: false,
      };
    }
  }

  async fetchOrders(options: FetchOptions = {}): Promise<FetchResult<NormalizedOrder>> {
    if (this.isSandbox) return this.buildSandboxOrders(options);

    const since = options.since ? new Date(options.since).getTime() : Date.now() - 7 * 86400000;
    const until = options.until ? new Date(options.until).getTime() : Date.now();

    const data = await this.call<{ cursor?: string; orderView?: Array<Record<string, unknown>> }>(
      'open.order.cursor.list',
      '/open/order/cursor/list',
      {
        beginTime: since,
        endTime: until,
        pageSize: Math.min(options.pageSize || 50, 100),
        cursor: options.cursor || undefined,
        sort: 1,       // 1=按订单创建时间升序
        queryType: 1,  // 1=按创建时间过滤
      }
    );

    const list = data?.orderView || [];
    const cursor = data?.cursor ? String(data.cursor) : '';
    const hasMore = !!cursor && cursor !== 'nomore';

    return {
      items: list.map((raw) => this.normalizeOrder(raw)),
      nextCursor: hasMore ? cursor : null,
      hasMore,
      sandbox: false,
    };
  }

  async fetchProducts(options: FetchOptions = {}): Promise<FetchResult<NormalizedProduct>> {
    if (this.isSandbox) return this.buildSandboxProducts(options);

    const data = await this.call<{ itemList?: Array<Record<string, unknown>>; pcursor?: string }>(
      'open.item.list',
      '/open/item/list',
      {
        pageSize: Math.min(options.pageSize || 50, 100),
        pcursor: options.cursor || undefined,
        onOffStatus: 1,
      }
    );

    const list = data?.itemList || [];
    const cursor = data?.pcursor ? String(data.pcursor) : '';
    const hasMore = !!cursor && cursor !== 'nomore';

    const items: NormalizedProduct[] = list.map((p) => ({
      platform: this.platform,
      platformProductId: String(p.itemId ?? ''),
      sku: String(p.relItemId || p.itemId || ''),
      title: String(p.title ?? p.itemTitle ?? ''),
      category: p.categoryId ? String(p.categoryId) : undefined,
      price: fenToYuan(p.itemPrice ?? p.price),
      stock: Number(p.skuStock || p.stock || 0),
      status: Number(p.onOffStatus) === 1 ? 'on_sale' : 'off_sale',
      imageUrl: p.imageUrls && Array.isArray(p.imageUrls) && p.imageUrls.length ? String(p.imageUrls[0]) : undefined,
      _sandbox: false,
    }));

    return { items, nextCursor: hasMore ? cursor : null, hasMore, sandbox: false };
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
        // changeType=1 表示「覆盖设置」
        await this.call('open.item.sku.stock.update', '/open/item/sku/stock/update', {
          kwaiItemId: it.platformProductId,
          skuId: it.platformSkuId,
          skuChangeStock: it.quantity,
          changeType: 1,
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
      message: `快手库存回写完成：成功 ${successCount} 条，失败 ${failures.length} 条`,
      failures,
      sandbox: false,
    };
  }

  /**
   * 快手订单字段映射。
   * 关键点：
   *   - 订单被拆成 order_base_info / order_address / order_item_info / order_logistics_info 四段
   *   - 时间字段是毫秒时间戳
   *   - 金额单位为「分」，totalFee 为订单总额，discountFee 为优惠，expressFee 为运费
   */
  normalizeOrder(raw: Record<string, unknown>): NormalizedOrder {
    const base = (raw.order_base_info || raw.orderBaseInfo || raw) as Record<string, unknown>;
    const address = (raw.order_address || raw.orderAddress || {}) as Record<string, unknown>;
    const logistics = (raw.order_logistics_info || raw.orderLogisticsInfo || {}) as Record<string, unknown>;
    const itemList = ((raw.order_item_info || raw.orderItemInfo || []) as Array<Record<string, unknown>>) || [];

    const oid = String(base.oid ?? base.orderId ?? '');
    const statusKey = String(base.status ?? '');
    const mapped = ORDER_STATUS_MAP[statusKey] || { order: 'pending' as UnifiedOrderStatus, pay: 'unpaid' as UnifiedPaymentStatus };

    const items: NormalizedOrderItem[] = itemList.map((it) => ({
      platformProductId: String(it.itemId ?? ''),
      platformSkuId: it.skuId ? String(it.skuId) : undefined,
      outerSku: it.relSkuId ? String(it.relSkuId) : (it.skuNick ? String(it.skuNick) : undefined),
      title: String(it.itemTitle ?? ''),
      specs: it.skuDesc ? String(it.skuDesc) : undefined,
      quantity: Number(it.num || 1),
      unitPrice: fenToYuan(it.price),
      itemAmount: fenToYuan(Number(it.price || 0) * Number(it.num || 1)),
      discount: fenToYuan(it.discountFee),
      imageUrl: it.itemPicUrl ? String(it.itemPicUrl) : undefined,
    }));

    const subtotal = items.reduce((s, it) => s + it.itemAmount, 0);
    const shippingFee = fenToYuan(base.expressFee);
    const discount = fenToYuan(base.discountFee);
    const totalAmount = fenToYuan(base.totalFee);
    const paid = mapped.pay === 'paid';

    const addrText = [address.provinceName, address.cityName, address.districtName, address.address]
      .filter(Boolean).join('');

    return {
      platform: this.platform,
      platformOrderId: oid,
      orderNo: `${this.orderNoPrefix}-${oid}`,
      createdAt: toIso(base.createTime) || new Date().toISOString(),
      paidAt: toIso(base.payTime),
      orderStatus: mapped.order,
      paymentStatus: mapped.pay,
      rawStatus: statusKey,
      buyerNick: base.buyerNick ? maskName(String(base.buyerNick)) : null,
      receiverName: maskName((address.consignee || address.consigneeName) as string),
      receiverPhone: maskPhone(address.mobile as string),
      buyerEmail: null,
      shippingAddress: maskAddress(addrText),
      items,
      subtotal: toAmount(subtotal),
      discount,
      platformSubsidy: 0, // 快手平台补贴需另查营销结算接口
      shippingFee,
      tax: 0,
      totalAmount,
      paidAmount: paid ? totalAmount : 0,
      currency: 'CNY',
      paymentMethod: base.payType ? `快手支付方式${String(base.payType)}` : null,
      shippingNo: logistics.expressNo ? String(logistics.expressNo) : null,
      shippingCompany: (logistics.expressName || logistics.expressCode)
        ? String(logistics.expressName || logistics.expressCode) : null,
      shippedAt: toIso(base.sendTime),
      remark: base.remark ? String(base.remark) : null,
      _sandbox: false,
    };
  }
}
