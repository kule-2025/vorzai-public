/**
 * 抖音电商（抖店 Doudian）适配器
 *
 * 平台特征（决定了本适配器与其它平台的差异）：
 *  1. 订单号是 19 位纯数字（形如 4900123456789012345），无字母无分隔符。
 *  2. 金额单位一律是「分」（整数），归一化时必须 /100 转元。
 *  3. order_status 是**数字枚举**：1 待支付 / 2 已支付 / 3 待发货 / 4 部分发货
 *     / 5 已发货 / 6 已取消 / 7 已完成，另有 main_status 大状态。
 *  4. 有独特的订单类型 order_type：0 普通 / 2 定金预售 / 4 全款预售 / 5 小时达，
 *     其中「小时达」要求 2 小时内履约，运营侧需要单独识别，故映射进 remark。
 *  5. 达人分销：author_id / author_name / commission_rate（万分比）/ estimated_commission（分），
 *     这是抖音独有的 GMV 归因来源，必须保留到订单备注与后续人效归因。
 *  6. 流量来源 origin_type / room_id：直播间成单需要标出所属直播间，
 *     与 Vorzai 的 orders.live_session_id 能力呼应。
 *
 * 真实 API 接入点（凭据齐备后即可切换 live）：
 *  - 网关 https://openapi-fxg.jinritemai.com
 *  - 订单列表 POST /order/searchList  （v2，param_json 传 size/page/create_time_start/create_time_end）
 *  - 订单详情 POST /order/orderDetail
 *  - 商品列表 POST /product/list
 *  - 库存更新 POST /sku/syncStock
 *  - 店铺信息 POST /shop/getShopDetail  （最轻量的鉴权探测接口，用于 testConnection）
 *  签名算法见 signing.ts:doudianSign（MD5，app_secret 双端包裹）。
 *  所需凭据：app_key、app_secret、access_token（OAuth 授权后获得，有效期 7 天，靠 refresh_token 续期）。
 */
import { BaseAdapter, AdapterError, fenToYuan, toAmount, toIso, mulberry32, seedFrom, pick, digits, SANDBOX_GOODS, SANDBOX_SURNAMES, SANDBOX_REGIONS } from './baseAdapter';
import { doudianSign, stableJsonStringify, formatCnTimestamp } from './signing';
import { maskAddress, maskName, maskPhone } from './crypto';
import {
  ConnectionTestResult,
  FetchOptions,
  FetchResult,
  InventoryPushItem,
  NormalizedInventory,
  NormalizedOrder,
  NormalizedOrderItem,
  NormalizedProduct,
  PlatformCode,
  PushResult,
  ResourceType,
  UnifiedOrderStatus,
  UnifiedPaymentStatus,
} from './types';

/** 抖店订单状态数字枚举 → Vorzai 统一状态 */
const DOUYIN_STATUS_MAP: Record<string, { order: UnifiedOrderStatus; pay: UnifiedPaymentStatus; label: string }> = {
  '1': { order: 'pending', pay: 'unpaid', label: '待支付' },
  '2': { order: 'confirmed', pay: 'paid', label: '已支付' },
  '3': { order: 'processing', pay: 'paid', label: '待发货' },
  '4': { order: 'processing', pay: 'paid', label: '部分发货' },
  '5': { order: 'shipped', pay: 'paid', label: '已发货' },
  '6': { order: 'cancelled', pay: 'cancelled', label: '已取消' },
  '7': { order: 'completed', pay: 'paid', label: '已完成' },
};

/** 抖店订单类型 order_type */
const DOUYIN_ORDER_TYPE: Record<string, string> = {
  '0': '普通订单',
  '2': '定金预售',
  '4': '全款预售',
  '5': '小时达',
  '6': '智能定价',
};

/** 抖店流量来源 origin_type */
const DOUYIN_ORIGIN_TYPE: Record<string, string> = {
  '1': '直播间',
  '2': '短视频',
  '3': '商品橱窗',
  '4': '店铺自然流量',
  '5': '搜索',
};

