/**
 * 连接器模块
 * 功能：对接电商平台 API（淘宝/天猫、京东、拼多多、抖音、快手、Shopee、Lazada 等）
 * 对接第三方 HR 系统（钉钉、企业微信、飞书）
 * 对接物流/支付/ERP 系统
 */
import { moduleBus } from '@api/moduleBus';

export type ConnectorPlatform =
  | 'taobao' | 'tmall' | 'jd' | 'pdd'
  | 'douyin' | 'kuaishou' | 'xiaohongshu'
  | 'shopee' | 'lazada' | 'amazon'
  | 'dingtalk' | 'wecom' | 'feishu'
  | 'cainiao' | 'yunda' | 'zto'
  | 'email-smtp' | 'email-imap' | 'email-api';

export type ConnectorType = 'ecommerce' | 'hr' | 'logistics' | 'email';

export interface ConnectorConfig {
  platform: ConnectorPlatform;
  status: 'connected' | 'disconnected' | 'error';
  lastSync: string | null;
  scopes: string[];
}

export interface ConnectorData {
  platform: ConnectorPlatform;
  type: 'order' | 'product' | 'inventory' | 'promotion' | 'customer';
  payload: unknown;
}

// ────────── 预定义连接器注册表 ──────────

const CONNECTOR_REGISTRY: Map<ConnectorPlatform, { name: string; type: ConnectorType; scopes: string[] }> = new Map([
  ['taobao', { name: '淘宝', type: 'ecommerce', scopes: ['order', 'product', 'inventory', 'promotion'] }],
  ['tmall', { name: '天猫', type: 'ecommerce', scopes: ['order', 'product', 'inventory', 'promotion'] }],
  ['jd', { name: '京东', type: 'ecommerce', scopes: ['order', 'product', 'inventory'] }],
  ['pdd', { name: '拼多多', type: 'ecommerce', scopes: ['order', 'product', 'promotion'] }],
  ['douyin', { name: '抖音电商', type: 'ecommerce', scopes: ['order', 'product', 'promotion', 'customer'] }],
  ['kuaishou', { name: '快手电商', type: 'ecommerce', scopes: ['order', 'product'] }],
  ['xiaohongshu', { name: '小红书', type: 'ecommerce', scopes: ['product', 'promotion'] }],
  ['shopee', { name: 'Shopee', type: 'ecommerce', scopes: ['order', 'product', 'inventory'] }],
  ['lazada', { name: 'Lazada', type: 'ecommerce', scopes: ['order', 'product', 'inventory'] }],
  ['amazon', { name: 'Amazon', type: 'ecommerce', scopes: ['order', 'product', 'inventory'] }],
  ['dingtalk', { name: '钉钉', type: 'hr', scopes: ['employee', 'attendance', 'approval'] }],
  ['wecom', { name: '企业微信', type: 'hr', scopes: ['employee', 'attendance', 'approval'] }],
  ['feishu', { name: '飞书', type: 'hr', scopes: ['employee', 'attendance', 'approval'] }],
  ['cainiao', { name: '菜鸟', type: 'logistics', scopes: ['logistics', 'tracking'] }],
  ['yunda', { name: '韵达', type: 'logistics', scopes: ['logistics', 'tracking'] }],
  ['zto', { name: '中通', type: 'logistics', scopes: ['logistics', 'tracking'] }],
  ['email-smtp', { name: '邮件 SMTP', type: 'email', scopes: ['send', 'status'] }],
  ['email-imap', { name: '邮件 IMAP', type: 'email', scopes: ['receive', 'sync_inbox'] }],
  ['email-api', { name: '邮件 API', type: 'email', scopes: ['send', 'receive', 'sync'] }],
]);

// ────────── 连接器状态 ──────────

let connectors: ConnectorConfig[] = [
  { platform: 'taobao', status: 'disconnected', lastSync: null, scopes: [] },
  { platform: 'jd', status: 'disconnected', lastSync: null, scopes: [] },
  { platform: 'pdd', status: 'disconnected', lastSync: null, scopes: [] },
  { platform: 'douyin', status: 'disconnected', lastSync: null, scopes: [] },
  { platform: 'dingtalk', status: 'disconnected', lastSync: null, scopes: [] },
];

