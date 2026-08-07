import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db';
import { NotFoundError, ValidationError } from '../utils/errors';
import { logger } from '../utils/logger';

// ============================================================
// 跨境电商服务
//   A. HS Code 参考库与合规属性
//   B. 多币种与汇率（本地维护 + 手工更新，绝非实时行情）
//   C. 落地成本与利润测算
//   D. 跨境概览聚合
//
// 存储策略（不新增任何表 / 不改 schema）：
//   · products 表已有列：hs_code / origin_country / declared_value /
//     is_prohibited / product_weight_kg  → 直接复用
//   · products.attributes（JSON）里的 "crossborder" 子对象 → 存放
//     declared_name_en / gross_weight_kg / 体积 / is_battery /
//     is_liquid / is_magnetic / certifications[]
//   · exchange_rates 表 → 汇率快照（历史留痕）
//   · system_settings（key = crossborder:landed_cost_history）→ 测算记录
//
// 所有 SQL 一律带 tenant_id 过滤。
// ============================================================

// HS Code 基础校验规则：6-10 位数字
const HS_CODE_REGEX = /^\d{6,10}$/;

// 支持的币种白名单（按需扩展）
const SUPPORTED_CURRENCIES = new Set([
  'CNY', 'USD', 'EUR', 'GBP', 'JPY', 'HKD', 'AUD', 'CAD', 'SGD', 'KRW',
  'THB', 'MYR', 'IDR', 'PHP', 'VND', 'INR', 'TWD', 'NZD', 'CHF', 'SEK',
  'NOK', 'DKK', 'RUB', 'BRL', 'MXN', 'ZAR', 'TRY', 'AED', 'SAR', 'PLN',
  'CZK', 'HUF', 'ILS',
]);

// 欧盟成员国 ISO 代码（用于 IOSS 适用判断）
const EU_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
  'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
]);

// 系统配置里存放测算历史的 key
const LANDED_COST_HISTORY_KEY = 'crossborder:landed_cost_history';
const LANDED_COST_HISTORY_MAX = 20;

// 汇率被视为「过期」的天数阈值
const RATE_STALE_DAYS = 7;

// ============================================================
// 常量表 1：关税税区
// ============================================================

/** 关税税区：用于把目的国归并到一套可维护的税率口径上 */
export type DutyZone = 'US' | 'EU' | 'GB' | 'JP' | 'AU' | 'CA';

const DUTY_ZONE_LABEL: Record<DutyZone, string> = {
  US: '美国',
  EU: '欧盟',
  GB: '英国',
  JP: '日本',
  AU: '澳大利亚',
  CA: '加拿大',
};

// ============================================================
// 常量表 2：精简 HS Code 参考库
//
// 说明：本表为本项目自行编写整理的「常用跨境类目速查表」，
// 覆盖服饰纺织、鞋靴、箱包、家居家具、照明、3C 电子、玩具、
// 美妆个护、饰品、五金餐厨等主流跨境类目。
// duty 为各税区的**参考普通税率**（0~1 小数），仅用于测算估算，
// 实际报关税率以目的国当期海关税则、原产地协定与商品实际归类为准。
// ============================================================

export interface HsCodeEntry {
  /** HS 编码（6 位） */
  code: string;
  /** 中文品名 */
  nameZh: string;
  /** 英文申报品名 */
  nameEn: string;
  /** 归属大类（用于认证要求推导） */
  categoryZh: string;
  /** 各税区参考关税率（0~1） */
  duty: Record<DutyZone, number>;
  /** 检索关键词（中英混排，空格分隔） */
  keywords: string;
}

function hs(
  code: string,
  nameZh: string,
  nameEn: string,
  categoryZh: string,
  duty: [number, number, number, number, number, number],
  keywords: string
): HsCodeEntry {
  return {
    code,
    nameZh,
    nameEn,
    categoryZh,
    duty: { US: duty[0], EU: duty[1], GB: duty[2], JP: duty[3], AU: duty[4], CA: duty[5] },
    keywords,
  };
}