export class DouyinAdapter extends BaseAdapter {
  readonly platform: PlatformCode = 'douyin';
  readonly displayName = '抖音电商（抖店）';
  readonly capabilities: ResourceType[] = ['orders', 'products', 'inventory', 'logistics'];
  readonly gateway = 'https://openapi-fxg.jinritemai.com';
  protected readonly orderNoPrefix = 'DY';

  /** 抖店走 OAuth，三件套齐全才能发起 live 调用 */
  protected hasLiveCredentials(): boolean {
    const c = this.creds;
    return !!(c.appKey && c.appSecret && c.accessToken);
  }

  /**
   * 构造抖店请求 URL 与请求体。
   * 抖店的签名参数固定为 app_key/method/param_json/timestamp/v，
   * 其中 param_json 必须是 key 递归升序的紧凑 JSON，否则验签必败。
   */
  private buildRequest(method: string, bizParams: Record<string, unknown>): { url: string; body: string; headers: Record<string, string> } {
    const appKey = String(this.creds.appKey || '');
    const appSecret = String(this.creds.appSecret || '');
    const timestamp = formatCnTimestamp();
    const paramJson = stableJsonStringify(bizParams);
    const v = '2';
    const sign = doudianSign({ app_key: appKey, method, param_json: paramJson, timestamp, v }, appSecret);

    // 抖店 method 形如 order.searchList，URL 路径是把 . 换成 /
    const path = `/${method.split('.').join('/')}`;
    const query = new URLSearchParams({
      app_key: appKey,
      method,
      param_json: paramJson,
      timestamp,
      v,
      sign,
      sign_method: 'md5',
      access_token: String(this.creds.accessToken || ''),
    }).toString();

    return {
      url: `${this.gateway}${path}?${query}`,
      body: paramJson,
      headers: { 'Content-Type': 'application/json' },
    };
  }

  async testConnection(): Promise<ConnectionTestResult> {
    if (this.isSandbox) {
      return this.sandboxTestResult(
        this.hasLiveCredentials() ? '连接被手动设为沙箱' : '未配置 app_key / app_secret / access_token'
      );
    }

    // live 路径：调用最轻量的店铺详情接口验证 access_token 有效性
    const { url, body, headers } = this.buildRequest('shop.getShopDetail', {});
    const res = await this.http<{ code: number; message: string; data?: { shop_name?: string; shop_id?: number } }>(url, {
      method: 'POST',
      headers,
      body,
    });

    // 抖店业务错误码在 body.code 里，HTTP 200 不代表成功
    const code = Number(res.data?.code ?? -1);
    if (!res.ok || code !== 10000) {
      const msg = res.data?.message || res.error || '未知错误';
      const tokenExpired = code === 20000 || /token/i.test(msg);
      return {
        success: false,
        status: tokenExpired ? 'expired' : 'error',
        message: `抖店连接失败（code=${code}）：${msg}`,
        endpoint: 'POST /shop/getShopDetail',
        mode: 'live',
        sandbox: false,
      };
    }

    return {
      success: true,
      status: 'connected',
      message: '抖店连接正常',
      endpoint: 'POST /shop/getShopDetail',
      mode: 'live',
      shopName: res.data?.data?.shop_name || this.ctx.shopName,
      sandbox: false,
    };
  }

