/**
 * 适配器注册表 / 工厂
 *
 * 上层（platformService）永远只依赖 PlatformAdapter 接口 + createAdapter 工厂，
 * 新增一个平台 = 新增一个 xxxAdapter.ts + 在 ADAPTER_REGISTRY / PLATFORM_CATALOG 各加一行，
 * 服务层与路由层零改动。
 *
 * PLATFORM_CATALOG 同时是前端接入表单的数据源：
 * 前端根据 credentialFields 动态渲染输入框，根据 capabilities 决定能同步哪些资源，
 * 根据 signatureAlgorithm / endpoints 向用户如实展示「我们真实实现了什么」。
 */
import { AmazonAdapter } from './amazonAdapter';
import { DouyinAdapter } from './douyinAdapter';
import { JdAdapter } from './jdAdapter';
import { KuaishouAdapter } from './kuaishouAdapter';
import { PddAdapter } from './pddAdapter';
import { ShopifyAdapter } from './shopifyAdapter';
import { TaobaoAdapter } from './taobaoAdapter';
import {
  AdapterContext,
  PlatformAdapter,
  PlatformCatalogEntry,
  PlatformCode,
} from './types';

export * from './types';
export { AdapterError } from './baseAdapter';
export {
  encryptSecret, decryptSecret, maskSecret, maskPlain, hasSecret,
  maskPhone, maskName, maskEmail, maskAddress,
} from './crypto';

type AdapterCtor = new (ctx: AdapterContext) => PlatformAdapter;

/** 平台代码 → 适配器实现 */
const ADAPTER_REGISTRY: Partial<Record<PlatformCode, AdapterCtor>> = {
  douyin: DouyinAdapter,
  taobao: TaobaoAdapter,
  jd: JdAdapter,
  pdd: PddAdapter,
  kuaishou: KuaishouAdapter,
  amazon: AmazonAdapter,
  shopify: ShopifyAdapter,
};

/** 该平台是否已有可用适配器 */
export function isPlatformSupported(platform: string): platform is PlatformCode {
  return Object.prototype.hasOwnProperty.call(ADAPTER_REGISTRY, platform);
}

/** 工厂：按连接上下文创建适配器实例 */
export function createAdapter(ctx: AdapterContext): PlatformAdapter {
  const Ctor = ADAPTER_REGISTRY[ctx.platform];
  if (!Ctor) {
    throw new Error(`暂不支持的平台: ${ctx.platform}。当前已实现: ${Object.keys(ADAPTER_REGISTRY).join(', ')}`);
  }
  return new Ctor(ctx);
}

// ────────────────── 平台目录 ──────────────────

const COMMON_SANDBOX_NOTE = '未填写凭据时自动进入沙箱模式，可完整演练「连接→同步→落库→统计」全链路，产出数据均标记为演练数据。';

