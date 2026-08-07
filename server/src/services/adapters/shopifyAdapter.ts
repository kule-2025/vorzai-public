/**
 * Shopify Admin API 适配器
 *
 * 网关：https://{shop}.myshopify.com/admin/api/{version}
 * 鉴权：Header `X-Shopify-Access-Token: {admin_api_access_token}`
 *      （自定义应用直接在后台生成 token，无需走 OAuth；公共应用走 OAuth 后拿同名 token）
 * 签名：Shopify 的 REST 调用本身不签名，签名用于两处，均已在 signing.ts 真实实现：
 *      1. Webhook 校验 —— base64(HMAC-SHA256(apiSecret, rawBody)) 对比 X-Shopify-Hmac-Sha256
 *      2. OAuth 回调校验 —— hex(HMAC-SHA256(apiSecret, 排序后的 query))
 * 文档：https://shopify.dev/docs/api/admin-rest
 *
 * 已实现 API（真实路径）：
 *   GET   /admin/api/{v}/shop.json                       店铺信息（鉴权探针）
 *   GET   /admin/api/{v}/orders.json                     订单列表（游标分页）
 *   GET   /admin/api/{v}/products.json                   商品列表
 *   GET   /admin/api/{v}/inventory_levels.json           库存水位
 *   POST  /admin/api/{v}/inventory_levels/set.json       库存覆盖写入
 *
 * 特殊约定：
 *   1. 分页用 Link 响应头的 rel="next" 游标（page_info），不是页码
 *   2. 金额字段是「字符串形式的元」，如 "129.00"，不是分
 *   3. 时间是 ISO 8601 带时区，如 2024-05-01T10:00:00+08:00
 *   4. 库存写入以 inventory_item_id + location_id 为主键，不是 SKU
 */
import { BaseAdapter, toAmount, toIso, AdapterError } from './baseAdapter';
import { buildQuery } from './signing';
import { maskAddress, maskEmail, maskName, maskPhone } from './crypto';
import {
  ConnectionTestResult, FetchOptions, FetchResult, InventoryPushItem,
  NormalizedInventory, NormalizedOrder, NormalizedOrderItem, NormalizedProduct,
  PlatformCode, PushResult, ResourceType, UnifiedOrderStatus, UnifiedPaymentStatus,
} from './types';

const DEFAULT_API_VERSION = '2024-10';

/** financial_status → Vorzai 支付状态 */
const PAYMENT_STATUS_MAP: Record<string, UnifiedPaymentStatus> = {
  pending: 'unpaid',
  authorized: 'unpaid',
  partially_paid: 'partial',
  paid: 'paid',
  partially_refunded: 'partial',
  refunded: 'refunded',
  voided: 'cancelled',
};

/** fulfillment_status → Vorzai 订单状态（需与 cancelled_at / financial_status 联合判定） */
const FULFILLMENT_STATUS_MAP: Record<string, UnifiedOrderStatus> = {
  fulfilled: 'shipped',
  partial: 'processing',
  restocked: 'returned',
};

export class ShopifyAdapter extends BaseAdapter {
  readonly platform: PlatformCode = 'shopify';
  readonly displayName = 'Shopify';
  readonly capabilities: ResourceType[] = ['orders', 'products', 'inventory', 'logistics'];
  readonly gateway = 'https://{shop}.myshopify.com/admin/api';
  protected readonly orderNoPrefix = 'SP';

