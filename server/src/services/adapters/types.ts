/**
 * 多平台对接适配层 — 统一类型契约
 *
 * 设计原则：
 *  1. 适配层只负责「取数 + 归一化」，不直接写库；落库统一由 platformService 完成。
 *  2. 每个适配器都持有 mode：
 *     - live    ：有完整凭据，走平台真实 API（真实端点 / 真实签名算法已实现）
 *     - sandbox ：无凭据或用户主动选择，返回结构完全一致的本地演练数据。
 *       沙箱数据 **必须** 带 `_sandbox: true` 标记，并逐级向上透传到前端，
 *       前端必须显著提示「沙箱数据，非真实平台数据」。绝不允许伪装成真实数据。
 *  3. normalizeOrder 是本层的核心资产：把各平台差异极大的订单结构，
 *     映射成 Vorzai 统一订单模型（金额单位统一为「元」，时间统一为 ISO 字符串）。
 */

// ────────────────── 基础枚举 ──────────────────

/** 平台代码，与 schema.sql 中 platform_connections.platform 的 CHECK 约束保持一致 */
export type PlatformCode =
  | 'douyin'    // 抖音电商（抖店）
  | 'amazon'    // 亚马逊 SP-API
  | 'taobao'    // 淘宝/天猫 TOP
  | 'jd'        // 京东开放平台
  | 'kuaishou'  // 快手小店
  | 'shopify'   // Shopify Admin API
  | 'pdd'       // 拼多多开放平台
  | 'shopee'    // 虾皮（规划中）
  | 'tiktok';   // TikTok Shop（规划中）

/** 适配器运行模式 */
export type AdapterMode = 'live' | 'sandbox';

/** 可同步的资源类型，与 platform_sync_jobs.resource 的 CHECK 约束一致 */
export type ResourceType = 'orders' | 'products' | 'inventory' | 'finance' | 'reviews' | 'logistics';

/** 连接状态，与 platform_connections.status 的 CHECK 约束一致 */
export type ConnectionStatus = 'disconnected' | 'connected' | 'expired' | 'error' | 'sandbox';

/** 授权方式 */
export type AuthMode = 'oauth' | 'apikey' | 'manual';

/** Vorzai 统一订单状态（对齐 orders.order_status 的 CHECK 约束） */
export type UnifiedOrderStatus =
  | 'pending' | 'confirmed' | 'processing' | 'shipped'
  | 'delivered' | 'completed' | 'cancelled' | 'returned' | 'refunded';

/** Vorzai 统一支付状态（对齐 orders.payment_status 的 CHECK 约束） */
export type UnifiedPaymentStatus = 'unpaid' | 'partial' | 'paid' | 'refunded' | 'cancelled';

// ────────────────── 凭据与上下文 ──────────────────

/**
 * 适配器运行所需凭据。
 * 明文仅存在于内存，落库前一律经 crypto.ts 的 AES-256-GCM 加密。
 */
export interface AdapterCredentials {
  appKey?: string;
  appSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  /** 店铺 ID / Seller ID / myshopify 域名等平台侧标识 */
  shopId?: string;
  /** 站点/区域：Amazon 的 na|eu|fe，Shopify 的 store domain 区域等 */
  region?: string;
  /** 平台特有的附加字段（如 Amazon 的 marketplaceId、Shopify 的 apiVersion） */
  extra?: Record<string, string>;
}

/** 适配器构造上下文 */
export interface AdapterContext {
  connectionId: string;
  tenantId: string;
  platform: PlatformCode;
  mode: AdapterMode;
  credentials: AdapterCredentials;
  shopName?: string;
  region?: string;
}

// ────────────────── 归一化数据模型 ──────────────────

/** 归一化后的订单商品明细 */
export interface NormalizedOrderItem {
  /** 平台侧商品 ID */
  platformProductId: string;
  /** 平台侧 SKU ID */
  platformSkuId?: string;
  /** 商家自定义编码（outer_id / SellerSKU / code），落库时用于匹配本地 products.sku */
  outerSku?: string;
  title: string;
  /** 规格描述 */
  specs?: string;
  quantity: number;
  /** 单价（元） */
  unitPrice: number;
  /** 该行实付（元） */
  itemAmount: number;
  /** 该行优惠（元） */
  discount?: number;
  imageUrl?: string;
}

/** 归一化后的订单 */
export interface NormalizedOrder {
  platform: PlatformCode;
  /** 平台订单号（唯一去重键） */
  platformOrderId: string;
  /** Vorzai 侧订单号，形如 DY-4900123456789 */
  orderNo: string;
  /** 下单时间（ISO 8601） */
  createdAt: string;
  /** 支付时间（ISO 8601，未支付为 null） */
  paidAt: string | null;
  orderStatus: UnifiedOrderStatus;
  paymentStatus: UnifiedPaymentStatus;
  /** 平台原始状态值，保留用于排查映射问题 */
  rawStatus: string;

  /** 买家昵称（已脱敏） */
  buyerNick: string | null;
  /** 收件人姓名（已脱敏，如「张*」） */
  receiverName: string | null;
  /** 收件人手机（已脱敏，如 138****1234） */
  receiverPhone: string | null;
  /** 买家邮箱（已脱敏） */
  buyerEmail: string | null;
  /** 收货地址（省市区已保留，详细门牌已截断脱敏） */
  shippingAddress: string | null;

  items: NormalizedOrderItem[];

  /** 商品小计（元） */
  subtotal: number;
  /** 优惠合计（元，含商家优惠券） */
  discount: number;
  /** 平台补贴（元，如抖音的平台券、拼多多的平台优惠） */
  platformSubsidy: number;
  /** 运费（元） */
  shippingFee: number;
  /** 税费（元，跨境场景） */
  tax: number;
  /** 订单总额（元） */
  totalAmount: number;
  /** 实付金额（元） */
  paidAmount: number;
  /** 币种，默认 CNY */
  currency: string;
  paymentMethod: string | null;