// ────────── Mock 平台数据 ──────────

const MOCK_PRODUCTS: Record<ConnectorPlatform, unknown[]> = {
  taobao: [
    { sku: 'SKU-A001', name: '纯棉T恤 黑色 M', price: 239.0, inventory: 50 },
    { sku: 'SKU-A002', name: '纯棉T恤 白色 L', price: 239.0, inventory: 32 },
  ],
  jd: [
    { sku: 'SKU-B003', name: '无线蓝牙耳机', price: 1599.0, inventory: 15 },
  ],
  pdd: [
    { sku: 'SKU-C007', name: '便携充电宝 20000mAh', price: 89.9, inventory: 165 },
  ],
  douyin: [
    { sku: 'SKU-D001', name: '冰丝防晒衣', price: 59.9, inventory: 200 },
  ],
  tmall: [],
  kuaishou: [],
  xiaohongshu: [],
  shopee: [],
  lazada: [],
  amazon: [],
  dingtalk: [],
  wecom: [],
  feishu: [],
  cainiao: [],
  yunda: [],
  zto: [],
  'email-smtp': [],
  'email-imap': [],
  'email-api': [],
};

export const connectorsModule = {
  /** 连接指定平台 */
  connect: async (platform: ConnectorPlatform, config?: Partial<ConnectorConfig>) => {
    const reg = CONNECTOR_REGISTRY.get(platform);
    if (!reg) return { platform, status: 'error' as const, error: `未知平台: ${platform}` };
    const exists = connectors.find((c) => c.platform === platform);
    if (exists) {
      exists.status = 'connected';
      exists.scopes = config?.scopes || reg.scopes;
      exists.lastSync = new Date().toISOString();
    } else {
      connectors.push({
        platform,
        status: 'connected',
        lastSync: new Date().toISOString(),
        scopes: config?.scopes || reg.scopes,
      });
    }
    moduleBus.broadcast('connector:status-change', { platform, status: 'connected' });
    moduleBus.broadcast('connector:connecting', { platform });
    return { platform, status: 'connected' as const, scopes: exists?.scopes || reg.scopes };
  },

  /** 断开连接 */
  disconnect: async (platform: ConnectorPlatform) => {
    const idx = connectors.findIndex((c) => c.platform === platform);
    if (idx === -1) return { platform, error: '未连接' };
    const item = connectors[idx];
    item.status = 'disconnected';
    item.scopes = [];
    moduleBus.broadcast('connector:status-change', { platform, status: 'disconnected' });
    return { platform, status: 'disconnected' as const };
  },

  /** 获取连接器状态（全部或指定） */
  getStatus: async (platform?: ConnectorPlatform): Promise<ConnectorConfig[]> => {
    if (platform) return connectors.filter((c) => c.platform === platform);
    return [...connectors];
  },

  /** 获取连接器注册表（所有可用平台） */
  getRegistry: async (): Promise<{ platform: ConnectorPlatform; name: string; type: ConnectorType; scopes: string[] }[]> => {
    return Array.from(CONNECTOR_REGISTRY.entries()).map(([platform, meta]) => ({
      platform,
      ...meta,
    }));
  },

  /** 拉取平台数据（mock：无凭证时返回模拟数据；实际对接需凭证） */
  fetchData: async (platform: ConnectorPlatform, type: string): Promise<unknown[]> => {
    const conn = connectors.find((c) => c.platform === platform && c.status === 'connected');
    if (!conn) {
      // 未连接时也返回 mock 数据供 UI 测试
      return MOCK_PRODUCTS[platform] || [];
    }
    // 已连接：返回 mock（真实对接需替换为 HTTP 调用）
    moduleBus.broadcast('connector:data-fetched', { platform, type, timestamp: new Date().toISOString() });
    return MOCK_PRODUCTS[platform] || [];
  },

  /** 推送数据到平台 */
  pushData: async (platform: ConnectorPlatform, data: ConnectorData) => {
    const conn = connectors.find((c) => c.platform === platform && c.status === 'connected');
    if (!conn) return { success: false, error: `平台 ${platform} 未连接` };
    moduleBus.broadcast('connector:data-pushed', { platform, type: data.type });
    return { success: true };
  },
};