  /** myshopify 域名，允许用户填 "my-store" 或 "my-store.myshopify.com" */
  private get shopDomain(): string {
    const raw = String(this.creds.shopId || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (!raw) return '';
    return raw.includes('.') ? raw : `${raw}.myshopify.com`;
  }

  private get apiVersion(): string {
    return (this.creds.extra && this.creds.extra.apiVersion) || DEFAULT_API_VERSION;
  }

  private get baseUrl(): string {
    return `https://${this.shopDomain}/admin/api/${this.apiVersion}`;
  }

  protected hasLiveCredentials(): boolean {
    // Shopify 自定义应用只需 store 域名 + Admin API access token
    return !!(this.shopDomain && this.creds.accessToken);
  }

  /** 统一 REST 调用；返回体与 Link 头一起带出，供游标分页使用 */
  private async call<T = Record<string, unknown>>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    pathname: string,
    query: Record<string, string | number | undefined | null> = {},
    body?: Record<string, unknown>
  ): Promise<{ data: T; linkHeader: string | null }> {
    const endpoint = `${this.baseUrl}${pathname}`;
    this.requireLive(endpoint);

    const qs = buildQuery(query);
    const url = qs ? `${endpoint}?${qs}` : endpoint;

    const res = await this.http<T & { errors?: unknown }>(url, {
      method,
      headers: {
        'X-Shopify-Access-Token': String(this.creds.accessToken),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      // 429 是 Shopify 的漏桶限流，单独提示，便于上层退避重试
      const hint = res.status === 429 ? '（触发 Shopify 调用限流，请降低同步频率）' : '';
      throw new AdapterError(`${res.error || 'Shopify 调用失败'}${hint}`, endpoint, res.status);
    }
    if (!res.data) {
      throw new AdapterError('Shopify 返回内容无法解析为 JSON', endpoint, res.status);
    }
    if (res.data.errors) {
      throw new AdapterError(`Shopify 接口报错: ${JSON.stringify(res.data.errors).slice(0, 200)}`, endpoint, res.status);
    }
    return { data: res.data as T, linkHeader: res.linkHeader };
  }

  /** 从 Link 响应头中解析 rel="next" 的 page_info 游标 */
  private parseNextCursor(linkHeader: string | null): string | null {
    if (!linkHeader) return null;
    for (const part of linkHeader.split(',')) {
      if (!/rel="?next"?/.test(part)) continue;
      const m = part.match(/[?&]page_info=([^&>;\s]+)/);
      if (m) return decodeURIComponent(m[1]);
    }
    return null;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    if (this.isSandbox) {
      return this.sandboxTestResult('未配置 Shopify 店铺域名或 Admin API access token');
    }
    const endpoint = `${this.baseUrl}/shop.json`;
    try {
      const { data } = await this.call<{ shop?: Record<string, unknown> }>('GET', '/shop.json');
      const shop = data.shop || {};
      return {
        success: true,
        status: 'connected',
        message: `Shopify 店铺连接成功（API 版本 ${this.apiVersion}）`,
        endpoint,
        mode: 'live',
        shopName: shop.name ? String(shop.name) : this.shopDomain,
        sandbox: false,
      };
    } catch (e) {
      const msg = e instanceof AdapterError ? e.message : String(e);
      const status = e instanceof AdapterError && (e.status === 401 || e.status === 403) ? 'expired' : 'error';
      return {
        success: false,
        status,
        message: msg,
        endpoint,
        mode: 'live',
        sandbox: false,
      };
    }
  }

  async fetchOrders(options: FetchOptions = {}): Promise<FetchResult<NormalizedOrder>> {
    if (this.isSandbox) return this.buildSandboxOrders(options);

    const limit = Math.min(options.pageSize || 50, 250);
    // Shopify 规定：带 page_info 翻页时，除 limit / fields 外的过滤参数都不能再传
    const query: Record<string, string | number | undefined> = options.cursor
      ? { limit, page_info: options.cursor }
      : {
          limit,
          status: 'any',
          created_at_min: options.since ? new Date(options.since).toISOString() : undefined,
          created_at_max: options.until ? new Date(options.until).toISOString() : undefined,
        };

    const { data, linkHeader } = await this.call<{ orders?: Array<Record<string, unknown>> }>(
      'GET',
      '/orders.json',
      query
    );

    const nextCursor = this.parseNextCursor(linkHeader);
    return {
      items: (data.orders || []).map((raw) => this.normalizeOrder(raw)),
      nextCursor,
      hasMore: !!nextCursor,
      sandbox: false,
    };
  }

  async fetchProducts(options: FetchOptions = {}): Promise<FetchResult<NormalizedProduct>> {
    if (this.isSandbox) return this.buildSandboxProducts(options);

    const limit = Math.min(options.pageSize || 50, 250);
    const query = options.cursor ? { limit, page_info: options.cursor } : { limit };

    const { data, linkHeader } = await this.call<{ products?: Array<Record<string, unknown>> }>(
      'GET',
      '/products.json',
      query
    );

    const items: NormalizedProduct[] = [];
    for (const p of data.products || []) {
      const variants = (p.variants as Array<Record<string, unknown>>) || [];
      const images = (p.images as Array<Record<string, unknown>>) || [];
      const cover = images.length ? String(images[0].src || '') : undefined;
      // Shopify 的库存 / 价格挂在 variant 上，一个 product 可能对应多条 Vorzai 商品
      if (!variants.length) continue;
      for (const v of variants) {
        items.push({
          platform: this.platform,
          platformProductId: String(p.id ?? ''),
          sku: String(v.sku || v.id || ''),
          title: variants.length > 1 ? `${String(p.title ?? '')} - ${String(v.title ?? '')}` : String(p.title ?? ''),
          category: p.product_type ? String(p.product_type) : undefined,
          brand: p.vendor ? String(p.vendor) : undefined,
          price: toAmount(v.price),
          stock: Number(v.inventory_quantity || 0),
          status: String(p.status) === 'active'
            ? (Number(v.inventory_quantity || 0) > 0 ? 'on_sale' : 'sold_out')
            : 'off_sale',
          imageUrl: cover,
          _sandbox: false,
        });
      }
    }

    const nextCursor = this.parseNextCursor(linkHeader);
    return { items, nextCursor, hasMore: !!nextCursor, sandbox: false };
  }

  async fetchInventory(options: FetchOptions = {}): Promise<FetchResult<NormalizedInventory>> {
    if (this.isSandbox) return this.buildSandboxInventory(options);

    // inventory_levels 只认 inventory_item_id，需要先从商品变体拿到映射关系
    const products = await this.call<{ products?: Array<Record<string, unknown>> }>('GET', '/products.json', {
      limit: Math.min(options.pageSize || 50, 250),
    });

    const itemIdToSku = new Map<string, { sku: string; productId: string; variantId: string }>();
    for (const p of products.data.products || []) {
      for (const v of ((p.variants as Array<Record<string, unknown>>) || [])) {
        if (v.inventory_item_id) {
          itemIdToSku.set(String(v.inventory_item_id), {
            sku: String(v.sku || v.id || ''),
            productId: String(p.id ?? ''),
            variantId: String(v.id ?? ''),
          });
        }
      }
    }

    if (itemIdToSku.size === 0) {
      return { items: [], nextCursor: null, hasMore: false, sandbox: false };
    }

    const { data } = await this.call<{ inventory_levels?: Array<Record<string, unknown>> }>(
      'GET',
      '/inventory_levels.json',
      { inventory_item_ids: Array.from(itemIdToSku.keys()).slice(0, 50).join(','), limit: 250 }
    );

    const now = new Date().toISOString();
    const items: NormalizedInventory[] = (data.inventory_levels || []).map((lv) => {
      const meta = itemIdToSku.get(String(lv.inventory_item_id));
      return {
        platform: this.platform,
        platformProductId: meta ? meta.productId : String(lv.inventory_item_id ?? ''),
        platformSkuId: meta ? meta.variantId : undefined,
        sku: meta ? meta.sku : String(lv.inventory_item_id ?? ''),
        available: Number(lv.available || 0),
        warehouseCode: lv.location_id ? String(lv.location_id) : undefined,
        updatedAt: toIso(lv.updated_at) || now,
        _sandbox: false,
      };
    });

    return { items, nextCursor: null, hasMore: false, sandbox: false };
  }

  async pushInventory(items: InventoryPushItem[]): Promise<PushResult> {
    if (this.isSandbox) return this.buildSandboxPushResult(items);

    // location_id 是 Shopify 库存写入的必填项，优先取用户在凭据 extra 中配置的默认仓
    let locationId = this.creds.extra && this.creds.extra.locationId;
    if (!locationId) {
      const { data } = await this.call<{ locations?: Array<Record<string, unknown>> }>('GET', '/locations.json');
      const first = (data.locations || [])[0];
      locationId = first ? String(first.id) : '';
    }
    if (!locationId) {
      return {
        success: false,
        successCount: 0,
        failedCount: items.length,
        message: 'Shopify 未能确定库存地点（location_id），请在连接凭据的扩展字段中配置 locationId',
        failures: items.map((it) => ({ sku: it.sku, reason: '缺少 location_id' })),
        sandbox: false,
      };
    }

    const failures: Array<{ sku: string; reason: string }> = [];
    let successCount = 0;
    for (const it of items) {
      try {
        if (!it.platformSkuId) {
          throw new Error('缺少 inventory_item_id（请先执行一次库存同步以建立映射）');
        }
        await this.call('POST', '/inventory_levels/set.json', {}, {
          location_id: Number(locationId),
          inventory_item_id: Number(it.platformSkuId),
          available: it.quantity,
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
      message: `Shopify 库存回写完成：成功 ${successCount} 条，失败 ${failures.length} 条`,
      failures,
      sandbox: false,
    };
  }

  /**
   * Shopify 订单字段映射。
   * 关键点：
   *   - 金额是字符串形式的「元」，直接 toAmount，不做分→元换算
   *   - 订单状态需三段联合判定：cancelled_at → financial_status → fulfillment_status
   *   - 优惠拆成 total_discounts（含商家折扣码），Shopify 无平台补贴概念，platformSubsidy 恒为 0
   *   - 运费在 shipping_lines[].price，税在 total_tax
   *   - 物流单号在 fulfillments[].tracking_number
   */
  normalizeOrder(raw: Record<string, unknown>): NormalizedOrder {
    const orderId = String(raw.id ?? '');
    const orderName = raw.name ? String(raw.name) : orderId; // Shopify 展示单号形如 #1001
    const financial = String(raw.financial_status || '').toLowerCase();
    const fulfillment = String(raw.fulfillment_status || '').toLowerCase();

    const paymentStatus: UnifiedPaymentStatus = PAYMENT_STATUS_MAP[financial] || 'unpaid';

    let orderStatus: UnifiedOrderStatus;
    if (raw.cancelled_at) {
      orderStatus = financial === 'refunded' ? 'refunded' : 'cancelled';
    } else if (raw.closed_at) {
      orderStatus = 'completed';
    } else if (FULFILLMENT_STATUS_MAP[fulfillment]) {
      orderStatus = FULFILLMENT_STATUS_MAP[fulfillment];
    } else if (paymentStatus === 'paid' || paymentStatus === 'partial') {
      orderStatus = 'processing';
    } else {
      orderStatus = 'pending';
    }

    const lineItems = (raw.line_items as Array<Record<string, unknown>>) || [];
    const items: NormalizedOrderItem[] = lineItems.map((li) => {
      const qty = Number(li.quantity || 1);
      const unitPrice = toAmount(li.price);
      const lineDiscount = toAmount(li.total_discount);
      return {
        platformProductId: String(li.product_id ?? ''),
        platformSkuId: li.variant_id ? String(li.variant_id) : undefined,
        outerSku: li.sku ? String(li.sku) : undefined,
        title: String(li.title ?? ''),
        specs: li.variant_title ? String(li.variant_title) : undefined,
        quantity: qty,
        unitPrice,
        itemAmount: toAmount(unitPrice * qty - lineDiscount),
        discount: lineDiscount,
      };
    });

    const subtotal = toAmount(raw.subtotal_price ?? items.reduce((s, it) => s + it.itemAmount, 0));
    const shippingLines = (raw.shipping_lines as Array<Record<string, unknown>>) || [];
    const shippingFee = toAmount(shippingLines.reduce((s, sl) => s + Number(sl.price || 0), 0));
    const discount = toAmount(raw.total_discounts);
    const tax = toAmount(raw.total_tax);
    const totalAmount = toAmount(raw.total_price);

    const customer = (raw.customer as Record<string, unknown>) || {};
    const shipAddr = (raw.shipping_address as Record<string, unknown>) || {};
    const addrText = [shipAddr.province, shipAddr.city, shipAddr.address1, shipAddr.address2]
      .filter(Boolean).join(' ');

    const fulfillments = (raw.fulfillments as Array<Record<string, unknown>>) || [];
    const firstFulfillment = fulfillments[0] || {};

    const gateways = (raw.payment_gateway_names as string[]) || [];

    return {
      platform: this.platform,
      platformOrderId: orderId,
      orderNo: `${this.orderNoPrefix}-${orderName.replace(/^#/, '')}`,
      createdAt: toIso(raw.created_at) || new Date().toISOString(),
      paidAt: paymentStatus === 'paid' || paymentStatus === 'partial'
        ? (toIso(raw.processed_at) || toIso(raw.created_at))
        : null,
      orderStatus,
      paymentStatus,
      rawStatus: `${financial || 'none'}/${fulfillment || 'unfulfilled'}`,
      buyerNick: customer.first_name || customer.last_name
        ? maskName(`${customer.first_name || ''} ${customer.last_name || ''}`.trim())
        : null,
      receiverName: maskName(shipAddr.name as string),
      receiverPhone: maskPhone((shipAddr.phone || raw.phone) as string),
      buyerEmail: maskEmail((raw.email || customer.email) as string),
      shippingAddress: maskAddress(addrText),
      items,
      subtotal,
      discount,
      platformSubsidy: 0, // Shopify 是自建站，不存在平台补贴
      shippingFee,
      tax,
      totalAmount,
      paidAmount: paymentStatus === 'paid' ? totalAmount : toAmount(raw.total_price_usd ?? 0),
      currency: String(raw.currency || 'USD'),
      paymentMethod: gateways.length ? gateways.join(',') : null,
      shippingNo: firstFulfillment.tracking_number ? String(firstFulfillment.tracking_number) : null,
      shippingCompany: firstFulfillment.tracking_company ? String(firstFulfillment.tracking_company) : null,
      shippedAt: toIso(firstFulfillment.created_at),
      remark: raw.note ? String(raw.note) : null,
      _sandbox: false,
    };
  }
}
