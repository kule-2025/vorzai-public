/**
 * 京东开放平台（宙斯）适配器
 *
 * 网关：https://api.jd.com/routerjson
 * 鉴权：app_key + app_secret + access_token
 * 签名：MD5 —— sign = MD5(app_secret + 排序拼接的 keyvalue 串 + app_secret).toUpperCase()
 * 文档：https://open.jd.com/home/home#/doc/api
 *
 * 已实现 API（真实 method 名）：
 *   jingdong.seller.vender.info.get      商家信息（连接探针）
 *   jingdong.pop.order.search            订单列表
 *   jingdong.pop.order.get               订单详情
 *   jingdong.ware.read.searchWare4Valid  在售商品列表
 *   jingdong.sku.write.update.stock      SKU 库存更新
 *
 * 特殊约定：
 *   1. 业务参数统一塞进 360buy_param_json，且该字段整体参与签名
 *   2. 京东响应外层键名历史上拼写为 "responce"（非 response），此处两种都兼容
 *   3. 金额单位为「元」
 */
import { BaseAdapter, toAmount, toIso, AdapterError } from './baseAdapter';
import { jdSign, formatCnTimestamp } from './signing';
import { maskAddress, maskName, maskPhone } from './crypto';
import {
  ConnectionTestResult, FetchOptions, FetchResult, InventoryPushItem,
  NormalizedInventory, NormalizedOrder, NormalizedOrderItem, NormalizedProduct,
  PlatformCode, PushResult, ResourceType, UnifiedOrderStatus, UnifiedPaymentStatus,
} from './types';

const GATEWAY = 'https://api.jd.com/routerjson';

/** 京东订单状态 → Vorzai 统一状态 */
const ORDER_STATE_MAP: Record<string, { order: UnifiedOrderStatus; pay: UnifiedPaymentStatus }> = {
  WAIT_SELLER_STOCK_OUT: { order: 'processing', pay: 'paid' },      // 等待出库
  WAIT_GOODS_RECEIVE_CONFIRM: { order: 'shipped', pay: 'paid' },    // 等待确认收货
  WAIT_SELLER_DELIVERY: { order: 'processing', pay: 'paid' },       // 等待发货
  FINISHED_L: { order: 'completed', pay: 'paid' },                  // 已完成
  TRADE_CANCELED: { order: 'cancelled', pay: 'cancelled' },         // 已取消
  LOCKED: { order: 'pending', pay: 'unpaid' },                      // 锁定（风控/待支付）
  PAUSE: { order: 'processing', pay: 'paid' },                      // 暂停
  POP_ORDER_PAUSE: { order: 'processing', pay: 'paid' },
  SEND_TO_DISTRIBUTION_CENER: { order: 'processing', pay: 'paid' },
  DISTRIBUTION_CENTER_RECEIVED: { order: 'shipped', pay: 'paid' },
};

/** 订单查询需要显式声明字段集合 */
const ORDER_FIELDS = [
  'orderId', 'orderState', 'orderStartTime', 'orderEndTime', 'paymentConfirmTime',
  'orderTotalPrice', 'orderSellerPrice', 'orderPayment', 'freightPrice', 'sellerDiscount',
  'consigneeInfo', 'itemInfoList', 'orderRemark', 'venderRemark', 'payType',
  'logisticsId', 'deliveryConfirmTime', 'pin', 'waybill',
].join(',');

export class JdAdapter extends BaseAdapter {
  readonly platform: PlatformCode = 'jd';
  readonly displayName = '京东';
  readonly capabilities: ResourceType[] = ['orders', 'products', 'inventory', 'logistics'];
  readonly gateway = GATEWAY;
  protected readonly orderNoPrefix = 'JD';

  protected hasLiveCredentials(): boolean {
    return !!(this.creds.appKey && this.creds.appSecret && this.creds.accessToken);
  }