const HS_CODE_LIBRARY: HsCodeEntry[] = [
  // ── 61 针织服装 ─────────────────────────────
  hs('610910', '针织棉制T恤衫', 'T-shirts, knitted, of cotton', '服饰纺织',
    [0.165, 0.12, 0.12, 0.078, 0.05, 0.18], 't恤 短袖 tshirt tee cotton 针织 上衣'),
  hs('610990', '针织化纤T恤衫', 'T-shirts, knitted, of man-made fibres', '服饰纺织',
    [0.32, 0.12, 0.12, 0.078, 0.05, 0.18], 't恤 涤纶 速干 polyester tshirt 化纤'),
  hs('611020', '针织棉制套头衫', 'Pullovers and sweaters, knitted, of cotton', '服饰纺织',
    [0.165, 0.12, 0.12, 0.088, 0.05, 0.18], '毛衣 套头衫 sweater pullover 针织衫'),
  hs('611030', '针织化纤卫衣', 'Sweatshirts and hoodies, knitted, of man-made fibres', '服饰纺织',
    [0.32, 0.12, 0.12, 0.088, 0.05, 0.18], '卫衣 连帽衫 hoodie sweatshirt 抓绒'),
  hs('610462', '针织棉制女式长裤', "Women's trousers, knitted, of cotton", '服饰纺织',
    [0.148, 0.12, 0.12, 0.078, 0.05, 0.18], '女裤 长裤 打底裤 leggings trousers'),
  hs('610343', '针织合纤男式长裤', "Men's trousers, knitted, of synthetic fibres", '服饰纺织',
    [0.28, 0.12, 0.12, 0.088, 0.05, 0.18], '男裤 运动裤 jogger 针织裤'),
  hs('611211', '针织棉制运动套装', 'Track suits, knitted, of cotton', '服饰纺织',
    [0.165, 0.12, 0.12, 0.078, 0.05, 0.18], '运动服 套装 tracksuit 卫裤'),
  hs('611596', '针织合纤袜类', 'Socks and hosiery, knitted, of synthetic fibres', '服饰纺织',
    [0.149, 0.12, 0.12, 0.078, 0.05, 0.16], '袜子 丝袜 socks hosiery 船袜'),
  hs('610821', '针织棉制女式内裤', "Women's briefs and panties, knitted, of cotton", '服饰纺织',
    [0.077, 0.12, 0.12, 0.078, 0.05, 0.17], '内裤 内衣 briefs panties 棉质'),
  hs('611780', '针织衣着附件', 'Knitted clothing accessories (scarves, gloves)', '服饰纺织',
    [0.146, 0.12, 0.12, 0.088, 0.05, 0.18], '围巾 手套 头带 scarf gloves 配饰'),

  // ── 62 梭织服装 ─────────────────────────────
  hs('620342', '梭织棉制男式长裤', "Men's trousers, woven, of cotton", '服饰纺织',
    [0.166, 0.12, 0.12, 0.098, 0.05, 0.18], '男裤 休闲裤 牛仔裤 chino trousers'),
  hs('620462', '梭织棉制女式长裤', "Women's trousers, woven, of cotton", '服饰纺织',
    [0.166, 0.12, 0.12, 0.098, 0.05, 0.18], '女裤 牛仔裤 denim jeans 梭织'),
  hs('620520', '梭织棉制男式衬衫', "Men's shirts, woven, of cotton", '服饰纺织',
    [0.197, 0.12, 0.12, 0.078, 0.05, 0.18], '衬衫 男装 shirt 商务衬衣'),
  hs('620630', '梭织棉制女式衬衫', "Women's blouses and shirts, woven, of cotton", '服饰纺织',
    [0.152, 0.12, 0.12, 0.078, 0.05, 0.18], '女衬衫 上衣 blouse 雪纺衫'),
  hs('620443', '梭织合纤女式连衣裙', "Women's dresses, woven, of synthetic fibres", '服饰纺织',
    [0.16, 0.12, 0.12, 0.088, 0.05, 0.18], '连衣裙 裙子 dress 长裙'),
  hs('620193', '梭织化纤男式防风外套', "Men's anoraks and windbreakers, of man-made fibres", '服饰纺织',
    [0.276, 0.12, 0.12, 0.098, 0.05, 0.18], '外套 夹克 冲锋衣 jacket windbreaker'),
  hs('621040', '涂层织物制防水外衣', 'Garments made of coated fabric, waterproof', '服饰纺织',
    [0.071, 0.12, 0.12, 0.088, 0.05, 0.18], '雨衣 防水服 raincoat 冲锋衣'),
  hs('620920', '婴幼儿棉制服装', "Babies' garments and accessories, of cotton", '服饰纺织',
    [0.098, 0.108, 0.108, 0.078, 0.05, 0.18], '婴儿服 童装 连体衣 baby romper'),
  hs('621210', '文胸及胸衣', 'Brassieres', '服饰纺织',
    [0.168, 0.065, 0.065, 0.088, 0.05, 0.18], '文胸 内衣 bra 胸罩 运动内衣'),
  hs('621600', '梭织手套', 'Gloves, mittens and mitts, not knitted', '服饰纺织',
    [0.207, 0.079, 0.079, 0.088, 0.05, 0.155], '手套 劳保手套 gloves 骑行手套'),

  // ── 63 家用纺织 ─────────────────────────────
  hs('630260', '棉制毛巾及厨房织物', 'Toilet and kitchen linen, of cotton terry towelling', '家居家具',
    [0.093, 0.12, 0.12, 0.078, 0.05, 0.17], '毛巾 浴巾 抹布 towel 厨房布'),
  hs('630392', '合纤制窗帘', 'Curtains and interior blinds, of synthetic fibres', '家居家具',
    [0.117, 0.12, 0.12, 0.088, 0.05, 0.18], '窗帘 遮光帘 curtain 隔断帘'),
  hs('630419', '棉制床罩及床品', 'Bedspreads and bed linen, of cotton', '家居家具',
    [0.064, 0.12, 0.12, 0.078, 0.05, 0.18], '床品 床单 被套 bedding bedspread'),

  // ── 64 鞋靴 ────────────────────────────────
  hs('640411', '胶底纺织面运动鞋', 'Sports footwear, textile upper with rubber sole', '鞋靴',
    [0.20, 0.167, 0.167, 0.10, 0.05, 0.18], '运动鞋 跑鞋 板鞋 sneakers sports shoes'),
  hs('640419', '胶底纺织面休闲鞋', 'Casual footwear, textile upper with rubber sole', '鞋靴',
    [0.375, 0.167, 0.167, 0.10, 0.05, 0.18], '休闲鞋 帆布鞋 canvas shoes 懒人鞋'),
  hs('640351', '皮面皮底盖踝靴', 'Leather footwear with leather outer soles, covering the ankle', '鞋靴',
    [0.085, 0.08, 0.08, 0.30, 0.05, 0.18], '靴子 皮靴 boots 马丁靴 短靴'),
  hs('640399', '皮面其他鞋类', 'Other footwear with leather uppers', '鞋靴',
    [0.10, 0.08, 0.08, 0.30, 0.05, 0.18], '皮鞋 乐福鞋 leather shoes 单鞋'),
  hs('640299', '塑胶面其他鞋类', 'Other footwear with rubber or plastic uppers', '鞋靴',
    [0.09, 0.167, 0.167, 0.08, 0.05, 0.18], '拖鞋 凉鞋 洞洞鞋 slippers sandals'),
  hs('640590', '其他材质鞋类', 'Other footwear of other materials', '鞋靴',
    [0.125, 0.17, 0.17, 0.08, 0.05, 0.18], '棉鞋 家居鞋 其他鞋 footwear'),
  hs('640620', '橡塑鞋底及鞋跟', 'Outer soles and heels, of rubber or plastics', '鞋靴',
    [0.026, 0.03, 0.03, 0.032, 0.05, 0.10], '鞋底 鞋跟 sole heel 鞋材'),

  // ── 42 箱包皮具 ─────────────────────────────
  hs('420212', '塑料或纺织面行李箱', 'Trunks and suitcases with outer surface of plastic or textile', '箱包皮具',
    [0.176, 0.092, 0.092, 0.043, 0.05, 0.11], '拉杆箱 行李箱 suitcase luggage 旅行箱'),
  hs('420221', '皮面手提包', 'Handbags with outer surface of leather', '箱包皮具',
    [0.10, 0.03, 0.03, 0.16, 0.05, 0.11], '手提包 皮包 handbag 女包 真皮'),
  hs('420222', '塑料或纺织面手提包', 'Handbags with outer surface of plastic sheeting or textile', '箱包皮具',
    [0.176, 0.037, 0.037, 0.084, 0.05, 0.11], '手提包 帆布包 tote bag 单肩包'),
  hs('420231', '皮制钱包', 'Wallets and purses of leather, pocket-size', '箱包皮具',
    [0.08, 0.03, 0.03, 0.16, 0.05, 0.11], '钱包 卡包 wallet purse 皮夹'),
  hs('420292', '纺织面双肩背包', 'Backpacks with outer surface of textile or plastic', '箱包皮具',
    [0.176, 0.037, 0.037, 0.084, 0.05, 0.11], '双肩包 背包 书包 backpack rucksack'),
  hs('420310', '皮革服装', 'Articles of apparel of leather', '箱包皮具',
    [0.06, 0.04, 0.04, 0.16, 0.05, 0.13], '皮衣 皮夹克 leather jacket 皮革服装'),
  hs('420329', '皮革手套', 'Gloves, mittens and mitts of leather', '箱包皮具',
    [0.126, 0.09, 0.09, 0.16, 0.05, 0.155], '皮手套 leather gloves 骑行手套'),
  hs('420500', '其他皮革制品', 'Other articles of leather or composition leather', '箱包皮具',
    [0.019, 0.025, 0.025, 0.10, 0.05, 0.07], '皮革制品 表带 皮具 leather goods'),

  // ── 39 塑料制品 ─────────────────────────────
  hs('392310', '塑料包装箱盒', 'Boxes, cases and crates of plastics', '塑料制品',
    [0.03, 0.062, 0.062, 0.037, 0.05, 0.065], '收纳箱 塑料盒 包装盒 plastic box'),
  hs('392490', '塑料家用器具', 'Tableware and household articles of plastics', '塑料制品',
    [0.034, 0.065, 0.065, 0.037, 0.05, 0.065], '塑料餐具 收纳 家居 plastic household'),
  hs('392620', '塑料服饰配件', 'Articles of apparel and clothing accessories of plastics', '塑料制品',
    [0.05, 0.065, 0.065, 0.037, 0.05, 0.065], '塑料配件 腰带扣 雨披 plastic accessories'),

  // ── 94 家居家具与照明 ────────────────────────
  hs('940161', '木框软垫座椅', 'Upholstered seats with wooden frames', '家居家具',
    [0.0, 0.0, 0.0, 0.0, 0.05, 0.08], '沙发 布艺椅 软包椅 upholstered chair'),
  hs('940171', '金属框软垫座椅', 'Upholstered seats with metal frames', '家居家具',
    [0.0, 0.0, 0.0, 0.0, 0.05, 0.08], '办公椅 电竞椅 金属椅 office chair'),
  hs('940330', '木制办公家具', 'Wooden furniture for offices', '家居家具',
    [0.0, 0.0, 0.0, 0.0, 0.05, 0.095], '办公桌 书桌 office desk 木家具'),
  hs('940350', '木制卧室家具', 'Wooden furniture for bedrooms', '家居家具',
    [0.0, 0.0, 0.0, 0.0, 0.05, 0.095], '床架 衣柜 床头柜 bedroom furniture'),
  hs('940360', '其他木制家具', 'Other wooden furniture', '家居家具',
    [0.0, 0.0, 0.0, 0.0, 0.05, 0.095], '边几 置物架 木架 wooden furniture'),
  hs('940370', '塑料家具', 'Furniture of plastics', '家居家具',
    [0.0, 0.027, 0.027, 0.0, 0.05, 0.08], '塑料椅 折叠桌 plastic furniture'),
  hs('940421', '泡沫或乳胶床垫', 'Mattresses of cellular rubber or plastics', '家居家具',
    [0.03, 0.038, 0.038, 0.0, 0.05, 0.098], '床垫 记忆棉 乳胶垫 mattress'),
  hs('940430', '睡袋', 'Sleeping bags', '家居家具',
    [0.09, 0.032, 0.032, 0.038, 0.05, 0.17], '睡袋 露营 sleeping bag 户外'),
  hs('940490', '靠垫抱枕及被褥', 'Cushions, pillows, quilts and similar furnishings', '家居家具',
    [0.06, 0.032, 0.032, 0.038, 0.05, 0.17], '抱枕 靠垫 被子 cushion pillow quilt'),
  hs('940540', 'LED灯具及照明装置', 'LED luminaires and lighting fittings', '照明',
    [0.039, 0.037, 0.037, 0.0, 0.05, 0.07], 'led 灯 台灯 氛围灯 灯带 lamp light'),
  hs('940550', '非电力照明器具', 'Non-electrical lamps and lighting fittings', '照明',
    [0.056, 0.028, 0.028, 0.031, 0.05, 0.065], '烛台 香薰灯 煤油灯 candle holder'),

  // ── 85 / 84 电子电器 ───────────────────────
  hs('850440', '静止式变流器（充电器/适配器）', 'Static converters (chargers and power adapters)', '3C电子',
    [0.015, 0.033, 0.033, 0.0, 0.05, 0.0], '充电器 适配器 电源 charger adapter 快充'),
  hs('850760', '锂离子蓄电池', 'Lithium-ion accumulators', '电池',
    [0.034, 0.027, 0.027, 0.0, 0.05, 0.07], '锂电池 充电宝 电池 lithium battery 移动电源'),
  hs('851713', '智能手机', 'Smartphones', '3C电子',
    [0.0, 0.0, 0.0, 0.0, 0.0, 0.0], '手机 智能机 smartphone 移动电话'),
  hs('851762', '无线数据收发设备', 'Machines for reception and transmission of data (routers, gateways)', '3C电子',
    [0.0, 0.0, 0.0, 0.0, 0.0, 0.0], '路由器 网关 中继器 router wifi 智能音箱'),
  hs('851821', '单喇叭音箱', 'Single loudspeakers, mounted in enclosures', '3C电子',
    [0.049, 0.045, 0.045, 0.0, 0.05, 0.065], '音箱 蓝牙音箱 speaker 喇叭'),
  hs('851822', '多喇叭音箱', 'Multiple loudspeakers, mounted in the same enclosure', '3C电子',
    [0.045, 0.045, 0.045, 0.0, 0.05, 0.065], '音响 组合音箱 soundbar 回音壁'),
  hs('851830', '耳机及头戴式耳麦', 'Headphones and earphones', '3C电子',
    [0.049, 0.0, 0.0, 0.0, 0.05, 0.0], '耳机 蓝牙耳机 tws headphones earbuds'),
  hs('852351', '固态非易失性存储器', 'Solid-state non-volatile storage devices', '3C电子',
    [0.0, 0.0, 0.0, 0.0, 0.0, 0.0], 'u盘 ssd 固态硬盘 内存卡 flash drive'),
  hs('852580', '数码相机及摄像机', 'Digital cameras and video camera recorders', '3C电子',
    [0.0, 0.0, 0.0, 0.0, 0.05, 0.0], '相机 摄像头 运动相机 webcam camera'),
  hs('854370', '其他电气机器及装置', 'Other electrical machines and apparatus', '3C电子',
    [0.026, 0.037, 0.037, 0.0, 0.05, 0.0], '个护电器 美容仪 电子器具 electrical apparatus'),
  hs('854442', '带接头电线电缆', 'Insulated electric conductors fitted with connectors', '3C电子',
    [0.026, 0.033, 0.033, 0.0, 0.05, 0.0], '数据线 充电线 hdmi cable 连接线'),
  hs('850980', '家用电动器具', 'Other electro-mechanical domestic appliances', '3C电子',
    [0.042, 0.022, 0.022, 0.0, 0.05, 0.06], '破壁机 榨汁机 清洁机 kitchen appliance'),
  hs('851660', '电烤箱及电炉灶', 'Other electric ovens, cookers and cooking plates', '3C电子',
    [0.028, 0.027, 0.027, 0.0, 0.05, 0.06], '烤箱 电炉 空气炸锅 oven air fryer'),
  hs('851640', '电熨斗', 'Electric smoothing irons', '3C电子',
    [0.028, 0.027, 0.027, 0.0, 0.05, 0.06], '熨斗 挂烫机 iron steamer'),
  hs('847130', '便携式笔记本电脑', 'Portable automatic data processing machines, ≤10kg', '3C电子',
    [0.0, 0.0, 0.0, 0.0, 0.0, 0.0], '笔记本 电脑 平板 laptop tablet notebook'),
  hs('841451', '家用风扇', 'Table, floor, wall or ceiling fans, ≤125W', '3C电子',
    [0.047, 0.032, 0.032, 0.0, 0.05, 0.06], '风扇 循环扇 手持风扇 fan'),

  // ── 95 玩具与运动户外 ────────────────────────
  hs('950300', '三轮车玩偶及其他玩具', 'Tricycles, dolls, puzzles and other toys', '玩具',
    [0.0, 0.0, 0.0, 0.0, 0.0, 0.0], '玩具 玩偶 积木 拼图 toys doll puzzle'),
  hs('950450', '电子游戏机及设备', 'Video game consoles and machines', '玩具',
    [0.0, 0.0, 0.0, 0.0, 0.0, 0.0], '游戏机 手柄 掌机 game console'),
  hs('950629', '充气水上运动用品', 'Inflatable water-sport equipment', '玩具',
    [0.0, 0.027, 0.027, 0.0, 0.05, 0.07], '游泳圈 浮排 皮划艇 inflatable water sports'),
  hs('950662', '充气球类', 'Inflatable balls', '玩具',
    [0.048, 0.027, 0.027, 0.0, 0.05, 0.07], '足球 篮球 排球 inflatable ball'),
  hs('950691', '健身及体操器材', 'Articles for general physical exercise and gymnastics', '玩具',
    [0.046, 0.027, 0.027, 0.0, 0.05, 0.07], '健身器材 瑜伽垫 哑铃 fitness yoga equipment'),
  hs('950699', '其他运动户外用品', 'Other sports and outdoor articles', '玩具',
    [0.04, 0.027, 0.027, 0.0, 0.05, 0.07], '户外用品 运动器材 sports outdoor gear'),
  hs('950510', '圣诞节庆用品', 'Articles for Christmas festivities', '玩具',
    [0.0, 0.027, 0.027, 0.0, 0.05, 0.065], '圣诞 装饰 节庆 christmas decoration'),

  // ── 33 美妆个护 ─────────────────────────────
  hs('330300', '香水及花露水', 'Perfumes and toilet waters', '美妆个护',
    [0.0, 0.0, 0.0, 0.0, 0.05, 0.065], '香水 淡香 perfume fragrance 古龙水'),
  hs('330410', '唇部化妆品', 'Lip make-up preparations', '美妆个护',
    [0.0, 0.0, 0.0, 0.0, 0.05, 0.065], '口红 唇釉 唇膏 lipstick lip gloss'),
  hs('330420', '眼部化妆品', 'Eye make-up preparations', '美妆个护',
    [0.0, 0.0, 0.0, 0.0, 0.05, 0.065], '眼影 睫毛膏 眼线 eyeshadow mascara'),
  hs('330491', '化妆用粉类', 'Powders for cosmetic use, whether or not compressed', '美妆个护',
    [0.0, 0.0, 0.0, 0.0, 0.05, 0.065], '散粉 蜜粉 腮红 powder blush'),
  hs('330499', '护肤品（面霜/精华）', 'Other beauty or skin-care preparations', '美妆个护',
    [0.0, 0.0, 0.0, 0.0, 0.05, 0.065], '面霜 精华 面膜 skincare cream serum'),
  hs('330510', '洗发水', 'Shampoos', '美妆个护',
    [0.0, 0.0, 0.0, 0.0, 0.05, 0.065], '洗发水 洗发露 shampoo 护发'),
  hs('330590', '其他护发用品', 'Other preparations for use on the hair', '美妆个护',
    [0.0, 0.0, 0.0, 0.0, 0.05, 0.065], '护发素 发膜 精油 hair care conditioner'),
  hs('330610', '牙膏', 'Dentifrices', '美妆个护',
    [0.0, 0.0, 0.0, 0.0, 0.05, 0.065], '牙膏 洁牙 toothpaste 口腔护理'),
  hs('330720', '人体除臭剂', 'Personal deodorants and antiperspirants', '美妆个护',
    [0.048, 0.065, 0.065, 0.0, 0.05, 0.065], '止汗剂 除臭 deodorant 体香剂'),

  // ── 71 / 91 饰品与钟表 ──────────────────────
  hs('711711', '贱金属仿首饰（袖扣等）', 'Cuff links and studs of base metal', '饰品',
    [0.11, 0.04, 0.04, 0.052, 0.05, 0.085], '袖扣 领针 cuff links 男士饰品'),
  hs('711719', '其他贱金属仿首饰', 'Other imitation jewellery of base metal', '饰品',
    [0.11, 0.04, 0.04, 0.052, 0.05, 0.085], '项链 耳环 手链 戒指 imitation jewellery'),
  hs('711790', '其他材料仿首饰', 'Imitation jewellery of other materials', '饰品',
    [0.11, 0.04, 0.04, 0.052, 0.05, 0.085], '树脂饰品 亚克力 珍珠饰品 jewellery'),
  hs('711319', '贵金属首饰', 'Jewellery of precious metal', '饰品',
    [0.055, 0.025, 0.025, 0.052, 0.05, 0.085], '黄金 银饰 925 gold silver jewellery'),
  hs('910212', '电子指针手表', 'Wrist-watches, electrically operated, with mechanical display', '饰品',
    [0.04, 0.045, 0.045, 0.0, 0.05, 0.05], '手表 石英表 watch 腕表'),

  // ── 90 光学 ────────────────────────────────
  hs('900410', '太阳镜', 'Sunglasses', '光学眼镜',
    [0.02, 0.029, 0.029, 0.0, 0.05, 0.065], '太阳镜 墨镜 sunglasses 偏光镜'),

  // ── 73 / 76 / 69 五金餐厨 ───────────────────
  hs('732393', '不锈钢餐厨用具', 'Table and kitchen articles of stainless steel', '五金餐厨',
    [0.02, 0.07, 0.07, 0.032, 0.05, 0.065], '不锈钢 餐具 锅具 保温杯 stainless kitchenware'),
  hs('761510', '铝制餐厨用具', 'Table and kitchen articles of aluminium', '五金餐厨',
    [0.031, 0.06, 0.06, 0.032, 0.05, 0.065], '铝锅 铝制餐具 aluminium kitchenware'),
  hs('691200', '陶瓷餐具及厨房用具', 'Ceramic tableware and kitchenware', '五金餐厨',
    [0.098, 0.05, 0.05, 0.032, 0.05, 0.055], '陶瓷 马克杯 餐盘 ceramic mug tableware'),
  hs('961700', '保温瓶及保温容器', 'Vacuum flasks and other vacuum vessels', '五金餐厨',
    [0.072, 0.067, 0.067, 0.032, 0.05, 0.065], '保温杯 保温壶 焖烧罐 vacuum flask thermos'),

  // ── 96 / 44 / 87 日用杂项 ───────────────────
  hs('960390', '清洁刷具及扫具', 'Brooms, brushes and other cleaning articles', '日用杂项',
    [0.028, 0.037, 0.037, 0.032, 0.05, 0.11], '刷子 扫把 清洁工具 brush broom'),
  hs('961519', '发饰及发夹', 'Hair slides and similar hair accessories', '日用杂项',
    [0.11, 0.027, 0.027, 0.032, 0.05, 0.065], '发夹 发圈 头饰 hair clip accessories'),
  hs('960810', '圆珠笔', 'Ball point pens', '日用杂项',
    [0.08, 0.037, 0.037, 0.0, 0.05, 0.07], '圆珠笔 中性笔 文具 ball pen'),
  hs('442010', '木制装饰摆件', 'Wooden statuettes and other ornaments', '日用杂项',
    [0.033, 0.03, 0.03, 0.027, 0.05, 0.07], '木雕 摆件 装饰品 wooden ornament'),
  hs('871200', '自行车', 'Bicycles and other cycles, not motorised', '日用杂项',
    [0.11, 0.14, 0.14, 0.0, 0.05, 0.13], '自行车 单车 山地车 bicycle bike'),
  hs('871500', '婴儿车及其零件', 'Baby carriages and parts thereof', '日用杂项',
    [0.045, 0.027, 0.027, 0.0, 0.05, 0.08], '婴儿车 推车 stroller baby carriage'),
];