  async fetchOrders(options: FetchOptions = {}): Promise<FetchResult<NormalizedOrder>> {
    if (this.isSandbox) {
      const page = Number(options.cursor || 0) || 0;
      const raws = this.buildSandboxRawOrders(page, Math.min(options.pageSize || 20, 50), options.since);
      const hasMore = page < 1; // 沙箱固定两页，用于验证游标续传链路
      return {
        items: raws.map((r) => this.normalizeOrder(r)),
        nextCursor: hasMore ? String(page + 1) : null,
        hasMore,
        sandbox: true,
        totalHint: raws.length * 2,
      };
    }

    this.requireLive('POST /order/searchList');
    const page = Number(options.cursor || 0) || 0;
    const size = Math.min(options.pageSize || 50, 100);
    const { url, body, headers } = this.buildRequest('order.searchList', {
      page,
      size,
      create_time_start: options.since ? Math.floor(new Date(options.since).getTime() / 1000) : undefined,
      create_time_end: options.until ? Math.floor(new Date(options.until).getTime() / 1000) : undefined,
      order_by: 'create_time',
      order_asc: false,
    });

    const res = await this.http<{ code: number; message: string; data?: { total?: number; shop_order_list?: Array<Record<string, unknown>> } }>(
      url,
      { method: 'POST', headers, body }
    );
    if (!res.ok || Number(res.data?.code ?? -1) !== 10000) {
      throw new AdapterError(`抖店订单拉取失败：${res.data?.message || res.error}`, 'POST /order/searchList', res.status);
    }

    const list = res.data?.data?.shop_order_list || [];
    const total = Number(res.data?.data?.total || 0);
    const hasMore = (page + 1) * size < total;
    return {
      items: list.map((r) => this.normalizeOrder(r)),
      nextCursor: hasMore ? String(page + 1) : null,
      hasMore,
      sandbox: false,
      totalHint: total,
    };
  }

  async fetchProducts(options: FetchOptions = {}): Promise<FetchResult<NormalizedProduct>> {
    if (this.isSandbox) {
      const rand = mulberry32(seedFrom(`${this.ctx.connectionId}|douyin|products`));
      const items: NormalizedProduct[] = SANDBOX_GOODS.map((g, idx) => ({
        platform: this.platform,
        platformProductId: digits(rand, 13), // 抖店 product_id 是纯数字
        sku: g.sku,
        title: g.title,
        category: g.category,
        brand: '演练品牌',
        price: toAmount(g.price),
        costPrice: toAmount(g.price * 0.55),
        stock: 20 + Math.floor(rand() * 200),
        // 抖店 status：0 上架 / 1 下架
        status: idx % 7 === 0 ? 'off_sale' : 'on_sale',
        _sandbox: true,
      }));
      return { items, nextCursor: null, hasMore: false, sandbox: true, totalHint: items.length };
    }

    this.requireLive('POST /product/list');
    const page = Number(options.cursor || 0) || 0;
    const { url, body, headers } = this.buildRequest('product.list', {
      page,
      size: Math.min(options.pageSize || 50, 100),
      status: 0,
    });
    const res = await this.http<{ code: number; message: string; data?: { total?: number; data?: Array<Record<string, unknown>> } }>(
      url,
      { method: 'POST', headers, body }
    );
    if (!res.ok || Number(res.data?.code ?? -1) !== 10000) {
      throw new AdapterError(`抖店商品拉取失败：${res.data?.message || res.error}`, 'POST /product/list', res.status);
    }

    const list = res.data?.data?.data || [];
    const total = Number(res.data?.data?.total || 0);
    const size = Math.min(options.pageSize || 50, 100);
    const hasMore = (page + 1) * size < total;
    return {
      items: list.map((p) => this.normalizeProduct(p)),
      nextCursor: hasMore ? String(page + 1) : null,
      hasMore,
      sandbox: false,
      totalHint: total,
    };
  }

