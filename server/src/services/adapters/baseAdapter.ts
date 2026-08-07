/**
 * 适配器基类：承载所有平台共用的能力
 *  - HTTP 调用封装（超时、JSON 解析、错误归一化）
 *  - live / sandbox 模式判定
 *  - 沙箱数据生成（确定性伪随机，同一连接每次生成结果一致，便于回归验证）
 *  - 金额 / 时间 / 状态映射的公共工具
 *
 * 沙箱纪律（硬约束）：
 *  沙箱产出的任何一条数据都会被打上 `_sandbox: true`，
 *  并在 FetchResult.sandbox、ConnectionTestResult.sandbox 上再标一次，
 *  最终由 platformService 写入 sync_logs 并透传到前端横幅提示。
 *  任何时候都不允许把沙箱数据描述为真实平台数据。
 */
import crypto from 'crypto';
import {
  AdapterContext,
  AdapterCredentials,
  AdapterMode,
  ConnectionTestResult,
  FetchOptions,
  FetchResult,
  InventoryPushItem,
  NormalizedInventory,
  NormalizedOrder,
  NormalizedOrderItem,
  NormalizedProduct,
  PlatformAdapter,
  PlatformCode,
  PushResult,
  ResourceType,
  UnifiedOrderStatus,
  UnifiedPaymentStatus,
} from './types';

// ────────────────── HTTP 封装 ──────────────────

/** 最小化的 fetch 类型，避免依赖 DOM lib */
type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  headers: { get(name: string): string | null };
}>;

const runtimeFetch: FetchLike | undefined = (globalThis as unknown as { fetch?: FetchLike }).fetch;

export interface HttpResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  rawText: string;
  /** Link 响应头，Shopify 游标分页需要 */
  linkHeader: string | null;
  error?: string;
}

/** 平台调用异常：带上端点信息，便于写入 sync_logs 定位 */
export class AdapterError extends Error {
  readonly endpoint: string;
  readonly status?: number;
  constructor(message: string, endpoint: string, status?: number) {
    super(message);
    this.name = 'AdapterError';
    this.endpoint = endpoint;
    this.status = status;
  }
}

// ────────────────── 通用工具 ──────────────────

/** 分 → 元 */
export function fenToYuan(fen: unknown): number {
  const n = Number(fen || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n) / 100;
}