// 快速索引
const HS_CODE_INDEX = new Map<string, HsCodeEntry>(HS_CODE_LIBRARY.map((e) => [e.code, e]));

// ============================================================
// 常量表 3：目的国 / 地区（VAT、币种、税区、免税额度）
//
// vatRate 为进口环节增值税/消费税参考税率（0~1）。
// 美国联邦层面无 VAT，销售税由各州在零售环节征收，故此处 vatRate = 0
// 并在 vatNote 中明确提示「州销售税另计」。
// ============================================================

export interface CountryEntry {
  /** ISO 3166-1 alpha-2 */
  code: string;
  nameZh: string;
  nameEn: string;
  /** 当地结算币种 */
  currency: string;
  /** 进口增值税/消费税参考税率 0~1 */
  vatRate: number;
  /** 税种名称 */
  vatLabel: string;
  /** 税制补充说明 */
  vatNote: string;
  /** 所属关税税区 */
  dutyZone: DutyZone;
  /** 关税起征点（当地币种，0 表示无免税额度） */
  deMinimis: number;
  /** 该国常见强制/准入认证 */
  baseCertifications: string[];
  /** 是否欧盟成员国 */
  isEu: boolean;
}

function country(
  code: string, nameZh: string, nameEn: string, currency: string,
  vatRate: number, vatLabel: string, vatNote: string,
  dutyZone: DutyZone, deMinimis: number, baseCertifications: string[]
): CountryEntry {
  return {
    code, nameZh, nameEn, currency, vatRate, vatLabel, vatNote,
    dutyZone, deMinimis, baseCertifications, isEu: EU_COUNTRIES.has(code),
  };
}

const COUNTRY_LIBRARY: CountryEntry[] = [
  country('GB', '英国', 'United Kingdom', 'GBP', 0.20, 'VAT',
    '标准税率 20%；跨境低值货物需通过 UK VAT 注册号申报', 'GB', 135, ['UKCA']),
  country('DE', '德国', 'Germany', 'EUR', 0.19, 'VAT',
    '标准税率 19%；欧盟境内可用 IOSS 一站式申报', 'EU', 150, ['CE']),
  country('FR', '法国', 'France', 'EUR', 0.20, 'VAT',
    '标准税率 20%；适用欧盟 IOSS 机制', 'EU', 150, ['CE']),
  country('IT', '意大利', 'Italy', 'EUR', 0.22, 'VAT',
    '标准税率 22%，为欧盟主要市场中较高', 'EU', 150, ['CE']),
  country('ES', '西班牙', 'Spain', 'EUR', 0.21, 'VAT',
    '标准税率 21%；适用欧盟 IOSS 机制', 'EU', 150, ['CE']),
  country('NL', '荷兰', 'Netherlands', 'EUR', 0.21, 'VAT',
    '标准税率 21%；欧洲海外仓与清关中转主力国', 'EU', 150, ['CE']),
  country('BE', '比利时', 'Belgium', 'EUR', 0.21, 'VAT',
    '标准税率 21%', 'EU', 150, ['CE']),
  country('PL', '波兰', 'Poland', 'PLN', 0.23, 'VAT',
    '标准税率 23%；中东欧海外仓常用节点', 'EU', 150, ['CE']),
  country('SE', '瑞典', 'Sweden', 'SEK', 0.25, 'VAT',
    '标准税率 25%，北欧税率普遍偏高', 'EU', 150, ['CE']),
  country('IE', '爱尔兰', 'Ireland', 'EUR', 0.23, 'VAT',
    '标准税率 23%', 'EU', 150, ['CE']),
  country('AT', '奥地利', 'Austria', 'EUR', 0.20, 'VAT',
    '标准税率 20%', 'EU', 150, ['CE']),
  country('US', '美国', 'United States', 'USD', 0, '销售税',
    '联邦层面无进口增值税；各州销售税在零售环节另行征收（约 0%~10%），需按州判定', 'US', 800, ['FCC']),
  country('CA', '加拿大', 'Canada', 'CAD', 0.05, 'GST',
    '联邦 GST 5%；部分省另征 PST/HST，合计可达 13%~15%', 'CA', 20, ['ISED']),
  country('JP', '日本', 'Japan', 'JPY', 0.10, '消费税',
    '消费税 10%；课税价格按 CIF 计算', 'JP', 10000, ['PSE']),
  country('AU', '澳大利亚', 'Australia', 'AUD', 0.10, 'GST',
    'GST 10%；低值进口商品需卖家注册 GST 并代收', 'AU', 1000, ['RCM']),
  country('NZ', '新西兰', 'New Zealand', 'NZD', 0.15, 'GST',
    'GST 15%；低值货物由卖家代收', 'AU', 1000, ['RCM']),
  country('SG', '新加坡', 'Singapore', 'SGD', 0.09, 'GST',
    'GST 9%；低价值进口货物同样需要征收', 'AU', 400, []),
  country('MY', '马来西亚', 'Malaysia', 'MYR', 0.10, '销售税',
    '销售税 10%；低价值货物销售税单独申报', 'AU', 500, []),
  country('AE', '阿联酋', 'United Arab Emirates', 'AED', 0.05, 'VAT',
    'VAT 5%；中东市场税率较低', 'AU', 1000, []),
  country('SA', '沙特阿拉伯', 'Saudi Arabia', 'SAR', 0.15, 'VAT',
    'VAT 15%；需 SABER 认证配合清关', 'AU', 1000, ['SABER']),
  country('MX', '墨西哥', 'Mexico', 'MXN', 0.16, 'IVA',
    'IVA 16%；北美近岸市场', 'US', 50, ['NOM']),
  country('BR', '巴西', 'Brazil', 'BRL', 0.17, 'ICMS',
    'ICMS 各州 17%~20% 不等，另有联邦进口税，综合税负偏高', 'US', 50, ['INMETRO']),
  country('KR', '韩国', 'South Korea', 'KRW', 0.10, 'VAT',
    'VAT 10%；个人通关需提供通关码', 'JP', 150000, ['KC']),
  country('HK', '中国香港', 'Hong Kong SAR', 'HKD', 0, '免征',
    '自由港，一般货物不征收进口关税与增值税', 'AU', 0, []),
];

const COUNTRY_INDEX = new Map<string, CountryEntry>(COUNTRY_LIBRARY.map((c) => [c.code, c]));

// ============================================================
// 常量表 4：类目 × 目的国 的常见认证要求
// ============================================================

/** 按「商品大类 + 税区」推导目的国常见强制认证 */
function requiredCertificationsFor(categoryZh: string, c: CountryEntry): string[] {
  const zone = c.dutyZone;
  const set = new Set<string>();

  const isElectric = categoryZh === '3C电子' || categoryZh === '照明' || categoryZh === '电池';
  const isToy = categoryZh === '玩具';
  const isCosmetic = categoryZh === '美妆个护';
  const isTextile = categoryZh === '服饰纺织' || categoryZh === '鞋靴' || categoryZh === '箱包皮具';
  const isFoodContact = categoryZh === '五金餐厨';

  if (isElectric) {
    if (zone === 'EU') { set.add('CE'); set.add('RoHS'); set.add('WEEE'); }
    if (zone === 'GB') { set.add('UKCA'); set.add('RoHS'); }
    if (zone === 'US') { set.add('FCC'); }
    if (zone === 'JP') { set.add('PSE'); }
    if (zone === 'AU') { set.add('RCM'); }
    if (zone === 'CA') { set.add('ISED'); }
  }
  if (isToy) {
    if (zone === 'EU') { set.add('CE'); set.add('EN71'); }
    if (zone === 'GB') { set.add('UKCA'); set.add('EN71'); }
    if (zone === 'US') { set.add('CPC'); set.add('ASTM F963'); }
    if (zone === 'AU') { set.add('AS/NZS ISO 8124'); }
    if (zone === 'CA') { set.add('CCPSA'); }
  }
  if (isCosmetic) {
    if (zone === 'EU') { set.add('CPNP'); set.add('CPSR'); }
    if (zone === 'GB') { set.add('SCPN'); }
    if (zone === 'US') { set.add('FDA 备案'); set.add('MoCRA'); }
    if (zone === 'JP') { set.add('化妆品制造販売届出'); }
    if (zone === 'AU') { set.add('NICNAS/AICIS'); }
  }
  if (isTextile) {
    if (zone === 'EU' || zone === 'GB') { set.add('REACH'); }
    if (zone === 'US') { set.add('CPSIA'); set.add('FTC 纤维标签'); }
  }
  if (isFoodContact) {
    if (zone === 'EU') { set.add('EC 1935/2004'); set.add('LFGB'); }
    if (zone === 'GB') { set.add('UKCA'); }
    if (zone === 'US') { set.add('FDA 食品接触'); }
  }

  // 国家级基础认证（如沙特 SABER、墨西哥 NOM）
  for (const cert of c.baseCertifications) {
    if (isElectric || isToy || isFoodContact) set.add(cert);
  }

  return Array.from(set);
}

// ============================================================
// 常量表 5：币种与内置参考基准汇率
//
// ⚠️ 重要：本表是**离线内置的参考基准占位值**，不是实时行情。
// 桌面端不联网抓取汇率。请在「汇率管理」中录入你自己的实际结汇汇率，
// 录入后即以手工值为准，并记录 updated_at 与来源。
// ============================================================

export interface CurrencyEntry {
  code: string;
  nameZh: string;
  symbol: string;
  /** 金额小数位（日元/韩元等为 0） */
  decimals: number;
}

const CURRENCY_LIBRARY: CurrencyEntry[] = [
  { code: 'CNY', nameZh: '人民币', symbol: '¥', decimals: 2 },
  { code: 'USD', nameZh: '美元', symbol: '$', decimals: 2 },
  { code: 'EUR', nameZh: '欧元', symbol: '€', decimals: 2 },
  { code: 'GBP', nameZh: '英镑', symbol: '£', decimals: 2 },
  { code: 'JPY', nameZh: '日元', symbol: '¥', decimals: 0 },
  { code: 'HKD', nameZh: '港币', symbol: 'HK$', decimals: 2 },
  { code: 'AUD', nameZh: '澳元', symbol: 'A$', decimals: 2 },
  { code: 'CAD', nameZh: '加元', symbol: 'C$', decimals: 2 },
  { code: 'SGD', nameZh: '新加坡元', symbol: 'S$', decimals: 2 },
  { code: 'KRW', nameZh: '韩元', symbol: '₩', decimals: 0 },
  { code: 'NZD', nameZh: '新西兰元', symbol: 'NZ$', decimals: 2 },
  { code: 'CHF', nameZh: '瑞士法郎', symbol: 'CHF', decimals: 2 },
  { code: 'SEK', nameZh: '瑞典克朗', symbol: 'kr', decimals: 2 },
  { code: 'NOK', nameZh: '挪威克朗', symbol: 'kr', decimals: 2 },
  { code: 'DKK', nameZh: '丹麦克朗', symbol: 'kr', decimals: 2 },
  { code: 'PLN', nameZh: '波兰兹罗提', symbol: 'zł', decimals: 2 },
  { code: 'AED', nameZh: '阿联酋迪拉姆', symbol: 'AED', decimals: 2 },
  { code: 'SAR', nameZh: '沙特里亚尔', symbol: 'SAR', decimals: 2 },
  { code: 'MXN', nameZh: '墨西哥比索', symbol: 'MX$', decimals: 2 },
  { code: 'BRL', nameZh: '巴西雷亚尔', symbol: 'R$', decimals: 2 },
  { code: 'MYR', nameZh: '马来西亚林吉特', symbol: 'RM', decimals: 2 },
  { code: 'THB', nameZh: '泰铢', symbol: '฿', decimals: 2 },
  { code: 'TWD', nameZh: '新台币', symbol: 'NT$', decimals: 2 },
  { code: 'INR', nameZh: '印度卢比', symbol: '₹', decimals: 2 },
];

const CURRENCY_INDEX = new Map<string, CurrencyEntry>(CURRENCY_LIBRARY.map((c) => [c.code, c]));

/**
 * 内置参考基准汇率（1 外币 = ? CNY）。
 * 仅作为「尚未手工录入时」的占位起点，一律标记 source = builtin_reference、
 * updatedAt = null，前端必须显示「未手工更新」提醒。
 */
const BUILTIN_REFERENCE_RATES: Record<string, number> = {
  CNY: 1,
  USD: 7.20, EUR: 7.85, GBP: 9.20, JPY: 0.048, HKD: 0.92,
  AUD: 4.75, CAD: 5.30, SGD: 5.40, KRW: 0.0053, NZD: 4.40,
  CHF: 8.20, SEK: 0.69, NOK: 0.67, DKK: 1.05, PLN: 1.82,
  AED: 1.96, SAR: 1.92, MXN: 0.40, BRL: 1.30, MYR: 1.62,
  THB: 0.21, TWD: 0.22, INR: 0.086,
};

const BUILTIN_RATE_NOTE = '内置参考基准值（离线占位，非实时行情），请录入你的实际结汇汇率';

// ============================================================
// 常量表 6：运输方式与计费参数
// ============================================================

export type ShippingMode = 'air' | 'sea' | 'express';

export interface ShippingModeEntry {
  mode: ShippingMode;
  nameZh: string;
  /** 体积重除数（cm³ → kg） */
  volumetricDivisor: number;
  /** 默认参考单价 CNY/kg（可在测算表单覆盖） */
  defaultRatePerKg: number;
  /** 参考时效（天） */
  leadTimeDays: string;
  note: string;
}

