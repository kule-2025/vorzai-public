/**
 * 淘宝 / 天猫（TOP 开放平台）适配器
 *
 * 网关：https://eco.taobao.com/router/rest （备用 https://gw.api.taobao.com/router/rest）
 * 鉴权：app_key + app_secret + session（即 access_token）
 * 签名：MD5 —— sign = MD5(app_secret + 排序拼接的 keyvalue 串 + app_secret).toUpperCase()
 *      亦支持 HMAC-MD5（sign_method=hmac）
 * 文档：https://open.taobao.com/api.htm
 *
 * 已实现 API（真实 method 名）：
 *   taobao.user.seller.get        卖家信息（连接探针，消耗最小）
 *   taobao.trades.sold.get        卖家已卖出的交易列表
 *   taobao.trade.fullinfo.get     单笔交易完整信息
 *   taobao.items.onsale.get       出售中商品列表
 *   taobao.item.quantity.update   商品/SKU 库存更新
 *
 * 金额单位：TOP 返回的是「元」的字符串（如 "128.00"），无需 /100。
 */
import { BaseAdapter, toAmount, toIso, AdapterError } from './baseAdapter';
import { taobaoTopSign, formatCnTimestamp } from './signing';
import { maskAddress, maskName, maskPhone } from './crypto';
import {
  ConnectionTestResult, FetchOptions, FetchResult, InventoryPushItem,
  NormalizedInventory, NormalizedOrder, NormalizedOrderItem, NormalizedProduct,
  PlatformCode, PushResult, ResourceType, UnifiedOrderStatus, UnifiedPaymentStatus,
} from './types';

const GATEWAY = 'https://eco.taobao.com/router/rest';

/** 淘宝交易状态 → Vorzai 统一状态 */
const TRADE_STATUS_MAP: Record<string, { order: UnifiedOrderStatus; pay: UnifiedPaymentStatus }> = {
  WAIT_BUYER_PAY: { order: 'pending', pay: 'unpaid' },
  WAIT_SELLER_SEND_GOODS: { order: 'processing', pay: 'paid' },
  SELLER_CONSIGNED_PART: { order: 'processing', pay: 'partial' },
  WAIT_BUYER_CONFIRM_GOODS: { order: 'shipped', pay: 'paid' },
  TRADE_BUYER_SIGNED: { order: 'delivered', pay: 'paid' },
  TRADE_FINISHED: { order: 'completed', pay: 'paid' },
  TRADE_CLOSED: { order: 'refunded', pay: 'refunded' },          // 付款后关闭（退款成功）
  TRADE_CLOSED_BY_TAOBAO: { order: 'cancelled', pay: 'cancelled' }, // 付款前关闭
  PAY_PENDING: { order: 'pending', pay: 'unpaid' },
};

/** trades.sold.get 需要显式声明返回字段，声明得越少配额消耗越低 */
const TRADE_FIELDS = [
  'tid', 'status', 'created', 'pay_time', 'end_time', 'modified',
  'payment', 'total_fee', 'post_fee', 'discount_fee', 'adjust_fee',
  'buyer_nick', 'receiver_name', 'receiver_mobile', 'receiver_state',
  'receiver_city', 'receiver_district', 'receiver_address',
  'consign_time', 'buyer_message', 'seller_memo', 'type', 'pay_type',
  'orders.oid', 'orders.num_iid', 'orders.sku_id', 'orders.outer_iid',
  'orders.outer_sku_id', 'orders.title', 'orders.sku_properties_name',
  'orders.num', 'orders.price', 'orders.payment', 'orders.discount_fee', 'orders.pic_path',
].join(',');

export class TaobaoAdapter extends BaseAdapter {
  readonly platform: PlatformCode = 'taobao';
  readonly displayName = '淘宝/天猫';
  readonly capabilities: ResourceType[] = ['orders', 'products', 'inventory'];
  readonly gateway = GATEWAY;
  protected readonly orderNoPrefix = 'TB';

  protected hasLiveCredentials(): boolean {
    return !!(this.creds.appKey && this.creds.appSecret && this.creds.accessToken);
  }

  /** 组装 TOP 请求：公共参数 + 业务参数一起参与签名，以 form 形式提交 */
  private async call<T = Record<string, unknown>>(method: string, bizParams: Record<string, unknown>): Promise<T> {
    this.requireLive(GATEWAY);

    const params: Record<string, string> = {
      method,
      app_key: String(this.creds.appKey),
      session: String(this.creds.accessToken),
      timestamp: formatCnTimestamp(),
      format: 'json',
      v: '2.0',
      sign_method: 'md5',
    };
    for (const [k, v] of Object.entries(bizParams)) {
      if (v !== undefined && v !== null && v !== '') params[k] = String(v);
    }
    params.sign = taobaoTopSign(params, String(this.creds.appSecret), 'md5');

    const res = await this.http<Record<string, unknown>>(GATEWAY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams(params).toString(),
    });

