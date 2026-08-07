/**
 * Amazon SP-API（Selling Partner API）适配器
 *
 * 鉴权链路（真实流程）：
 *   1. LWA 换取 access_token：POST https://api.amazon.com/auth/o2/token
 *      grant_type=refresh_token & refresh_token & client_id & client_secret
 *   2. 业务请求头带 x-amz-access-token
 *   3. 如配置了 IAM 密钥（Restricted Data / 部分区域仍要求），再叠加 AWS SigV4 签名
 *
 * 区域端点（真实）：
 *   na → https://sellingpartnerapi-na.amazon.com  (us-east-1)
 *   eu → https://sellingpartnerapi-eu.amazon.com  (eu-west-1)
 *   fe → https://sellingpartnerapi-fe.amazon.com  (us-west-2)
 *
 * 已实现端点（真实路径）：
 *   GET   /orders/v0/orders                        订单列表
 *   GET   /orders/v0/orders/{orderId}/orderItems   订单明细
 *   GET   /catalog/2022-04-01/items                商品目录
 *   GET   /fba/inventory/v1/summaries              FBA 库存
 *   PATCH /listings/2021-08-01/items/{sellerId}/{sku}  库存/价格回写
 *
 * 金额单位：SP-API 返回的是「元/美元」的字符串金额，附带 CurrencyCode。
 */
import { BaseAdapter, toAmount, toIso, AdapterError } from './baseAdapter';
import { awsSigV4, buildQuery } from './signing';
import { maskAddress, maskEmail, maskName, maskPhone } from './crypto';
import {
  ConnectionTestResult, FetchOptions, FetchResult, InventoryPushItem,
  NormalizedInventory, NormalizedOrder, NormalizedOrderItem, NormalizedProduct,
  PlatformCode, PushResult, ResourceType, UnifiedOrderStatus, UnifiedPaymentStatus,
} from './types';

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

/** 区域 → SP-API 主机与 AWS Region */
const REGION_MAP: Record<string, { host: string; awsRegion: string; defaultMarketplace: string }> = {
  na: { host: 'sellingpartnerapi-na.amazon.com', awsRegion: 'us-east-1', defaultMarketplace: 'ATVPDKIKX0DER' }, // 美国
  eu: { host: 'sellingpartnerapi-eu.amazon.com', awsRegion: 'eu-west-1', defaultMarketplace: 'A1F83G8C2ARO7P' }, // 英国
  fe: { host: 'sellingpartnerapi-fe.amazon.com', awsRegion: 'us-west-2', defaultMarketplace: 'A1VC38T7YXB528' }, // 日本
};

/** Amazon 订单状态 → Vorzai 统一状态 */
const ORDER_STATUS_MAP: Record<string, { order: UnifiedOrderStatus; pay: UnifiedPaymentStatus }> = {
  Pending: { order: 'pending', pay: 'unpaid' },
  PendingAvailability: { order: 'pending', pay: 'unpaid' },
  Unshipped: { order: 'processing', pay: 'paid' },
  PartiallyShipped: { order: 'processing', pay: 'paid' },
  Shipped: { order: 'shipped', pay: 'paid' },
  InvoiceUnconfirmed: { order: 'processing', pay: 'paid' },
  Canceled: { order: 'cancelled', pay: 'cancelled' },
  Unfulfillable: { order: 'cancelled', pay: 'cancelled' },
};

export class AmazonAdapter extends BaseAdapter {
  readonly platform: PlatformCode = 'amazon';
  readonly displayName = 'Amazon';
  readonly capabilities: ResourceType[] = ['orders', 'products', 'inventory', 'finance'];
  readonly gateway = 'https://sellingpartnerapi-na.amazon.com';
  protected readonly orderNoPrefix = 'AMZ';

  /** LWA token 内存缓存，避免每次调用都换令牌 */
  private lwaToken: { value: string; expiresAt: number } | null = null;

  protected hasLiveCredentials(): boolean {
    return !!(this.creds.appKey && this.creds.appSecret && this.creds.refreshToken);
  }

  private get regionConf(): { host: string; awsRegion: string; defaultMarketplace: string } {
    const key = String(this.creds.region || this.ctx.region || 'na').toLowerCase();
    return REGION_MAP[key] || REGION_MAP.na;
  }

  private get marketplaceId(): string {
    return this.creds.extra?.marketplaceId || this.regionConf.defaultMarketplace;
  }