  private async call<T = Record<string, unknown>>(method: string, bizParams: Record<string, unknown>): Promise<T> {
    this.requireLive(GATEWAY);

    const params: Record<string, string> = {
      method,
      app_key: String(this.creds.appKey),
      access_token: String(this.creds.accessToken),
      timestamp: formatCnTimestamp(),
      format: 'json',
      v: '2.0',
      '360buy_param_json': JSON.stringify(bizParams),
    };
    params.sign = jdSign(params, String(this.creds.appSecret));

    const res = await this.http<Record<string, unknown>>(GATEWAY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams(params).toString(),
    });

    if (!res.ok || !res.data) {
      throw new AdapterError(res.error || '京东返回内容无法解析', GATEWAY, res.status);
    }
    const errorResponse = res.data.error_response as Record<string, unknown> | undefined;
    if (errorResponse) {
      throw new AdapterError(
        `京东接口报错 code=${errorResponse.code} ${errorResponse.zh_desc || errorResponse.en_desc || ''}`.trim(),
        GATEWAY,
        res.status
      );
    }

    const base = method.replace(/\./g, '_');
    const payload = (res.data[`${base}_responce`] || res.data[`${base}_response`]) as Record<string, unknown> | undefined;
    if (!payload) {
      throw new AdapterError(`京东响应结构异常，未找到 ${base}_responce 节点`, GATEWAY, res.status);
    }
    if (payload.code !== undefined && String(payload.code) !== '0') {
      throw new AdapterError(`京东业务报错 code=${payload.code} ${payload.error_description || ''}`.trim(), GATEWAY, res.status);
    }
    return payload as T;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    if (this.isSandbox) {
      return this.sandboxTestResult('未配置京东 app_key / app_secret / access_token');
    }
    const endpoint = `${GATEWAY} (jingdong.seller.vender.info.get)`;
    try {
      const data = await this.call<Record<string, unknown>>('jingdong.seller.vender.info.get', {});
      const venderInfo = (data.vender_info_result || data.venderInfoResult) as Record<string, unknown> | undefined;
      return {
        success: true,
        status: 'connected',
        message: '京东连接成功，MD5 签名与 access_token 校验通过',
        endpoint,
        mode: 'live',
        shopName: venderInfo?.shopName ? String(venderInfo.shopName) : this.ctx.shopName,
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

    const page = options.cursor ? Number(options.cursor) || 1 : 1;
    const pageSize = Math.min(options.pageSize || 50, 100);
    const since = options.since ? new Date(options.since) : new Date(Date.now() - 7 * 86400000);
    const until = options.until ? new Date(options.until) : new Date();

    const data = await this.call<Record<string, unknown>>('jingdong.pop.order.search', {
      start_date: formatCnTimestamp(since),
      end_date: formatCnTimestamp(until),
      order_state: 'WAIT_SELLER_STOCK_OUT,WAIT_GOODS_RECEIVE_CONFIRM,FINISHED_L,TRADE_CANCELED,LOCKED,PAUSE',
      page: String(page),
      page_size: String(pageSize),
      optional_fields: ORDER_FIELDS,
      sortType: '1',
      dateType: '0',
    });

    const result = (data.searchorderinfo_result || data.orderSearchResult) as Record<string, unknown> | undefined;
    const list = (result?.orderInfoList as Array<Record<string, unknown>>) || [];
    const total = Number(result?.orderTotal || list.length);
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
    const data = await this.call<Record<string, unknown>>('jingdong.ware.read.searchWare4Valid', {
      pageNo: page,
      pageSize,
      wareStatusValue: 1,
      field: 'wareId,title,jdPrice,stockNum,outerId,itemNum,categoryId,brandName,logo',
    });

    const page4Valid = (data.page || data.searchWare4Valid_result) as Record<string, unknown> | undefined;
    const list = (page4Valid?.data as Array<Record<string, unknown>>) || [];
    const total = Number(page4Valid?.totalItem || list.length);
    const items: NormalizedProduct[] = list.map((p) => ({
      platform: this.platform,
      platformProductId: String(p.wareId ?? ''),
      sku: String(p.outerId || p.itemNum || p.wareId || ''),
      title: String(p.title ?? ''),
      category: p.categoryId ? String(p.categoryId) : undefined,
      brand: p.brandName ? String(p.brandName) : undefined,
      price: toAmount(p.jdPrice),
      stock: Number(p.stockNum || 0),
      status: 'on_sale',
      imageUrl: p.logo ? String(p.logo) : undefined,
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
        await this.call('jingdong.sku.write.update.stock', {
          skuId: it.platformSkuId || it.platformProductId,
          stockNum: it.quantity,
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
      message: `京东库存回写完成：成功 ${successCount} 条，失败 ${failures.length} 条`,
      failures,
      sandbox: false,
    };
  }

  /**
   * 京东订单字段映射。
   * 关键点：
   *   - orderTotalPrice 为订单总额，orderPayment 为用户实付，orderSellerPrice 为商家商品金额
   *   - 收件人信息在 consigneeInfo 中（fullname / mobile / fullAddress）
   *   - 明细在 itemInfoList，其中 outerSkuId 是商家自定义编码，用于匹配本地 SKU
   */
  normalizeOrder(raw: Record<string, unknown>): NormalizedOrder {
    const orderId = String(raw.orderId ?? '');
    const state = String(raw.orderState ?? '');
    const mapped = ORDER_STATE_MAP[state] || { order: 'pending' as UnifiedOrderStatus, pay: 'unpaid' as UnifiedPaymentStatus };

    const itemList = (raw.itemInfoList as Array<Record<string, unknown>>) || [];
    const items: NormalizedOrderItem[] = itemList.map((it) => ({
      platformProductId: String(it.wareId ?? it.skuId ?? ''),
      platformSkuId: it.skuId ? String(it.skuId) : undefined,
      outerSku: it.outerSkuId ? String(it.outerSkuId) : (it.outSkuId ? String(it.outSkuId) : undefined),
      title: String(it.skuName ?? ''),
      quantity: Number(it.itemTotal || 1),
      unitPrice: toAmount(it.jdPrice),
      itemAmount: toAmount(Number(it.jdPrice || 0) * Number(it.itemTotal || 1)),
      discount: 0,
    }));

    const consignee = (raw.consigneeInfo as Record<string, unknown>) || {};
    const subtotal = toAmount(raw.orderSellerPrice) || items.reduce((s, it) => s + it.itemAmount, 0);
    const shippingFee = toAmount(raw.freightPrice);
    const discount = toAmount(raw.sellerDiscount);
    const totalAmount = toAmount(raw.orderTotalPrice) || subtotal + shippingFee - discount;
    const paidAmount = toAmount(raw.orderPayment);

    return {
      platform: this.platform,
      platformOrderId: orderId,
      orderNo: `${this.orderNoPrefix}-${orderId}`,
      createdAt: toIso(raw.orderStartTime) || new Date().toISOString(),
      paidAt: toIso(raw.paymentConfirmTime),
      orderStatus: mapped.order,
      paymentStatus: mapped.pay,
      rawStatus: state,
      buyerNick: raw.pin ? maskName(String(raw.pin)) : null,
      receiverName: maskName(consignee.fullname as string),
      receiverPhone: maskPhone((consignee.mobile || consignee.telephone) as string),
      buyerEmail: null,
      shippingAddress: maskAddress((consignee.fullAddress || consignee.fulladdress) as string),
      items,
      subtotal: toAmount(subtotal),
      discount,
      platformSubsidy: 0, // 京东平台补贴需另查 jingdong.pop.order.venderRemark / 促销明细接口
      shippingFee,
      tax: 0,
      totalAmount,
      paidAmount,
      currency: 'CNY',
      paymentMethod: raw.payType ? `京东支付方式${String(raw.payType)}` : null,
      shippingNo: raw.waybill ? String(raw.waybill) : null,
      shippingCompany: raw.logisticsId ? String(raw.logisticsId) : null,
      shippedAt: toIso(raw.deliveryConfirmTime),
      remark: raw.orderRemark ? String(raw.orderRemark) : (raw.venderRemark ? String(raw.venderRemark) : null),
      _sandbox: false,
    };
  }
}