  async fetchInventory(options: FetchOptions = {}): Promise<FetchResult<NormalizedInventory>> {
    if (this.isSandbox) return this.buildSandboxInventory(options);
    // 抖店没有独立的库存查询接口，库存随 product/list 的 sku 一并返回
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
      totalHint: products.totalHint,
    };
  }

  async pushInventory(items: InventoryPushItem[]): Promise<PushResult> {
    if (this.isSandbox) return this.buildSandboxPushResult(items);
    this.requireLive('POST /sku/syncStock');

    // 抖店库存回写是「单 SKU 一次调用」，需逐条提交并汇总结果
    const failures: Array<{ sku: string; reason: string }> = [];
    let successCount = 0;
    for (const item of items) {
      if (!item.platformSkuId) {
        failures.push({ sku: item.sku, reason: '缺少抖店 sku_id，无法回写' });
        continue;
      }
      try {
        const { url, body, headers } = this.buildRequest('sku.syncStock', {
          sku_id: item.platformSkuId,
          num: Math.max(0, Math.floor(item.quantity)),
          idempotent_id: `${this.ctx.connectionId}-${item.sku}-${Date.now()}`,
        });
        const res = await this.http<{ code: number; message: string }>(url, { method: 'POST', headers, body });
        if (res.ok && Number(res.data?.code ?? -1) === 10000) successCount += 1;
        else failures.push({ sku: item.sku, reason: res.data?.message || res.error || '平台返回失败' });
      } catch (e) {
        failures.push({ sku: item.sku, reason: e instanceof Error ? e.message : String(e) });
      }
    }

    return {
      success: failures.length === 0,
      successCount,
      failedCount: failures.length,
      message: `抖店库存回写完成：成功 ${successCount} 条，失败 ${failures.length} 条`,
      failures,
      sandbox: false,
    };
  }

  /**
   * 抖店订单 → Vorzai 统一订单。
   * 关键差异处理：
   *  - 金额字段全是「分」，统一 fenToYuan
   *  - 主子单：shop_order 下挂 sku_order_list，子单才有商品信息
   *  - 达人佣金与流量来源写入 remark，供后续人效归因与直播复盘使用
   */
  normalizeOrder(raw: Record<string, unknown>): NormalizedOrder {
    const orderId = String(raw.order_id ?? raw.shop_order_id ?? '');
    const statusCode = String(raw.order_status ?? '1');
    const mapped = DOUYIN_STATUS_MAP[statusCode] || { order: 'pending' as UnifiedOrderStatus, pay: 'unpaid' as UnifiedPaymentStatus, label: `未知(${statusCode})` };
    const sandbox = raw._sandbox === true;

    const skuList = Array.isArray(raw.sku_order_list) ? (raw.sku_order_list as Array<Record<string, unknown>>) : [];
    const items: NormalizedOrderItem[] = skuList.map((s) => ({
      platformProductId: String(s.product_id ?? ''),
      platformSkuId: String(s.sku_id ?? ''),
      outerSku: s.code ? String(s.code) : undefined, // 抖店的商家编码字段叫 code
      title: String(s.product_name ?? ''),
      specs: s.spec ? String(s.spec) : undefined,
      quantity: Number(s.item_num ?? 1),
      unitPrice: fenToYuan(s.origin_amount ? Number(s.origin_amount) / Number(s.item_num ?? 1) : s.sku_pay_amount),
      itemAmount: fenToYuan(s.pay_amount ?? s.sku_pay_amount ?? 0),
      discount: fenToYuan(s.promotion_amount ?? 0),
      imageUrl: s.product_pic ? String(s.product_pic) : undefined,
    }));

    const subtotal = fenToYuan(raw.origin_amount ?? 0) || toAmount(items.reduce((s, i) => s + i.itemAmount, 0));
    const payAmount = fenToYuan(raw.pay_amount ?? 0);
    const isPaid = mapped.pay === 'paid';

    // 抖音独有：达人分销与流量来源，做成人可读的备注，运营与归因都要用
    const remarkParts: string[] = [];
    const orderType = String(raw.order_type ?? '0');
    if (DOUYIN_ORDER_TYPE[orderType] && orderType !== '0') {
      remarkParts.push(`订单类型:${DOUYIN_ORDER_TYPE[orderType]}`);
    }
    if (orderType === '5') remarkParts.push('小时达履约（2 小时内必须发货）');
    const originType = String(raw.origin_type ?? '');
    if (DOUYIN_ORIGIN_TYPE[originType]) remarkParts.push(`来源:${DOUYIN_ORIGIN_TYPE[originType]}`);
    if (raw.room_id) remarkParts.push(`直播间:${String(raw.room_id)}`);
    if (raw.author_name) {
      const rate = Number(raw.commission_rate || 0) / 100; // 抖店佣金率是万分比
      const commission = fenToYuan(raw.estimated_commission ?? 0);
      remarkParts.push(`达人:${String(raw.author_name)}(佣金率${rate}% / 预估佣金¥${commission})`);
    }
    if (raw.buyer_words) remarkParts.push(`买家留言:${String(raw.buyer_words)}`);
    if (sandbox) remarkParts.unshift('沙箱数据，非真实平台数据');

    const logistics = Array.isArray(raw.logistics_info) ? (raw.logistics_info as Array<Record<string, unknown>>) : [];
    const firstLogistics = logistics[0] || {};

    return {
      platform: 'douyin',
      platformOrderId: orderId,
      orderNo: `DY-${orderId}`,
      createdAt: toIso(raw.create_time) || new Date().toISOString(),
      paidAt: isPaid ? toIso(raw.pay_time) : null,
      orderStatus: mapped.order,
      paymentStatus: mapped.pay,
      rawStatus: `${statusCode}(${mapped.label})`,
      buyerNick: raw.post_receiver ? maskName(String(raw.post_receiver)) : maskName(String(raw.buyer_nick ?? '')),
      receiverName: maskName(String(raw.post_receiver ?? '')),
      receiverPhone: maskPhone(String(raw.post_tel ?? '')),
      buyerEmail: null,
      shippingAddress: maskAddress(String(raw.post_addr ?? '')),
      items,
      subtotal: toAmount(subtotal),
      discount: fenToYuan(raw.promotion_amount ?? 0),
      platformSubsidy: fenToYuan(raw.promotion_platform_amount ?? 0),
      shippingFee: fenToYuan(raw.post_amount ?? 0),
      tax: 0,
      totalAmount: toAmount(payAmount || subtotal),
      paidAmount: isPaid ? payAmount : 0,
      currency: 'CNY',
      paymentMethod: isPaid ? String(raw.pay_type ?? '抖音支付') : null,
      shippingNo: firstLogistics.tracking_no ? String(firstLogistics.tracking_no) : null,
      shippingCompany: firstLogistics.company_name ? String(firstLogistics.company_name) : null,
      shippedAt: toIso(raw.ship_time),
      remark: remarkParts.length ? remarkParts.join(' | ') : null,
      _sandbox: sandbox,
    };
  }

  /** 抖店商品 → Vorzai 统一商品 */
  private normalizeProduct(raw: Record<string, unknown>): NormalizedProduct {
    const skus = Array.isArray(raw.specs) ? (raw.specs as Array<Record<string, unknown>>) : [];
    const stock = skus.length
      ? skus.reduce((s, k) => s + Number(k.stock_num || 0), 0)
      : Number(raw.quantity ?? 0);
    return {
      platform: 'douyin',
      platformProductId: String(raw.product_id ?? ''),
      sku: String(raw.outer_product_id || raw.product_id || ''),
      title: String(raw.name ?? raw.product_name ?? ''),
      category: raw.category_name ? String(raw.category_name) : undefined,
      brand: raw.brand_name ? String(raw.brand_name) : undefined,
      price: fenToYuan(raw.discount_price ?? raw.market_price ?? 0),
      stock,
      // 抖店 status：0 上架 / 1 下架 / 其它为异常态
      status: Number(raw.status ?? 0) === 0 ? (stock > 0 ? 'on_sale' : 'sold_out') : 'off_sale',
      imageUrl: Array.isArray(raw.pic) && raw.pic.length ? String((raw.pic as unknown[])[0]) : undefined,
      _sandbox: raw._sandbox === true,
    };
  }

  /**
   * 生成**抖店原始结构**的沙箱订单，再交给真实的 normalizeOrder 处理。
   * 这样沙箱不仅产出数据，还顺带验证了归一化映射本身的正确性。
   */
  private buildSandboxRawOrders(page: number, size: number, since?: string): Array<Record<string, unknown>> {
    const rand = mulberry32(seedFrom(`${this.ctx.connectionId}|douyin|orders|${page}`));
    const sinceMs = since ? new Date(since).getTime() : Date.now() - 7 * 86400000;
    const spanMs = Math.max(Date.now() - sinceMs, 3600 * 1000);
    const authors = ['演练达人-小柚', '演练达人-阿橙', '演练达人-momo', ''];
    const out: Array<Record<string, unknown>> = [];

    for (let i = 0; i < size; i++) {
      // 抖店订单号：19 位纯数字，以 49 开头
      const orderId = `49${digits(rand, 17)}`;
      const createSec = Math.floor((sinceMs + Math.floor(rand() * spanMs)) / 1000);
      const statusCode = pick(rand, ['1', '2', '3', '4', '5', '6', '7']);
      const orderType = pick(rand, ['0', '0', '0', '2', '4', '5']);
      const originType = pick(rand, ['1', '1', '2', '3', '4', '5']);
      const author = pick(rand, authors);
      const shipped = statusCode === '5' || statusCode === '7';
      const paid = statusCode !== '1' && statusCode !== '6';

      const lineCount = 1 + Math.floor(rand() * 2);
      const skuOrders: Array<Record<string, unknown>> = [];
      let originFen = 0;
      for (let j = 0; j < lineCount; j++) {
        const g = pick(rand, SANDBOX_GOODS);
        const qty = 1 + Math.floor(rand() * 3);
        const lineFen = Math.round(g.price * 100) * qty;
        originFen += lineFen;
        skuOrders.push({
          order_id: `${orderId}${j}`,
          product_id: digits(rand, 13),
          sku_id: digits(rand, 14),
          code: g.sku,
          product_name: g.title,
          spec: '演练规格/均码',
          item_num: qty,
          origin_amount: lineFen,
          pay_amount: lineFen,
          sku_pay_amount: lineFen,
          promotion_amount: 0,
        });
      }

      const promotionFen = Math.round(originFen * rand() * 0.1);
      const platformFen = Math.round(originFen * rand() * 0.05);
      const postFen = rand() > 0.6 ? Math.round((6 + rand() * 6) * 100) : 0;
      const payFen = Math.max(0, originFen - promotionFen - platformFen + postFen);
      const surname = pick(rand, SANDBOX_SURNAMES);
      const region = pick(rand, SANDBOX_REGIONS);

      out.push({
        order_id: orderId,
        shop_order_id: orderId,
        order_status: statusCode,
        order_type: orderType,
        origin_type: originType,
        room_id: originType === '1' ? digits(rand, 16) : undefined,
        author_name: author || undefined,
        author_id: author ? digits(rand, 12) : undefined,
        commission_rate: author ? 500 + Math.floor(rand() * 1500) : undefined, // 万分比：5%~20%
        estimated_commission: author ? Math.round(payFen * 0.1) : undefined,
        create_time: createSec,
        pay_time: paid ? createSec + 60 : undefined,
        ship_time: shipped ? createSec + 3600 : undefined,
        origin_amount: originFen,
        pay_amount: payFen,
        promotion_amount: promotionFen,
        promotion_platform_amount: platformFen,
        post_amount: postFen,
        pay_type: paid ? '抖音支付' : undefined,
        post_receiver: `${surname}${pick(rand, ['小明', '小红', '大伟', '欣怡'])}`,
        post_tel: `13${digits(rand, 9)}`,
        post_addr: `${region}演练路 ${1 + Math.floor(rand() * 99)} 号`,
        buyer_words: rand() > 0.7 ? '演练留言：麻烦尽快发货' : undefined,
        sku_order_list: skuOrders,
        logistics_info: shipped
          ? [{ tracking_no: `SBX${digits(rand, 12)}`, company_name: '演练快递' }]
          : [],
        _sandbox: true,
      });
    }
    return out;
  }
}