  /** 用 refresh_token 换 LWA access_token（真实 LWA 流程） */
  private async getAccessToken(): Promise<string> {
    if (this.lwaToken && this.lwaToken.expiresAt > Date.now() + 60000) {
      return this.lwaToken.value;
    }
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: String(this.creds.refreshToken),
      client_id: String(this.creds.appKey),
      client_secret: String(this.creds.appSecret),
    }).toString();

    const res = await this.http<{ access_token?: string; expires_in?: number; error_description?: string; error?: string }>(
      LWA_TOKEN_URL,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }
    );
    if (!res.ok || !res.data?.access_token) {
      throw new AdapterError(
        `LWA 令牌获取失败：${res.data?.error_description || res.data?.error || res.error || '未知错误'}`,
        LWA_TOKEN_URL,
        res.status
      );
    }
    this.lwaToken = {
      value: res.data.access_token,
      expiresAt: Date.now() + Number(res.data.expires_in || 3600) * 1000,
    };
    return this.lwaToken.value;
  }

  /** 发起 SP-API 请求；如配置 IAM 密钥则叠加 SigV4 */
  private async call<T = Record<string, unknown>>(
    method: string,
    pathname: string,
    query: Record<string, string | number | undefined> = {},
    payload?: unknown
  ): Promise<T> {
    const { host, awsRegion } = this.regionConf;
    const endpoint = `https://${host}${pathname}`;
    this.requireLive(endpoint);

    const token = await this.getAccessToken();
    const qs = buildQuery(query);
    const url = qs ? `${endpoint}?${qs}` : endpoint;
    const body = payload ? JSON.stringify(payload) : undefined;

    const headers: Record<string, string> = {
      'x-amz-access-token': token,
      'Content-Type': 'application/json',
      accept: 'application/json',
    };

    // SP-API 自 2023-10 起多数接口不再强制 SigV4；配置了 IAM 密钥时仍按标准签名，兼容受限数据接口
    const awsAccessKeyId = this.creds.extra?.awsAccessKeyId;
    const awsSecretKey = this.creds.extra?.awsSecretAccessKey;
    if (awsAccessKeyId && awsSecretKey) {
      const signed = awsSigV4({
        method,
        path: pathname,
        query,
        host,
        region: awsRegion,
        service: 'execute-api',
        accessKeyId: awsAccessKeyId,
        secretAccessKey: awsSecretKey,
        sessionToken: this.creds.extra?.awsSessionToken,
        payload: body || '',
      });
      Object.assign(headers, signed.headers);
    }

    const res = await this.http<T & { errors?: Array<{ code: string; message: string }> }>(url, { method, headers, body });
    if (!res.ok || !res.data) {
      throw new AdapterError(res.error || 'Amazon 返回内容无法解析', endpoint, res.status);
    }
    if (res.data.errors && res.data.errors.length) {
      const first = res.data.errors[0];
      throw new AdapterError(`Amazon 接口报错 ${first.code}: ${first.message}`, endpoint, res.status);
    }
    return res.data as T;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    if (this.isSandbox) {
      return this.sandboxTestResult('未配置 Amazon LWA client_id / client_secret / refresh_token');
    }
    const endpoint = `https://${this.regionConf.host}/orders/v0/orders`;
    try {
      // 拉取最近 1 小时、最多 1 条订单作为鉴权探针（内部会先完成 LWA 换令牌）
      await this.call('GET', '/orders/v0/orders', {
        MarketplaceIds: this.marketplaceId,
        CreatedAfter: new Date(Date.now() - 3600 * 1000).toISOString(),
        MaxResultsPerPage: 1,
      });
      return {
        success: true,
        status: 'connected',
        message: `Amazon 连接成功（区域 ${String(this.creds.region || 'na').toUpperCase()}，站点 ${this.marketplaceId}），LWA 令牌有效`,
        endpoint,
        mode: 'live',
        shopName: this.ctx.shopName,
        tokenExpiresAt: this.lwaToken ? new Date(this.lwaToken.expiresAt).toISOString() : undefined,
        sandbox: false,
      };
    } catch (e) {
      const msg = e instanceof AdapterError ? e.message : String(e);
      return {
        success: false,
        status: /LWA|refresh_token|invalid_grant|unauthorized/i.test(msg) ? 'expired' : 'error',
        message: msg,
        endpoint,
        mode: 'live',
        sandbox: false,
      };
    }
  }

  async fetchOrders(options: FetchOptions = {}): Promise<FetchResult<NormalizedOrder>> {
    if (this.isSandbox) return this.buildSandboxOrders(options);

    const query: Record<string, string | number | undefined> = {
      MarketplaceIds: this.marketplaceId,
      MaxResultsPerPage: Math.min(options.pageSize || 50, 100),
    };
    if (options.cursor) {
      query.NextToken = options.cursor;
    } else {
      query.CreatedAfter = options.since || new Date(Date.now() - 7 * 86400000).toISOString();
      if (options.until) query.CreatedBefore = options.until;
    }

    const data = await this.call<{ payload?: { Orders?: Array<Record<string, unknown>>; NextToken?: string } }>(
      'GET', '/orders/v0/orders', query
    );
    const payload = data.payload || {};
    const orders = payload.Orders || [];

    // Amazon 订单头与明细分离，逐单补齐 OrderItems（失败不影响整批）
    const items: NormalizedOrder[] = [];
    for (const o of orders) {
      const normalized = this.normalizeOrder(o);
      try {
        const detail = await this.call<{ payload?: { OrderItems?: Array<Record<string, unknown>> } }>(
          'GET', `/orders/v0/orders/${encodeURIComponent(normalized.platformOrderId)}/orderItems`, {}
        );
        normalized.items = (detail.payload?.OrderItems || []).map((it) => this.normalizeOrderItem(it));
        normalized.subtotal = toAmount(normalized.items.reduce((s, x) => s + x.itemAmount, 0));
      } catch {
        // 明细拉取失败时保留订单头，明细留空，由同步日志记录
      }
      items.push(normalized);
    }

    const next = payload.NextToken ? String(payload.NextToken) : null;
    return { items, nextCursor: next, hasMore: !!next, sandbox: false };
  }

  async fetchProducts(options: FetchOptions = {}): Promise<FetchResult<NormalizedProduct>> {
    if (this.isSandbox) return this.buildSandboxProducts(options);

    const sellerId = this.creds.shopId || this.creds.extra?.sellerId;
    if (!sellerId) {
      throw new AdapterError('缺少 Seller ID（卖家编号），无法查询商品目录', `https://${this.regionConf.host}/catalog/2022-04-01/items`);
    }

    const data = await this.call<{ items?: Array<Record<string, unknown>>; pagination?: { nextToken?: string } }>(
      'GET', '/catalog/2022-04-01/items',
      {
        marketplaceIds: this.marketplaceId,
        sellerId,
        pageSize: Math.min(options.pageSize || 20, 20),
        pageToken: options.cursor || undefined,
        includedData: 'attributes,summaries,identifiers',
      }
    );

    const list = data.items || [];
    const products: NormalizedProduct[] = list.map((p) => {
      const summaries = (p.summaries as Array<Record<string, unknown>>) || [];
      const summary = summaries[0] || {};
      return {
        platform: this.platform,
        platformProductId: String(p.asin ?? ''),
        sku: String(summary.sellerSku ?? p.asin ?? ''),
        title: String(summary.itemName ?? ''),
        brand: summary.brand ? String(summary.brand) : undefined,
        price: 0, // 目录接口不返回价格，价格需查 /products/pricing/v0/price
        stock: 0,
        status: 'on_sale',
        _sandbox: false,
      };
    });

    const next = data.pagination?.nextToken ? String(data.pagination.nextToken) : null;
    return { items: products, nextCursor: next, hasMore: !!next, sandbox: false };
  }

  async fetchInventory(options: FetchOptions = {}): Promise<FetchResult<NormalizedInventory>> {
    if (this.isSandbox) return this.buildSandboxInventory(options);

    const data = await this.call<{ payload?: { inventorySummaries?: Array<Record<string, unknown>>; nextToken?: string } }>(
      'GET', '/fba/inventory/v1/summaries',
      {
        granularityType: 'Marketplace',
        granularityId: this.marketplaceId,
        marketplaceIds: this.marketplaceId,
        details: 'true',
        nextToken: options.cursor || undefined,
      }
    );

    const list = data.payload?.inventorySummaries || [];
    const now = new Date().toISOString();
    const items: NormalizedInventory[] = list.map((s) => {
      const detail = (s.inventoryDetails as Record<string, unknown>) || {};
      return {
        platform: this.platform,
        platformProductId: String(s.asin ?? ''),
        sku: String(s.sellerSku ?? s.fnSku ?? ''),
        available: Number(s.totalQuantity || detail.fulfillableQuantity || 0),
        reserved: Number((detail.reservedQuantity as Record<string, unknown>)?.totalReservedQuantity || 0),
        warehouseCode: 'FBA',
        updatedAt: s.lastUpdatedTime ? String(s.lastUpdatedTime) : now,
        _sandbox: false,
      };
    });

    const next = data.payload?.nextToken ? String(data.payload.nextToken) : null;
    return { items, nextCursor: next, hasMore: !!next, sandbox: false };
  }

  async pushInventory(items: InventoryPushItem[]): Promise<PushResult> {
    if (this.isSandbox) return this.buildSandboxPushResult(items);

    const sellerId = this.creds.shopId || this.creds.extra?.sellerId;
    if (!sellerId) {
      return {
        success: false, successCount: 0, failedCount: items.length,
        message: '缺少 Seller ID，无法回写库存',
        failures: items.map((i) => ({ sku: i.sku, reason: '缺少 Seller ID' })),
        sandbox: false,
      };
    }

    const failures: Array<{ sku: string; reason: string }> = [];
    let successCount = 0;
    for (const it of items) {
      try {
        // Listings Items API：PATCH 单个 SKU 的 fulfillment_availability
        await this.call(
          'PATCH',
          `/listings/2021-08-01/items/${encodeURIComponent(sellerId)}/${encodeURIComponent(it.sku)}`,
          { marketplaceIds: this.marketplaceId },
          {
            productType: 'PRODUCT',
            patches: [{
              op: 'replace',
              path: '/attributes/fulfillment_availability',
              value: [{ fulfillment_channel_code: 'DEFAULT', quantity: it.quantity }],
            }],
          }
        );
        successCount++;
      } catch (e) {
        failures.push({ sku: it.sku, reason: e instanceof Error ? e.message : String(e) });
      }
    }
    return {
      success: failures.length === 0,
      successCount,
      failedCount: failures.length,
      message: `Amazon 库存回写完成：成功 ${successCount} 条，失败 ${failures.length} 条`,
      failures,
      sandbox: false,
    };
  }

  /** OrderItems 明细映射 */
  private normalizeOrderItem(it: Record<string, unknown>): NormalizedOrderItem {
    const money = (v: unknown): number => toAmount((v as Record<string, unknown>)?.Amount);
    const qty = Number(it.QuantityOrdered || 1);
    const itemAmount = money(it.ItemPrice);
    return {
      platformProductId: String(it.ASIN ?? ''),
      platformSkuId: it.OrderItemId ? String(it.OrderItemId) : undefined,
      outerSku: it.SellerSKU ? String(it.SellerSKU) : undefined,
      title: String(it.Title ?? ''),
      quantity: qty,
      unitPrice: qty > 0 ? toAmount(itemAmount / qty) : itemAmount,
      itemAmount,
      discount: money(it.PromotionDiscount),
    };
  }

  /**
   * Amazon 订单头字段映射。
   * 关键点：
   *   - OrderTotal 为含税总额，明细在 orderItems 单独接口
   *   - BuyerInfo.BuyerEmail 是亚马逊代理邮箱，仍按隐私字段脱敏
   *   - 币种取自 OrderTotal.CurrencyCode，跨境场景不可默认 CNY
   */
  normalizeOrder(raw: Record<string, unknown>): NormalizedOrder {
    const orderId = String(raw.AmazonOrderId ?? '');
    const status = String(raw.OrderStatus ?? '');
    const mapped = ORDER_STATUS_MAP[status] || { order: 'pending' as UnifiedOrderStatus, pay: 'unpaid' as UnifiedPaymentStatus };

    const orderTotal = (raw.OrderTotal as Record<string, unknown>) || {};
    const totalAmount = toAmount(orderTotal.Amount);
    const currency = String(orderTotal.CurrencyCode || 'USD');

    const shipAddr = (raw.ShippingAddress as Record<string, unknown>) || {};
    const addrText = [
      shipAddr.AddressLine1, shipAddr.AddressLine2,
      shipAddr.City, shipAddr.StateOrRegion, shipAddr.PostalCode, shipAddr.CountryCode,
    ].filter(Boolean).join(' ');

    const buyerInfo = (raw.BuyerInfo as Record<string, unknown>) || {};
    const paid = mapped.pay === 'paid';

    return {
      platform: this.platform,
      platformOrderId: orderId,
      orderNo: `${this.orderNoPrefix}-${orderId}`,
      createdAt: toIso(raw.PurchaseDate) || new Date().toISOString(),
      paidAt: paid ? toIso(raw.PurchaseDate) : null,
      orderStatus: mapped.order,
      paymentStatus: mapped.pay,
      rawStatus: status,
      buyerNick: buyerInfo.BuyerName ? maskName(String(buyerInfo.BuyerName)) : null,
      receiverName: maskName(shipAddr.Name as string),
      receiverPhone: maskPhone(shipAddr.Phone as string),
      buyerEmail: maskEmail(buyerInfo.BuyerEmail as string),
      shippingAddress: maskAddress(addrText),
      items: [], // 由 fetchOrders 调用 orderItems 接口补齐
      subtotal: totalAmount,
      discount: 0,
      platformSubsidy: 0,
      shippingFee: 0, // 运费包含在明细的 ShippingPrice 中
      tax: 0,
      totalAmount,
      paidAmount: paid ? totalAmount : 0,
      currency,
      paymentMethod: raw.PaymentMethod ? String(raw.PaymentMethod) : null,
      shippingNo: null, // 运单号需查 /shipping 或 Merchant Fulfillment API
      shippingCompany: raw.FulfillmentChannel ? String(raw.FulfillmentChannel) : null,
      shippedAt: null,
      remark: raw.OrderType ? `OrderType=${String(raw.OrderType)}` : null,
      _sandbox: false,
    };
  }
}