const SHIPPING_MODES: ShippingModeEntry[] = [
  {
    mode: 'express', nameZh: '国际快递', volumetricDivisor: 5000, defaultRatePerKg: 45,
    leadTimeDays: '3-7', note: '按 长×宽×高/5000 计体积重，与实重取大者计费',
  },
  {
    mode: 'air', nameZh: '空运专线', volumetricDivisor: 6000, defaultRatePerKg: 28,
    leadTimeDays: '7-15', note: '按 长×宽×高/6000 计体积重，与实重取大者计费',
  },
  {
    mode: 'sea', nameZh: '海运专线', volumetricDivisor: 6000, defaultRatePerKg: 8,
    leadTimeDays: '30-45', note: '大件泡货按体积重计费，重货按实重计费',
  },
];

const SHIPPING_MODE_INDEX = new Map<ShippingMode, ShippingModeEntry>(
  SHIPPING_MODES.map((m) => [m.mode, m])
);

// ============================================================
// 类型定义
// ============================================================

export interface HSCodeValidationResult {
  hsCode: string;
  valid: boolean;
  format: string;          // 标准化后的格式（去空格/点）
  length: number;
  category?: string;       // 简化的 HS 章节（前 2 位）
  description?: string;    // 基础描述（简化版）
  error?: string;
}

export interface ProhibitedCheckResult {
  productId: string;
  sku: string;
  name: string;
  originCountry: string | null;
  isProhibited: boolean;
  reason: string;
  warnings: string[];
}

export interface VATCalculateResult {
  amount: number;
  rate: number;
  vatAmount: number;
  totalWithVat: number;
  region: string;
  vatNumberValid?: boolean;
}

export interface CurrencyConvertResult {
  fromCurrency: string;
  toCurrency: string;
  originalAmount: number;
  convertedAmount: number;
  rate: number;
  effectiveDate: string;
  source: string;
}

export interface ExchangeRateRecord {
  id: string;
  tenantId: string;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  effectiveDate: string;
  source: string;
  createdAt: string;
}

/** 汇率视图（对前端）：合并「手工录入快照」与「内置参考基准」 */
export interface ExchangeRateView {
  fromCurrency: string;
  toCurrency: string;
  currencyNameZh: string;
  symbol: string;
  rate: number;
  /** manual / builtin_reference / 用户自填来源 */
  source: string;
  /** 手工录入时间；内置基准为 null */
  updatedAt: string | null;
  /** 距今天数；内置基准为 null */
  ageDays: number | null;
  /** 是否为内置占位值（从未手工录入） */
  isBuiltinDefault: boolean;
  /** 超过 7 天未更新，或从未录入 */
  isStale: boolean;
  note: string;
}

/** HS Code 检索结果条目 */
export interface HsCodeSearchItem extends HsCodeEntry {
  /** 各税区参考关税率区间 [min, max] */
  dutyRange: [number, number];
  /** 可读的税率区间描述 */
  dutyRangeText: string;
}

/** 商品跨境合规属性 */
export interface ProductCompliance {
  productId: string;
  sku: string;
  name: string;
  category: string | null;
  hsCode: string | null;
  hsCodeInfo: HsCodeSearchItem | null;
  originCountry: string | null;
  declaredNameEn: string | null;
  declaredValue: number;
  netWeightKg: number;
  grossWeightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  isBattery: boolean;
  isLiquid: boolean;
  isMagnetic: boolean;
  isProhibited: boolean | null; // null = 未评估
  certifications: string[];
  costPrice: number | null;
  sellingPrice: number | null;
  /** 跨境属性最后一次维护时间 */
  updatedAt: string | null;
}

/** 合规体检问题项 */
export interface ComplianceIssue {
  code: string;
  /** blocker=会卡关 / warning=有风险 / info=建议完善 */
  level: 'blocker' | 'warning' | 'info';
  field: string;
  title: string;
  detail: string;
  suggestion: string;
}

export type ComplianceRiskLevel = 'clear' | 'low' | 'medium' | 'high' | 'critical';

export interface ComplianceCheckResult {
  productId: string;
  sku: string;
  name: string;
  targetCountry: string;
  targetCountryNameZh: string;
  riskLevel: ComplianceRiskLevel;
  riskLabel: string;
  /** 合规完成度 0~100 */
  score: number;
  issues: ComplianceIssue[];
  passed: string[];
  requiredCertifications: string[];
  missingCertifications: string[];
  applicableDutyRate: number;
  applicableVatRate: number;
  vatLabel: string;
  vatNote: string;
  deMinimis: number;
  deMinimisCurrency: string;
  checkedAt: string;
}

/** 落地成本测算入参 */
export interface LandedCostInput {
  productId?: string;
  /** 未选商品时手工填写的采购单价（CNY） */
  costPrice?: number;
  qty: number;
  destinationCountry: string;
  sellingPrice: number;
  sellingCurrency: string;
  shippingMode: ShippingMode;
  /** 单件实重（kg），未填则取商品净重 */
  weightKg?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  /** 头程单价 CNY/kg，未填用运输方式默认参考价 */
  freightRatePerKg?: number;
  /** 单件申报价值（CNY），未填按采购价 */
  declaredValuePerUnit?: number;
  hsCode?: string;
  /** 手工覆盖关税率 0~1 */
  dutyRateOverride?: number;
  /** 手工覆盖 VAT 率 0~1 */
  vatRateOverride?: number;
  platformFeeRate: number;
  paymentFeeRate: number;
  adRate: number;
  /** 单件尾程配送费（售价币种） */
  lastMileFeePerUnit?: number;
}

/** 成本瀑布中的一项 */
export interface LandedCostLine {
  key: string;
  label: string;
  amountCny: number;
  amountLocal: number;
  /** 占落地总成本比例 0~1 */
  ratio: number;
  formula: string;
  group: 'goods' | 'logistics' | 'tax' | 'channel';
}

export interface LandedCostResult {
  /** 测算流水号 */
  id: string;
  calculatedAt: string;
  /** 入参回显 */
  input: LandedCostInput;
  productSku: string | null;
  productName: string | null;
  destinationCountry: string;
  destinationNameZh: string;
  localCurrency: string;
  sellingCurrency: string;
  /** 售价币种 → CNY 的换算汇率 */
  fxRate: number;
  fxSource: string;
  fxUpdatedAt: string | null;
  fxIsStale: boolean;
  fxPath: string[];

  qty: number;
  actualWeightKg: number;
  volumetricWeightKg: number;
  chargeableWeightKg: number;
  freightRatePerKg: number;
  shippingModeLabel: string;

  hsCode: string | null;
  hsCodeNameZh: string | null;
  dutyRate: number;
  dutyRateSource: string;
  vatRate: number;
  vatLabel: string;
  vatNote: string;
  declaredValueCny: number;

  /** 成本瀑布 */
  lines: LandedCostLine[];

  revenueCny: number;
  revenueLocal: number;
  totalCostCny: number;
  totalCostLocal: number;
  unitCostCny: number;
  unitCostLocal: number;
  grossProfitCny: number;
  grossProfitLocal: number;
  grossMarginRate: number;
  roi: number;
  /** 盈亏平衡单件售价（售价币种） */
  breakEvenPriceLocal: number;
  breakEvenPriceCny: number;
  /** 提示与口径说明 */
  notes: string[];
}

/** 落地成本历史记录（精简存档） */
export interface LandedCostHistoryItem {
  id: string;
  calculatedAt: string;
  productSku: string | null;
  productName: string | null;
  destinationCountry: string;
  destinationNameZh: string;
  qty: number;
  sellingCurrency: string;
  revenueCny: number;
  totalCostCny: number;
  grossProfitCny: number;
  grossMarginRate: number;
}

export interface CrossBorderOverview {
  generatedAt: string;
  compliance: {
    totalProducts: number;
    withHsCode: number;
    withOriginCountry: number;
    fullyCompliant: number;
    missingHsCode: number;
    missingOriginCountry: number;
    prohibitedCount: number;
    completionRate: number;   // 0~1
  };
  rates: {
    total: number;
    manualCount: number;
    builtinCount: number;
    staleCount: number;
    latestUpdatedAt: string | null;
    oldestUpdatedAt: string | null;
    staleDaysThreshold: number;
    error: string | null;  // 汇率数据加载异常信息
  };
  destinations: Array<{
    country: string;
    nameZh: string;
    orderCount: number;
    amount: number;
    vatRate: number;
  }>;
  recentCalculations: LandedCostHistoryItem[];
  hsLibrarySize: number;
  countryLibrarySize: number;
}

// ============================================================
// 服务实现
// ============================================================

class CrossBorderService {

  // ==========================================================
  // A-1. HS Code 校验（保留原有能力）
  // ==========================================================
  validateHSCode(hsCode: string): HSCodeValidationResult {
    if (!hsCode || typeof hsCode !== 'string') {
      return {
        hsCode: hsCode || '',
        valid: false,
        format: '',
        length: 0,
        error: 'HS Code 不能为空',
      };
    }

    // 标准化：去空格、点、横线
    const format = hsCode.replace(/[\s.\-]/g, '');

    if (!HS_CODE_REGEX.test(format)) {
      return {
        hsCode,
        valid: false,
        format,
        length: format.length,
        error: 'HS Code 格式错误，应为 6-10 位数字',
      };
    }

    // 优先命中内置参考库（前 6 位）
    const entry = HS_CODE_INDEX.get(format.slice(0, 6));
    const chapter = format.substring(0, 2);

    return {
      hsCode,
      valid: true,
      format,
      length: format.length,
      category: entry ? entry.categoryZh : `Chapter ${chapter}`,
      description: entry ? entry.nameZh : this.describeHSChapter(chapter),
    };
  }

  /**
   * 简化版 HS Code 章节描述（前 2 位）
   * 内置参考库未覆盖时的兜底说明
   */
  private describeHSChapter(chapter: string): string {
    const map: Record<string, string> = {
      '01': '活动物',
      '02': '肉类',
      '03': '鱼及水生无脊椎动物',
      '04': '乳品；蛋品；天然蜂蜜',
      '09': '咖啡、茶、马黛茶及调味香料',
      '15': '动、植物油、脂及其分解产品',
      '17': '糖及糖食',
      '22': '饮料、酒及醋',
      '33': '精油及香膏；芳香料制品及化妆盥洗品',
      '39': '塑料及其制品',
      '42': '皮革制品；鞍具及挽具；旅行用品',
      '44': '木及木制品',
      '49': '书籍、报纸、印刷图画及其他印刷品',
      '50': '蚕丝',
      '61': '针织或钩编的服装及衣着附件',
      '62': '非针织或非钩编的服装及衣着附件',
      '63': '其他纺织制成品',
      '64': '鞋靴、护腿和类似品及其零件',
      '69': '陶瓷产品',
      '71': '天然或养殖珍珠、宝石或半宝石、贵金属',
      '73': '钢铁制品',
      '76': '铝及其制品',
      '84': '核反应堆、锅炉、机器及机械器具',
      '85': '电机、电气设备及其零件',
      '87': '车辆及其零件、附件',
      '90': '光学、照相、电影、计量、检验、精密仪器',
      '91': '钟表及其零件',
      '94': '家具；寝具、褥垫、弹簧床、软坐垫及类似的填充制品',
      '95': '玩具、游戏品及运动用品',
      '96': '杂项制品',
      '97': '艺术品、收藏品及古物',
    };
    return map[chapter] || `HS Chapter ${chapter}（需查询详细分类）`;
  }

  // ==========================================================
  // A-2. HS Code 检索
  // ==========================================================

  /** 中英文模糊检索内置 HS Code 参考库 */
  searchHsCode(keyword?: string, limit: number = 50): HsCodeSearchItem[] {
    const kw = (keyword || '').trim().toLowerCase();
    const max = Math.max(1, Math.min(200, limit));

    if (!kw) {
      return HS_CODE_LIBRARY.slice(0, max).map((e) => this.decorateHsEntry(e));
    }

    // 打分：编码前缀 > 中文品名 > 英文品名 > 类目 > 关键词
    const scored: Array<{ entry: HsCodeEntry; score: number }> = [];
    for (const e of HS_CODE_LIBRARY) {
      let score = 0;
      if (e.code.startsWith(kw)) score += 100;
      else if (e.code.includes(kw)) score += 60;
      if (e.nameZh.toLowerCase().includes(kw)) score += 50;
      if (e.nameEn.toLowerCase().includes(kw)) score += 40;
      if (e.categoryZh.toLowerCase().includes(kw)) score += 25;
      if (e.keywords.toLowerCase().includes(kw)) score += 20;
      if (score > 0) scored.push({ entry: e, score });
    }

    return scored
      .sort((a, b) => b.score - a.score || a.entry.code.localeCompare(b.entry.code))
      .slice(0, max)
      .map((s) => this.decorateHsEntry(s.entry));
  }

  /** 精确取一条 HS Code（自动截取前 6 位匹配） */
  getHsCodeEntry(code?: string | null): HsCodeSearchItem | null {
    if (!code) return null;
    const normalized = String(code).replace(/[\s.\-]/g, '').slice(0, 6);
    const entry = HS_CODE_INDEX.get(normalized);
    return entry ? this.decorateHsEntry(entry) : null;
  }

  private decorateHsEntry(e: HsCodeEntry): HsCodeSearchItem {
    const values = Object.values(e.duty);
    const min = Math.min(...values);
    const max = Math.max(...values);
    return {
      ...e,
      dutyRange: [min, max],
      dutyRangeText: min === max
        ? `${(min * 100).toFixed(1)}%`
        : `${(min * 100).toFixed(1)}% ~ ${(max * 100).toFixed(1)}%`,
    };
  }

  // ==========================================================
  // A-3. 商品跨境合规属性读写
  // ==========================================================

  /** 读取单个商品的跨境属性 */
  getProductCompliance(tenantId: string, productId: string): ProductCompliance {
    const db = getDatabase();
    const row = db.prepare(
      `SELECT id, sku, name, category, cost_price, selling_price, attributes,
              hs_code, origin_country, declared_value, is_prohibited, product_weight_kg, updated_at
       FROM products WHERE id = ? AND tenant_id = ?`
    ).get(productId, tenantId) as any;

    if (!row) {
      throw new NotFoundError('商品', productId);
    }
    return this.mapProductCompliance(row);
  }