export const PLATFORM_CATALOG: PlatformCatalogEntry[] = [
  {
    platform: 'douyin',
    displayName: '抖音电商（抖店）',
    supported: true,
    authMode: 'oauth',
    gateway: 'https://openapi-fxg.jinritemai.com',
    docUrl: 'https://op.jinritemai.com/docs/guide-docs/',
    capabilities: ['orders', 'products', 'inventory', 'logistics'],
    signatureAlgorithm: 'MD5：sign = md5(app_secret + "app_key"+ak+"method"+m+"param_json"+pj+"timestamp"+ts+"v"+v + app_secret)',
    endpoints: {
      订单列表: 'POST /order/searchList',
      订单详情: 'POST /order/orderDetail',
      商品列表: 'POST /product/list',
      SKU列表: 'POST /sku/list',
      库存同步: 'POST /sku/syncStock',
    },
    credentialFields: [
      { key: 'appKey', label: 'App Key', type: 'text', required: true, placeholder: '7xxxxxxxxxxxxxxx', hint: '抖店开放平台 → 我的应用 → 应用详情' },
      { key: 'appSecret', label: 'App Secret', type: 'secret', required: true, hint: '与 App Key 同处获取，加密存储' },
      { key: 'accessToken', label: 'Access Token', type: 'secret', required: true, hint: '店铺授权后由 token/create 换取，有效期 7 天' },
      { key: 'refreshToken', label: 'Refresh Token', type: 'secret', required: false, hint: '用于自动续期，可留空' },
      { key: 'shopId', label: '店铺 ID', type: 'text', required: false, placeholder: 'shop_id' },
    ],
    sandboxSupported: true,
    notes: `金额单位为「分」，已在归一化时统一换算为元。${COMMON_SANDBOX_NOTE}`,
  },
  {
    platform: 'taobao',
    displayName: '淘宝/天猫',
    supported: true,
    authMode: 'oauth',
    gateway: 'https://eco.taobao.com/router/rest',
    docUrl: 'https://open.taobao.com/doc.htm',
    capabilities: ['orders', 'products', 'inventory'],
    signatureAlgorithm: 'MD5：sign = md5(app_secret + k1v1k2v2... + app_secret).toUpperCase()（另支持 HMAC-MD5）',
    endpoints: {
      卖家信息: 'taobao.user.seller.get',
      订单列表: 'taobao.trades.sold.get',
      订单详情: 'taobao.trade.fullinfo.get',
      在售商品: 'taobao.items.onsale.get',
      库存更新: 'taobao.item.quantity.update',
    },
    credentialFields: [
      { key: 'appKey', label: 'AppKey', type: 'text', required: true, hint: '淘宝开放平台 → 应用管理' },
      { key: 'appSecret', label: 'AppSecret', type: 'secret', required: true },
      { key: 'accessToken', label: 'Session Key', type: 'secret', required: true, hint: '卖家授权后得到的 session（TOP 的 access_token）' },
      { key: 'shopId', label: '卖家 nick / 店铺 ID', type: 'text', required: false },
    ],
    sandboxSupported: true,
    notes: `金额单位为「元」（字符串），fields 已按最小必要原则显式声明。${COMMON_SANDBOX_NOTE}`,
  },
  {
    platform: 'jd',
    displayName: '京东',
    supported: true,
    authMode: 'oauth',
    gateway: 'https://api.jd.com/routerjson',
    docUrl: 'https://open.jd.com/home/home#/doc',
    capabilities: ['orders', 'products', 'inventory', 'logistics'],
    signatureAlgorithm: 'MD5：sign = md5(app_secret + k1v1k2v2...(含 360buy_param_json) + app_secret).toUpperCase()',
    endpoints: {
      商家信息: 'jingdong.seller.vender.info.get',
      订单列表: 'jingdong.pop.order.search',
      订单详情: 'jingdong.pop.order.get',
      商品列表: 'jingdong.ware.read.searchWare4Valid',
      库存更新: 'jingdong.sku.write.update.stock',
    },
    credentialFields: [
      { key: 'appKey', label: 'App Key', type: 'text', required: true, hint: '京东宙斯开放平台 → 我的应用' },
      { key: 'appSecret', label: 'App Secret', type: 'secret', required: true },
      { key: 'accessToken', label: 'Access Token', type: 'secret', required: true, hint: '商家授权后获取，注意区分 POP / 自营' },
      { key: 'shopId', label: '商家编号', type: 'text', required: false },
    ],
    sandboxSupported: true,
    notes: `响应体的 responce / response 两种拼写均已兼容。${COMMON_SANDBOX_NOTE}`,
  },
  {
    platform: 'pdd',
    displayName: '拼多多',
    supported: true,
    authMode: 'oauth',
    gateway: 'https://gw-api.pinduoduo.com/api/router',
    docUrl: 'https://open.pinduoduo.com/application/document/index',
    capabilities: ['orders', 'products', 'inventory', 'logistics'],
    signatureAlgorithm: 'MD5：sign = md5(client_secret + k1v1k2v2... + client_secret).toUpperCase()',
    endpoints: {
      店铺信息: 'pdd.mall.info.get',
      订单列表: 'pdd.order.list.get',
      订单详情: 'pdd.order.information.get',
      商品列表: 'pdd.goods.list.get',
      库存更新: 'pdd.goods.quantity.update',
    },
    credentialFields: [
      { key: 'appKey', label: 'Client ID', type: 'text', required: true, hint: '拼多多开放平台 → 应用管理（对应 client_id）' },
      { key: 'appSecret', label: 'Client Secret', type: 'secret', required: true },
      { key: 'accessToken', label: 'Access Token', type: 'secret', required: true },
      { key: 'shopId', label: '店铺 ID', type: 'text', required: false },
    ],
    sandboxSupported: true,
    notes: `金额单位为「分」；平台补贴（platform_discount）已单独归一化，不与商家优惠混算。${COMMON_SANDBOX_NOTE}`,
  },
  {
    platform: 'kuaishou',
    displayName: '快手小店',
    supported: true,
    authMode: 'oauth',
    gateway: 'https://openapi.kwaixiaodian.com',
    docUrl: 'https://open.kwaixiaodian.com/zone/new/docs',
    capabilities: ['orders', 'products', 'inventory', 'logistics'],
    signatureAlgorithm: 'MD5：sign = md5("k1=v1&k2=v2..." + "&signSecret=" + signSecret)（另支持 HMAC-SHA256）',
    endpoints: {
      订单游标列表: 'open.order.cursor.list → /open/order/cursor/list',
      订单详情: 'open.order.detail → /open/order/detail',
      商品列表: 'open.item.list → /open/item/list',
      库存更新: 'open.item.sku.stock.update → /open/item/sku/stock/update',
    },
    credentialFields: [
      { key: 'appKey', label: 'AppKey', type: 'text', required: true, hint: '快手开放平台 → 应用详情' },
      { key: 'appSecret', label: 'Sign Secret', type: 'secret', required: true, hint: '快手侧称 signSecret，用于签名' },
      { key: 'accessToken', label: 'Access Token', type: 'secret', required: true },
      { key: 'shopId', label: '小店 ID', type: 'text', required: false },
    ],
    sandboxSupported: true,
    notes: `采用游标分页（返回 nomore 表示到底）；金额单位为「分」。${COMMON_SANDBOX_NOTE}`,
  },
  {
    platform: 'amazon',
    displayName: 'Amazon',
    supported: true,
    authMode: 'oauth',
    gateway: 'https://sellingpartnerapi-{region}.amazon.com',
    docUrl: 'https://developer-docs.amazon.com/sp-api/',
    capabilities: ['orders', 'products', 'inventory', 'finance'],
    signatureAlgorithm: 'LWA（refresh_token 换 access_token）+ AWS Signature V4（service=execute-api，Restricted Data 场景启用）',
    endpoints: {
      LWA换令牌: 'POST https://api.amazon.com/auth/o2/token',
      订单列表: 'GET /orders/v0/orders',
      订单明细: 'GET /orders/v0/orders/{orderId}/orderItems',
      商品目录: 'GET /catalog/2022-04-01/items',
      FBA库存: 'GET /fba/inventory/v1/summaries',
      库存更新: 'PATCH /listings/2021-08-01/items/{sellerId}/{sku}',
    },
    credentialFields: [
      { key: 'appKey', label: 'LWA Client ID', type: 'text', required: true, hint: 'Seller Central → 开发者中心 → 应用凭据' },
      { key: 'appSecret', label: 'LWA Client Secret', type: 'secret', required: true },
      { key: 'refreshToken', label: 'Refresh Token', type: 'secret', required: true, hint: '卖家授权后得到，长期有效' },
      {
        key: 'region', label: '区域', type: 'select', required: true,
        options: [
          { value: 'na', label: '北美 NA（us-east-1）' },
          { value: 'eu', label: '欧洲 EU（eu-west-1）' },
          { value: 'fe', label: '远东 FE（us-west-2）' },
        ],
        hint: '决定 SP-API 网关域名与 SigV4 签名区域',
      },
      { key: 'shopId', label: 'Seller ID', type: 'text', required: false, hint: '库存回写（listings）时必填' },
    ],
    sandboxSupported: true,
    notes: `access_token 有效期 1 小时，已做内存缓存与自动续期；默认币种 USD。${COMMON_SANDBOX_NOTE}`,
  },
  {
    platform: 'shopify',
    displayName: 'Shopify',
    supported: true,
    authMode: 'apikey',
    gateway: 'https://{shop}.myshopify.com/admin/api',
    docUrl: 'https://shopify.dev/docs/api/admin-rest',
    capabilities: ['orders', 'products', 'inventory', 'logistics'],
    signatureAlgorithm: 'Header Token 鉴权（X-Shopify-Access-Token）；Webhook/OAuth 校验用 HMAC-SHA256（已实现）',
    endpoints: {
      店铺信息: 'GET /shop.json',
      订单列表: 'GET /orders.json',
      商品列表: 'GET /products.json',
      库存水位: 'GET /inventory_levels.json',
      库存写入: 'POST /inventory_levels/set.json',
    },
    credentialFields: [
      { key: 'shopId', label: '店铺域名', type: 'text', required: true, placeholder: 'my-store 或 my-store.myshopify.com' },
      { key: 'accessToken', label: 'Admin API Access Token', type: 'secret', required: true, hint: '后台 → 应用与销售渠道 → 开发应用 → API 凭据' },
      { key: 'appSecret', label: 'API Secret Key', type: 'secret', required: false, hint: '仅 Webhook / OAuth 回调校验需要' },
    ],
    sandboxSupported: true,
    notes: `分页使用 Link 响应头的 page_info 游标；金额为字符串形式的元。${COMMON_SANDBOX_NOTE}`,
  },
  // ── 以下为规划中平台：目录里如实标注 supported=false，绝不伪装已接入 ──
  {
    platform: 'shopee',
    displayName: 'Shopee 虾皮',
    supported: false,
    authMode: 'oauth',
    gateway: 'https://partner.shopeemobile.com/api/v2',
    docUrl: 'https://open.shopee.com/documents',
    capabilities: [],
    signatureAlgorithm: 'HMAC-SHA256（partner_id + path + timestamp + access_token + shop_id）— 尚未实现',
    endpoints: {},
    credentialFields: [],
    sandboxSupported: false,
    notes: '适配器尚未实现，暂不可创建连接。',
  },
  {
    platform: 'tiktok',
    displayName: 'TikTok Shop',
    supported: false,
    authMode: 'oauth',
    gateway: 'https://open-api.tiktokglobalshop.com',
    docUrl: 'https://partner.tiktokshop.com/docv2',
    capabilities: [],
    signatureAlgorithm: 'HMAC-SHA256（app_secret 包裹 path + 排序参数）— 尚未实现',
    endpoints: {},
    credentialFields: [],
    sandboxSupported: false,
    notes: '适配器尚未实现，暂不可创建连接。',
  },
];

/** 按平台代码取目录条目 */
export function getCatalogEntry(platform: string): PlatformCatalogEntry | undefined {
  return PLATFORM_CATALOG.find((e) => e.platform === platform);
}