  /** 物流单号 */
  shippingNo: string | null;
  /** 物流公司 */
  shippingCompany: string | null;
  shippedAt: string | null;
  remark: string | null;

  /** 沙箱标记：true 表示这是本地演练数据，绝非真实平台数据 */
  _sandbox: boolean;
}

/** 归一化后的商品 */
export interface NormalizedProduct {
  platform: PlatformCode;
  platformProductId: string;
  sku: string;
  title: string;
  category?: string;
  brand?: string;
  /** 售价（元） */
  price: number;
  /** 成本价（元，多数平台不返回，为空） */
  costPrice?: number;
  stock: number;
  status: 'on_sale' | 'off_sale' | 'sold_out';
  imageUrl?: string;
  _sandbox: boolean;
}

/** 归一化后的库存 */
export interface NormalizedInventory {
  platform: PlatformCode;
  platformProductId: string;
  platformSkuId?: string;
  sku: string;
  /** 可售库存 */
  available: number;
  /** 锁定/占用库存 */
  reserved?: number;
  warehouseCode?: string;
  updatedAt: string;
  _sandbox: boolean;
}

// ────────────────── 调用结果 ──────────────────

/** 分页拉取结果 */
export interface FetchResult<T> {
  items: T[];
  /** 下一页游标；null 表示已到末页 */
  nextCursor: string | null;
  hasMore: boolean;
  /** 本次结果是否来自沙箱 */
  sandbox: boolean;
  /** 平台返回的原始总数（部分平台不返回） */
  totalHint?: number;
}

/** 连接测试结果 */
export interface ConnectionTestResult {
  success: boolean;
  /** 测试后应写入的连接状态 */
  status: ConnectionStatus;
  message: string;
  /** 本次测试实际调用的平台端点（sandbox 模式下为「未发起真实请求」） */
  endpoint: string;
  mode: AdapterMode;
  /** 探测到的店铺名/卖家名 */
  shopName?: string;
  /** 令牌过期时间 */
  tokenExpiresAt?: string;
  sandbox: boolean;
}

/** 推送类操作结果 */
export interface PushResult {
  success: boolean;
  successCount: number;
  failedCount: number;
  message: string;
  failures: Array<{ sku: string; reason: string }>;
  sandbox: boolean;
}

/** 库存推送入参 */
export interface InventoryPushItem {
  platformProductId?: string;
  platformSkuId?: string;
  sku: string;
  quantity: number;
}

/** 拉取选项 */
export interface FetchOptions {
  /** 起始时间（ISO 8601） */
  since?: string;
  /** 截止时间（ISO 8601） */
  until?: string;
  /** 分页游标 */
  cursor?: string | null;
  /** 单页条数 */
  pageSize?: number;
}

// ────────────────── 适配器接口 ──────────────────

/**
 * 平台适配器统一接口。
 * 新增平台只需实现本接口并在 adapters/index.ts 注册，上层服务零改动。
 */
export interface PlatformAdapter {
  readonly platform: PlatformCode;
  readonly displayName: string;
  readonly mode: AdapterMode;
  /** 该适配器已实现的资源能力 */
  readonly capabilities: ResourceType[];
  /** 该平台 API 网关根地址（真实地址，便于排查与审计） */
  readonly gateway: string;

  /** 测试连接：live 模式调用平台最轻量的鉴权型接口；sandbox 模式返回沙箱状态 */
  testConnection(): Promise<ConnectionTestResult>;

  /** 拉取订单（已归一化） */
  fetchOrders(options?: FetchOptions): Promise<FetchResult<NormalizedOrder>>;

  /** 拉取商品（已归一化） */
  fetchProducts(options?: FetchOptions): Promise<FetchResult<NormalizedProduct>>;

  /** 拉取库存（已归一化） */
  fetchInventory(options?: FetchOptions): Promise<FetchResult<NormalizedInventory>>;

  /** 回写库存到平台 */
  pushInventory(items: InventoryPushItem[]): Promise<PushResult>;

  /** 把平台原始订单对象映射为 Vorzai 统一订单模型 */
  normalizeOrder(raw: Record<string, unknown>): NormalizedOrder;
}

// ────────────────── 平台目录（前端动态渲染凭据表单用） ──────────────────

/** 凭据字段描述，前端据此动态渲染接入表单 */
export interface CredentialFieldSpec {
  key: keyof AdapterCredentials | string;
  label: string;
  /** text=普通文本，secret=密文（前端 type=password，响应脱敏） */
  type: 'text' | 'secret' | 'select';
  required: boolean;
  placeholder?: string;
  /** type=select 时的候选项 */
  options?: Array<{ value: string; label: string }>;
  /** 字段说明，告诉用户去平台哪里拿这个值 */
  hint?: string;
}

/** 平台目录条目 */
export interface PlatformCatalogEntry {
  platform: PlatformCode;
  displayName: string;
  /** 是否已实现适配器；false 表示规划中 */
  supported: boolean;
  authMode: AuthMode;
  gateway: string;
  /** 官方开放平台文档入口，便于用户自助申请凭据 */
  docUrl: string;
  capabilities: ResourceType[];
  credentialFields: CredentialFieldSpec[];
  /** 签名算法说明，用于在 UI 上展示「我们真实实现了什么」 */
  signatureAlgorithm: string;
  /** 主要端点清单（真实路径） */
  endpoints: Record<string, string>;
  /** 是否支持沙箱演练 */
  sandboxSupported: boolean;
  notes?: string;
}