  /** 批量列出商品跨境属性（合规管理列表页用） */
  listProductCompliance(
    tenantId: string,
    opts?: { keyword?: string; onlyIncomplete?: boolean; limit?: number }
  ): ProductCompliance[] {
    const db = getDatabase();
    const limit = Math.max(1, Math.min(500, opts?.limit || 200));
    const kw = (opts?.keyword || '').trim();

    let sql = `SELECT id, sku, name, category, cost_price, selling_price, attributes,
                      hs_code, origin_country, declared_value, is_prohibited, product_weight_kg, updated_at
               FROM products WHERE tenant_id = ?`;
    const params: unknown[] = [tenantId];

    if (kw) {
      sql += ' AND (sku LIKE ? OR name LIKE ? OR IFNULL(hs_code, \'\') LIKE ?)';
      const like = `%${kw}%`;
      params.push(like, like, like);
    }
    if (opts?.onlyIncomplete) {
      sql += " AND (hs_code IS NULL OR hs_code = '' OR origin_country IS NULL OR origin_country = '')";
    }
    sql += ' ORDER BY updated_at DESC LIMIT ?';
    params.push(limit);

    const rows = db.prepare(sql).all(...params) as any[];
    return rows.map((r) => this.mapProductCompliance(r));
  }

  /** 写入/更新商品跨境属性 */
  upsertProductCompliance(
    tenantId: string,
    productId: string,
    data: {
      hsCode?: string | null;
      originCountry?: string | null;
      declaredNameEn?: string | null;
      declaredValue?: number | null;
      netWeightKg?: number | null;
      grossWeightKg?: number | null;
      lengthCm?: number | null;
      widthCm?: number | null;
      heightCm?: number | null;
      isBattery?: boolean;
      isLiquid?: boolean;
      isMagnetic?: boolean;
      isProhibited?: boolean;
      certifications?: string[];
    }
  ): ProductCompliance {
    const db = getDatabase();
    const existing = db.prepare(
      'SELECT id, attributes FROM products WHERE id = ? AND tenant_id = ?'
    ).get(productId, tenantId) as any;

    if (!existing) {
      throw new NotFoundError('商品', productId);
    }

    // HS Code 校验
    let hsCode: string | null | undefined = data.hsCode;
    if (hsCode !== undefined && hsCode !== null && String(hsCode).trim() !== '') {
      const check = this.validateHSCode(String(hsCode));
      if (!check.valid) {
        throw new ValidationError(check.error || 'HS Code 格式不正确');
      }
      hsCode = check.format;
    } else if (hsCode !== undefined) {
      hsCode = null;
    }

    // 原产国校验：ISO 2 位字母
    let originCountry: string | null | undefined = data.originCountry;
    if (originCountry !== undefined && originCountry !== null && String(originCountry).trim() !== '') {
      const oc = String(originCountry).trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(oc)) {
        throw new ValidationError('原产国须为 2 位 ISO 国家代码，例如 CN / VN / US');
      }
      originCountry = oc;
    } else if (originCountry !== undefined) {
      originCountry = null;
    }