    if (!res.ok || !res.data) {
      throw new AdapterError(res.error || '淘宝返回内容无法解析', GATEWAY, res.status);
    }
    const errorResponse = res.data.error_response as Record<string, unknown> | undefined;
    if (errorResponse) {
      throw new AdapterError(
        `淘宝接口报错 code=${errorResponse.code} ${errorResponse.sub_code || ''} ${errorResponse.sub_msg || errorResponse.msg || ''}`.trim(),
        GATEWAY,
        res.status
      );
    }
    // TOP 响应外层键名为 method 去掉 taobao. 前缀并把 . 换成 _ 再加 _response
    const responseKey = `${method.replace(/^taobao\./, '').replace(/\./g, '_')}_response`;
    return (res.data[responseKey] || res.data) as T;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    if (this.isSandbox) {
      return this.sandboxTestResult('未配置淘宝 app_key / app_secret / session');
    }
    try {
      const data = await this.call<{ user?: Record<string, unknown> }>('taobao.user.seller.get', {
        fields: 'user_id,nick,seller_credit',
      });
      return {
        success: true,
        status: 'connected',
        message: '淘宝连接成功，MD5 签名与 session 校验通过',
        endpoint: `${GATEWAY} (taobao.user.seller.get)`,
        mode: 'live',
        shopName: data?.user?.nick ? String(data.user.nick) : this.ctx.shopName,
        sandbox: false,
      };
    } catch (e) {
      const msg = e instanceof AdapterError ? e.message : String(e);
      return {
        success: false,
        status: /session|授权|invalid.*token|27\d{2}/i.test(msg) ? 'expired' : 'error',
        message: msg,
        endpoint: `${GATEWAY} (taobao.user.seller.get)`,
        mode: 'live',
        sandbox: false,
      };
    }
  }

  async fetchOrders(options: FetchOptions = {}): Promise<FetchResult<NormalizedOrder>> {
    if (this.isSandbox) return this.buildSandboxOrders(options);

    const pageNo = options.cursor ? Number(options.cursor) || 1 : 1;
    const pageSize = Math.min(options.pageSize || 50, 100);
    // TOP 要求 start_created / end_created 为 yyyy-MM-dd HH:mm:ss，且跨度不超过 90 天
    const since = options.since ? new Date(options.since) : new Date(Date.now() - 7 * 86400000);
    const until = options.until ? new Date(options.until) : new Date();

    const data = await this.call<{ trades?: { trade?: Array<Record<string, unknown>> }; total_results?: number; has_next?: boolean }>(
      'taobao.trades.sold.get',
      {
        fields: TRADE_FIELDS,
        start_created: formatCnTimestamp(since),
        end_created: formatCnTimestamp(until),
        page_no: pageNo,
        page_size: pageSize,
        use_has_next: 'true',
      }
    );

    const list = data?.trades?.trade || [];
    const hasMore = !!data?.has_next;
    return {
      items: list.map((raw) => this.normalizeOrder(raw)),
      nextCursor: hasMore ? String(pageNo + 1) : null,
      hasMore,
      sandbox: false,
      totalHint: Number(data?.total_results || list.length),
    };
  }

  async fetchProducts(options: FetchOptions = {}): Promise<FetchResult<NormalizedProduct>> {
    if (this.isSandbox) return this.buildSandboxProducts(options);

    const pageNo = options.cursor ? Number(options.cursor) || 1 : 1;
    const pageSize = Math.min(options.pageSize || 50, 200);
    const data = await this.call<{ items?: { item?: Array<Record<string, unknown>> }; total_results?: number }>(
      'taobao.items.onsale.get',
      {
        fields: 'num_iid,title,price,num,outer_id,pic_url,cid,approve_status',
        page_no: pageNo,
        page_size: pageSize,
      }
    );

    const list = data?.items?.item || [];
    const total = Number(data?.total_results || list.length);
    const items: NormalizedProduct[] = list.map((p) => ({
      platform: this.platform,
      platformProductId: String(p.num_iid ?? ''),
      sku: String(p.outer_id || p.num_iid || ''),
      title: String(p.title ?? ''),
      category: p.cid ? String(p.cid) : undefined,
      price: toAmount(p.price),
      stock: Number(p.num || 0),
      status: String(p.approve_status) === 'onsale' ? 'on_sale' : 'off_sale',
      imageUrl: p.pic_url ? String(p.pic_url) : undefined,
      _sandbox: false,
    }));

    const hasMore = pageNo * pageSize < total;
    return { items, nextCursor: hasMore ? String(pageNo + 1) : null, hasMore, sandbox: false, totalHint: total };
  }

  async fetchInventory(options: FetchOptions = {}): Promise<FetchResult<NormalizedInventory>> {
    if (this.isSandbox) return this.buildSandboxInventory(options);

    // 淘宝的库存挂在商品/SKU 上，直接复用 items.onsale.get 的 num 字段
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
        // type=1 表示「全量覆盖」，避免并发下的增量错乱
        await this.call('taobao.item.quantity.update', {
          num_iid: it.platformProductId,
          sku_id: it.platformSkuId,
          outer_id: it.platformSkuId ? undefined : it.sku,
          quantity: it.quantity,
          type: 1,
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
      message: `淘宝库存回写完成：成功 ${successCount} 条，失败 ${failures.length} 条`,
      failures,
      sandbox: false,
    };
  }

  /**
   * 淘宝交易字段映射。
   * 关键点：
   *   - payment 是买家实付，total_fee 是商品总额（不含运费调整），post_fee 为运费
   *   - discount_fee 为系统优惠，adjust_fee 为卖家手工改价（可能为负）
   *   - 子订单在 orders.order 数组中；主订单退款状态需另查 refund 接口，此处仅按交易状态映射
   */
  normalizeOrder(raw: Record<string, unknown>): NormalizedOrder {
    const tid = String(raw.tid ?? '');
    const status = String(raw.status ?? '');
    const mapped = TRADE_STATUS_MAP[status] || { order: 'pending' as UnifiedOrderStatus, pay: 'unpaid' as UnifiedPaymentStatus };

    const subOrders = ((raw.orders as Record<string, unknown>)?.order as Array<Record<string, unknown>>) || [];
    const items: NormalizedOrderItem[] = subOrders.map((o) => ({
      platformProductId: String(o.num_iid ?? ''),
      platformSkuId: o.sku_id ? String(o.sku_id) : undefined,
      outerSku: o.outer_sku_id ? String(o.outer_sku_id) : (o.outer_iid ? String(o.outer_iid) : undefined),
      title: String(o.title ?? ''),
      specs: o.sku_properties_name ? String(o.sku_properties_name) : undefined,
      quantity: Number(o.num || 1),
      unitPrice: toAmount(o.price),
      itemAmount: toAmount(o.payment ?? Number(o.price || 0) * Number(o.num || 1)),
      discount: toAmount(o.discount_fee),
      imageUrl: o.pic_path ? String(o.pic_path) : undefined,
    }));

    const subtotal = items.reduce((sum, it) => sum + it.itemAmount, 0) || toAmount(raw.total_fee);
    const shippingFee = toAmount(raw.post_fee);
    const discount = toAmount(raw.discount_fee);
    const paidAmount = toAmount(raw.payment);
    const totalAmount = toAmount(raw.total_fee) || paidAmount;

    const addrText = [raw.receiver_state, raw.receiver_city, raw.receiver_district, raw.receiver_address]
      .filter(Boolean).join('');

    return {
      platform: this.platform,
      platformOrderId: tid,
      orderNo: `${this.orderNoPrefix}-${tid}`,
      createdAt: toIso(raw.created) || new Date().toISOString(),
      paidAt: toIso(raw.pay_time),
      orderStatus: mapped.order,
      paymentStatus: mapped.pay,
      rawStatus: status,
      buyerNick: raw.buyer_nick ? maskName(String(raw.buyer_nick)) : null,
      receiverName: maskName(raw.receiver_name as string),
      receiverPhone: maskPhone(raw.receiver_mobile as string),
      buyerEmail: null,
      shippingAddress: maskAddress(addrText),
      items,
      subtotal: toAmount(subtotal),
      discount,
      platformSubsidy: 0, // TOP 主接口不区分平台补贴，需另查 promotion 详情
      shippingFee,
      tax: 0,
      totalAmount,
      paidAmount,
      currency: 'CNY',
      paymentMethod: raw.pay_type ? String(raw.pay_type) : null,
      shippingNo: null,       // 运单号需调 taobao.logistics.orders.get 获取
      shippingCompany: null,
      shippedAt: toIso(raw.consign_time),
      remark: raw.buyer_message ? String(raw.buyer_message) : (raw.seller_memo ? String(raw.seller_memo) : null),
      _sandbox: false,
    };
  }
}