/** 任意数值安全转 number，保留两位小数 */
export function toAmount(value: unknown): number {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/** 秒/毫秒时间戳或字符串 → ISO 8601 */
export function toIso(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    const n = Number(value);
    // 10 位按秒，13 位按毫秒
    const ms = String(n).length <= 10 ? n * 1000 : n;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** 确定性伪随机（mulberry32）：同一 seed 永远产出同一序列 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFrom(text: string): number {
  const h = crypto.createHash('md5').update(text).digest();
  return h.readUInt32BE(0);
}

/** 从伪随机序列里等概率取一个元素 */
export function pick<T>(rand: () => number, pool: readonly T[]): T {
  return pool[Math.floor(rand() * pool.length)];
}

/** 生成固定长度的数字串，用于伪造各平台的定长订单号 */
export function digits(rand: () => number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String(Math.floor(rand() * 10));
  return out;
}

/** 沙箱演练用的商品样本（明确标注为演练数据，不冒充任何真实商品） */
export const SANDBOX_GOODS: Array<{ title: string; sku: string; price: number; category: string }> = [
  { title: '[演练]轻透气纯棉短袖T恤', sku: 'DEMO-TS-001', price: 79, category: '服饰' },
  { title: '[演练]便携折叠保温杯 500ml', sku: 'DEMO-CUP-002', price: 49, category: '家居' },
  { title: '[演练]蓝牙降噪耳机 Pro', sku: 'DEMO-EAR-003', price: 299, category: '数码' },
  { title: '[演练]冻干猫粮 1.5kg', sku: 'DEMO-PET-004', price: 128, category: '宠物' },
  { title: '[演练]氨基酸洗面奶 120g', sku: 'DEMO-SKN-005', price: 68, category: '美妆' },
  { title: '[演练]桌面收纳置物架', sku: 'DEMO-HOM-006', price: 35, category: '家居' },
  { title: '[演练]速干运动毛巾 2 条装', sku: 'DEMO-SPT-007', price: 26, category: '运动' },
  { title: '[演练]儿童积木拼装玩具', sku: 'DEMO-TOY-008', price: 89, category: '母婴' },
];

export const SANDBOX_SURNAMES = ['张', '王', '李', '赵', '陈', '刘', '杨', '黄'];
export const SANDBOX_REGIONS = [
  '广东省深圳市南山区', '浙江省杭州市余杭区', '江苏省南京市江宁区',
  '四川省成都市武侯区', '山东省青岛市市南区', '福建省厦门市思明区',
];

// ────────────────── 抽象基类 ──────────────────

export abstract class BaseAdapter implements PlatformAdapter {
  abstract readonly platform: PlatformCode;
  abstract readonly displayName: string;
  abstract readonly capabilities: ResourceType[];
  abstract readonly gateway: string;
  /** Vorzai 订单号前缀，如 DY / TB / JD */
  protected abstract readonly orderNoPrefix: string;

  protected readonly ctx: AdapterContext;

  constructor(ctx: AdapterContext) {
    this.ctx = ctx;
  }

  get mode(): AdapterMode {
    return this.ctx.mode;
  }

  protected get creds(): AdapterCredentials {
    return this.ctx.credentials || {};
  }

  /** 是否具备发起 live 调用的最小凭据集，由各平台覆写 */
  protected abstract hasLiveCredentials(): boolean;

  /** 当前是否走沙箱：显式 sandbox 模式，或凭据不完整 */
  protected get isSandbox(): boolean {
    return this.ctx.mode === 'sandbox' || !this.hasLiveCredentials();
  }

  /** live 模式下缺凭据时的统一报错 */
  protected requireLive(endpoint: string): void {
    if (!this.hasLiveCredentials()) {
      throw new AdapterError(
        `${this.displayName} 凭据不完整，无法发起真实 API 调用。请补全凭据，或将连接切换为沙箱模式进行流程演练。`,
        endpoint
      );
    }
  }

  // ────────── HTTP ──────────

  /** 发起 HTTP 请求并解析 JSON；超时默认 20s */
  protected async http<T = unknown>(
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {}
  ): Promise<HttpResponse<T>> {
    if (!runtimeFetch) {
      throw new AdapterError('当前运行时不支持 fetch，无法发起平台 API 调用（需 Node 18+）', url);
    }

    const timeoutMs = init.timeoutMs ?? 20000;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const res = await runtimeFetch(url, {
        method: init.method || 'GET',
        headers: init.headers || {},
        body: init.body,
        signal: controller ? controller.signal : undefined,
      });
      const rawText = await res.text();
      let data: T | null = null;
      try {
        data = rawText ? (JSON.parse(rawText) as T) : null;
      } catch {
        data = null;
      }
      return {
        ok: res.ok,
        status: res.status,
        data,
        rawText,
        linkHeader: res.headers ? res.headers.get('link') : null,
        error: res.ok ? undefined : `HTTP ${res.status}: ${rawText.slice(0, 300)}`,
      };
    } catch (e) {
      const msg = String(e);
      throw new AdapterError(
        msg.includes('abort') ? `请求超时（${timeoutMs}ms）` : `网络请求失败: ${msg}`,
        url
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // ────────── 抽象业务方法 ──────────

  abstract testConnection(): Promise<ConnectionTestResult>;
  abstract fetchOrders(options?: FetchOptions): Promise<FetchResult<NormalizedOrder>>;
  abstract fetchProducts(options?: FetchOptions): Promise<FetchResult<NormalizedProduct>>;
  abstract fetchInventory(options?: FetchOptions): Promise<FetchResult<NormalizedInventory>>;
  abstract pushInventory(items: InventoryPushItem[]): Promise<PushResult>;
  abstract normalizeOrder(raw: Record<string, unknown>): NormalizedOrder;

  // ────────── 沙箱数据生成 ──────────

  /** 沙箱连接测试结果 */
  protected sandboxTestResult(reason: string): ConnectionTestResult {
    return {
      success: true,
      status: 'sandbox',
      message: `沙箱模式已就绪：${reason}。当前不会向 ${this.displayName} 发起任何真实请求，后续同步产出的均为本地演练数据。`,
      endpoint: '未发起真实请求（沙箱）',
      mode: 'sandbox',
      shopName: this.ctx.shopName || `${this.displayName}演练店铺`,
      sandbox: true,
    };
  }

  /**
   * 生成沙箱订单。
   * 采用确定性伪随机：seed = md5(connectionId + platform + 页游标)，
   * 保证同一连接反复同步得到同一批订单号，可验证「去重 upsert」逻辑是否正确。
   */
  protected buildSandboxOrders(options: FetchOptions = {}): FetchResult<NormalizedOrder> {
    const pageIndex = options.cursor ? Number(options.cursor) || 0 : 0;
    const pageSize = Math.min(options.pageSize || 20, 50);
    const rand = mulberry32(seedFrom(`${this.ctx.connectionId}|${this.platform}|orders|${pageIndex}`));

    const sinceMs = options.since ? new Date(options.since).getTime() : Date.now() - 7 * 86400000;
    const spanMs = Math.max(Date.now() - sinceMs, 3600 * 1000);

    const statusPool: Array<{ order: UnifiedOrderStatus; pay: UnifiedPaymentStatus; raw: string }> = [
      { order: 'pending', pay: 'unpaid', raw: 'SANDBOX_WAIT_PAY' },
      { order: 'processing', pay: 'paid', raw: 'SANDBOX_WAIT_SEND' },
      { order: 'shipped', pay: 'paid', raw: 'SANDBOX_SHIPPED' },
      { order: 'completed', pay: 'paid', raw: 'SANDBOX_FINISHED' },
      { order: 'cancelled', pay: 'cancelled', raw: 'SANDBOX_CLOSED' },
      { order: 'refunded', pay: 'refunded', raw: 'SANDBOX_REFUNDED' },
    ];

    const items: NormalizedOrder[] = [];
    for (let i = 0; i < pageSize; i++) {
      const seq = pageIndex * pageSize + i;
      const platformOrderId = `SBX${this.orderNoPrefix}${String(seedFrom(`${this.ctx.connectionId}${seq}`)).slice(0, 10)}`;
      const createdMs = sinceMs + Math.floor(rand() * spanMs);
      const st = statusPool[Math.floor(rand() * statusPool.length)];
      const paid = st.pay === 'paid' || st.pay === 'refunded';

      const lineCount = 1 + Math.floor(rand() * 2);
      const orderItems: NormalizedOrderItem[] = [];
      let subtotal = 0;
      for (let j = 0; j < lineCount; j++) {
        const g = SANDBOX_GOODS[Math.floor(rand() * SANDBOX_GOODS.length)];
        const qty = 1 + Math.floor(rand() * 3);
        const amount = toAmount(g.price * qty);
        subtotal += amount;
        orderItems.push({
          platformProductId: `SBX-P-${g.sku}`,
          platformSkuId: `SBX-S-${g.sku}-${j}`,
          outerSku: g.sku,
          title: g.title,
          specs: '演练规格/均码',
          quantity: qty,
          unitPrice: toAmount(g.price),
          itemAmount: amount,
          discount: 0,
        });
      }

      const discount = toAmount(subtotal * (rand() * 0.1));
      const platformSubsidy = toAmount(subtotal * (rand() * 0.05));
      const shippingFee = rand() > 0.6 ? toAmount(6 + rand() * 6) : 0;
      const totalAmount = toAmount(subtotal - discount - platformSubsidy + shippingFee);
      const surname = SANDBOX_SURNAMES[Math.floor(rand() * SANDBOX_SURNAMES.length)];
      const region = SANDBOX_REGIONS[Math.floor(rand() * SANDBOX_REGIONS.length)];
      const shipped = st.order === 'shipped' || st.order === 'completed';

      items.push({
        platform: this.platform,
        platformOrderId,
        orderNo: `${this.orderNoPrefix}-${platformOrderId}`,
        createdAt: new Date(createdMs).toISOString(),
        paidAt: paid ? new Date(createdMs + 60000).toISOString() : null,
        orderStatus: st.order,
        paymentStatus: st.pay,
        rawStatus: st.raw,
        buyerNick: `演练买家${surname}`,
        receiverName: `${surname}*`,
        receiverPhone: '138****0000',
        buyerEmail: null,
        shippingAddress: `${region}****`,
        items: orderItems,
        subtotal: toAmount(subtotal),
        discount,
        platformSubsidy,
        shippingFee,
        tax: 0,
        totalAmount,
        paidAmount: paid ? totalAmount : 0,
        currency: this.platform === 'amazon' || this.platform === 'shopify' ? 'USD' : 'CNY',
        paymentMethod: paid ? '演练支付渠道' : null,
        shippingNo: shipped ? `SBX${String(seedFrom(platformOrderId)).slice(0, 12)}` : null,
        shippingCompany: shipped ? '演练快递' : null,
        shippedAt: shipped ? new Date(createdMs + 3600000).toISOString() : null,
        remark: '沙箱演练订单，非真实平台数据',
        _sandbox: true,
      });
    }

    // 沙箱固定产出 2 页，便于验证游标分页链路
    const hasMore = pageIndex < 1;
    return {
      items,
      nextCursor: hasMore ? String(pageIndex + 1) : null,
      hasMore,
      sandbox: true,
      totalHint: pageSize * 2,
    };
  }

  /** 生成沙箱商品 */
  protected buildSandboxProducts(options: FetchOptions = {}): FetchResult<NormalizedProduct> {
    const rand = mulberry32(seedFrom(`${this.ctx.connectionId}|${this.platform}|products`));
    const items: NormalizedProduct[] = SANDBOX_GOODS.map((g, idx) => ({
      platform: this.platform,
      platformProductId: `SBX-P-${g.sku}`,
      sku: g.sku,
      title: g.title,
      category: g.category,
      brand: '演练品牌',
      price: toAmount(g.price),
      costPrice: toAmount(g.price * 0.55),
      stock: 20 + Math.floor(rand() * 200),
      status: idx % 7 === 0 ? 'off_sale' : 'on_sale',
      _sandbox: true,
    }));
    void options;
    return { items, nextCursor: null, hasMore: false, sandbox: true, totalHint: items.length };
  }

  /** 生成沙箱库存 */
  protected buildSandboxInventory(options: FetchOptions = {}): FetchResult<NormalizedInventory> {
    const rand = mulberry32(seedFrom(`${this.ctx.connectionId}|${this.platform}|inventory`));
    const now = new Date().toISOString();
    const items: NormalizedInventory[] = SANDBOX_GOODS.map((g) => ({
      platform: this.platform,
      platformProductId: `SBX-P-${g.sku}`,
      platformSkuId: `SBX-S-${g.sku}-0`,
      sku: g.sku,
      available: 10 + Math.floor(rand() * 150),
      reserved: Math.floor(rand() * 10),
      warehouseCode: 'SBX-WH-01',
      updatedAt: now,
      _sandbox: true,
    }));
    void options;
    return { items, nextCursor: null, hasMore: false, sandbox: true, totalHint: items.length };
  }

  /** 沙箱库存回写结果 */
  protected buildSandboxPushResult(items: InventoryPushItem[]): PushResult {
    return {
      success: true,
      successCount: items.length,
      failedCount: 0,
      message: `沙箱模式已受理 ${items.length} 条库存变更，未向 ${this.displayName} 发起真实写入`,
      failures: [],
      sandbox: true,
    };
  }
}