    // 合并 attributes.crossborder
    let attributes: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(existing.attributes || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        attributes = parsed as Record<string, unknown>;
      }
    } catch { attributes = {}; }

    const prevCb = (attributes.crossborder && typeof attributes.crossborder === 'object'
      ? attributes.crossborder
      : {}) as Record<string, unknown>;

    const nextCb: Record<string, unknown> = { ...prevCb };
    if (data.declaredNameEn !== undefined) nextCb.declaredNameEn = data.declaredNameEn || null;
    if (data.grossWeightKg !== undefined) nextCb.grossWeightKg = numOrNull(data.grossWeightKg);
    if (data.lengthCm !== undefined) nextCb.lengthCm = numOrNull(data.lengthCm);
    if (data.widthCm !== undefined) nextCb.widthCm = numOrNull(data.widthCm);
    if (data.heightCm !== undefined) nextCb.heightCm = numOrNull(data.heightCm);
    if (data.isBattery !== undefined) nextCb.isBattery = !!data.isBattery;
    if (data.isLiquid !== undefined) nextCb.isLiquid = !!data.isLiquid;
    if (data.isMagnetic !== undefined) nextCb.isMagnetic = !!data.isMagnetic;
    if (data.certifications !== undefined) {
      nextCb.certifications = Array.isArray(data.certifications)
        ? data.certifications.map((c) => String(c).trim()).filter(Boolean)
        : [];
    }
    nextCb.updatedAt = new Date().toISOString();
    attributes.crossborder = nextCb;

    // 拼装动态 UPDATE（只更新传入的列）
    const sets: string[] = ['attributes = ?', "updated_at = datetime('now', '+0000')"];
    const params: unknown[] = [JSON.stringify(attributes)];

    if (hsCode !== undefined) { sets.unshift('hs_code = ?'); params.unshift(hsCode); }
    if (originCountry !== undefined) { sets.push('origin_country = ?'); params.push(originCountry); }
    if (data.declaredValue !== undefined) { sets.push('declared_value = ?'); params.push(numOrZero(data.declaredValue)); }
    if (data.netWeightKg !== undefined) { sets.push('product_weight_kg = ?'); params.push(numOrZero(data.netWeightKg)); }
    // DA-03: 允许将 is_prohibited 更新为 NULL（解除评估状态）
    if (data.isProhibited !== undefined) {
      sets.push('is_prohibited = ?');
      params.push(data.isProhibited === true ? 1 : (data.isProhibited === false ? 0 : null));
    }

    params.push(productId, tenantId);

    db.prepare(
      `UPDATE products SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`
    ).run(...params);

    logger.info('crossborder', `Product compliance updated: ${productId}`);
    return this.getProductCompliance(tenantId, productId);
  }

  private mapProductCompliance(row: any): ProductCompliance {
    let cb: Record<string, any> = {};
    try {
      const parsed = JSON.parse(row.attributes || '{}');
      if (parsed && typeof parsed === 'object' && parsed.crossborder && typeof parsed.crossborder === 'object') {
        cb = parsed.crossborder;
      }
    } catch { cb = {}; }

    return {
      productId: row.id,
      sku: row.sku,
      name: row.name,
      category: row.category ?? null,
      hsCode: row.hs_code || null,
      hsCodeInfo: this.getHsCodeEntry(row.hs_code),
      originCountry: row.origin_country || null,
      declaredNameEn: cb.declaredNameEn ?? null,
      declaredValue: Number(row.declared_value || 0),
      netWeightKg: Number(row.product_weight_kg || 0),
      grossWeightKg: Number(cb.grossWeightKg || 0),
      lengthCm: Number(cb.lengthCm || 0),
      widthCm: Number(cb.widthCm || 0),
      heightCm: Number(cb.heightCm || 0),
      isBattery: !!cb.isBattery,
      isLiquid: !!cb.isLiquid,
      isMagnetic: !!cb.isMagnetic,
      // DA-03: isProhibited NULL → null（未评估），而非 false（非违禁）
      isProhibited: row.is_prohibited === 1 ? true : (row.is_prohibited === 0 ? false : null),
      certifications: Array.isArray(cb.certifications) ? cb.certifications.map(String) : [],
      costPrice: row.cost_price === null || row.cost_price === undefined ? null : Number(row.cost_price),
      sellingPrice: row.selling_price === null || row.selling_price === undefined ? null : Number(row.selling_price),
      updatedAt: cb.updatedAt ?? null,
    };
  }

  // ==========================================================
  // A-4. 合规体检
  // ==========================================================

  checkCompliance(tenantId: string, productId: string, targetCountry: string): ComplianceCheckResult {
    const cp = this.getProductCompliance(tenantId, productId);
    const cc = String(targetCountry || '').trim().toUpperCase();
    const c = COUNTRY_INDEX.get(cc);

    if (!c) {
      throw new ValidationError(
        `暂不支持目的国 ${targetCountry}，当前内置 ${COUNTRY_LIBRARY.length} 个主要目的国，可在「目的国清单」中查看`
      );
    }

    const issues: ComplianceIssue[] = [];
    const passed: string[] = [];
    const warnings: string[] = [];

    // 1. HS Code
    if (!cp.hsCode) {
      issues.push({
        code: 'MISSING_HS_CODE',
        level: 'blocker',
        field: 'hsCode',
        title: '缺少 HS Code',
        detail: '未填写 HS 编码，无法确定适用关税率，报关单无法生成。',
        suggestion: '在「HS Code 查询」中按品名检索并回填，或向货代索取归类建议。',
      });
    } else {
      const v = this.validateHSCode(cp.hsCode);
      if (!v.valid) {
        issues.push({
          code: 'INVALID_HS_CODE',
          level: 'blocker',
          field: 'hsCode',
          title: 'HS Code 格式不规范',
          detail: v.error || '编码不是 6-10 位数字。',
          suggestion: '改为 6 位或 10 位纯数字编码。',
        });
      } else if (!cp.hsCodeInfo) {
        issues.push({
          code: 'HS_CODE_NOT_IN_LIBRARY',
          level: 'info',
          field: 'hsCode',
          title: 'HS Code 不在内置参考库中',
          detail: `编码 ${cp.hsCode} 格式正确，但未收录在本系统的常用类目速查表内，关税率需手工确认。`,
          suggestion: '测算落地成本时手工填写关税率，或向清关行确认目的国税则。',
        });
        passed.push('HS Code 格式校验通过');
      } else {
        passed.push(`HS Code 已填报：${cp.hsCode}（${cp.hsCodeInfo.nameZh}）`);
      }
    }

    // 2. 原产国
    if (!cp.originCountry) {
      issues.push({
        code: 'MISSING_ORIGIN_COUNTRY',
        level: 'blocker',
        field: 'originCountry',
        title: '缺少原产国',
        detail: '原产国是清关必填项，也决定能否享受优惠税率。',
        suggestion: '填写 2 位 ISO 国家代码，例如中国填 CN。',
      });
    } else {
      passed.push(`原产国已填报：${cp.originCountry}`);
    }

    // 3. 英文申报品名
    if (!cp.declaredNameEn || cp.declaredNameEn.trim().length < 3) {
      issues.push({
        code: 'MISSING_DECLARED_NAME_EN',
        level: 'warning',
        field: 'declaredNameEn',
        title: '缺少英文申报品名',
        detail: '英文申报品名缺失或过短，容易被海关判定申报不清而查验。',
        suggestion: cp.hsCodeInfo
          ? `可参考内置英文品名：${cp.hsCodeInfo.nameEn}`
          : '填写具体材质 + 用途的英文描述，避免使用 gift / sample 等笼统词。',
      });
    } else {
      passed.push('英文申报品名已填写');
    }

    // 4. 申报价值低报风险
    if (cp.declaredValue <= 0) {
      issues.push({
        code: 'MISSING_DECLARED_VALUE',
        level: 'warning',
        field: 'declaredValue',
        title: '未填写申报价值',
        detail: '申报价值为 0，无法计算关税与进口增值税。',
        suggestion: '按实际成交价或采购成本填写申报价值。',
      });
    } else if (cp.costPrice && cp.costPrice > 0 && cp.declaredValue < cp.costPrice * 0.3) {
      issues.push({
        code: 'UNDERVALUED_DECLARATION',
        level: 'warning',
        field: 'declaredValue',
        title: '申报价值异常偏低，存在低报风险',
        detail: `申报价值 ${cp.declaredValue.toFixed(2)} 低于采购成本 ${cp.costPrice.toFixed(2)} 的 30%，海关系统易触发价格质疑。`,
        suggestion: '按真实成交价申报；确需低报请准备价格说明与采购凭证。',
      });
    } else {
      passed.push('申报价值填写合理');
    }

    // 5. 重量
    if (cp.netWeightKg <= 0) {
      issues.push({
        code: 'MISSING_NET_WEIGHT',
        level: 'warning',
        field: 'netWeightKg',
        title: '缺少商品净重',
        detail: '无净重数据，无法计算头程运费与体积重。',
        suggestion: '填写单件净重（kg）。',
      });
    } else {
      passed.push('净重已填写');
      if (cp.grossWeightKg > 0 && cp.grossWeightKg < cp.netWeightKg) {
        issues.push({
          code: 'GROSS_LESS_THAN_NET',
          level: 'info',
          field: 'grossWeightKg',
          title: '毛重小于净重',
          detail: `毛重 ${cp.grossWeightKg}kg 小于净重 ${cp.netWeightKg}kg，数据存在矛盾。`,
          suggestion: '毛重应为净重加包装重量，请复核。',
        });
      }
    }

    // 6. 带电 / 液体 / 磁性 特殊货
    if (cp.isBattery) {
      const certs = cp.certifications.map((x) => x.toUpperCase());
      const hasUn38 = certs.some((x) => x.includes('UN38') || x.includes('UN 38'));
      const hasMsds = certs.some((x) => x.includes('MSDS') || x.includes('SDS'));
      if (!hasUn38 || !hasMsds) {
        issues.push({
          code: 'BATTERY_DOC_MISSING',
          level: 'blocker',
          field: 'certifications',
          title: '带电商品缺少运输鉴定文件',
          detail: `已标记为含电池商品，但认证清单中缺少 ${!hasUn38 ? 'UN38.3' : ''}${!hasUn38 && !hasMsds ? ' 与 ' : ''}${!hasMsds ? 'MSDS/SDS' : ''}。空运与快递渠道会直接拒收。`,
          suggestion: '向电芯厂索取 UN38.3 测试报告与 MSDS，并补录到认证清单。',
        });
      } else {
        passed.push('带电商品已备齐 UN38.3 与 MSDS');
      }
    }
    if (cp.isLiquid) {
      issues.push({
        code: 'LIQUID_SHIPPING_RESTRICTION',
        level: 'info',
        field: 'isLiquid',
        title: '液体商品运输受限',
        detail: '液体属于敏感货，普通空运与快递渠道多数不接受或需走特货专线。',
        suggestion: '提前与货代确认可收渠道，并准备成分说明。',
      });
    }
    if (cp.isMagnetic) {
      issues.push({
        code: 'MAGNETIC_SHIPPING_RESTRICTION',
        level: 'info',
        field: 'isMagnetic',
        title: '磁性商品需磁检',
        detail: '含磁商品空运需提供磁检报告，否则航司可能拒载。',
        suggestion: '出运前办理磁检并做好屏蔽包装。',
      });
    }

    // 7. 禁运标记
    if (cp.isProhibited === true) {
      issues.push({
        code: 'MARKED_PROHIBITED',
        level: 'blocker',
        field: 'isProhibited',
        title: '商品已被标记为禁运品',
        detail: '该 SKU 在系统中被显式标记为禁运，不应安排出运。',
        suggestion: '确认标记原因；若为误标请在合规管理中取消勾选。',
      });
    } else if (cp.isProhibited === null) {
      issues.push({
        code: 'IS_PROHIBITED_NOT_ASSESSED',
        level: 'warning',
        field: 'isProhibited',
        title: '跨境禁运属性未评估',
        detail: '该商品尚未在合规管理中设置"是否违禁"标记，合规体检无法判断。',
        suggestion: '请在「跨境合规管理」中为该商品补充禁运评估。',
      });
    }

    // 8. 目的国认证要求
    const category = cp.hsCodeInfo?.categoryZh || '';
    const requiredCerts = category ? requiredCertificationsFor(category, c) : [];
    const ownedUpper = new Set(cp.certifications.map((x) => x.toUpperCase().replace(/\s+/g, '')));
    const missingCerts = requiredCerts.filter(
      (r) => !ownedUpper.has(r.toUpperCase().replace(/\s+/g, ''))
    );

    if (requiredCerts.length > 0) {
      if (missingCerts.length > 0) {
        issues.push({
          code: 'MISSING_CERTIFICATIONS',
          level: 'blocker',
          field: 'certifications',
          title: `目的国 ${c.nameZh} 缺失必要认证`,
          detail: `类目「${category}」出口 ${c.nameZh} 通常需要：${requiredCerts.join('、')}；当前缺少：${missingCerts.join('、')}。`,
          suggestion: '联系第三方检测机构办理，取证后补录到认证清单。',
        });
      } else {
        passed.push(`${c.nameZh} 所需认证已齐备：${requiredCerts.join('、')}`);
      }
    } else if (category) {
      passed.push(`类目「${category}」出口 ${c.nameZh} 无内置强制认证要求`);
    }

    // 9. 评分与风险等级
    const blockerCount = issues.filter((i) => i.level === 'blocker').length;
    const warningCount = issues.filter((i) => i.level === 'warning').length;
    const infoCount = issues.filter((i) => i.level === 'info').length;

    let score = 100 - blockerCount * 25 - warningCount * 10 - infoCount * 3;
    score = Math.max(0, Math.min(100, score));

    let riskLevel: ComplianceRiskLevel;
    if (blockerCount >= 3 || cp.isProhibited === true) riskLevel = 'critical';
    else if (blockerCount >= 1) riskLevel = 'high';
    else if (warningCount >= 2) riskLevel = 'medium';
    else if (warningCount >= 1 || infoCount >= 1) riskLevel = 'low';
    else riskLevel = 'clear';

    const riskLabelMap: Record<ComplianceRiskLevel, string> = {
      clear: '合规',
      low: '低风险',
      medium: '中风险',
      high: '高风险',
      critical: '严重风险',
    };

    const dutyRate = cp.hsCodeInfo ? cp.hsCodeInfo.duty[c.dutyZone] : 0;

    return {
      productId: cp.productId,
      sku: cp.sku,
      name: cp.name,
      targetCountry: c.code,
      targetCountryNameZh: c.nameZh,
      riskLevel,
      riskLabel: riskLabelMap[riskLevel],
      score,
      issues,
      passed,
      requiredCertifications: requiredCerts,
      missingCertifications: missingCerts,
      applicableDutyRate: dutyRate,
      applicableVatRate: c.vatRate,
      vatLabel: c.vatLabel,
      vatNote: c.vatNote,
      deMinimis: c.deMinimis,
      deMinimisCurrency: c.currency,
      checkedAt: new Date().toISOString(),
    };
  }

  // ==========================================================
  // A-5. 违禁品检查（保留原有能力）
  // ==========================================================
  checkProhibited(tenantId: string, productId: string): ProhibitedCheckResult {
    const db = getDatabase();
    const product = db.prepare(
      'SELECT id, sku, name, origin_country, is_prohibited, hs_code, declared_value, product_weight_kg FROM products WHERE id = ? AND tenant_id = ?'
    ).get(productId, tenantId) as any;

    if (!product) {
      throw new NotFoundError('商品', productId);
    }

    const warnings: string[] = [];
    const originCountry = product.origin_country as string | null;

    // 已显式标记为违禁
    if (product.is_prohibited === 1) {
      return {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        originCountry,
        isProhibited: true,
        reason: '商品已被显式标记为禁运品',
        warnings,
      };
    }

    // 简化违禁检查：基于原产国/HS Code 章节给出提示
    const hsCheck = product.hs_code ? this.validateHSCode(product.hs_code) : null;

    // 常见限制原产国（普遍制裁/管制地区）
    const restrictedOrigins = new Set(['IR', 'KP', 'SY', 'CU']);
    if (originCountry && restrictedOrigins.has(originCountry.toUpperCase())) {
      return {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        originCountry,
        isProhibited: true,
        reason: `原产国 ${originCountry} 属于普遍制裁/限制地区`,
        warnings,
      };
    }

    // 申报价值异常
    if (product.declared_value !== null && product.declared_value <= 0) {
      warnings.push('申报价值为空或零，建议填写准确申报价值以避免海关查验');
    }

    // HS Code 缺失
    if (!product.hs_code) {
      warnings.push('缺少 HS Code，无法自动判断关税与合规要求');
    } else if (hsCheck && !hsCheck.valid) {
      warnings.push(`HS Code 格式不规范: ${hsCheck.error}`);
    }

    // 重量缺失
    if (!product.product_weight_kg || product.product_weight_kg <= 0) {
      warnings.push('缺少商品重量，无法计算运费与跨境物流费用');
    }

    return {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      originCountry,
      isProhibited: false,
      reason: '未发现明显违禁特征',
      warnings,
    };
  }

  // ==========================================================
  // B-1. 目的国与币种清单
  // ==========================================================

  listCountries(): CountryEntry[] {
    return COUNTRY_LIBRARY.slice();
  }

  getCountry(code?: string | null): CountryEntry | null {
    if (!code) return null;
    return COUNTRY_INDEX.get(String(code).trim().toUpperCase()) || null;
  }

  listCurrencies(): CurrencyEntry[] {
    return CURRENCY_LIBRARY.slice();
  }

  // ==========================================================
  // B-2. VAT 计算（保留原有能力）
  // ==========================================================
  calculateVAT(
    amount: number,
    rate: number,
    options?: { destinationCountry?: string; vatNumber?: string }
  ): VATCalculateResult {
    if (typeof amount !== 'number' || isNaN(amount) || amount < 0) {
      throw new ValidationError('金额必须为非负数字');
    }
    if (typeof rate !== 'number' || isNaN(rate) || rate < 0 || rate > 1) {
      throw new ValidationError('VAT 税率必须为 0-1 之间的小数（如 0.20 表示 20%）');
    }

    const vatAmount = round2(amount * rate);
    const totalWithVat = round2(amount + vatAmount);

    const region = options?.destinationCountry
      ? (EU_COUNTRIES.has(options.destinationCountry.toUpperCase()) ? 'EU' : 'non-EU')
      : 'unknown';

    // 简化 VAT 号格式校验（EU 国家以 2 位国别码开头）
    let vatNumberValid: boolean | undefined;
    if (options?.vatNumber) {
      const vat = options.vatNumber.replace(/[\s.\-]/g, '').toUpperCase();
      vatNumberValid = vat.length >= 8 && /^[A-Z]{2}/.test(vat);
    }

    return {
      amount: round2(amount),
      rate,
      vatAmount,
      totalWithVat,
      region,
      vatNumberValid,
    };
  }

  // ==========================================================
  // B-3. 汇率：视图 / 录入 / 换算
  // ==========================================================

  /**
   * 取当前租户的汇率表（外币 → CNY）。
   * 手工录入的最新快照优先；没有录入过的币种回落到内置参考基准，
   * 并明确标记 isBuiltinDefault = true、updatedAt = null。
   */
  getExchangeRates(tenantId: string): ExchangeRateView[] {
    const db = getDatabase();

    // 取每个 from 币种（→CNY）的最新一条手工快照
    let rows: any[] = [];
    try {
      rows = db.prepare(
        `SELECT from_currency, to_currency, rate, effective_date, source, created_at
         FROM exchange_rates
         WHERE tenant_id = ? AND to_currency = 'CNY'
         ORDER BY effective_date DESC, created_at DESC`
      ).all(tenantId) as any[];
    } catch (e) {
      logger.warn('crossborder', `getExchangeRates query failed: ${String(e)}`);
      rows = [];
    }

    const latestByFrom = new Map<string, any>();
    for (const r of rows) {
      if (!latestByFrom.has(r.from_currency)) latestByFrom.set(r.from_currency, r);
    }

    const now = Date.now();
    return CURRENCY_LIBRARY.map((cur) => {
      if (cur.code === 'CNY') {
        return {
          fromCurrency: 'CNY',
          toCurrency: 'CNY',
          currencyNameZh: cur.nameZh,
          symbol: cur.symbol,
          rate: 1,
          source: 'base',
          updatedAt: null,
          ageDays: null,
          isBuiltinDefault: false,
          isStale: false,
          note: '本位币，无需维护',
        } as ExchangeRateView;
      }

      const snap = latestByFrom.get(cur.code);
      if (snap) {
        const updatedAt = snap.created_at || snap.effective_date || null;
        const ageDays = updatedAt ? Math.max(0, Math.floor((now - Date.parse(replaceSpaceT(updatedAt))) / 86400000)) : null;
        return {
          fromCurrency: cur.code,
          toCurrency: 'CNY',
          currencyNameZh: cur.nameZh,
          symbol: cur.symbol,
          rate: Number(snap.rate),
          source: snap.source || 'manual',
          updatedAt,
          ageDays,
          isBuiltinDefault: false,
          isStale: ageDays !== null && ageDays > RATE_STALE_DAYS,
          note: ageDays !== null && ageDays > RATE_STALE_DAYS
            ? `已 ${ageDays} 天未更新，建议重新录入`
            : '手工维护',
        } as ExchangeRateView;
      }

      const fallback = BUILTIN_REFERENCE_RATES[cur.code];
      return {
        fromCurrency: cur.code,
        toCurrency: 'CNY',
        currencyNameZh: cur.nameZh,
        symbol: cur.symbol,
        rate: typeof fallback === 'number' ? fallback : 0,
        source: 'builtin_reference',
        updatedAt: null,
        ageDays: null,
        isBuiltinDefault: true,
        isStale: true,
        note: BUILTIN_RATE_NOTE,
      } as ExchangeRateView;
    });
  }

  /**
   * 录入/更新一条汇率（写入快照表，保留历史）。
   * 同一币种对同一天重复录入时覆盖当天记录，避免无意义膨胀。
   */
  upsertExchangeRate(
    tenantId: string,
    input: { from: string; to?: string; rate: number; source?: string }
  ): ExchangeRateView {
    const db = getDatabase();
    const fromC = String(input.from || '').toUpperCase();
    const toC = String(input.to || 'CNY').toUpperCase();

    if (!SUPPORTED_CURRENCIES.has(fromC)) {
      throw new ValidationError(`不支持的源币种: ${fromC}`);
    }
    if (!SUPPORTED_CURRENCIES.has(toC)) {
      throw new ValidationError(`不支持的目标币种: ${toC}`);
    }
    if (fromC === toC) {
      throw new ValidationError('源币种与目标币种不能相同');
    }
    if (typeof input.rate !== 'number' || isNaN(input.rate) || input.rate <= 0) {
      throw new ValidationError('汇率必须为正数');
    }

    const effectiveDate = new Date().toISOString().slice(0, 10);
    const source = (input.source || 'manual').slice(0, 40);

    // 覆盖当天同币种对的记录
    db.prepare(
      `DELETE FROM exchange_rates
       WHERE tenant_id = ? AND from_currency = ? AND to_currency = ? AND effective_date = ?`
    ).run(tenantId, fromC, toC, effectiveDate);

    db.prepare(
      `INSERT INTO exchange_rates (id, tenant_id, from_currency, to_currency, rate, effective_date, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+0000'))`
    ).run(uuidv4(), tenantId, fromC, toC, input.rate, effectiveDate, source);

    logger.info('crossborder', `Exchange rate saved (manual): ${fromC}->${toC} = ${input.rate}`);

    const all = this.getExchangeRates(tenantId);
    const hit = all.find((r) => r.fromCurrency === fromC);
    if (hit) return hit;

    return {
      fromCurrency: fromC,
      toCurrency: toC,
      currencyNameZh: CURRENCY_INDEX.get(fromC)?.nameZh || fromC,
      symbol: CURRENCY_INDEX.get(fromC)?.symbol || '',
      rate: input.rate,
      source,
      updatedAt: new Date().toISOString(),
      ageDays: 0,
      isBuiltinDefault: false,
      isStale: false,
      note: '手工维护',
    };
  }

  /**
   * 币种换算。找不到直接汇率时通过 CNY 中转。
   * rates 为 getExchangeRates() 的结果（外币 → CNY）。
   */
  convert(
    amount: number,
    from: string,
    to: string,
    rates: ExchangeRateView[]
  ): { amount: number; rate: number; path: string[]; resolved: boolean; source: string; updatedAt: string | null; isStale: boolean } {
    const fromC = String(from || '').toUpperCase();
    const toC = String(to || '').toUpperCase();

    if (!fromC || !toC) {
      throw new ValidationError('源币种与目标币种不能为空');
    }
    if (fromC === toC) {
      return { amount: round2(amount), rate: 1, path: [fromC], resolved: true, source: 'identity', updatedAt: null, isStale: false };
    }

    const byCode = new Map(rates.map((r) => [r.fromCurrency, r]));

    // 直接：X → CNY
    if (toC === 'CNY') {
      const r = byCode.get(fromC);
      if (r && r.rate > 0) {
        return {
          amount: round2(amount * r.rate), rate: r.rate, path: [fromC, 'CNY'],
          resolved: true, source: r.source, updatedAt: r.updatedAt, isStale: r.isStale,
        };
      }
    }
    // 反向：CNY → X
    if (fromC === 'CNY') {
      const r = byCode.get(toC);
      if (r && r.rate > 0) {
        const rate = 1 / r.rate;
        return {
          amount: round2(amount * rate), rate: round6(rate), path: ['CNY', toC],
          resolved: true, source: r.source, updatedAt: r.updatedAt, isStale: r.isStale,
        };
      }
    }
    // 中转：X → CNY → Y
    const rFrom = byCode.get(fromC);
    const rTo = byCode.get(toC);
    if (rFrom && rTo && rFrom.rate > 0 && rTo.rate > 0) {
      const rate = rFrom.rate / rTo.rate;
      return {
        amount: round2(amount * rate),
        rate: round6(rate),
        path: [fromC, 'CNY', toC],
        resolved: true,
        source: `${rFrom.source}+${rTo.source}`,
        updatedAt: pickOlder(rFrom.updatedAt, rTo.updatedAt),
        isStale: rFrom.isStale || rTo.isStale,
      };
    }

    return { amount: 0, rate: 0, path: [fromC, toC], resolved: false, source: 'unavailable', updatedAt: null, isStale: true };
  }

  // ==========================================================
  // B-4. 汇率快照（保留原有能力，向后兼容旧端点）
  // ==========================================================

  convertCurrency(
    amount: number,
    from: string,
    to: string,
    rate?: number
  ): CurrencyConvertResult {
    if (typeof amount !== 'number' || isNaN(amount)) {
      throw new ValidationError('金额必须为数字');
    }
    const fromC = (from || '').toUpperCase();
    const toC = (to || '').toUpperCase();
    if (!fromC || !toC) {
      throw new ValidationError('源币种与目标币种不能为空');
    }
    if (!SUPPORTED_CURRENCIES.has(fromC)) {
      throw new ValidationError(`不支持的源币种: ${fromC}`);
    }
    if (!SUPPORTED_CURRENCIES.has(toC)) {
      throw new ValidationError(`不支持的目标币种: ${toC}`);
    }
    if (fromC === toC) {
      return {
        fromCurrency: fromC,
        toCurrency: toC,
        originalAmount: round2(amount),
        convertedAmount: round2(amount),
        rate: 1.0,
        effectiveDate: new Date().toISOString().slice(0, 10),
        source: 'identity',
      };
    }

    const useRate = rate;
    const source = 'manual';
    const effectiveDate = new Date().toISOString().slice(0, 10);

    if (useRate === undefined || useRate === null) {
      throw new ValidationError('请提供汇率 rate 参数，或先调用 getLatestRate 获取');
    }
    if (typeof useRate !== 'number' || isNaN(useRate) || useRate <= 0) {
      throw new ValidationError('汇率必须为正数');
    }

    return {
      fromCurrency: fromC,
      toCurrency: toC,
      originalAmount: round2(amount),
      convertedAmount: round2(amount * useRate),
      rate: useRate,
      effectiveDate,
      source,
    };
  }

  createExchangeRate(input: {
    tenantId: string;
    fromCurrency: string;
    toCurrency: string;
    rate: number;
    effectiveDate?: string;
    source?: string;
  }): ExchangeRateRecord {
    const db = getDatabase();
    const fromC = (input.fromCurrency || '').toUpperCase();
    const toC = (input.toCurrency || '').toUpperCase();

    if (!fromC || !toC) {
      throw new ValidationError('源币种与目标币种不能为空');
    }
    if (fromC === toC) {
      throw new ValidationError('源币种与目标币种不能相同');
    }
    if (!SUPPORTED_CURRENCIES.has(fromC)) {
      throw new ValidationError(`不支持的源币种: ${fromC}`);
    }
    if (!SUPPORTED_CURRENCIES.has(toC)) {
      throw new ValidationError(`不支持的目标币种: ${toC}`);
    }
    if (typeof input.rate !== 'number' || isNaN(input.rate) || input.rate <= 0) {
      throw new ValidationError('汇率必须为正数');
    }

    const id = uuidv4();
    const effectiveDate = input.effectiveDate || new Date().toISOString().slice(0, 10);
    const source = input.source || 'manual';

    db.prepare(
      `INSERT INTO exchange_rates (id, tenant_id, from_currency, to_currency, rate, effective_date, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+0000'))`
    ).run(id, input.tenantId, fromC, toC, input.rate, effectiveDate, source);

    const record = db.prepare(
      'SELECT * FROM exchange_rates WHERE id = ? AND tenant_id = ?'
    ).get(id, input.tenantId) as any;
    logger.info('crossborder', `Exchange rate created: ${fromC}->${toC} = ${input.rate} (${effectiveDate})`);

    return this.mapRateRecord(record);
  }

  getLatestRate(tenantId: string, from: string, to: string): ExchangeRateRecord | null {
    const db = getDatabase();
    const fromC = (from || '').toUpperCase();
    const toC = (to || '').toUpperCase();
    if (!fromC || !toC) {
      throw new ValidationError('源币种与目标币种不能为空');
    }
    if (fromC === toC) {
      // 同币种直接返回 1
      return {
        id: 'identity',
        tenantId,
        fromCurrency: fromC,
        toCurrency: toC,
        rate: 1.0,
        effectiveDate: new Date().toISOString().slice(0, 10),
        source: 'identity',
        createdAt: new Date().toISOString(),
      };
    }

    const record = db.prepare(
      `SELECT * FROM exchange_rates
       WHERE tenant_id = ? AND from_currency = ? AND to_currency = ?
       ORDER BY effective_date DESC, created_at DESC
       LIMIT 1`
    ).get(tenantId, fromC, toC) as any;

    if (!record) return null;
    return this.mapRateRecord(record);
  }

  // 列出某租户的所有汇率快照（按日期倒序）
  listExchangeRates(tenantId: string, limit: number = 100): ExchangeRateRecord[] {
    const db = getDatabase();
    const rows = db.prepare(
      `SELECT * FROM exchange_rates WHERE tenant_id = ?
       ORDER BY effective_date DESC, created_at DESC LIMIT ?`
    ).all(tenantId, Math.max(1, Math.min(500, limit))) as any[];
    return rows.map((r) => this.mapRateRecord(r));
  }

  private mapRateRecord(row: any): ExchangeRateRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      fromCurrency: row.from_currency,
      toCurrency: row.to_currency,
      rate: row.rate,
      effectiveDate: row.effective_date,
      source: row.source,
      createdAt: row.created_at,
    };
  }

  // ==========================================================
  // C. 落地成本与利润测算
  // ==========================================================

  calculateLandedCost(tenantId: string, input: LandedCostInput): LandedCostResult {
    const notes: string[] = [];

    // ── 1. 参数校验与基础对象 ──
    const qty = Math.max(1, Math.floor(Number(input.qty) || 1));

    const c = this.getCountry(input.destinationCountry);
    if (!c) {
      throw new ValidationError(
        `暂不支持目的国 ${input.destinationCountry}，请从「目的国清单」中选择`
      );
    }

    const sellingCurrency = String(input.sellingCurrency || c.currency).toUpperCase();
    if (!SUPPORTED_CURRENCIES.has(sellingCurrency)) {
      throw new ValidationError(`不支持的售价币种: ${sellingCurrency}`);
    }

    const modeEntry = SHIPPING_MODE_INDEX.get(input.shippingMode);
    if (!modeEntry) {
      throw new ValidationError('运输方式必须是 air（空运）/ sea（海运）/ express（快递）之一');
    }

    const sellingPrice = Number(input.sellingPrice);
    if (!isFinite(sellingPrice) || sellingPrice <= 0) {
      throw new ValidationError('售价必须为正数');
    }

    const platformFeeRate = clampRate(input.platformFeeRate, 'platformFeeRate');
    const paymentFeeRate = clampRate(input.paymentFeeRate, 'paymentFeeRate');
    const adRate = clampRate(input.adRate, 'adRate');
    const variableRate = platformFeeRate + paymentFeeRate + adRate;
    if (variableRate >= 1) {
      throw new ValidationError('平台佣金率 + 支付费率 + 广告费占比之和必须小于 100%');
    }

    // ── 2. 商品信息（可选） ──
    let compliance: ProductCompliance | null = null;
    if (input.productId) {
      compliance = this.getProductCompliance(tenantId, input.productId);
    }

    const unitCostCny = pickNumber(
      input.costPrice,
      compliance?.costPrice,
      0
    );
    if (unitCostCny <= 0) {
      throw new ValidationError('采购成本必须大于 0：请选择已维护成本价的商品，或手工填写采购单价');
    }

    // ── 3. 重量与体积重 ──
    const unitActualWeight = pickNumber(
      input.weightKg,
      compliance?.grossWeightKg && compliance.grossWeightKg > 0 ? compliance.grossWeightKg : undefined,
      compliance?.netWeightKg,
      0
    );
    if (unitActualWeight <= 0) {
      throw new ValidationError('单件重量必须大于 0：请填写重量，或先在合规管理中维护商品净重');
    }

    const lengthCm = pickNumber(input.lengthCm, compliance?.lengthCm, 0);
    const widthCm = pickNumber(input.widthCm, compliance?.widthCm, 0);
    const heightCm = pickNumber(input.heightCm, compliance?.heightCm, 0);

    const unitVolumetric = (lengthCm > 0 && widthCm > 0 && heightCm > 0)
      ? (lengthCm * widthCm * heightCm) / modeEntry.volumetricDivisor
      : 0;

    const actualWeightKg = round4(unitActualWeight * qty);
    const volumetricWeightKg = round4(unitVolumetric * qty);
    const chargeableWeightKg = round4(Math.max(actualWeightKg, volumetricWeightKg));

    if (unitVolumetric <= 0) {
      notes.push('未填写长宽高，头程运费按实重计费；泡货建议补齐尺寸以免低估运费。');
    } else if (volumetricWeightKg > actualWeightKg) {
      notes.push(`体积重 ${volumetricWeightKg}kg 大于实重 ${actualWeightKg}kg，按体积重计费（${modeEntry.note}）。`);
    }

    const freightRatePerKg = pickNumber(input.freightRatePerKg, modeEntry.defaultRatePerKg, 0);
    if (input.freightRatePerKg === undefined || input.freightRatePerKg === null) {
      notes.push(`头程单价使用${modeEntry.nameZh}默认参考价 ${modeEntry.defaultRatePerKg} 元/kg，请按你的实际货代报价覆盖。`);
    }

    // ── 4. 汇率 ──
    const rates = this.getExchangeRates(tenantId);
    const fx = this.convert(1, sellingCurrency, 'CNY', rates);
    if (!fx.resolved || fx.rate <= 0) {
      throw new ValidationError(
        `缺少 ${sellingCurrency} → CNY 的汇率，请先在「汇率管理」中录入`
      );
    }
    const fxRate = fx.rate;
    if (fx.isStale) {
      notes.push(
        fx.source === 'builtin_reference'
          ? `${sellingCurrency} 使用的是内置参考基准汇率（非实时行情），请录入实际结汇汇率后重新测算。`
          : `${sellingCurrency} 汇率已超过 ${RATE_STALE_DAYS} 天未更新，测算结果可能失真。`
      );
    }

    // ── 5. 税率 ──
    const hsCode = (input.hsCode || compliance?.hsCode || null);
    const hsEntry = this.getHsCodeEntry(hsCode);

    let dutyRate: number;
    let dutyRateSource: string;
    if (input.dutyRateOverride !== undefined && input.dutyRateOverride !== null) {
      dutyRate = clampRate(input.dutyRateOverride, 'dutyRateOverride');
      dutyRateSource = '手工指定';
    } else if (hsEntry) {
      dutyRate = hsEntry.duty[c.dutyZone];
      dutyRateSource = `内置参考表（HS ${hsEntry.code} · ${DUTY_ZONE_LABEL[c.dutyZone]}税区）`;
    } else {
      dutyRate = 0;
      dutyRateSource = '未知（无 HS Code，按 0% 计）';
      notes.push('未提供可识别的 HS Code，关税按 0% 估算，实际可能产生关税，请补齐 HS Code 后重算。');
    }

    let vatRate: number;
    if (input.vatRateOverride !== undefined && input.vatRateOverride !== null) {
      vatRate = clampRate(input.vatRateOverride, 'vatRateOverride');
    } else {
      vatRate = c.vatRate;
    }
    if (c.code === 'US') {
      notes.push('美国联邦无进口增值税，此处 VAT 计 0；各州销售税在零售环节另行计算，未纳入本次测算。');
    }

    // ── 6. 逐项成本（全部先折算为 CNY） ──
    const unitDeclaredValue = pickNumber(
      input.declaredValuePerUnit,
      compliance?.declaredValue && compliance.declaredValue > 0 ? compliance.declaredValue : undefined,
      unitCostCny
    );
    const declaredValueCny = round2(unitDeclaredValue * qty);

    const purchaseCost = round2(unitCostCny * qty);
    const freightCost = round2(chargeableWeightKg * freightRatePerKg);
    const dutyCost = round2(declaredValueCny * dutyRate);
    const vatCost = round2((declaredValueCny + dutyCost + freightCost) * vatRate);

    const revenueLocal = round2(sellingPrice * qty);
    const revenueCny = round2(revenueLocal * fxRate);

    const platformFee = round2(revenueCny * platformFeeRate);
    const paymentFee = round2(revenueCny * paymentFeeRate);
    const adCost = round2(revenueCny * adRate);

    const lastMileLocalUnit = Number(input.lastMileFeePerUnit || 0);
    const lastMileCost = round2(lastMileLocalUnit * qty * fxRate);

    const totalCostCny = round2(
      purchaseCost + freightCost + dutyCost + vatCost + platformFee + paymentFee + adCost + lastMileCost
    );

    const toLocal = (cny: number) => round2(fxRate > 0 ? cny / fxRate : 0);
    const ratio = (v: number) => (totalCostCny > 0 ? round4(v / totalCostCny) : 0);

    const lines: LandedCostLine[] = [
      {
        key: 'purchase', label: '采购成本', group: 'goods',
        amountCny: purchaseCost, amountLocal: toLocal(purchaseCost), ratio: ratio(purchaseCost),
        formula: `采购单价 ¥${unitCostCny.toFixed(2)} × ${qty} 件`,
      },
      {
        key: 'freight', label: `头程物流（${modeEntry.nameZh}）`, group: 'logistics',
        amountCny: freightCost, amountLocal: toLocal(freightCost), ratio: ratio(freightCost),
        formula: `计费重 ${chargeableWeightKg}kg × ¥${freightRatePerKg}/kg（实重 ${actualWeightKg}kg / 体积重 ${volumetricWeightKg}kg 取大）`,
      },
      {
        key: 'duty', label: '进口关税', group: 'tax',
        amountCny: dutyCost, amountLocal: toLocal(dutyCost), ratio: ratio(dutyCost),
        formula: `申报价值 ¥${declaredValueCny.toFixed(2)} × 关税率 ${(dutyRate * 100).toFixed(2)}%`,
      },
      {
        key: 'vat', label: `进口${c.vatLabel}`, group: 'tax',
        amountCny: vatCost, amountLocal: toLocal(vatCost), ratio: ratio(vatCost),
        formula: `(申报价值 ¥${declaredValueCny.toFixed(2)} + 关税 ¥${dutyCost.toFixed(2)} + 运费 ¥${freightCost.toFixed(2)}) × ${(vatRate * 100).toFixed(2)}%`,
      },
      {
        key: 'platform', label: '平台佣金', group: 'channel',
        amountCny: platformFee, amountLocal: toLocal(platformFee), ratio: ratio(platformFee),
        formula: `营收 ¥${revenueCny.toFixed(2)} × ${(platformFeeRate * 100).toFixed(2)}%`,
      },
      {
        key: 'payment', label: '支付手续费', group: 'channel',
        amountCny: paymentFee, amountLocal: toLocal(paymentFee), ratio: ratio(paymentFee),
        formula: `营收 ¥${revenueCny.toFixed(2)} × ${(paymentFeeRate * 100).toFixed(2)}%`,
      },
      {
        key: 'ad', label: '广告推广费', group: 'channel',
        amountCny: adCost, amountLocal: toLocal(adCost), ratio: ratio(adCost),
        formula: `营收 ¥${revenueCny.toFixed(2)} × ${(adRate * 100).toFixed(2)}%`,
      },
      {
        key: 'lastmile', label: '尾程配送', group: 'logistics',
        amountCny: lastMileCost, amountLocal: toLocal(lastMileCost), ratio: ratio(lastMileCost),
        formula: lastMileLocalUnit > 0
          ? `${sellingCurrency} ${lastMileLocalUnit.toFixed(2)}/件 × ${qty} 件 × 汇率 ${fxRate}`
          : '未填写尾程配送费，按 0 计',
      },
    ];

    // ── 7. 利润指标 ──
    const grossProfitCny = round2(revenueCny - totalCostCny);
    const grossMarginRate = revenueCny > 0 ? round4(grossProfitCny / revenueCny) : 0;
    const roi = totalCostCny > 0 ? round4(grossProfitCny / totalCostCny) : 0;

    // 盈亏平衡售价：固定成本 F 与售价无关，渠道费按营收比例 v 浮动
    //   营收 R 满足  R × (1 − v) = F  →  R = F / (1 − v)
    const fixedCostCny = round2(purchaseCost + freightCost + dutyCost + vatCost + lastMileCost);
    const breakEvenRevenueCny = round2(fixedCostCny / (1 - variableRate));
    const breakEvenPriceCny = round2(breakEvenRevenueCny / qty);
    const breakEvenPriceLocal = round2(fxRate > 0 ? breakEvenPriceCny / fxRate : 0);

    notes.push('毛利口径：营收 − 落地总成本（含采购/头程/关税/进口税/渠道费/尾程），与业务驾驶舱一致。');

    const result: LandedCostResult = {
      id: uuidv4(),
      calculatedAt: new Date().toISOString(),
      input,
      productSku: compliance?.sku ?? null,
      productName: compliance?.name ?? null,
      destinationCountry: c.code,
      destinationNameZh: c.nameZh,
      localCurrency: c.currency,
      sellingCurrency,
      fxRate,
      fxSource: fx.source,
      fxUpdatedAt: fx.updatedAt,
      fxIsStale: fx.isStale,
      fxPath: fx.path,

      qty,
      actualWeightKg,
      volumetricWeightKg,
      chargeableWeightKg,
      freightRatePerKg,
      shippingModeLabel: modeEntry.nameZh,

      hsCode: hsEntry ? hsEntry.code : (hsCode || null),
      hsCodeNameZh: hsEntry ? hsEntry.nameZh : null,
      dutyRate,
      dutyRateSource,
      vatRate,
      vatLabel: c.vatLabel,
      vatNote: c.vatNote,
      declaredValueCny,

      lines,

      revenueCny,
      revenueLocal,
      totalCostCny,
      totalCostLocal: toLocal(totalCostCny),
      unitCostCny: round2(totalCostCny / qty),
      unitCostLocal: round2(toLocal(totalCostCny) / qty),
      grossProfitCny,
      grossProfitLocal: toLocal(grossProfitCny),
      grossMarginRate,
      roi,
      breakEvenPriceLocal,
      breakEvenPriceCny,
      notes,
    };

    this.appendLandedCostHistory(tenantId, result);
    return result;
  }

  /** 读取最近的测算记录 */
  listLandedCostHistory(tenantId: string, limit: number = 10): LandedCostHistoryItem[] {
    const db = getDatabase();
    try {
      const row = db.prepare(
        'SELECT value FROM system_settings WHERE tenant_id = ? AND key = ?'
      ).get(tenantId, LANDED_COST_HISTORY_KEY) as any;
      if (!row || !row.value) return [];
      const arr = JSON.parse(row.value);
      if (!Array.isArray(arr)) return [];
      return arr.slice(0, Math.max(1, Math.min(LANDED_COST_HISTORY_MAX, limit)));
    } catch (e) {
      logger.warn('crossborder', `listLandedCostHistory failed: ${String(e)}`);
      return [];
    }
  }

  private appendLandedCostHistory(tenantId: string, r: LandedCostResult): void {
    try {
      const prev = this.listLandedCostHistory(tenantId, LANDED_COST_HISTORY_MAX);
      const item: LandedCostHistoryItem = {
        id: r.id,
        calculatedAt: r.calculatedAt,
        productSku: r.productSku,
        productName: r.productName,
        destinationCountry: r.destinationCountry,
        destinationNameZh: r.destinationNameZh,
        qty: r.qty,
        sellingCurrency: r.sellingCurrency,
        revenueCny: r.revenueCny,
        totalCostCny: r.totalCostCny,
        grossProfitCny: r.grossProfitCny,
        grossMarginRate: r.grossMarginRate,
      };
      const next = [item, ...prev].slice(0, LANDED_COST_HISTORY_MAX);

      const db = getDatabase();
      db.prepare(
        `INSERT INTO system_settings (id, tenant_id, key, value, category, updated_at)
         VALUES (?, ?, ?, ?, 'crossborder', datetime('now', '+0000'))
         ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now', '+0000')`
      ).run(uuidv4(), tenantId, LANDED_COST_HISTORY_KEY, JSON.stringify(next));
    } catch (e) {
      // 历史留档失败不影响测算结果本身
      logger.warn('crossborder', `appendLandedCostHistory failed: ${String(e)}`);
    }
  }

  // ==========================================================
  // D. 跨境概览
  // ==========================================================

  getOverview(tenantId: string): CrossBorderOverview {
    const db = getDatabase();

    // ── 合规完成度 ──
    let compliance = {
      totalProducts: 0,
      withHsCode: 0,
      withOriginCountry: 0,
      fullyCompliant: 0,
      missingHsCode: 0,
      missingOriginCountry: 0,
      prohibitedCount: 0,
      completionRate: 0,
    };
    try {
      const row = db.prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN hs_code IS NOT NULL AND hs_code != '' THEN 1 ELSE 0 END) AS with_hs,
           SUM(CASE WHEN origin_country IS NOT NULL AND origin_country != '' THEN 1 ELSE 0 END) AS with_origin,
           SUM(CASE WHEN hs_code IS NOT NULL AND hs_code != ''
                     AND origin_country IS NOT NULL AND origin_country != ''
                     AND declared_value > 0 AND product_weight_kg > 0 THEN 1 ELSE 0 END) AS full_ok,
           SUM(CASE WHEN is_prohibited = 1 THEN 1 ELSE 0 END) AS prohibited
         FROM products
         WHERE tenant_id = ? AND status != 'discontinued'`
      ).get(tenantId) as any;

      const total = Number(row?.total || 0);
      const withHs = Number(row?.with_hs || 0);
      const withOrigin = Number(row?.with_origin || 0);
      const fullOk = Number(row?.full_ok || 0);

      compliance = {
        totalProducts: total,
        withHsCode: withHs,
        withOriginCountry: withOrigin,
        fullyCompliant: fullOk,
        missingHsCode: Math.max(0, total - withHs),
        missingOriginCountry: Math.max(0, total - withOrigin),
        prohibitedCount: Number(row?.prohibited || 0),
        completionRate: total > 0 ? round4(fullOk / total) : 0,
      };
    } catch (e) {
      logger.warn('crossborder', `overview compliance query failed: ${String(e)}`);
    }

    // ── 汇率新鲜度 ──
    let rateViews: ExchangeRateView[] = [];
    let rateError: string | null = null;
    try {
      rateViews = this.getExchangeRates(tenantId).filter((r) => r.fromCurrency !== 'CNY');
    } catch (e) {
      rateError = String(e);
      logger.warn('crossborder', `getOverview getExchangeRates failed: ${String(e)}`);
    }
    const manual = rateViews.filter((r) => !r.isBuiltinDefault);
    const updatedTimes = manual
      .map((r) => r.updatedAt)
      .filter((x): x is string => !!x)
      .map((x) => Date.parse(replaceSpaceT(x)))
      .filter((t) => !isNaN(t))
      .sort((a, b) => a - b);

    const rates = {
      total: rateViews.length,
      manualCount: manual.length,
      builtinCount: rateViews.filter((r) => r.isBuiltinDefault).length,
      staleCount: rateViews.filter((r) => r.isStale).length,
      latestUpdatedAt: updatedTimes.length ? new Date(updatedTimes[updatedTimes.length - 1]).toISOString() : null,
      oldestUpdatedAt: updatedTimes.length ? new Date(updatedTimes[0]).toISOString() : null,
      staleDaysThreshold: RATE_STALE_DAYS,
      error: rateError,
    };

    // ── 目的国分布（来自订单） ──
    let destinations: CrossBorderOverview['destinations'] = [];
    try {
      const rows = db.prepare(
        `SELECT destination_country AS country,
                COUNT(*) AS cnt,
                COALESCE(SUM(total_amount), 0) AS amount
         FROM orders
         WHERE tenant_id = ? AND destination_country IS NOT NULL AND destination_country != ''
         GROUP BY destination_country
         ORDER BY cnt DESC
         LIMIT 10`
      ).all(tenantId) as any[];

      destinations = rows.map((r) => {
        const cc = String(r.country || '').toUpperCase();
        const entry = COUNTRY_INDEX.get(cc);
        return {
          country: cc,
          nameZh: entry ? entry.nameZh : cc,
          orderCount: Number(r.cnt || 0),
          amount: round2(Number(r.amount || 0)),
          vatRate: entry ? entry.vatRate : 0,
        };
      });
    } catch (e) {
      logger.warn('crossborder', `overview destinations query failed: ${String(e)}`);
    }

    return {
      generatedAt: new Date().toISOString(),
      compliance,
      rates,
      destinations,
      recentCalculations: this.listLandedCostHistory(tenantId, 5),
      hsLibrarySize: HS_CODE_LIBRARY.length,
      countryLibrarySize: COUNTRY_LIBRARY.length,
    };
  }

  /** 运输方式清单（前端表单下拉用） */
  listShippingModes(): ShippingModeEntry[] {
    return SHIPPING_MODES.slice();
  }
}

// ============================================================
// 工具函数
// ============================================================

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
function round6(n: number): number {
  return Math.round(n * 1000000) / 1000000;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}
function numOrZero(v: unknown): number {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

/** 依次取第一个有效正数，全部无效则取最后一个参数作为默认值 */
function pickNumber(...candidates: Array<number | null | undefined>): number {
  for (let i = 0; i < candidates.length - 1; i++) {
    const v = candidates[i];
    if (v !== null && v !== undefined) {
      const n = Number(v);
      if (isFinite(n) && n > 0) return n;
    }
  }
  const last = candidates[candidates.length - 1];
  const n = Number(last);
  return isFinite(n) ? n : 0;
}

function clampRate(v: unknown, field: string): number {
  const n = Number(v);
  if (!isFinite(n) || n < 0 || n > 1) {
    throw new ValidationError(`${field} 必须是 0~1 之间的小数（如 0.15 表示 15%）`);
  }
  return n;
}

/** SQLite datetime('now', '+0000') 返回 "YYYY-MM-DD HH:MM:SS"，补成可被 Date.parse 识别的 ISO 形式 */
function replaceSpaceT(s: string): string {
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return `${s.replace(' ', 'T')}Z`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00Z`;
  return s;
}

function pickOlder(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(replaceSpaceT(a)) <= Date.parse(replaceSpaceT(b)) ? a : b;
}

export const crossborderService = new CrossBorderService();
export {
  CrossBorderService,
  SUPPORTED_CURRENCIES,
  EU_COUNTRIES,
  HS_CODE_LIBRARY,
  COUNTRY_LIBRARY,
  CURRENCY_LIBRARY,
  SHIPPING_MODES,
  RATE_STALE_DAYS,
};
