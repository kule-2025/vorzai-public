/**
 * Vorzai 直播电商服务（Livestream Service）
 *
 * 覆盖直播电商全链路的五块能力：
 *   A. 场次管理     live_sessions          —— 排期、状态机（planned → ready → living → ended → reviewed）
 *   B. 直播脚本     live_scripts           —— 分段脚本 CRUD + 自动生成 + 合规检查（核心「教练」价值）
 *   C. 选品排期     live_session_products  —— 选品、讲解时段推算、总时长校验
 *   D. 指标与复盘   live_metrics/live_reviews —— 手工/批量录入快照、UV 价值等核心指标、自动诊断复盘
 *   E. 主播绩效     多场次聚合，喂给 HR 绩效模块
 *
 * ⚠ 数据来源声明：
 *   本服务 **不联网、不对接任何直播平台 API**。live_metrics 全部走「手工录入 + 批量导入」，
 *   source 恒为 'manual'（或调用方显式指定的 'import'）。未来平台对接方接上真实数据流后
 *   再把 source 改成 'api'。任何界面都不得把手工快照包装成「实时数据」。
 *
 * 所有 SQL 严格带 tenant_id 过滤，配合 tenantIsolation 中间件做租户隔离。
 */
import { getDatabase, transaction } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { NotFoundError, ValidationError, ConflictError } from '../utils/errors';
import { logger } from '../utils/logger';

// ══════════════════════════════════════════════════════════
// 一、类型定义
// ══════════════════════════════════════════════════════════

export type LiveSessionStatus = 'planned' | 'ready' | 'living' | 'ended' | 'reviewed' | 'cancelled';
export type LiveSegmentType = 'warmup' | 'sell' | 'interact' | 'flashsale' | 'lottery' | 'closing';

export interface LiveSession {
  id: string;
  tenantId: string;
  projectId: string | null;
  title: string;
  platform: string;
  roomId: string | null;
  anchorEmployeeId: string | null;
  anchorName: string | null;
  assistantEmployeeId: string | null;
  assistantName: string | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  durationMinutes: number;
  targetGmv: number;
  actualGmv: number;
  targetOrders: number;
  actualOrders: number;
  status: LiveSessionStatus;
  coverUrl: string | null;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
  /** GMV 达成率 = actual_gmv / target_gmv，target 为 0 时返回 0 */
  gmvAchievementRate: number;
}

export interface LiveScript {
  id: string;
  tenantId: string;
  sessionId: string;
  segmentNo: number;
  segmentType: LiveSegmentType;
  title: string;
  productId: string | null;
  productName: string | null;
  durationMinutes: number;
  talkTrack: string;
  sellingPoints: string[];
  objectionHandling: Array<{ objection: string; response: string }>;
  ctaText: string;
  complianceFlags: ComplianceFlag[];
  createdAt: string;
  updatedAt: string;
}

export interface LiveSessionProduct {
  id: string;
  tenantId: string;
  sessionId: string;
  productId: string;
  sku: string | null;
  productName: string | null;
  category: string | null;
  sellingPrice: number | null;
  marketPrice: number | null;
  costPrice: number | null;
  stock: number;
  sortOrder: number;
  plannedSlotStart: string | null;
  plannedDurationMinutes: number;
  livePrice: number | null;
  stockLocked: number;
  explainedCount: number;
  soldQty: number;
  gmv: number;
  conversionRate: number;
  createdAt: string;
}

export interface LiveMetric {
  id: string;
  tenantId: string;
  sessionId: string;
  capturedAt: string;
  onlineUsers: number;
  cumulativeUv: number;
  newFollowers: number;
  comments: number;
  likes: number;
  shares: number;
  cartClicks: number;
  orders: number;
  gmv: number;
  avgStaySeconds: number;
  source: string;
}

export interface LiveReview {
  id: string;
  tenantId: string;
  sessionId: string;
  gmvAchievementRate: number;
  uvValue: number;
  conversionRate: number;
  avgStaySeconds: number;
  bestProductId: string | null;
  bestProductName: string | null;
  worstProductId: string | null;
  worstProductName: string | null;
  highlights: DiagnosisItem[];
  problems: DiagnosisItem[];
  actions: DiagnosisItem[];
  anchorScore: number;
  reviewerId: string | null;
  createdAt: string;
}

/** 复盘诊断条目：每一条都由明确的阈值规则命中产生，可追溯 */
export interface DiagnosisItem {
  /** 规则编号，便于前端定位与后续调参 */
  rule: string;
  /** 诊断维度：gmv / uv_value / conversion / stay / interact / product / script / duration */
  dimension: string;
  /** 结论正文 */
  text: string;
  /** 触发时的实测值（已格式化） */
  metric?: string;
}

/** 合规命中标记 */
export interface ComplianceFlag {
  /** 命中的违禁词 */
  word: string;
  /** 违禁类别 */
  category: string;
  /** 风险等级：high 必须改，medium 建议改，low 注意语境 */
  severity: 'high' | 'medium' | 'low';
  /** 命中位置：talk_track / cta_text */
  field: 'talk_track' | 'cta_text';
  /** 修改建议 */
  suggestion: string;
}

export interface ComplianceIssue extends ComplianceFlag {
  scriptId: string;
  segmentNo: number;
  segmentTitle: string;
  /** 命中处的上下文片段（前后各 12 字） */
  context: string;
}

export interface ComplianceReport {
  sessionId: string;
  scannedSegments: number;
  totalIssues: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  passed: boolean;
  issues: ComplianceIssue[];
  /** 按类别汇总，方便前端做分组展示 */
  byCategory: Array<{ category: string; count: number }>;
  checkedAt: string;
}

export interface ScheduleSlot {
  productId: string;
  sku: string | null;
  productName: string | null;
  sortOrder: number;
  /** 相对开播的偏移分钟 */
  offsetMinutes: number;
  /** 推算出的绝对讲解开始时间（有 planned_start 才有值） */
  slotStart: string | null;
  slotEnd: string | null;
  durationMinutes: number;
  livePrice: number | null;
}

export interface ScheduleTimeline {
  sessionId: string;
  plannedStart: string | null;
  /** 场次计划总时长（分钟），由 planned_start/planned_end 推算 */
  plannedTotalMinutes: number;
  /** 选品讲解占用总时长 */
  scheduledMinutes: number;
  /** 剩余可用（负数表示超时） */
  remainingMinutes: number;
  overflow: boolean;
  warnings: string[];
  slots: ScheduleSlot[];
}

export interface LiveSnapshot {
  sessionId: string;
  status: LiveSessionStatus;
  /** 最近一条快照；从未录入时为 null */
  latest: LiveMetric | null;
  targetGmv: number;
  targetOrders: number;
  gmvAchievementRate: number;
  ordersAchievementRate: number;
  uvValue: number;
  conversionRate: number;
  /** 数据来源说明，前端必须原样展示，避免误导为实时数据 */
  dataSourceNote: string;
}

export interface AnchorPerformance {
  employeeId: string;
  employeeName: string | null;
  period: string;
  sessionCount: number;
  liveMinutes: number;
  totalGmv: number;
  totalOrders: number;
  totalUv: number;
  avgUvValue: number;
  avgConversionRate: number;
  avgStaySeconds: number;
  avgGmvAchievementRate: number;
  avgAnchorScore: number;
  bestSession: { id: string; title: string; gmv: number } | null;
  sessions: Array<{
    id: string; title: string; plannedStart: string | null; status: LiveSessionStatus;
    targetGmv: number; actualGmv: number; achievementRate: number; anchorScore: number | null;
  }>;
}

export interface LivestreamOverview {
  generatedAt: string;
  month: string;
  sessionCount: number;
  livingCount: number;
  totalGmv: number;
  totalOrders: number;
  avgUvValue: number;
  avgConversionRate: number;
  topAnchors: Array<{
    employeeId: string; name: string; sessionCount: number; gmv: number; avgScore: number;
  }>;
  recentSessions: LiveSession[];
}

export interface SessionInput {
  projectId?: string;
  title: string;
  platform?: string;
  roomId?: string;
  anchorEmployeeId?: string;
  assistantEmployeeId?: string;
  plannedStart?: string;
  plannedEnd?: string;
  targetGmv?: number;
  targetOrders?: number;
  coverUrl?: string;
  remark?: string;
  status?: LiveSessionStatus;
}

export interface ScriptInput {
  id?: string;
  segmentNo?: number;
  segmentType?: LiveSegmentType;
  title: string;
  productId?: string;
  durationMinutes?: number;
  talkTrack?: string;
  sellingPoints?: string[];
  objectionHandling?: Array<{ objection: string; response: string }>;
  ctaText?: string;
}

export interface MetricInput {
  capturedAt?: string;
  onlineUsers?: number;
  cumulativeUv?: number;
  newFollowers?: number;
  comments?: number;
  likes?: number;
  shares?: number;
  cartClicks?: number;
  orders?: number;
  gmv?: number;
  avgStaySeconds?: number;
  source?: string;
}

export interface GenerateScriptOptions {
  /** 覆盖场次计划时长（分钟）；不传则从 planned_start/planned_end 推算，再兜底 120 */
  totalMinutes?: number;
  /** 是否插入秒杀引流段，默认 true */
  includeFlashSale?: boolean;
  /** 每讲几个品插入一次互动/抽奖，默认 3 */
  interactEvery?: number;
  /** 是否覆盖已有脚本，默认 true（false 时已有脚本则报错） */
  overwrite?: boolean;
  /** 直播间人设风格，影响开场话术口吻 */
  tone?: 'professional' | 'warm' | 'energetic';
}

// ══════════════════════════════════════════════════════════
// 二、合规违禁词库（原创整理，对标《广告法》第九条/第十七条与主流直播平台审核规则）
//     只做「文本命中 + 改写建议」，不替代法务审核。
// ══════════════════════════════════════════════════════════

interface LexiconEntry {
  word: string;
  category: string;
  severity: 'high' | 'medium' | 'low';
  suggestion: string;
}

const COMPLIANCE_LEXICON: LexiconEntry[] = [
  // ── 类别 1：绝对化 / 极限用语（《广告法》第九条明令禁止）──
  { word: '最好', category: '绝对化用语', severity: 'high', suggestion: '改为「我们自己很满意的一款」或直接讲具体参数，不做同类横向排序。' },
  { word: '最佳', category: '绝对化用语', severity: 'high', suggestion: '改为「比较适合的」「我个人推荐的」，把主观判断说成主观判断。' },
  { word: '最优', category: '绝对化用语', severity: 'high', suggestion: '换成「表现比较突出」，并补一句可验证的数据。' },
  { word: '最强', category: '绝对化用语', severity: 'high', suggestion: '删掉极限修饰，改讲「这一档位里做到了 XX 参数」。' },
  { word: '最低价', category: '绝对化用语', severity: 'high', suggestion: '改为「本场直播间的活动价」，把范围限定在自己直播间。' },
  { word: '最便宜', category: '绝对化用语', severity: 'high', suggestion: '改为「今天这个价格是我们能给到的活动价」。' },
  { word: '最高级', category: '绝对化用语', severity: 'high', suggestion: '删除，改用具体规格描述（材质/克重/产地）。' },
  { word: '最先进', category: '绝对化用语', severity: 'high', suggestion: '改为「采用了 XX 工艺」，用事实代替评价。' },
  { word: '最划算', category: '绝对化用语', severity: 'high', suggestion: '改为「折算下来单次成本约 X 元」，让用户自己判断。' },
  // 注：「第一」作为「第一步/第一点」的序数用法是正常表达，
  //     因此这里只收录构成排名宣称的组合词，避免误伤正常话术。
  { word: '全网第一', category: '绝对化用语', severity: 'high', suggestion: '直接删除，无法自证的排名一律不讲。' },
  { word: '销量第一', category: '绝对化用语', severity: 'high', suggestion: '改为「上一场卖出 XXX 件」，用自家可核实的数据。' },
  { word: '行业第一', category: '绝对化用语', severity: 'high', suggestion: '删除，排名宣称需权威出处并标注统计口径。' },
  { word: '排名第一', category: '绝对化用语', severity: 'high', suggestion: '删除，或注明榜单名称、统计周期与出处。' },
  { word: '第一品牌', category: '绝对化用语', severity: 'high', suggestion: '删除，改为「我们做这个品类 X 年」。' },
  { word: '第一名', category: '绝对化用语', severity: 'high', suggestion: '删除，无权威出处的名次一律不讲。' },
  { word: '全网最低', category: '绝对化用语', severity: 'high', suggestion: '改为「本场专属价」，不与全网比价。' },
  { word: '全国首家', category: '绝对化用语', severity: 'high', suggestion: '无资质佐证请删除。' },
  { word: '独家', category: '绝对化用语', severity: 'medium', suggestion: '若无独家授权文件，改为「我们直播间的定制款」。' },
  { word: '唯一', category: '绝对化用语', severity: 'high', suggestion: '删除，改为「比较少见的」。' },
  { word: '独一无二', category: '绝对化用语', severity: 'high', suggestion: '删除该修饰，直接讲差异化卖点。' },
  { word: '绝无仅有', category: '绝对化用语', severity: 'high', suggestion: '删除，替换成「这批货数量有限」（数量属实的前提下）。' },
  { word: '史无前例', category: '绝对化用语', severity: 'high', suggestion: '删除。' },
  { word: '空前绝后', category: '绝对化用语', severity: 'high', suggestion: '删除。' },
  { word: '顶级', category: '绝对化用语', severity: 'high', suggestion: '改为「品质在线」，或直接报出等级标准（如「一级品」需有检测依据）。' },
  { word: '顶尖', category: '绝对化用语', severity: 'high', suggestion: '删除，改讲具体工艺。' },
  { word: '极致', category: '绝对化用语', severity: 'medium', suggestion: '弱化为「体验做得比较细」。' },
  { word: '极品', category: '绝对化用语', severity: 'high', suggestion: '删除，改用产品等级的客观表述。' },
  { word: '王牌', category: '绝对化用语', severity: 'medium', suggestion: '改为「我们的主推款」。' },
  { word: '绝对', category: '绝对化用语', severity: 'high', suggestion: '删除「绝对」二字，改为「通常」「一般情况下」。' },
  { word: '100%', category: '绝对化用语', severity: 'high', suggestion: '除非是成分含量并有质检报告，否则删除；效果类一律不能用。' },
  { word: '百分百', category: '绝对化用语', severity: 'high', suggestion: '同上，效果承诺不得使用。' },
  { word: '万能', category: '绝对化用语', severity: 'high', suggestion: '删除，改为列举 2-3 个具体适用场景。' },
  { word: '零风险', category: '绝对化用语', severity: 'high', suggestion: '删除，改为说明退换货规则。' },

  // ── 类别 2：虚假权威 / 违规背书 ──
  { word: '国家级', category: '虚假权威背书', severity: 'high', suggestion: '删除，国家级相关表述属于禁用词。' },
  { word: '国家免检', category: '虚假权威背书', severity: 'high', suggestion: '免检制度早已取消，必须删除。' },
  { word: '驰名商标', category: '虚假权威背书', severity: 'high', suggestion: '不得用于商业宣传，删除。' },
  { word: '特供', category: '虚假权威背书', severity: 'high', suggestion: '删除，特供/专供类表述明令禁止。' },
  { word: '专供', category: '虚假权威背书', severity: 'high', suggestion: '删除。' },
  { word: '央视推荐', category: '虚假权威背书', severity: 'high', suggestion: '无授权文件一律删除。' },
  { word: '政府推荐', category: '虚假权威背书', severity: 'high', suggestion: '删除，不得借用行政机关名义。' },
  { word: '质检总局认证', category: '虚假权威背书', severity: 'high', suggestion: '删除，改为出示真实检测报告编号。' },
  { word: '权威认证', category: '虚假权威背书', severity: 'medium', suggestion: '改为「已通过 XX 标准检测（报告编号 XXX）」。' },

  // ── 类别 3：医疗功效 / 健康承诺（食品、化妆品、日用品均不得涉及）──
  { word: '根治', category: '医疗功效宣称', severity: 'high', suggestion: '删除，非药品不得宣称治疗作用。' },
  { word: '治愈', category: '医疗功效宣称', severity: 'high', suggestion: '删除。' },
  { word: '疗效', category: '医疗功效宣称', severity: 'high', suggestion: '删除，改讲使用感受。' },
  { word: '包治', category: '医疗功效宣称', severity: 'high', suggestion: '删除。' },
  { word: '药到病除', category: '医疗功效宣称', severity: 'high', suggestion: '删除。' },
  { word: '抗癌', category: '医疗功效宣称', severity: 'high', suggestion: '删除，属于严重违规表述。' },
  { word: '防癌', category: '医疗功效宣称', severity: 'high', suggestion: '删除。' },
  { word: '消炎', category: '医疗功效宣称', severity: 'high', suggestion: '删除，非药品不得宣称。' },
  { word: '杀菌率', category: '医疗功效宣称', severity: 'medium', suggestion: '需有检测报告并标注实验条件，否则删除。' },
  { word: '无副作用', category: '医疗功效宣称', severity: 'high', suggestion: '删除。' },
  { word: '替代药物', category: '医疗功效宣称', severity: 'high', suggestion: '删除。' },
  { word: '纯天然', category: '医疗功效宣称', severity: 'medium', suggestion: '改为列出主要成分，避免「纯天然/零添加」这类难以自证的表述。' },
  { word: '零添加', category: '医疗功效宣称', severity: 'medium', suggestion: '改为「未添加 XX（配料表可查）」。' },

  // ── 类别 4：虚假比价 / 促销欺诈 ──
  { word: '原价', category: '虚假比价', severity: 'medium', suggestion: '除非有 7 天内真实成交记录，否则改为「日常售价」并保留截图凭据。' },
  { word: '跌破成本价', category: '虚假比价', severity: 'high', suggestion: '删除，属于典型虚假促销话术。' },
  { word: '亏本甩卖', category: '虚假比价', severity: 'high', suggestion: '删除。' },
  { word: '清仓价', category: '虚假比价', severity: 'low', suggestion: '确为清仓可用，但需与库存数量一致，避免长期挂着。' },
  { word: '假一赔十', category: '虚假比价', severity: 'medium', suggestion: '需有书面承诺与赔付能力，否则改为「假一赔三，按平台规则执行」。' },
  { word: '最后一天', category: '虚假比价', severity: 'medium', suggestion: '活动若会重复上架，请删除，避免被判定虚假紧迫感。' },
  { word: '仅此一次', category: '虚假比价', severity: 'medium', suggestion: '同上，除非确实不再返场。' },

  // ── 类别 5：绝对承诺 / 诱导性表述 ──
  { word: '稳赚不赔', category: '绝对承诺', severity: 'high', suggestion: '删除，涉及收益承诺属高风险。' },
  { word: '包您满意', category: '绝对承诺', severity: 'medium', suggestion: '改为「不满意可按平台规则申请退换」。' },
  { word: '无效退款', category: '绝对承诺', severity: 'high', suggestion: '删除，效果承诺+退款承诺组合风险极高。' },
  { word: '终身免费', category: '绝对承诺', severity: 'high', suggestion: '改为明确的服务年限，如「三年质保」。' },
  { word: '永久', category: '绝对承诺', severity: 'high', suggestion: '删除，改为具体时限。' },
  { word: '永不', category: '绝对承诺', severity: 'high', suggestion: '删除。' },
  { word: '买了不后悔', category: '绝对承诺', severity: 'low', suggestion: '弱化为「回购率还不错」，并给出真实数据。' },

  // ── 类别 6：虚假承诺 / 效果保证 ──
  { word: '保证', category: '虚假承诺', severity: 'high', suggestion: '改为「通常」「大多数用户反馈」，避免绝对化效果保证。' },
  { word: '承诺', category: '虚假承诺', severity: 'high', suggestion: '改为「我们尽力做到」，而非无法兑现的承诺。' },
  { word: '绝对有效', category: '虚假承诺', severity: 'high', suggestion: '删除，效果因人而异，不得保证。' },
  { word: '立即见效', category: '虚假承诺', severity: 'high', suggestion: '改为「持续使用后可观察到改善」，避免即时效果承诺。' },
  { word: '一次性根治', category: '虚假承诺', severity: 'high', suggestion: '删除，医疗相关承诺属严重违规。' },
  { word: '永不复发', category: '虚假承诺', severity: 'high', suggestion: '删除，属于非法医疗承诺。' },
  { word: '无副作用', category: '虚假承诺', severity: 'high', suggestion: '改为「副作用较小」，并说明可能的不良反应。' },
  { word: '完全安全', category: '虚假承诺', severity: 'high', suggestion: '删除，任何产品都无法保证 100% 安全。' },
  { word: '100% 有效', category: '虚假承诺', severity: 'high', suggestion: '改为「多数用户反映有效」，并附上用户反馈数据。' },
  { word: '包治百病', category: '虚假承诺', severity: 'high', suggestion: '删除，属于严重虚假宣传。' },
  { word: '神效', category: '虚假承诺', severity: 'high', suggestion: '删除，不得夸大产品功效。' },
  { word: '药到病除', category: '虚假承诺', severity: 'high', suggestion: '删除，非药品不得宣称治疗效果。' },

  // ── 类别 7：绝对化比较 ──
  { word: '比 XX 更好', category: '绝对化比较', severity: 'medium', suggestion: '改为「在 XX 方面表现突出」，避免直接对比竞品。' },
  { word: '胜过 XX', category: '绝对化比较', severity: 'medium', suggestion: '删除或改为「各有特色」，避免贬低他人。' },
  { word: '碾压', category: '绝对化比较', severity: 'high', suggestion: '删除，属于贬低性表述。' },
  { word: '吊打', category: '绝对化比较', severity: 'high', suggestion: '删除，属于网络用语，不适合正式宣传。' },
  { word: '完爆', category: '绝对化比较', severity: 'high', suggestion: '删除，属于贬低性表述。' },
  { word: '秒杀', category: '绝对化比较', severity: 'medium', suggestion: '改为「性价比高」，避免夸大对比。' },
  { word: '超越 XX', category: '绝对化比较', severity: 'medium', suggestion: '删除或改为「在某些方面优于 XX」。' },
  { word: '比 XX 强', category: '绝对化比较', severity: 'medium', suggestion: '改为「与 XX 相比，我们的优势是...」。' },
  { word: '吊打一切', category: '绝对化比较', severity: 'high', suggestion: '删除，属于严重虚假宣传。' },
  { word: '无敌', category: '绝对化比较', severity: 'high', suggestion: '删除，属于无法证实的绝对化表述。' },
  { word: '最强王者', category: '绝对化比较', severity: 'high', suggestion: '删除，属于绝对化排名宣称。' },
  { word: '秒杀同行', category: '绝对化比较', severity: 'high', suggestion: '删除，属于贬低竞品。' },

  // ── 类别 8：贬低他人 / 恶意比较 ──
  { word: 'XX 都是骗子', category: '贬低他人', severity: 'high', suggestion: '删除，不得恶意诋毁竞争对手。' },
  { word: 'XX 是垃圾', category: '贬低他人', severity: 'high', suggestion: '删除，属于恶意诋毁。' },
  { word: 'XX 骗人', category: '贬低他人', severity: 'high', suggestion: '删除，不得对竞争对手进行人身攻击。' },
  { word: '其他家都是假的', category: '贬低他人', severity: 'high', suggestion: '删除，属于恶意比较。' },
  { word: '别家都是坑', category: '贬低他人', severity: 'high', suggestion: '删除，不得贬低其他商家。' },
  { word: 'XX 品牌不行', category: '贬低他人', severity: 'high', suggestion: '删除，不得公开贬低竞品。' },

  // ── 类别 9：封建迷信 ──
  { word: '风水', category: '封建迷信', severity: 'high', suggestion: '删除，不得宣传封建迷信内容。' },
  { word: '算命', category: '封建迷信', severity: 'high', suggestion: '删除，不得宣传算命等迷信活动。' },
  { word: '转运', category: '封建迷信', severity: 'high', suggestion: '删除，属于封建迷信表述。' },
  { word: '开运', category: '封建迷信', severity: 'high', suggestion: '删除，不得宣传开运等迷信内容。' },
  { word: '辟邪', category: '封建迷信', severity: 'high', suggestion: '删除，属于封建迷信表述。' },
  { word: '改运', category: '封建迷信', severity: 'high', suggestion: '删除，不得宣传改运等迷信内容。' },
  { word: '命格', category: '封建迷信', severity: 'high', suggestion: '删除，属于封建迷信表述。' },
  { word: '八字', category: '封建迷信', severity: 'high', suggestion: '删除，不得宣传八字算命等迷信内容。' },
  { word: '塔罗', category: '封建迷信', severity: 'high', suggestion: '删除，属于封建迷信表述。' },
  { word: '星座运势', category: '封建迷信', severity: 'medium', suggestion: '改为「星座性格分析」，避免运势预测。' },
  { word: '招财', category: '封建迷信', severity: 'high', suggestion: '删除，属于封建迷信表述。' },
  { word: '旺运', category: '封建迷信', severity: 'high', suggestion: '删除，不得宣传旺运等迷信内容。' },

  // ── 类别 10：政治敏感 ──
  { word: '政府指定', category: '政治敏感', severity: 'high', suggestion: '删除，不得借用政府名义宣传。' },
  { word: '官方认证', category: '政治敏感', severity: 'high', suggestion: '删除，非官方机构不得自称官方认证。' },
  { word: '国家机关', category: '政治敏感', severity: 'high', suggestion: '删除，不得冒用国家机关名义。' },
  { word: '中央军委', category: '政治敏感', severity: 'high', suggestion: '删除，属于严重政治敏感内容。' },
  { word: '党和国家', category: '政治敏感', severity: 'high', suggestion: '删除，不得在商业宣传中使用政治表述。' },
  { word: '国货之光', category: '政治敏感', severity: 'medium', suggestion: '改为「国产优质产品」，避免过度政治化表述。' },
  { word: '民族品牌', category: '政治敏感', severity: 'medium', suggestion: '改为「国产品牌」，避免煽动性表述。' },
  { word: '抵制 XX', category: '政治敏感', severity: 'high', suggestion: '删除，不得煽动抵制特定国家或品牌。' },
  { word: '爱国', category: '政治敏感', severity: 'high', suggestion: '删除，不得将产品与爱国情怀捆绑。' },
  { word: '支持国货', category: '政治敏感', severity: 'medium', suggestion: '改为「国产优质」，避免道德绑架。' },

  // ── 类别 11：金融投资误导 ──
  { word: '稳赚', category: '金融误导', severity: 'high', suggestion: '删除，不得承诺投资收益。' },
  { word: '保本保息', category: '金融误导', severity: 'high', suggestion: '删除，属于违规金融宣传。' },
  { word: '零风险投资', category: '金融误导', severity: 'high', suggestion: '删除，任何投资都有风险。' },
  { word: '日赚', category: '金融误导', severity: 'high', suggestion: '删除，不得承诺具体收益。' },
  { word: '月入过万', category: '金融误导', severity: 'high', suggestion: '删除，属于虚假收益承诺。' },
  { word: '躺赚', category: '金融误导', severity: 'high', suggestion: '删除，不得宣传无风险收益。' },
  { word: '无本万利', category: '金融误导', severity: 'high', suggestion: '删除，属于虚假宣传。' },
  { word: '暴富', category: '金融误导', severity: 'high', suggestion: '删除，不得宣扬暴富思维。' },
  { word: '财富自由', category: '金融误导', severity: 'medium', suggestion: '改为「改善财务状况」，避免夸大宣传。' },
  { word: '财务自由', category: '金融误导', severity: 'medium', suggestion: '改为「提升收入水平」，避免误导。' },

  // ── 类别 12：虚假促销 ──
  { word: '跳楼价', category: '虚假促销', severity: 'medium', suggestion: '改为「超值优惠」，避免夸张表述。' },
  { word: '血亏', category: '虚假促销', severity: 'medium', suggestion: '改为「成本价」，避免夸张表述。' },
  { word: '亏本赚吆喝', category: '虚假促销', severity: 'medium', suggestion: '改为「限时特惠」，避免虚假促销话术。' },
  { word: '最后 XX 件', category: '虚假促销', severity: 'medium', suggestion: '确保库存真实，避免虚假紧迫感。' },
  { word: '仅剩', category: '虚假促销', severity: 'medium', suggestion: '确保库存数据真实准确。' },
  { word: '错过等一年', category: '虚假促销', severity: 'medium', suggestion: '改为「限时优惠」，避免制造虚假紧迫感。' },
  { word: '最后一天', category: '虚假促销', severity: 'medium', suggestion: '确保活动真实结束时间。' },
  { word: '最后一次', category: '虚假促销', severity: 'medium', suggestion: '避免虚假宣传。' },

  // ── 类别 13：医疗相关 ──
  { word: '治疗', category: '医疗宣称', severity: 'high', suggestion: '非药品不得宣称治疗作用。' },
  { word: '治愈', category: '医疗宣称', severity: 'high', suggestion: '删除，非药品不得宣称治愈。' },
  { word: '疗效', category: '医疗宣称', severity: 'high', suggestion: '删除，改讲使用感受。' },
  { word: '医生推荐', category: '医疗宣称', severity: 'high', suggestion: '需提供真实医生推荐证明。' },
  { word: '医院专用', category: '医疗宣称', severity: 'high', suggestion: '删除，不得冒充医院用品。' },
  { word: '临床验证', category: '医疗宣称', severity: 'medium', suggestion: '需提供真实临床试验报告。' },
  { word: ' Scientific ', category: '医疗宣称', severity: 'medium', suggestion: '需提供真实科学依据。' },
];

/** 违禁词按长度倒序，优先命中长词（如「全网最低」先于「最低价」不重复计） */
const SORTED_LEXICON = [...COMPLIANCE_LEXICON].sort((a, b) => b.word.length - a.word.length);

// ══════════════════════════════════════════════════════════
// 三、话术素材（100% 原创，全部经过上面的违禁词库自检）
// ══════════════════════════════════════════════════════════

/** 开场暖场话术模板：三种人设口吻 */
const WARMUP_TEMPLATES: Record<string, (title: string, welfare: string) => string> = {
  professional: (title, welfare) =>
    `【前 30 秒·抛福利留人】\n` +
    `欢迎刚进直播间的朋友，这里是「${title}」。先把今天的规则讲清楚，你不用听我废话：\n` +
    `第一，${welfare}，一会儿到点直接上链接，不做任何铺垫；\n` +
    `第二，今天所有商品的价格、规格、发货时效，我都会念一遍，你听完再决定买不买；\n` +
    `第三，不懂的直接打在公屏上，我看到就答，答不上来的我不瞎编。\n\n` +
    `【30 秒 - 2 分钟·建立信任】\n` +
    `先自我介绍一下，我们团队做这个品类三年多，样品都在我手边，等下每一款我都会现场拆开给你看。\n` +
    `我说话可能比较直：不适合你的，我会当场劝你别下单。买回去不合适再退，运费和时间都是你的损失，没必要。\n\n` +
    `【2 - 4 分钟·留人钩子】\n` +
    `新来的朋友把「想看」两个字打在公屏上，我看到 20 个就提前开福利款。\n` +
    `另外提醒一句，购物车第一个位置的商品数量不多，想要的先加购物车，加了不用马上付款，避免一会儿手忙脚乱。`,

  warm: (title, welfare) =>
    `【前 30 秒·抛福利留人】\n` +
    `刚进来的家人们别急着走，先听我说三句话。这里是「${title}」。\n` +
    `第一句：${welfare}，不用抢半天，我会提前倒数；\n` +
    `第二句：今天不管你买不买，我把挑这类东西的门道给你讲明白，你以后自己买也不吃亏；\n` +
    `第三句：有问题公屏问我，我一个一个答。\n\n` +
    `【30 秒 - 2 分钟·拉近距离】\n` +
    `我知道大家现在下单都很谨慎，钱都不是大风刮来的。所以我这边有个习惯——\n` +
    `每一款我都会先说它的短板，再说它的好。短板你能接受，我们再聊价格。\n\n` +
    `【2 - 4 分钟·留人钩子】\n` +
    `想看的朋友扣个「1」，人数够了我就把福利款提前放出来。\n` +
    `顺便说一句，觉得有用的话点个关注，我每场都会讲怎么挑，不听广告听门道。`,

  energetic: (title, welfare) =>
    `【前 30 秒·抛福利留人】\n` +
    `欢迎来到「${title}」！刚进来的朋友先别划走，三十秒把今天的安排讲完：\n` +
    `${welfare}——到点就上，绝不拖延；\n` +
    `全场商品我一个一个拆给你看，眼见为实；\n` +
    `公屏有问必答，问到我答不上来的，我现场查资料给你。\n\n` +
    `【30 秒 - 2 分钟·节奏拉起来】\n` +
    `节奏我先交代一下：前半场讲主推，中间有一轮互动，后半场是压轴款。\n` +
    `你现在进来正好，一个都不会错过。\n\n` +
    `【2 - 4 分钟·留人钩子】\n` +
    `公屏扣「在」，我看看有多少人在。人齐了我提前开福利。\n` +
    `想要的先加购物车，加购不扣钱，等我喊上链接你再付，省得手慢。`,
};

/** 场景化异议应对（每个品位复用同一套骨架，再按品名/价格填空） */
function buildObjections(
  productName: string,
  livePrice: number | null,
  category: string | null
): Array<{ objection: string; response: string }> {
  const priceText = livePrice && livePrice > 0 ? `${livePrice} 元` : '这个价格';
  const cat = category || '这个品类';
  return [
    {
      objection: '太贵了 / 隔壁便宜',
      response:
        `我不跟你争贵不贵，我们把账算清楚。${productName} 今天是 ${priceText}，` +
        `你如果按使用次数摊，一次也就几毛钱。便宜的产品我也见过，差别通常在用料和售后上——` +
        `你可以把你看到的那款链接发公屏，我帮你对一下参数，真比我们合适，我劝你去买那个。`,
    },
    {
      objection: '质量到底行不行',
      response:
        `质量不靠我说，靠三样东西：一是检测报告，编号我可以念给你；二是样品，我现在就拆给你看；` +
        `三是退货率，我们上一场这款的退货情况我如实报给你。` +
        `${cat}这类东西就怕主播光喊好，你看完这三样再决定。`,
    },
    {
      objection: '有没有更便宜的时候 / 等大促再买',
      response:
        `我不会跟你说「过了今天就没了」这种话。大促确实可能有别的玩法，` +
        `但今天这个价是我们这场谈下来的活动价，库存就这么多。` +
        `你如果不急着用，完全可以等；急着用，今天下单不吃亏——这是实话。`,
    },
    {
      objection: '售后怎么办 / 坏了找谁',
      response:
        `售后走两条路：平台七天无理由，这个是硬规则，我们不设门槛；` +
        `再就是我们自己的售后群，签收后有任何问题，把订单号发进来，客服跟到解决为止。` +
        `${productName}的质保时长我一会儿会念一遍，你截个图存着。`,
    },
    {
      objection: '我再想想 / 先看看',
      response:
        `可以，不用急。你先加个购物车，加购不花钱。\n` +
        `我建议你想清楚两件事：一是你到底多久用一次，二是家里是不是已经有类似的了。` +
        `这两个想明白了，买不买你自己就有答案了。`,
    },
  ];
}

/** 单品讲解话术：痛点引入 → 卖点拆解 → 价格锚定 → 限时逼单 */
function buildSellTalkTrack(params: {
  productName: string;
  category: string | null;
  livePrice: number | null;
  marketPrice: number | null;
  durationMinutes: number;
  index: number;
  stock: number;
}): string {
  const { productName, category, livePrice, marketPrice, durationMinutes, index, stock } = params;
  const cat = category || '这类产品';
  const priceText = livePrice && livePrice > 0 ? `${livePrice} 元` : '本场活动价（待定，开播前务必确认）';
  const anchorLine =
    marketPrice && livePrice && marketPrice > livePrice
      ? `它平时在我们店里挂的是 ${marketPrice} 元，今天这场是 ${priceText}。` +
        `我强调一下，${marketPrice} 是有真实成交记录的日常售价，不是随便标的数字，你可以去主页翻历史价格。`
      : `今天这场的价格是 ${priceText}。我不跟别家比价，你自己去横向看，看完觉得合适再回来。`;

  const stockLine =
    stock > 0
      ? `这一款我们锁的库存是 ${stock} 件，卖完这场就不补了，不会临时加单。`
      : `库存数量开播前我会在公屏同步，卖完即止，不做临时追加。`;

  return (
    `【第 1 步·痛点引入（约 ${Math.max(1, Math.round(durationMinutes * 0.2))} 分钟）】\n` +
    `先不说产品。买${cat}容易踩的坑，我给你列三条：\n` +
    `一是只看图不看参数，到手发现尺寸/规格对不上；\n` +
    `二是贪便宜买了低配版本，用两次就闲置；\n` +
    `三是没看售后条款，出问题找不到人。\n` +
    `这三条你中过任何一条，接下来这几分钟对你有用。\n\n` +

    `【第 2 步·卖点拆解（约 ${Math.max(1, Math.round(durationMinutes * 0.35))} 分钟）】\n` +
    `${productName}，我按「你会实际用到的地方」来讲，不念说明书。\n` +
    `第一点，它解决的是刚才说的第 ${(index % 3) + 1} 个痛点，具体怎么解决的，我现在拆开演示给你看。\n` +
    `第二点，用料和做工——我把细节怼到镜头前，你自己判断。\n` +
    `第三点，也是我要提醒的：它不适合谁。如果你的使用场景是高频重度使用，这一款可能不够，` +
    `那你就别买，我后面还有更合适的款。\n\n` +

    `【第 3 步·价格锚定（约 ${Math.max(1, Math.round(durationMinutes * 0.25))} 分钟）】\n` +
    `${anchorLine}\n` +
    `换算一下：假设你一周用两次，用一年就是一百来次，摊到每次几毛钱。这笔账你自己算，比我说一百句管用。\n\n` +

    `【第 4 步·限时逼单（约 ${Math.max(1, Math.round(durationMinutes * 0.2))} 分钟）】\n` +
    `${stockLine}\n` +
    `现在的动作很简单：想要的点购物车第 ${index + 1} 个链接，先加购，我倒数五秒上库存。\n` +
    `犹豫的朋友我也说一句实话——不确定就先别下单，等我讲完后面的款再回头看，链接我会留着。`
  );
}

/** 从商品信息中提炼卖点（合规、可验证的表述） */
function buildSellingPoints(p: {
  name: string; category: string | null; livePrice: number | null;
  marketPrice: number | null; stock: number;
}): string[] {
  const points: string[] = [];
  points.push(`品名与规格现场逐条念读：${p.name}，杜绝「买家秀货不对板」`);
  if (p.category) points.push(`${p.category}品类适用场景明确，主播会当场说明「谁不适合买」`);
  if (p.livePrice && p.livePrice > 0) points.push(`本场活动价 ${p.livePrice} 元，价格与库存同步公屏，卖完即止`);
  if (p.marketPrice && p.livePrice && p.marketPrice > p.livePrice) {
    const off = Math.round((1 - p.livePrice / p.marketPrice) * 100);
    points.push(`较日常售价 ${p.marketPrice} 元让利约 ${off}%（日常价有真实成交记录可查）`);
  }
  if (p.stock > 0) points.push(`本场锁库存 ${p.stock} 件，不临时追加，避免超卖`);
  points.push('样品现场拆封演示，细节怼镜头，眼见为实');
  points.push('七天无理由 + 专属售后群，订单号直连客服跟进');
  return points;
}

// ══════════════════════════════════════════════════════════
// 四、服务类
// ══════════════════════════════════════════════════════════

/** 状态机：key 为当前状态，value 为允许流转到的状态集合 */
const STATUS_TRANSITIONS: Record<LiveSessionStatus, LiveSessionStatus[]> = {
  planned: ['ready', 'cancelled'],
  ready: ['living', 'planned', 'cancelled'],
  living: ['ended'],
  ended: ['reviewed'],
  reviewed: [],
  cancelled: [],
};

const STATUS_LABEL: Record<LiveSessionStatus, string> = {
  planned: '已排期',
  ready: '待开播',
  living: '直播中',
  ended: '已下播',
  reviewed: '已复盘',
  cancelled: '已取消',
};

export class LivestreamService {
  // ─────────────────────────────────────────────
  // A. 场次管理
  // ─────────────────────────────────────────────

  listSessions(
    tenantId: string,
    filters: {
      status?: string; platform?: string; anchorId?: string;
      from?: string; to?: string; keyword?: string;
      page?: number; limit?: number;
    } = {}
  ): { data: LiveSession[]; pagination: { page: number; limit: number; total: number; totalPages: number } } {
    const db = getDatabase();
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 20));
    const offset = (page - 1) * limit;

    const where: string[] = ['s.tenant_id = ?'];
    const params: unknown[] = [tenantId];

    if (filters.status) { where.push('s.status = ?'); params.push(filters.status); }
    if (filters.platform) { where.push('s.platform = ?'); params.push(filters.platform); }
    if (filters.anchorId) { where.push('s.anchor_employee_id = ?'); params.push(filters.anchorId); }
    if (filters.from) { where.push("COALESCE(s.planned_start, s.created_at) >= ?"); params.push(filters.from); }
    if (filters.to) { where.push("COALESCE(s.planned_start, s.created_at) <= ?"); params.push(filters.to); }
    if (filters.keyword) { where.push('s.title LIKE ?'); params.push(`%${filters.keyword}%`); }

    const whereSql = where.join(' AND ');

    const totalRow = db.prepare(
      `SELECT COUNT(*) AS cnt FROM live_sessions s WHERE ${whereSql}`
    ).get(...params) as { cnt: number };

    const rows = db.prepare(
      `SELECT s.*,
              a.name AS anchor_name,
              b.name AS assistant_name
       FROM live_sessions s
       LEFT JOIN employees a ON a.id = s.anchor_employee_id AND a.tenant_id = s.tenant_id
       LEFT JOIN employees b ON b.id = s.assistant_employee_id AND b.tenant_id = s.tenant_id
       WHERE ${whereSql}
       ORDER BY COALESCE(s.planned_start, s.created_at) DESC
       LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as Record<string, unknown>[];

    const total = Number(totalRow?.cnt || 0);
    return {
      data: rows.map(mapSession),
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  getSession(tenantId: string, sessionId: string): LiveSession {
    const db = getDatabase();
    const row = db.prepare(
      `SELECT s.*, a.name AS anchor_name, b.name AS assistant_name
       FROM live_sessions s
       LEFT JOIN employees a ON a.id = s.anchor_employee_id AND a.tenant_id = s.tenant_id
       LEFT JOIN employees b ON b.id = s.assistant_employee_id AND b.tenant_id = s.tenant_id
       WHERE s.id = ? AND s.tenant_id = ?`
    ).get(sessionId, tenantId) as Record<string, unknown> | undefined;
    if (!row) throw new NotFoundError('直播场次', sessionId);
    return mapSession(row);
  }

  /** 场次详情聚合：基础信息 + 脚本 + 选品 + 最新指标 + 复盘（若有） */
  getSessionDetail(tenantId: string, sessionId: string): {
    session: LiveSession;
    scripts: LiveScript[];
    products: LiveSessionProduct[];
    latestMetric: LiveMetric | null;
    review: LiveReview | null;
  } {
    const session = this.getSession(tenantId, sessionId);
    return {
      session,
      scripts: this.listScripts(tenantId, sessionId),
      products: this.listSessionProducts(tenantId, sessionId),
      latestMetric: this.getLatestMetric(tenantId, sessionId),
      review: this.getReview(tenantId, sessionId),
    };
  }

  createSession(tenantId: string, input: SessionInput): LiveSession {
    const db = getDatabase();
    if (!input.title || !input.title.trim()) throw new ValidationError('场次标题不能为空');

    if (input.plannedStart && input.plannedEnd && input.plannedEnd <= input.plannedStart) {
      throw new ValidationError('计划结束时间必须晚于计划开始时间');
    }
    if (input.anchorEmployeeId) this.assertEmployee(tenantId, input.anchorEmployeeId, '主播');
    if (input.assistantEmployeeId) this.assertEmployee(tenantId, input.assistantEmployeeId, '助播');

    const id = uuidv4();
    db.prepare(
      `INSERT INTO live_sessions (
         id, tenant_id, project_id, title, platform, room_id,
         anchor_employee_id, assistant_employee_id,
         planned_start, planned_end, target_gmv, target_orders,
         status, cover_url, remark, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+0000'), datetime('now', '+0000'))`
    ).run(
      id, tenantId, input.projectId || null, input.title.trim(),
      input.platform || 'douyin', input.roomId || null,
      input.anchorEmployeeId || null, input.assistantEmployeeId || null,
      input.plannedStart || null, input.plannedEnd || null,
      Number(input.targetGmv || 0), Number(input.targetOrders || 0),
      input.status || 'planned', input.coverUrl || null, input.remark || null
    );

    logger.info('livestream', `创建直播场次 ${id} - ${input.title}`, { tenantId, sessionId: id });
    return this.getSession(tenantId, id);
  }

  updateSession(tenantId: string, sessionId: string, input: Partial<SessionInput>): LiveSession {
    const db = getDatabase();
    const current = this.getSession(tenantId, sessionId);

    const plannedStart = input.plannedStart !== undefined ? input.plannedStart : current.plannedStart;
    const plannedEnd = input.plannedEnd !== undefined ? input.plannedEnd : current.plannedEnd;
    if (plannedStart && plannedEnd && plannedEnd <= plannedStart) {
      throw new ValidationError('计划结束时间必须晚于计划开始时间');
    }
    if (input.anchorEmployeeId) this.assertEmployee(tenantId, input.anchorEmployeeId, '主播');
    if (input.assistantEmployeeId) this.assertEmployee(tenantId, input.assistantEmployeeId, '助播');

    const fieldMap: Record<string, string> = {
      projectId: 'project_id', title: 'title', platform: 'platform', roomId: 'room_id',
      anchorEmployeeId: 'anchor_employee_id', assistantEmployeeId: 'assistant_employee_id',
      plannedStart: 'planned_start', plannedEnd: 'planned_end',
      targetGmv: 'target_gmv', targetOrders: 'target_orders',
      coverUrl: 'cover_url', remark: 'remark',
    };

    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [key, column] of Object.entries(fieldMap)) {
      const value = (input as Record<string, unknown>)[key];
      if (value !== undefined) { sets.push(`${column} = ?`); params.push(value); }
    }
    if (sets.length === 0) return current;

    sets.push("updated_at = datetime('now', '+0000')");
    params.push(sessionId, tenantId);
    db.prepare(`UPDATE live_sessions SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...params);
    return this.getSession(tenantId, sessionId);
  }

  deleteSession(tenantId: string, sessionId: string): { id: string } {
    const db = getDatabase();
    const session = this.getSession(tenantId, sessionId);
    if (session.status === 'living') {
      throw new ConflictError('直播进行中的场次不能删除，请先下播');
    }
    // 关联表未必开启外键级联，这里显式清理，避免脏数据
    db.prepare('DELETE FROM live_scripts WHERE session_id = ? AND tenant_id = ?').run(sessionId, tenantId);
    db.prepare('DELETE FROM live_session_products WHERE session_id = ? AND tenant_id = ?').run(sessionId, tenantId);
    db.prepare('DELETE FROM live_metrics WHERE session_id = ? AND tenant_id = ?').run(sessionId, tenantId);
    db.prepare('DELETE FROM live_reviews WHERE session_id = ? AND tenant_id = ?').run(sessionId, tenantId);
    db.prepare('DELETE FROM live_sessions WHERE id = ? AND tenant_id = ?').run(sessionId, tenantId);
    logger.info('livestream', `删除直播场次 ${sessionId}`, { tenantId });
    return { id: sessionId };
  }

  /**
   * 状态机流转。
   * planned → ready → living → ended → reviewed，任何阶段可 cancel（reviewed/cancelled 除外）。
   * 开播写 actual_start；下播写 actual_end 并回算 duration_minutes 与实际 GMV/订单数。
   */
  advanceStatus(tenantId: string, sessionId: string, to: LiveSessionStatus): LiveSession {
    const db = getDatabase();
    const session = this.getSession(tenantId, sessionId);
    const allowed = STATUS_TRANSITIONS[session.status] || [];

    if (!allowed.includes(to)) {
      throw new ValidationError(
        `不允许的状态流转：${STATUS_LABEL[session.status]} → ${STATUS_LABEL[to] || to}。` +
        `当前状态仅允许流转到：${allowed.length ? allowed.map((s) => STATUS_LABEL[s]).join('、') : '无（终态）'}`
      );
    }

    const sets: string[] = ['status = ?'];
    const params: unknown[] = [to];

    if (to === 'living') {
      sets.push("actual_start = COALESCE(actual_start, datetime('now', '+0000'))");
    }

    if (to === 'ended') {
      sets.push("actual_end = datetime('now', '+0000')");
      // duration_minutes：优先按 actual_start 计算；无 actual_start 时退回计划时长
      const durationRow = db.prepare(
        `SELECT CAST((julianday('now') - julianday(COALESCE(actual_start, planned_start, datetime('now', '+0000')))) * 1440 AS INTEGER) AS mins
         FROM live_sessions WHERE id = ? AND tenant_id = ?`
      ).get(sessionId, tenantId) as { mins: number } | undefined;
      const mins = Math.max(0, Number(durationRow?.mins || 0));
      sets.push('duration_minutes = ?');
      params.push(mins);

      // 从最新指标快照回填实际 GMV / 订单数（手工录入口径）
      const latest = this.getLatestMetric(tenantId, sessionId);
      if (latest) {
        sets.push('actual_gmv = ?', 'actual_orders = ?');
        params.push(round2(latest.gmv), Math.round(latest.orders));
      }
    }

    sets.push("updated_at = datetime('now', '+0000')");
    params.push(sessionId, tenantId);
    db.prepare(`UPDATE live_sessions SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...params);

    logger.info('livestream', `场次 ${sessionId} 状态流转 ${session.status} → ${to}`, { tenantId });
    return this.getSession(tenantId, sessionId);
  }

  // ─────────────────────────────────────────────
  // B. 直播脚本
  // ─────────────────────────────────────────────

  listScripts(tenantId: string, sessionId: string): LiveScript[] {
    const db = getDatabase();
    const rows = db.prepare(
      `SELECT sc.*, p.name AS product_name
       FROM live_scripts sc
       LEFT JOIN products p ON p.id = sc.product_id AND p.tenant_id = sc.tenant_id
       WHERE sc.session_id = ? AND sc.tenant_id = ?
       ORDER BY sc.segment_no ASC`
    ).all(sessionId, tenantId) as Record<string, unknown>[];
    return rows.map(mapScript);
  }

  /** 新增或更新一段脚本（有 id 走更新，无 id 走新增） */
  upsertScript(tenantId: string, sessionId: string, input: ScriptInput): LiveScript {
    const db = getDatabase();
    this.getSession(tenantId, sessionId); // 校验归属

    if (!input.title || !input.title.trim()) throw new ValidationError('脚本分段标题不能为空');
    if (input.productId) this.assertProduct(tenantId, input.productId);

    const sellingPoints = JSON.stringify(input.sellingPoints || []);
    const objections = JSON.stringify(input.objectionHandling || []);
    // 保存时即时体检，把命中结果写进 compliance_flags，避免「保存完不知道有没有雷」
    const flags = scanText(input.talkTrack || '', 'talk_track')
      .concat(scanText(input.ctaText || '', 'cta_text'));

    if (input.id) {
      const exists = db.prepare(
        'SELECT id FROM live_scripts WHERE id = ? AND session_id = ? AND tenant_id = ?'
      ).get(input.id, sessionId, tenantId) as { id: string } | undefined;
      if (!exists) throw new NotFoundError('直播脚本分段', input.id);

      db.prepare(
        `UPDATE live_scripts SET
           segment_no = COALESCE(?, segment_no),
           segment_type = COALESCE(?, segment_type),
           title = ?, product_id = ?, duration_minutes = COALESCE(?, duration_minutes),
           talk_track = ?, selling_points = ?, objection_handling = ?,
           cta_text = ?, compliance_flags = ?, updated_at = datetime('now', '+0000')
         WHERE id = ? AND tenant_id = ?`
      ).run(
        input.segmentNo ?? null, input.segmentType ?? null,
        input.title.trim(), input.productId || null, input.durationMinutes ?? null,
        input.talkTrack || '', sellingPoints, objections,
        input.ctaText || '', JSON.stringify(flags),
        input.id, tenantId
      );
      return this.getScript(tenantId, input.id);
    }

    // 新增：segment_no 未指定时排到末尾
    const maxRow = db.prepare(
      'SELECT COALESCE(MAX(segment_no), 0) AS m FROM live_scripts WHERE session_id = ? AND tenant_id = ?'
    ).get(sessionId, tenantId) as { m: number };
    const segmentNo = input.segmentNo ?? Number(maxRow.m) + 1;

    const id = uuidv4();
    db.prepare(
      `INSERT INTO live_scripts (
         id, tenant_id, session_id, segment_no, segment_type, title, product_id,
         duration_minutes, talk_track, selling_points, objection_handling,
         cta_text, compliance_flags, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+0000'), datetime('now', '+0000'))`
    ).run(
      id, tenantId, sessionId, segmentNo, input.segmentType || 'sell',
      input.title.trim(), input.productId || null, Number(input.durationMinutes || 5),
      input.talkTrack || '', sellingPoints, objections,
      input.ctaText || '', JSON.stringify(flags)
    );
    return this.getScript(tenantId, id);
  }

  getScript(tenantId: string, scriptId: string): LiveScript {
    const db = getDatabase();
    const row = db.prepare(
      `SELECT sc.*, p.name AS product_name
       FROM live_scripts sc
       LEFT JOIN products p ON p.id = sc.product_id AND p.tenant_id = sc.tenant_id
       WHERE sc.id = ? AND sc.tenant_id = ?`
    ).get(scriptId, tenantId) as Record<string, unknown> | undefined;
    if (!row) throw new NotFoundError('直播脚本分段', scriptId);
    return mapScript(row);
  }

  updateScript(tenantId: string, scriptId: string, input: Partial<ScriptInput>): LiveScript {
    const existing = this.getScript(tenantId, scriptId);
    return this.upsertScript(tenantId, existing.sessionId, {
      ...input,
      id: scriptId,
      title: input.title ?? existing.title,
      talkTrack: input.talkTrack ?? existing.talkTrack,
      ctaText: input.ctaText ?? existing.ctaText,
      sellingPoints: input.sellingPoints ?? existing.sellingPoints,
      objectionHandling: input.objectionHandling ?? existing.objectionHandling,
      productId: input.productId !== undefined ? input.productId : (existing.productId || undefined),
    });
  }

  deleteScript(tenantId: string, scriptId: string): { id: string } {
    const db = getDatabase();
    const script = this.getScript(tenantId, scriptId);
    db.prepare('DELETE FROM live_scripts WHERE id = ? AND tenant_id = ?').run(scriptId, tenantId);
    // 删除后重排序号，保持 1..N 连续
    this.renumberScripts(tenantId, script.sessionId);
    return { id: scriptId };
  }

  /** 按传入的 scriptId 顺序重排 segment_no */
  reorderScripts(tenantId: string, sessionId: string, orderedIds: string[]): LiveScript[] {
    const db = getDatabase();
    this.getSession(tenantId, sessionId);
    orderedIds.forEach((scriptId, idx) => {
      db.prepare(
        `UPDATE live_scripts SET segment_no = ?, updated_at = datetime('now', '+0000')
         WHERE id = ? AND session_id = ? AND tenant_id = ?`
      ).run(idx + 1, scriptId, sessionId, tenantId);
    });
    return this.listScripts(tenantId, sessionId);
  }

  private renumberScripts(tenantId: string, sessionId: string): void {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT id FROM live_scripts WHERE session_id = ? AND tenant_id = ? ORDER BY segment_no ASC'
    ).all(sessionId, tenantId) as Array<{ id: string }>;
    rows.forEach((r, idx) => {
      db.prepare('UPDATE live_scripts SET segment_no = ? WHERE id = ? AND tenant_id = ?')
        .run(idx + 1, r.id, tenantId);
    });
  }

  /**
   * 脚本自动生成 —— 直播「教练」的核心能力。
   *
   * 排布逻辑（沿用成熟直播间的节奏模型）：
   *   1. 开场暖场（默认 4 分钟）：抛福利 → 立人设 → 留人钩子
   *   2. 秒杀引流（默认 8 分钟）：选价格最低的品做福利款，把流量拉进来
   *   3. 商品讲解循环：痛点 → 卖点 → 价格锚定 → 限时逼单，时长按剩余时间均分
   *   4. 每讲 N 个品插一段互动/抽奖：拉停留、涨粉、把公屏带起来
   *   5. 收尾（默认 5 分钟）：关注引导 + 下场预告 + 售后交代
   */
  generateScript(tenantId: string, sessionId: string, options: GenerateScriptOptions = {}): LiveScript[] {
    const db = getDatabase();
    const session = this.getSession(tenantId, sessionId);
    const products = this.listSessionProducts(tenantId, sessionId);

    if (products.length === 0) {
      throw new ValidationError('该场次还没有选品，无法生成脚本。请先到「选品排期」加入商品。');
    }

    const overwrite = options.overwrite !== false;
    const existingCount = db.prepare(
      'SELECT COUNT(*) AS cnt FROM live_scripts WHERE session_id = ? AND tenant_id = ?'
    ).get(sessionId, tenantId) as { cnt: number };
    if (Number(existingCount.cnt) > 0) {
      if (!overwrite) throw new ConflictError('该场次已有脚本，如需重新生成请显式开启覆盖');
      db.prepare('DELETE FROM live_scripts WHERE session_id = ? AND tenant_id = ?').run(sessionId, tenantId);
    }

    const totalMinutes = options.totalMinutes
      || diffMinutes(session.plannedStart, session.plannedEnd)
      || 120;
    const includeFlash = options.includeFlashSale !== false;
    const interactEvery = Math.max(1, Number(options.interactEvery) || 3);
    const tone = options.tone || 'professional';

    const WARMUP_MIN = 4;
    const CLOSING_MIN = 5;
    const FLASH_MIN = includeFlash ? 8 : 0;
    const INTERACT_MIN = 5;

    // 引流款：直播价（无则售价）最低的一个品
    const flashProduct = includeFlash
      ? [...products].sort((a, b) => effectivePrice(a) - effectivePrice(b))[0]
      : null;
    const sellProducts = flashProduct
      ? products.filter((p) => p.productId !== flashProduct.productId)
      : products;

    const interactCount = sellProducts.length > 0
      ? Math.max(0, Math.floor((sellProducts.length - 1) / interactEvery))
      : 0;

    const fixedMinutes = WARMUP_MIN + CLOSING_MIN + FLASH_MIN + interactCount * INTERACT_MIN;
    const sellPool = Math.max(sellProducts.length * 3, totalMinutes - fixedMinutes);
    const perProduct = sellProducts.length > 0
      ? Math.max(3, Math.floor(sellPool / sellProducts.length))
      : 0;

    const drafts: ScriptInput[] = [];
    let segNo = 1;

    // ── 1. 开场暖场 ──
    const welfare = flashProduct
      ? `开播第 ${WARMUP_MIN + 1} 分钟直接上福利款「${flashProduct.productName || '引流款'}」`
      : '开播前十分钟会放出本场的福利款';
    drafts.push({
      segmentNo: segNo++,
      segmentType: 'warmup',
      title: `开场暖场 · 前 ${WARMUP_MIN} 分钟留人`,
      durationMinutes: WARMUP_MIN,
      talkTrack: WARMUP_TEMPLATES[tone](session.title, welfare),
      sellingPoints: [
        '前 30 秒必须抛出福利信息，这是留人率的分水岭',
        '讲清直播间规则（价格/规格/时效），降低用户决策成本',
        '主动交代「谁不适合买」，用坦诚换信任',
        '引导加购物车而非立即下单，降低第一步门槛',
      ],
      objectionHandling: [
        { objection: '又是卖货的，划走', response: '不用买，先听我把挑选门道讲完，你以后自己买也不吃亏。' },
        { objection: '价格是不是套路', response: '价格我一次报到底，规格和发货时效一并念清楚，你听完再判断。' },
      ],
      ctaText: '公屏扣「想看」，人数到了提前开福利款；想要的先加购物车，加购不扣钱。',
    });

    // ── 2. 秒杀引流 ──
    if (flashProduct) {
      drafts.push({
        segmentNo: segNo++,
        segmentType: 'flashsale',
        title: `秒杀引流 · ${flashProduct.productName || '福利款'}`,
        productId: flashProduct.productId,
        durationMinutes: FLASH_MIN,
        talkTrack:
          `【倒计时逼停留（2 分钟）】\n` +
          `福利款是「${flashProduct.productName || '本场福利款'}」，` +
          `本场活动价 ${effectivePrice(flashProduct) > 0 ? effectivePrice(flashProduct) + ' 元' : '开播前确认后同步公屏'}，` +
          `锁的库存是 ${flashProduct.stockLocked || flashProduct.stock || 0} 件。\n` +
          `我先讲三十秒它是什么、适合谁，讲完就上链接，不拖。\n\n` +
          `【产品速讲（3 分钟）】\n` +
          `这一款是拿来给大家试水的，用料和规格我现在念一遍，样品在我手上，镜头拉近。\n` +
          `丑话说前面：福利款是标准配置，不是顶配。你要是重度使用，等我后面的主推款。\n\n` +
          `【上链接 + 逼单（3 分钟）】\n` +
          `购物车第 1 个链接，我倒数五秒放库存。\n` +
          `没抢到的别急着走，我看后台，如果加购人数够多，等下再补放一轮。补不了我也会明说，不吊着大家。`,
        sellingPoints: buildSellingPoints({
          name: flashProduct.productName || '福利款',
          category: flashProduct.category,
          livePrice: flashProduct.livePrice ?? flashProduct.sellingPrice,
          marketPrice: flashProduct.marketPrice,
          stock: flashProduct.stockLocked || flashProduct.stock,
        }),
        objectionHandling: buildObjections(
          flashProduct.productName || '福利款',
          flashProduct.livePrice ?? flashProduct.sellingPrice,
          flashProduct.category
        ),
        ctaText: '购物车第 1 个链接，倒数五秒上库存，先加购再付款。',
      });
    }

    // ── 3. 商品讲解循环 + 互动插段 ──
    let interactSeq = 0;
    sellProducts.forEach((p, idx) => {
      const name = p.productName || `商品 ${idx + 1}`;
      drafts.push({
        segmentNo: segNo++,
        segmentType: 'sell',
        title: `主推第 ${idx + 1} 款 · ${name}`,
        productId: p.productId,
        durationMinutes: perProduct,
        talkTrack: buildSellTalkTrack({
          productName: name,
          category: p.category,
          livePrice: p.livePrice ?? p.sellingPrice,
          marketPrice: p.marketPrice,
          durationMinutes: perProduct,
          index: idx,
          stock: p.stockLocked || p.stock,
        }),
        sellingPoints: buildSellingPoints({
          name,
          category: p.category,
          livePrice: p.livePrice ?? p.sellingPrice,
          marketPrice: p.marketPrice,
          stock: p.stockLocked || p.stock,
        }),
        objectionHandling: buildObjections(name, p.livePrice ?? p.sellingPrice, p.category),
        ctaText: `购物车第 ${idx + (flashProduct ? 2 : 1)} 个链接，先加购再付款，库存有限卖完即止。`,
      });

      const isLast = idx === sellProducts.length - 1;
      if (!isLast && (idx + 1) % interactEvery === 0) {
        interactSeq += 1;
        const isLottery = interactSeq % 2 === 0;
        drafts.push({
          segmentNo: segNo++,
          segmentType: isLottery ? 'lottery' : 'interact',
          title: isLottery ? `福袋抽奖 · 第 ${interactSeq} 轮` : `公屏互动 · 第 ${interactSeq} 轮`,
          durationMinutes: INTERACT_MIN,
          talkTrack: isLottery
            ? `【抽奖前置（1 分钟）】\n` +
              `讲了这么久，停一下，发个福袋。参与条件我说清楚：关注 + 公屏扣「参与」，倒计时三分钟。\n` +
              `奖品是什么、几份、什么时候发货，我一次讲明白，不搞含糊其辞那一套。\n\n` +
              `【抽奖中承接（3 分钟）】\n` +
              `等开奖这几分钟别浪费，我回答一下刚才公屏上没答完的问题。\n` +
              `（主播现场逐条念公屏问题作答，助播记录高频问题，作为下一场脚本的补充素材。）\n\n` +
              `【开奖 + 转化（1 分钟）】\n` +
              `中奖名单我念一遍，请中奖的朋友按提示填写信息。\n` +
              `没中的也别走，接下来这一款是我个人比较想推的，理由等下讲。`
            : `【互动拉停留（2 分钟）】\n` +
              `问大家一个问题，把答案打在公屏上：你买这类东西，最在意的是价格、耐用度，还是售后？\n` +
              `扣 1 是价格，扣 2 是耐用度，扣 3 是售后。我按你们的答案调整后面讲解的重点。\n\n` +
              `【答疑承接（2 分钟）】\n` +
              `刚才有几位问到尺寸和适配，我统一答一次，避免重复问。\n` +
              `（助播把公屏高频问题整理出来，主播逐条回应，答不上来的当场查资料，不糊弄。）\n\n` +
              `【涨粉引导（1 分钟）】\n` +
              `觉得刚才这些内容有用的，点个关注。我每周固定开播，讲的都是怎么挑不踩坑。\n` +
              `关注之后下次开播会有提醒，不用守着。`,
          sellingPoints: [
            '互动段的目标不是卖货，是把停留时长和公屏热度拉起来',
            '用「选择题」代替开放式提问，公屏回复门槛更低',
            '答疑集中处理，避免主播被单个问题带偏节奏',
            '涨粉引导放在互动尾部，用户此刻好感度最高',
          ],
          objectionHandling: [
            { objection: '又开始抽奖拖时间', response: '倒计时三分钟，到点就开，中间我继续答问题，不空转。' },
            { objection: '中奖是不是内定', response: '名单系统随机，开奖后名单公屏公示，谁都能看。' },
          ],
          ctaText: isLottery
            ? '关注 + 公屏扣「参与」进福袋，三分钟后开奖，名单公屏公示。'
            : '公屏扣 1 / 2 / 3 告诉我你的关注点，我按票数调整讲解重点。',
        });
      }
    });

    // ── 4. 收尾 ──
    drafts.push({
      segmentNo: segNo++,
      segmentType: 'closing',
      title: `收尾 · 关注引导与下场预告`,
      durationMinutes: CLOSING_MIN,
      talkTrack:
        `【订单交代（2 分钟）】\n` +
        `今天下单的朋友注意三件事：\n` +
        `一、发货时效我再念一遍，超时未发按平台规则处理；\n` +
        `二、收到货先验货再签收，有问题拍照留证；\n` +
        `三、售后走平台售后入口，或者把订单号发到我们的售后群，客服跟到解决。\n\n` +
        `【关注引导（2 分钟）】\n` +
        `没关注的朋友点个关注。关注的好处很实在：下次开播有提醒，不用守着；` +
        `老粉在直播间提问我会优先答。\n` +
        `不想被打扰的，关注之后也可以关掉提醒，不影响。\n\n` +
        `【下场预告（1 分钟）】\n` +
        `下一场的时间和主题我发在公屏和主页动态里，会提前把选品名单放出来，你可以先看后买。\n` +
        `今天就到这儿，谢谢陪到最后的朋友，我们下场见。`,
      sellingPoints: [
        '收尾先讲售后再讲关注，让用户走得安心',
        '关注引导要给具体好处（开播提醒、提问优先），空喊关注无效',
        '下场预告提前公布选品名单，把本场流量沉淀成下场的初始人气',
      ],
      objectionHandling: [
        { objection: '关注了会不会天天推送', response: '可以只关注不开提醒，主页随时能找到我们。' },
        { objection: '下单后多久发货', response: '发货时效以商品页承诺为准，我刚才念过一遍，超时按平台规则处理。' },
      ],
      ctaText: '点个关注，下场开播会提醒你；售后有问题把订单号发售后群。',
    });

    // 落库
    for (const d of drafts) {
      this.upsertScript(tenantId, sessionId, d);
    }
    logger.info('livestream', `为场次 ${sessionId} 生成 ${drafts.length} 段脚本`, { tenantId });
    return this.listScripts(tenantId, sessionId);
  }

  /**
   * 合规检查：扫描全场脚本的 talk_track 与 cta_text，
   * 命中违禁词则写回该段的 compliance_flags，并返回带上下文与修改建议的问题清单。
   */
  checkScriptCompliance(tenantId: string, sessionId: string): ComplianceReport {
    const db = getDatabase();
    this.getSession(tenantId, sessionId);
    const scripts = this.listScripts(tenantId, sessionId);

    const issues: ComplianceIssue[] = [];

    for (const s of scripts) {
      const flags: ComplianceFlag[] = [];
      const fields: Array<{ field: 'talk_track' | 'cta_text'; text: string }> = [
        { field: 'talk_track', text: s.talkTrack || '' },
        { field: 'cta_text', text: s.ctaText || '' },
      ];

      for (const f of fields) {
        for (const hit of scanTextWithPosition(f.text, f.field)) {
          flags.push(hit.flag);
          issues.push({
            ...hit.flag,
            scriptId: s.id,
            segmentNo: s.segmentNo,
            segmentTitle: s.title,
            context: hit.context,
          });
        }
      }

      db.prepare(
        `UPDATE live_scripts SET compliance_flags = ?, updated_at = datetime('now', '+0000')
         WHERE id = ? AND tenant_id = ?`
      ).run(JSON.stringify(flags), s.id, tenantId);
    }

    const byCategoryMap = new Map<string, number>();
    for (const i of issues) byCategoryMap.set(i.category, (byCategoryMap.get(i.category) || 0) + 1);

    const highCount = issues.filter((i) => i.severity === 'high').length;
    const mediumCount = issues.filter((i) => i.severity === 'medium').length;
    const lowCount = issues.filter((i) => i.severity === 'low').length;

    return {
      sessionId,
      scannedSegments: scripts.length,
      totalIssues: issues.length,
      highCount,
      mediumCount,
      lowCount,
      // 高危一条都不能留；中低危允许带风险开播，但要显式提示
      passed: highCount === 0,
      issues,
      byCategory: Array.from(byCategoryMap.entries())
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count),
      checkedAt: new Date().toISOString(),
    };

    // LC-02: 保存合规报告到 compliance_reports 表
    db.prepare(
      `INSERT INTO compliance_reports
       (id, tenant_id, session_id, scanned_segments, total_issues,
        high_count, medium_count, low_count, passed, issues, by_category, checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      uuidv4(), tenantId, sessionId,
      scripts.length, issues.length,
      highCount, mediumCount, lowCount,
      highCount === 0 ? 1 : 0,
      JSON.stringify(issues),
      JSON.stringify(Array.from(byCategoryMap.entries()).map(([c, n]) => ({ category: c, count: n }))),
      new Date().toISOString()
    );

    // LC-02: 保存合规报告到 compliance_reports 表
    db.prepare(
      `INSERT INTO compliance_reports
       (id, tenant_id, session_id, scanned_segments, total_issues,
        high_count, medium_count, low_count, passed, issues, by_category, checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      uuidv4(), tenantId, sessionId,
      scripts.length, issues.length,
      highCount, mediumCount, lowCount,
      highCount === 0 ? 1 : 0,
      JSON.stringify(issues),
      JSON.stringify(Array.from(byCategoryMap.entries()).map(([c, n]) => ({ category: c, count: n }))),
      new Date().toISOString()
    );
  }

  /** 违禁词库对外暴露，供前端做「写稿时实时提示」 */
  getComplianceLexicon(): Array<{ word: string; category: string; severity: string; suggestion: string }> {
    return COMPLIANCE_LEXICON.map((e) => ({ ...e }));
  }

  // ─────────────────────────────────────────────
  // C. 选品排期
  // ─────────────────────────────────────────────

  listSessionProducts(tenantId: string, sessionId: string): LiveSessionProduct[] {
    const db = getDatabase();
    const rows = db.prepare(
      `SELECT sp.*,
              p.sku, p.name AS product_name, p.category,
              p.selling_price, p.market_price, p.cost_price, p.stock
       FROM live_session_products sp
       LEFT JOIN products p ON p.id = sp.product_id AND p.tenant_id = sp.tenant_id
       WHERE sp.session_id = ? AND sp.tenant_id = ?
       ORDER BY sp.sort_order ASC, sp.created_at ASC`
    ).all(sessionId, tenantId) as Record<string, unknown>[];
    return rows.map(mapSessionProduct);
  }

  /** 批量加品；已存在的品跳过（UNIQUE(session_id, product_id)）。整体在事务内执行，中途失败全部回滚。 */
  addProducts(
    tenantId: string,
    sessionId: string,
    items: Array<{ productId: string; livePrice?: number; plannedDurationMinutes?: number; stockLocked?: number }>
  ): { added: number; skipped: number; products: LiveSessionProduct[] } {
    this.getSession(tenantId, sessionId);
    if (!items || items.length === 0) throw new ValidationError('请至少选择一个商品');

    return transaction((db) => {
      const maxRow = db.prepare(
        'SELECT COALESCE(MAX(sort_order), 0) AS m FROM live_session_products WHERE session_id = ? AND tenant_id = ?'
      ).get(sessionId, tenantId) as { m: number };
      let order = Number(maxRow.m);

      let added = 0;
      let skipped = 0;

      for (const item of items) {
        this.assertProduct(tenantId, item.productId);
        const exists = db.prepare(
          'SELECT id FROM live_session_products WHERE session_id = ? AND product_id = ? AND tenant_id = ?'
        ).get(sessionId, item.productId, tenantId) as { id: string } | undefined;
        if (exists) { skipped += 1; continue; }

        order += 1;
        db.prepare(
          `INSERT INTO live_session_products (
             id, tenant_id, session_id, product_id, sort_order,
             planned_duration_minutes, live_price, stock_locked, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+0000'))`
        ).run(
          uuidv4(), tenantId, sessionId, item.productId, order,
          Number(item.plannedDurationMinutes || 5),
          item.livePrice !== undefined ? Number(item.livePrice) : null,
          Number(item.stockLocked || 0)
        );

        // LC-04: 触发实际库存扣减（扣除 stock_locked 数量）
        // 注意：原写法 `MAX(stock - ?, stock)` 中 RHS 的 stock 引用旧值，恒等于原库存 → 扣减永不生效。
        // 改为先读后写：扣减且下限为 0（防止负库存），并记录 stock_transactions 流水。
        const lockedQty = Number(item.stockLocked || 0);
        if (lockedQty > 0) {
          const prod = db.prepare(
            'SELECT sku, name, stock FROM products WHERE id = ? AND tenant_id = ?'
          ).get(item.productId, tenantId) as { sku: string | null; name: string | null; stock: number } | undefined;
          if (prod) {
            const before = Number(prod.stock || 0);
            const after = Math.max(0, before - lockedQty);
            db.prepare(
              `UPDATE products SET stock = ?, updated_at = datetime('now', '+0000') WHERE id = ? AND tenant_id = ?`
            ).run(after, item.productId, tenantId);
            db.prepare(
              `INSERT INTO stock_transactions (id, tenant_id, product_id, product_sku, product_name, txn_type, quantity, stock_before, stock_after, unit_cost, ref_type, ref_id, operator_id, remark)
               VALUES (?, ?, ?, ?, ?, 'sale_out', ?, ?, ?, 0, 'live_session', ?, NULL, '直播选品锁定库存')`
            ).run(uuidv4(), tenantId, item.productId, prod.sku, prod.name, -lockedQty, before, after, sessionId);
          }
        }

        added += 1;
      }

      return { added, skipped, products: this.listSessionProducts(tenantId, sessionId) };
    });
  }

  removeProduct(tenantId: string, sessionId: string, productId: string): { productId: string } {
    const db = getDatabase();
    this.getSession(tenantId, sessionId);

    // 回补锁定库存：移除选品时，把该品已锁定的 stock_locked 归还到 products.stock
    const row = db.prepare(
      'SELECT stock_locked FROM live_session_products WHERE session_id = ? AND product_id = ? AND tenant_id = ?'
    ).get(sessionId, productId, tenantId) as { stock_locked: number } | undefined;
    const lockedQty = row ? Number(row.stock_locked || 0) : 0;

    const res = db.prepare(
      'DELETE FROM live_session_products WHERE session_id = ? AND product_id = ? AND tenant_id = ?'
    ).run(sessionId, productId, tenantId);
    if (!res || Number(res.changes || 0) === 0) throw new NotFoundError('场次选品', productId);

    // 关联脚本里的 product_id 置空，避免悬挂引用
    db.prepare(
      `UPDATE live_scripts SET product_id = NULL, updated_at = datetime('now', '+0000')
       WHERE session_id = ? AND product_id = ? AND tenant_id = ?`
    ).run(sessionId, productId, tenantId);

    if (lockedQty > 0) {
      const prod = db.prepare(
        'SELECT sku, name, stock FROM products WHERE id = ? AND tenant_id = ?'
      ).get(productId, tenantId) as { sku: string | null; name: string | null; stock: number } | undefined;
      if (prod) {
        const before = Number(prod.stock || 0);
        const after = before + lockedQty;
        db.prepare(
          `UPDATE products SET stock = ?, updated_at = datetime('now', '+0000') WHERE id = ? AND tenant_id = ?`
        ).run(after, productId, tenantId);
        db.prepare(
          `INSERT INTO stock_transactions (id, tenant_id, product_id, product_sku, product_name, txn_type, quantity, stock_before, stock_after, unit_cost, ref_type, ref_id, operator_id, remark)
           VALUES (?, ?, ?, ?, ?, 'adjust', ?, ?, ?, 0, 'live_session', ?, NULL, '移除直播选品，回补锁定库存')`
        ).run(uuidv4(), tenantId, productId, prod.sku, prod.name, lockedQty, before, after, sessionId);
      }
    }

    this.renumberProducts(tenantId, sessionId);
    return { productId };
  }

  reorderProducts(tenantId: string, sessionId: string, orderedProductIds: string[]): LiveSessionProduct[] {
    const db = getDatabase();
    this.getSession(tenantId, sessionId);
    orderedProductIds.forEach((productId, idx) => {
      db.prepare(
        'UPDATE live_session_products SET sort_order = ? WHERE session_id = ? AND product_id = ? AND tenant_id = ?'
      ).run(idx + 1, sessionId, productId, tenantId);
    });
    return this.listSessionProducts(tenantId, sessionId);
  }

  /** 调整讲解时段与直播价 */
  updateSlot(
    tenantId: string,
    sessionId: string,
    productId: string,
    input: {
      plannedSlotStart?: string; plannedDurationMinutes?: number;
      livePrice?: number; stockLocked?: number; sortOrder?: number;
      explainedCount?: number; soldQty?: number; gmv?: number;
    }
  ): LiveSessionProduct {
    const db = getDatabase();
    this.getSession(tenantId, sessionId);

    if (input.plannedDurationMinutes !== undefined && Number(input.plannedDurationMinutes) <= 0) {
      throw new ValidationError('讲解时长必须大于 0 分钟');
    }
    if (input.livePrice !== undefined && Number(input.livePrice) < 0) {
      throw new ValidationError('直播价不能为负数');
    }

    const fieldMap: Record<string, string> = {
      plannedSlotStart: 'planned_slot_start',
      plannedDurationMinutes: 'planned_duration_minutes',
      livePrice: 'live_price',
      stockLocked: 'stock_locked',
      sortOrder: 'sort_order',
      explainedCount: 'explained_count',
      soldQty: 'sold_qty',
      gmv: 'gmv',
    };

    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [key, column] of Object.entries(fieldMap)) {
      const value = (input as Record<string, unknown>)[key];
      if (value !== undefined) { sets.push(`${column} = ?`); params.push(value); }
    }
    if (sets.length === 0) {
      const found = this.listSessionProducts(tenantId, sessionId).find((p) => p.productId === productId);
      if (!found) throw new NotFoundError('场次选品', productId);
      return found;
    }

    // 库存锁定数调整：计算与旧值的增量，UPDATE 后同步增/减 products.stock（保持一致性）
    let stockDelta = 0;
    if (input.stockLocked !== undefined) {
      const cur = db.prepare(
        'SELECT stock_locked FROM live_session_products WHERE session_id = ? AND product_id = ? AND tenant_id = ?'
      ).get(sessionId, productId, tenantId) as { stock_locked: number } | undefined;
      const oldLocked = cur ? Number(cur.stock_locked || 0) : 0;
      stockDelta = Number(input.stockLocked) - oldLocked;
    }

    params.push(sessionId, productId, tenantId);
    const res = db.prepare(
      `UPDATE live_session_products SET ${sets.join(', ')}
       WHERE session_id = ? AND product_id = ? AND tenant_id = ?`
    ).run(...params);
    if (!res || Number(res.changes || 0) === 0) throw new NotFoundError('场次选品', productId);

    // 同步库存：stockDelta > 0 增锁（扣库存），< 0 减锁（回补库存）
    if (stockDelta !== 0) {
      const prod = db.prepare(
        'SELECT sku, name, stock FROM products WHERE id = ? AND tenant_id = ?'
      ).get(productId, tenantId) as { sku: string | null; name: string | null; stock: number } | undefined;
      if (prod) {
        const before = Number(prod.stock || 0);
        const after = Math.max(0, before - stockDelta);
        db.prepare(
          `UPDATE products SET stock = ?, updated_at = datetime('now', '+0000') WHERE id = ? AND tenant_id = ?`
        ).run(after, productId, tenantId);
        db.prepare(
          `INSERT INTO stock_transactions (id, tenant_id, product_id, product_sku, product_name, txn_type, quantity, stock_before, stock_after, unit_cost, ref_type, ref_id, operator_id, remark)
           VALUES (?, ?, ?, ?, ?, 'adjust', ?, ?, ?, 0, 'live_session', ?, NULL, '直播选品调整锁定库存')`
        ).run(uuidv4(), tenantId, productId, prod.sku, prod.name, -stockDelta, before, after, sessionId);
      }
    }

    // 转化率随讲解次数/销量变化重算：sold_qty / explained_count（讲解一次视为一次曝光机会）
    db.prepare(
      `UPDATE live_session_products
       SET conversion_rate = CASE WHEN explained_count > 0
             THEN ROUND(CAST(sold_qty AS REAL) / explained_count, 4) ELSE 0 END
       WHERE session_id = ? AND product_id = ? AND tenant_id = ?`
    ).run(sessionId, productId, tenantId);

    const updated = this.listSessionProducts(tenantId, sessionId).find((p) => p.productId === productId);
    if (!updated) throw new NotFoundError('场次选品', productId);
    return updated;
  }

  /**
   * 讲解时间轴推算：
   * 按 sort_order 依次累加 planned_duration_minutes，得到每个品的相对/绝对讲解时段，
   * 并与场次计划总时长做比对，超时给出明确警告（真实排品最常犯的错就是排太满）。
   */
  getScheduleTimeline(tenantId: string, sessionId: string): ScheduleTimeline {
    const session = this.getSession(tenantId, sessionId);
    const products = this.listSessionProducts(tenantId, sessionId);

    const plannedTotalMinutes = diffMinutes(session.plannedStart, session.plannedEnd);
    const warnings: string[] = [];

    // 开场与收尾必须预留，不能全给讲品
    const RESERVED = 9; // 暖场 4 + 收尾 5
    let cursor = plannedTotalMinutes > 0 ? 4 : 0; // 有计划时间时，从暖场结束开始排品

    const slots: ScheduleSlot[] = products.map((p) => {
      const duration = Math.max(1, Number(p.plannedDurationMinutes || 5));
      const offset = cursor;
      cursor += duration;
      return {
        productId: p.productId,
        sku: p.sku,
        productName: p.productName,
        sortOrder: p.sortOrder,
        offsetMinutes: offset,
        slotStart: session.plannedStart ? addMinutes(session.plannedStart, offset) : p.plannedSlotStart,
        slotEnd: session.plannedStart ? addMinutes(session.plannedStart, offset + duration) : null,
        durationMinutes: duration,
        livePrice: p.livePrice ?? p.sellingPrice,
      };
    });

    const scheduledMinutes = products.reduce((sum, p) => sum + Math.max(1, Number(p.plannedDurationMinutes || 5)), 0);
    const remainingMinutes = plannedTotalMinutes > 0
      ? plannedTotalMinutes - scheduledMinutes - RESERVED
      : 0;
    const overflow = plannedTotalMinutes > 0 && remainingMinutes < 0;

    if (plannedTotalMinutes <= 0) {
      warnings.push('场次未设置计划开播/结束时间，无法校验总时长，请先补全排期时间。');
    } else {
      if (overflow) {
        warnings.push(
          `选品讲解总时长 ${scheduledMinutes} 分钟 + 开收场预留 ${RESERVED} 分钟，` +
          `已超出场次计划时长 ${plannedTotalMinutes} 分钟，超时 ${Math.abs(remainingMinutes)} 分钟。` +
          `建议减少选品数量，或把单品讲解压缩到 5 分钟以内。`
        );
      } else if (remainingMinutes > plannedTotalMinutes * 0.4) {
        warnings.push(
          `当前只排了 ${scheduledMinutes} 分钟的讲品内容，还剩 ${remainingMinutes} 分钟空档。` +
          `直播间空转会掉流量，建议补品或安排返场讲解。`
        );
      }
      if (products.length > 0 && scheduledMinutes / products.length < 4) {
        warnings.push('单品平均讲解时长不足 4 分钟，讲不透就上链接，转化通常上不去，建议适当拉长。');
      }
    }
    if (products.length === 0) {
      warnings.push('该场次尚未选品。');
    }
    if (products.length > 20) {
      warnings.push(`本场排了 ${products.length} 个品，SKU 过多容易让用户决策疲劳，建议精简到 20 个以内。`);
    }

    return {
      sessionId,
      plannedStart: session.plannedStart,
      plannedTotalMinutes,
      scheduledMinutes,
      remainingMinutes,
      overflow,
      warnings,
      slots,
    };
  }

  private renumberProducts(tenantId: string, sessionId: string): void {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT id FROM live_session_products WHERE session_id = ? AND tenant_id = ? ORDER BY sort_order ASC'
    ).all(sessionId, tenantId) as Array<{ id: string }>;
    rows.forEach((r, idx) => {
      db.prepare('UPDATE live_session_products SET sort_order = ? WHERE id = ? AND tenant_id = ?')
        .run(idx + 1, r.id, tenantId);
    });
  }

  // ─────────────────────────────────────────────
  // D. 指标与复盘
  // ─────────────────────────────────────────────

  /** 手工录入一条指标快照。source 只允许 manual / import，不接受伪造的 api。 */
  recordMetric(tenantId: string, sessionId: string, data: MetricInput): LiveMetric {
    const db = getDatabase();
    this.getSession(tenantId, sessionId);

    const source = data.source === 'import' ? 'import' : 'manual';
    const id = uuidv4();

    const cumulativeUv = Math.max(0, Math.round(Number(data.cumulativeUv || 0)));
    const orders = Math.max(0, Math.round(Number(data.orders || 0)));
    if (orders > 0 && cumulativeUv > 0 && orders > cumulativeUv) {
      throw new ValidationError('订单数不能大于累计观看人数（UV），请检查录入数据');
    }

    db.prepare(
      `INSERT INTO live_metrics (
         id, tenant_id, session_id, captured_at, online_users, cumulative_uv,
         new_followers, comments, likes, shares, cart_clicks, orders, gmv,
         avg_stay_seconds, source
       ) VALUES (?, ?, ?, COALESCE(?, datetime('now', '+0000')), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, tenantId, sessionId, data.capturedAt || null,
      Math.max(0, Math.round(Number(data.onlineUsers || 0))),
      cumulativeUv,
      Math.max(0, Math.round(Number(data.newFollowers || 0))),
      Math.max(0, Math.round(Number(data.comments || 0))),
      Math.max(0, Math.round(Number(data.likes || 0))),
      Math.max(0, Math.round(Number(data.shares || 0))),
      Math.max(0, Math.round(Number(data.cartClicks || 0))),
      orders,
      Math.max(0, Number(data.gmv || 0)),
      Math.max(0, Number(data.avgStaySeconds || 0)),
      source
    );

    // 直播中同步回写场次的实际 GMV / 订单数，方便列表页直接看到进度
    db.prepare(
      `UPDATE live_sessions SET actual_gmv = ?, actual_orders = ?, updated_at = datetime('now', '+0000')
       WHERE id = ? AND tenant_id = ?`
    ).run(round2(Number(data.gmv || 0)), orders, sessionId, tenantId);

    const created = db.prepare(
      'SELECT * FROM live_metrics WHERE id = ? AND tenant_id = ?'
    ).get(id, tenantId) as Record<string, unknown>;
    return mapMetric(created);
  }

  /** 批量导入指标快照（如从平台后台导出的 CSV 解析后传入） */
  batchImportMetrics(tenantId: string, sessionId: string, list: MetricInput[]): { imported: number; failed: number; errors: string[] } {
    this.getSession(tenantId, sessionId);
    if (!list || list.length === 0) throw new ValidationError('导入数据为空');

    let imported = 0;
    let failed = 0;
    const errors: string[] = [];

    list.forEach((item, idx) => {
      try {
        this.recordMetric(tenantId, sessionId, { ...item, source: 'import' });
        imported += 1;
      } catch (e) {
        failed += 1;
        errors.push(`第 ${idx + 1} 行导入失败：${e instanceof Error ? e.message : String(e)}`);
      }
    });

    return { imported, failed, errors };
  }

  getMetricsTimeline(tenantId: string, sessionId: string): LiveMetric[] {
    const db = getDatabase();
    this.getSession(tenantId, sessionId);
    const rows = db.prepare(
      `SELECT * FROM live_metrics WHERE session_id = ? AND tenant_id = ?
       ORDER BY captured_at ASC`
    ).all(sessionId, tenantId) as Record<string, unknown>[];
    return rows.map(mapMetric);
  }

  getLatestMetric(tenantId: string, sessionId: string): LiveMetric | null {
    const db = getDatabase();
    const row = db.prepare(
      `SELECT * FROM live_metrics WHERE session_id = ? AND tenant_id = ?
       ORDER BY captured_at DESC, rowid DESC LIMIT 1`
    ).get(sessionId, tenantId) as Record<string, unknown> | undefined;
    return row ? mapMetric(row) : null;
  }

  getLiveSnapshot(tenantId: string, sessionId: string): LiveSnapshot {
    const session = this.getSession(tenantId, sessionId);
    const latest = this.getLatestMetric(tenantId, sessionId);

    const gmv = latest ? latest.gmv : session.actualGmv;
    const orders = latest ? latest.orders : session.actualOrders;
    const uv = latest ? latest.cumulativeUv : 0;

    return {
      sessionId,
      status: session.status,
      latest,
      targetGmv: session.targetGmv,
      targetOrders: session.targetOrders,
      gmvAchievementRate: session.targetGmv > 0 ? round4(gmv / session.targetGmv) : 0,
      ordersAchievementRate: session.targetOrders > 0 ? round4(orders / session.targetOrders) : 0,
      uvValue: uv > 0 ? round2(gmv / uv) : 0,
      conversionRate: uv > 0 ? round4(orders / uv) : 0,
      dataSourceNote: latest
        ? `数据来源：${latest.source === 'import' ? '批量导入' : '人工录入'}，采集时间 ${latest.capturedAt}。本系统未接入平台实时接口，非实时数据。`
        : '尚未录入任何指标快照。本系统未接入平台实时接口，请在「数据复盘」页手工录入或批量导入。',
    };
  }

  /**
   * 自动复盘 —— 算指标 + 出诊断 + 打分，结果落 live_reviews（UNIQUE(session_id)，重复生成即覆盖）。
   *
   * 诊断规则全部基于可解释的阈值，命中即产出一条带 rule 编号的结论，
   * 阈值取自常见直播间的健康区间，团队可按自身类目在此调参。
   */
  generateReview(tenantId: string, sessionId: string, reviewerId?: string): LiveReview {
    const db = getDatabase();
    const session = this.getSession(tenantId, sessionId);

    if (session.status === 'planned' || session.status === 'ready') {
      throw new ValidationError('场次尚未开播，无法生成复盘。请先完成「开播 → 下播」流程。');
    }

    const metrics = this.getMetricsTimeline(tenantId, sessionId);
    if (metrics.length === 0) {
      throw new ValidationError('该场次没有任何指标数据，无法复盘。请先在「数据复盘」页录入至少一条快照。');
    }

    const last = metrics[metrics.length - 1];
    const peakOnline = Math.max(...metrics.map((m) => m.onlineUsers), 0);

    const gmv = last.gmv > 0 ? last.gmv : session.actualGmv;
    const orders = last.orders > 0 ? last.orders : session.actualOrders;
    const uv = last.cumulativeUv;
    const avgStay = last.avgStaySeconds;
    const cartClicks = last.cartClicks;
    const newFollowers = last.newFollowers;
    const comments = last.comments;

    const gmvAchievementRate = session.targetGmv > 0 ? round4(gmv / session.targetGmv) : 0;
    const uvValue = uv > 0 ? round2(gmv / uv) : 0;
    const conversionRate = uv > 0 ? round4(orders / uv) : 0;

    // 单品表现：GMV 优先，GMV 相同看转化率
    const products = this.listSessionProducts(tenantId, sessionId);
    const ranked = [...products].sort((a, b) => (b.gmv - a.gmv) || (b.conversionRate - a.conversionRate));
    const best = ranked.length > 0 ? ranked[0] : null;
    const worst = ranked.length > 1 ? ranked[ranked.length - 1] : null;

    const highlights: DiagnosisItem[] = [];
    const problems: DiagnosisItem[] = [];
    const actions: DiagnosisItem[] = [];

    // ── 规则 1：GMV 达成率 ──
    if (session.targetGmv > 0) {
      if (gmvAchievementRate >= 1) {
        highlights.push({
          rule: 'R1-GMV-HIT', dimension: 'gmv',
          text: `GMV 达成率 ${pct(gmvAchievementRate)}，完成本场目标。把这场的选品顺序与话术版本存档，作为同类目开播的基线模板。`,
          metric: `${money(gmv)} / 目标 ${money(session.targetGmv)}`,
        });
      } else if (gmvAchievementRate < 0.6) {
        problems.push({
          rule: 'R1-GMV-MISS', dimension: 'gmv',
          text: `GMV 达成率仅 ${pct(gmvAchievementRate)}，缺口 ${money(session.targetGmv - gmv)}。这个差距不是话术微调能补的，要从流量结构和选品档位上找原因。`,
          metric: `${money(gmv)} / 目标 ${money(session.targetGmv)}`,
        });
        actions.push({
          rule: 'R1-ACT', dimension: 'gmv',
          text: '拆解缺口来源：先看是进人不够（UV 低）还是买得少（转化低）。UV 低就查开播时段与推流，转化低就查价格带与承接话术。',
        });
      } else {
        problems.push({
          rule: 'R1-GMV-NEAR', dimension: 'gmv',
          text: `GMV 达成率 ${pct(gmvAchievementRate)}，接近但未达标。差的这一截通常出在后半场节奏松掉，建议对照时间轴看后 1/3 时段的产出。`,
          metric: money(gmv),
        });
      }
    } else {
      problems.push({
        rule: 'R1-NO-TARGET', dimension: 'gmv',
        text: '本场未设置 GMV 目标，无法评估达成情况。没有目标的直播等于没有复盘基准。',
      });
      actions.push({
        rule: 'R1-ACT-TARGET', dimension: 'gmv',
        text: '下场开播前必须设定 GMV 与订单数目标，建议取近三场实际值的中位数上浮 10%。',
      });
    }

    // ── 规则 2：UV 价值（直播最核心的单一指标）──
    if (uv > 0) {
      if (uvValue < 1) {
        problems.push({
          rule: 'R2-UV-LOW', dimension: 'uv_value',
          text: `UV 价值 ${money(uvValue)}，低于 1 元的健康线。说明进来的人和你卖的货对不上——要么流量不精准，要么价格带太低撑不起产出。`,
          metric: `${money(gmv)} / ${uv} UV`,
        });
        actions.push({
          rule: 'R2-ACT-LOW', dimension: 'uv_value',
          text: '两条路二选一：一是提高客单，加入中高价位的组合装／套餐款；二是换引流款，用更贴合目标人群的品把精准流量拉进来。不要两头都动，一场只验证一个变量。',
        });
      } else if (uvValue < 3) {
        problems.push({
          rule: 'R2-UV-MID', dimension: 'uv_value',
          text: `UV 价值 ${money(uvValue)}，处在 1-3 元的及格区间，还没到能放量投流的水平。`,
          metric: money(uvValue),
        });
        actions.push({
          rule: 'R2-ACT-MID', dimension: 'uv_value',
          text: '先把 UV 价值做到 3 元以上再考虑加大投流，否则投得越多亏得越快。优先优化转化最高那个品的讲解时长占比。',
        });
      } else {
        highlights.push({
          rule: 'R2-UV-GOOD', dimension: 'uv_value',
          text: `UV 价值 ${money(uvValue)}，超过 3 元，流量承接效率良好，具备加大投流的基础。`,
          metric: money(uvValue),
        });
        actions.push({
          rule: 'R2-ACT-GOOD', dimension: 'uv_value',
          text: '维持当前选品结构，小步加大投流预算测试上限，同时监控 UV 价值是否随流量放大而下滑。',
        });
      }
    } else {
      problems.push({
        rule: 'R2-NO-UV', dimension: 'uv_value',
        text: '未录入累计观看人数（UV），UV 价值无法计算。UV 是直播复盘的分母，缺了它其他指标都失去意义。',
      });
    }

    // ── 规则 3：转化率 ──
    if (uv > 0) {
      if (conversionRate < 0.01) {
        problems.push({
          rule: 'R3-CVR-LOW', dimension: 'conversion',
          text: `转化率 ${pct(conversionRate)}，低于 1%。人进来了但没下单，问题基本在承接环节：讲解不透、价格没算清、或者没给下单理由。`,
          metric: `${orders} 单 / ${uv} UV`,
        });
        actions.push({
          rule: 'R3-ACT-LOW', dimension: 'conversion',
          text: '回听录像，重点查每个品的「价格锚定」段是否讲了单次使用成本。用户算不出这笔账就不会下单。',
        });
      } else if (conversionRate >= 0.05) {
        highlights.push({
          rule: 'R3-CVR-GOOD', dimension: 'conversion',
          text: `转化率 ${pct(conversionRate)}，超过 5%，承接话术有效。`,
          metric: `${orders} 单 / ${uv} UV`,
        });
      }
    }

    // ── 规则 4：加购转化（购物车点击 → 订单）──
    if (cartClicks > 0) {
      const cartToOrder = orders / cartClicks;
      if (cartToOrder < 0.3) {
        problems.push({
          rule: 'R4-CART-DROP', dimension: 'conversion',
          text: `加购 ${cartClicks} 次只成交 ${orders} 单，加购转化 ${pct(cartToOrder)}，不足三成。用户点了购物车却没付款，说明临门一脚的逼单动作缺失。`,
          metric: pct(cartToOrder),
        });
        actions.push({
          rule: 'R4-ACT', dimension: 'conversion',
          text: '在每个品讲完后固定加一句库存播报 + 五秒倒计时，并让助播念未付款人数，把犹豫的人推过去。注意不要用虚假紧迫话术。',
        });
      } else if (cartToOrder >= 0.5) {
        highlights.push({
          rule: 'R4-CART-GOOD', dimension: 'conversion',
          text: `加购转化 ${pct(cartToOrder)}，逼单环节执行到位。`,
          metric: pct(cartToOrder),
        });
      }
    }

    // ── 规则 5：平均停留时长 ──
    if (avgStay > 0) {
      if (avgStay < 60) {
        problems.push({
          rule: 'R5-STAY-LOW', dimension: 'stay',
          text: `平均停留 ${Math.round(avgStay)} 秒，不足 1 分钟。用户看一眼就走，开场留人话术明显没起作用。`,
          metric: `${Math.round(avgStay)} 秒`,
        });
        actions.push({
          rule: 'R5-ACT-LOW', dimension: 'stay',
          text: '改开场：前 30 秒必须抛出具体福利（什么品、什么价、几点上），不要先自我介绍。福利信息越具体，留人越有效。',
        });
      } else if (avgStay < 120) {
        problems.push({
          rule: 'R5-STAY-MID', dimension: 'stay',
          text: `平均停留 ${Math.round(avgStay)} 秒，在 1-2 分钟之间，勉强及格但撑不住系统推流。`,
          metric: `${Math.round(avgStay)} 秒`,
        });
        actions.push({
          rule: 'R5-ACT-MID', dimension: 'stay',
          text: '每 20 分钟插一段互动或福袋，把停留曲线的低谷填掉，避免中段掉人。',
        });
      } else {
        highlights.push({
          rule: 'R5-STAY-GOOD', dimension: 'stay',
          text: `平均停留 ${Math.round(avgStay)} 秒，超过 2 分钟，内容承接与互动节奏做得不错。`,
          metric: `${Math.round(avgStay)} 秒`,
        });
      }
    } else {
      problems.push({
        rule: 'R5-NO-STAY', dimension: 'stay',
        text: '未录入平均停留时长。停留是判断开场话术是否有效的关键指标，建议下场务必补录。',
      });
    }

    // ── 规则 6：涨粉效率 ──
    if (uv > 0) {
      const followRate = newFollowers / uv;
      if (followRate < 0.01) {
        problems.push({
          rule: 'R6-FOLLOW-LOW', dimension: 'interact',
          text: `涨粉 ${newFollowers} 人，涨粉率 ${pct(followRate)}，低于 1%。这场的流量基本是一次性的，没沉淀下来。`,
          metric: `${newFollowers} 人 / ${uv} UV`,
        });
        actions.push({
          rule: 'R6-ACT', dimension: 'interact',
          text: '关注引导要给具体好处：下场开播提醒、老粉提问优先、粉丝专属价。空喊「点个关注」没人动。至少在开场、中段互动、收尾各引导一次。',
        });
      } else if (followRate >= 0.03) {
        highlights.push({
          rule: 'R6-FOLLOW-GOOD', dimension: 'interact',
          text: `涨粉 ${newFollowers} 人，涨粉率 ${pct(followRate)}，粉丝沉淀效率良好，为下场开播积累了初始人气。`,
          metric: pct(followRate),
        });
      }
    }

    // ── 规则 7：公屏互动密度 ──
    if (uv > 0) {
      const commentRate = comments / uv;
      if (commentRate < 0.03) {
        problems.push({
          rule: 'R7-COMMENT-LOW', dimension: 'interact',
          text: `公屏评论 ${comments} 条，互动率 ${pct(commentRate)}，直播间偏冷。公屏不动，系统就不给推流。`,
          metric: pct(commentRate),
        });
        actions.push({
          rule: 'R7-ACT', dimension: 'interact',
          text: '把开放式提问改成选择题（扣 1/2/3），互动门槛降下来公屏才会动。助播要负责念公屏、带节奏，不能只挂链接。',
        });
      }
    }

    // ── 规则 8：单品表现分化 ──
    if (best && best.gmv > 0) {
      highlights.push({
        rule: 'R8-BEST', dimension: 'product',
        text: `产出最高的是「${best.productName || best.productId}」，贡献 ${money(best.gmv)}。下场把它的讲解时段前移，并围绕它做组合搭配。`,
        metric: money(best.gmv),
      });
    }
    if (worst && worst.gmv === 0) {
      problems.push({
        rule: 'R8-WORST-ZERO', dimension: 'product',
        text: `「${worst.productName || worst.productId}」本场零成交，白占了 ${worst.plannedDurationMinutes} 分钟讲解时长。`,
        metric: '0 元',
      });
      actions.push({
        rule: 'R8-ACT-ZERO', dimension: 'product',
        text: '先别急着下架，判断是「货不行」还是「讲得不行」：如果讲解次数不足 2 次，下场换个时段再试一次；已经讲过 3 次以上仍无成交，直接替换掉。',
      });
    }
    const unexplained = products.filter((p) => p.explainedCount === 0);
    if (unexplained.length > 0) {
      problems.push({
        rule: 'R9-UNEXPLAINED', dimension: 'product',
        text: `有 ${unexplained.length} 个品全程没讲到（${unexplained.slice(0, 3).map((p) => p.productName || p.productId).join('、')}${unexplained.length > 3 ? ' 等' : ''}）。排了不讲等于没排。`,
        metric: `${unexplained.length} / ${products.length}`,
      });
      actions.push({
        rule: 'R9-ACT', dimension: 'product',
        text: '排品数量按「计划时长 ÷ 单品 6 分钟」倒推，排不下就砍。助播要在时间轴上卡点提醒主播切品。',
      });
    }

    // ── 规则 10：直播时长 ──
    if (session.durationMinutes > 0 && session.durationMinutes < 120) {
      problems.push({
        rule: 'R10-DURATION', dimension: 'duration',
        text: `本场实际直播 ${session.durationMinutes} 分钟，不足 2 小时。时长太短，系统的流量池还没完全打开就下播了。`,
        metric: `${session.durationMinutes} 分钟`,
      });
      actions.push({
        rule: 'R10-ACT', dimension: 'duration',
        text: '稳定在 2-4 小时，并固定开播时段。时长和开播规律性是自然流量推荐的基础权重。',
      });
    }

    // ── 规则 11：脚本合规风险 ──
    try {
      const compliance = this.checkScriptCompliance(tenantId, sessionId);
      if (compliance.highCount > 0) {
        problems.push({
          rule: 'R11-COMPLIANCE', dimension: 'script',
          text: `脚本合规扫描发现 ${compliance.highCount} 处高危违禁表述（另有中危 ${compliance.mediumCount} 处）。这类问题一旦被平台判定，轻则限流重则封播。`,
          metric: `${compliance.totalIssues} 处`,
        });
        actions.push({
          rule: 'R11-ACT', dimension: 'script',
          text: '开播前必须把高危项清零。到「脚本工作台 → 合规检查」逐条按建议改写，改完再扫一次。',
        });
      } else if (compliance.totalIssues === 0 && compliance.scannedSegments > 0) {
        highlights.push({
          rule: 'R11-CLEAN', dimension: 'script',
          text: `脚本合规扫描通过，${compliance.scannedSegments} 段脚本未发现违禁表述。`,
        });
      }
    } catch (e) {
      logger.warn('livestream', `复盘时合规扫描失败：${String(e)}`, { tenantId, sessionId });
    }

    // ── 规则 12：在线人数峰值与均值落差 ──
    if (peakOnline > 0 && last.onlineUsers > 0) {
      const dropRate = 1 - last.onlineUsers / peakOnline;
      if (dropRate > 0.7) {
        problems.push({
          rule: 'R12-PEAK-DROP', dimension: 'stay',
          text: `在线人数从峰值 ${peakOnline} 掉到收尾时的 ${last.onlineUsers}，跌幅 ${pct(dropRate)}。后半场明显守不住人。`,
          metric: pct(dropRate),
        });
        actions.push({
          rule: 'R12-ACT', dimension: 'stay',
          text: '把一个高价值爆品留到后半场做压轴，并在开场就预告「几点讲什么」，给用户留下来的理由。',
        });
      }
    }

    // ── 主播评分（0-100）──
    const anchorScore = computeAnchorScore({
      gmvAchievementRate, uvValue, conversionRate, avgStaySeconds: avgStay,
    });

    if (anchorScore >= 85) {
      highlights.push({
        rule: 'R13-SCORE', dimension: 'gmv',
        text: `本场主播综合评分 ${anchorScore} 分，四项核心指标均衡。可作为新人主播的培训案例。`,
        metric: `${anchorScore} 分`,
      });
    } else if (anchorScore < 50) {
      actions.push({
        rule: 'R13-ACT', dimension: 'gmv',
        text: `本场主播综合评分 ${anchorScore} 分，建议安排一次陪播复盘：主播、运营、助播三人一起回看录像，逐段标注掉人节点。`,
      });
    }

    if (actions.length === 0) {
      actions.push({
        rule: 'R0-KEEP', dimension: 'gmv',
        text: '各项指标未触发预警，保持当前节奏。下场可尝试小幅提高目标或测试新品，持续找上限。',
      });
    }

    // 落库（UNIQUE(session_id)，重复生成覆盖）
    const existing = db.prepare(
      'SELECT id FROM live_reviews WHERE session_id = ? AND tenant_id = ?'
    ).get(sessionId, tenantId) as { id: string } | undefined;

    const payload = [
      gmvAchievementRate, uvValue, conversionRate, round2(avgStay),
      best?.productId || null, worst?.productId || null,
      JSON.stringify(highlights), JSON.stringify(problems), JSON.stringify(actions),
      anchorScore, reviewerId || null,
    ];

    if (existing) {
      db.prepare(
        `UPDATE live_reviews SET
           gmv_achievement_rate = ?, uv_value = ?, conversion_rate = ?, avg_stay_seconds = ?,
           best_product_id = ?, worst_product_id = ?,
           highlights = ?, problems = ?, actions = ?,
           anchor_score = ?, reviewer_id = ?, created_at = datetime('now', '+0000')
         WHERE id = ? AND tenant_id = ?`
      ).run(...payload, existing.id, tenantId);
    } else {
      db.prepare(
        `INSERT INTO live_reviews (
           id, tenant_id, session_id,
           gmv_achievement_rate, uv_value, conversion_rate, avg_stay_seconds,
           best_product_id, worst_product_id, highlights, problems, actions,
           anchor_score, reviewer_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+0000'))`
      ).run(uuidv4(), tenantId, sessionId, ...payload);
    }

    // 复盘完成后把场次推进到 reviewed（ended → reviewed 是合法流转）
    if (session.status === 'ended') {
      db.prepare(
        `UPDATE live_sessions SET status = 'reviewed', updated_at = datetime('now', '+0000')
         WHERE id = ? AND tenant_id = ?`
      ).run(sessionId, tenantId);
    }

    const result = this.getReview(tenantId, sessionId);
    if (!result) throw new NotFoundError('直播复盘', sessionId);
    logger.info('livestream', `生成场次 ${sessionId} 复盘，评分 ${anchorScore}`, { tenantId });
    return result;
  }

  getReview(tenantId: string, sessionId: string): LiveReview | null {
    const db = getDatabase();
    const row = db.prepare(
      `SELECT r.*,
              bp.name AS best_product_name,
              wp.name AS worst_product_name
       FROM live_reviews r
       LEFT JOIN products bp ON bp.id = r.best_product_id AND bp.tenant_id = r.tenant_id
       LEFT JOIN products wp ON wp.id = r.worst_product_id AND wp.tenant_id = r.tenant_id
       WHERE r.session_id = ? AND r.tenant_id = ?`
    ).get(sessionId, tenantId) as Record<string, unknown> | undefined;
    return row ? mapReview(row) : null;
  }

  // ─────────────────────────────────────────────
  // E. 主播绩效 & 总览
  // ─────────────────────────────────────────────

  /**
   * 主播绩效汇总，供 HR 绩效模块消费。
   * period 支持 'YYYY-MM'（自然月）或 'YYYY'（年度）；不传则统计全部历史。
   */
  getAnchorPerformance(tenantId: string, employeeId: string, period?: string): AnchorPerformance {
    const db = getDatabase();

    const emp = db.prepare(
      'SELECT id, name FROM employees WHERE id = ? AND tenant_id = ?'
    ).get(employeeId, tenantId) as { id: string; name: string } | undefined;
    if (!emp) throw new NotFoundError('员工', employeeId);

    const where: string[] = [
      's.tenant_id = ?', 's.anchor_employee_id = ?',
      "s.status IN ('ended', 'reviewed')",
    ];
    const params: unknown[] = [tenantId, employeeId];
    if (period) {
      where.push("substr(COALESCE(s.actual_start, s.planned_start, s.created_at), 1, ?) = ?");
      params.push(period.length, period);
    }

    const rows = db.prepare(
      `SELECT s.id, s.title, s.planned_start, s.actual_start, s.status,
              s.target_gmv, s.actual_gmv, s.actual_orders, s.duration_minutes,
              r.anchor_score, r.uv_value, r.conversion_rate, r.avg_stay_seconds
       FROM live_sessions s
       LEFT JOIN live_reviews r ON r.session_id = s.id AND r.tenant_id = s.tenant_id
       WHERE ${where.join(' AND ')}
       ORDER BY COALESCE(s.actual_start, s.planned_start, s.created_at) DESC`
    ).all(...params) as Array<Record<string, unknown>>;

    const sessions = rows.map((r) => {
      const target = Number(r.target_gmv || 0);
      const actual = Number(r.actual_gmv || 0);
      return {
        id: String(r.id),
        title: String(r.title || ''),
        plannedStart: (r.planned_start as string) || null,
        status: (r.status as LiveSessionStatus) || 'ended',
        targetGmv: round2(target),
        actualGmv: round2(actual),
        achievementRate: target > 0 ? round4(actual / target) : 0,
        anchorScore: r.anchor_score !== null && r.anchor_score !== undefined ? round2(Number(r.anchor_score)) : null,
      };
    });

    // 累计 UV 取每场最后一条快照
    let totalUv = 0;
    for (const r of rows) {
      const m = db.prepare(
        `SELECT cumulative_uv FROM live_metrics
         WHERE session_id = ? AND tenant_id = ?
         ORDER BY captured_at DESC, rowid DESC LIMIT 1`
      ).get(String(r.id), tenantId) as { cumulative_uv: number } | undefined;
      totalUv += Number(m?.cumulative_uv || 0);
    }

    const totalGmv = rows.reduce((s, r) => s + Number(r.actual_gmv || 0), 0);
    const totalOrders = rows.reduce((s, r) => s + Number(r.actual_orders || 0), 0);
    const liveMinutes = rows.reduce((s, r) => s + Number(r.duration_minutes || 0), 0);

    const scored = rows.filter((r) => r.anchor_score !== null && r.anchor_score !== undefined);
    const stayed = rows.filter((r) => Number(r.avg_stay_seconds || 0) > 0);

    const bestRow = [...rows].sort((a, b) => Number(b.actual_gmv || 0) - Number(a.actual_gmv || 0))[0];

    return {
      employeeId,
      employeeName: emp.name,
      period: period || '全部',
      sessionCount: rows.length,
      liveMinutes,
      totalGmv: round2(totalGmv),
      totalOrders,
      totalUv,
      avgUvValue: totalUv > 0 ? round2(totalGmv / totalUv) : 0,
      avgConversionRate: totalUv > 0 ? round4(totalOrders / totalUv) : 0,
      avgStaySeconds: stayed.length > 0
        ? round2(stayed.reduce((s, r) => s + Number(r.avg_stay_seconds || 0), 0) / stayed.length)
        : 0,
      avgGmvAchievementRate: sessions.length > 0
        ? round4(sessions.reduce((s, x) => s + x.achievementRate, 0) / sessions.length)
        : 0,
      avgAnchorScore: scored.length > 0
        ? round2(scored.reduce((s, r) => s + Number(r.anchor_score || 0), 0) / scored.length)
        : 0,
      bestSession: bestRow
        ? { id: String(bestRow.id), title: String(bestRow.title || ''), gmv: round2(Number(bestRow.actual_gmv || 0)) }
        : null,
      sessions,
    };
  }

  /** 直播总览：本月场次数 / 总 GMV / 平均 UV 价值 / Top 主播 / 近期场次 */
  getOverview(tenantId: string): LivestreamOverview {
    const db = getDatabase();
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM

    const monthRows = db.prepare(
      `SELECT s.id, s.actual_gmv, s.actual_orders, s.anchor_employee_id, s.status
       FROM live_sessions s
       WHERE s.tenant_id = ?
         AND substr(COALESCE(s.actual_start, s.planned_start, s.created_at), 1, 7) = ?
         AND s.status != 'cancelled'`
    ).all(tenantId, month) as Array<Record<string, unknown>>;

    let totalGmv = 0;
    let totalOrders = 0;
    let totalUv = 0;
    let livingCount = 0;

    for (const r of monthRows) {
      totalGmv += Number(r.actual_gmv || 0);
      totalOrders += Number(r.actual_orders || 0);
      if (r.status === 'living') livingCount += 1;
      const m = db.prepare(
        `SELECT cumulative_uv FROM live_metrics
         WHERE session_id = ? AND tenant_id = ?
         ORDER BY captured_at DESC, rowid DESC LIMIT 1`
      ).get(String(r.id), tenantId) as { cumulative_uv: number } | undefined;
      totalUv += Number(m?.cumulative_uv || 0);
    }

    const anchorRows = db.prepare(
      `SELECT s.anchor_employee_id AS eid,
              e.name AS name,
              COUNT(*) AS cnt,
              COALESCE(SUM(s.actual_gmv), 0) AS gmv,
              COALESCE(AVG(r.anchor_score), 0) AS avg_score
       FROM live_sessions s
       JOIN employees e ON e.id = s.anchor_employee_id AND e.tenant_id = s.tenant_id
       LEFT JOIN live_reviews r ON r.session_id = s.id AND r.tenant_id = s.tenant_id
       WHERE s.tenant_id = ?
         AND s.anchor_employee_id IS NOT NULL
         AND s.status IN ('ended', 'reviewed')
         AND substr(COALESCE(s.actual_start, s.planned_start, s.created_at), 1, 7) = ?
       GROUP BY s.anchor_employee_id, e.name
       ORDER BY gmv DESC
       LIMIT 5`
    ).all(tenantId, month) as Array<Record<string, unknown>>;

    const recent = this.listSessions(tenantId, { limit: 8, page: 1 });

    return {
      generatedAt: new Date().toISOString(),
      month,
      sessionCount: monthRows.length,
      livingCount,
      totalGmv: round2(totalGmv),
      totalOrders,
      avgUvValue: totalUv > 0 ? round2(totalGmv / totalUv) : 0,
      avgConversionRate: totalUv > 0 ? round4(totalOrders / totalUv) : 0,
      topAnchors: anchorRows.map((r) => ({
        employeeId: String(r.eid),
        name: String(r.name || ''),
        sessionCount: Number(r.cnt || 0),
        gmv: round2(Number(r.gmv || 0)),
        avgScore: round2(Number(r.avg_score || 0)),
      })),
      recentSessions: recent.data,
    };
  }

  // ─────────────────────────────────────────────
  // 内部校验
  // ─────────────────────────────────────────────

  private assertEmployee(tenantId: string, employeeId: string, role: string): void {
    const db = getDatabase();
    const row = db.prepare(
      'SELECT id FROM employees WHERE id = ? AND tenant_id = ?'
    ).get(employeeId, tenantId) as { id: string } | undefined;
    if (!row) throw new ValidationError(`指定的${role}不存在或不属于当前租户`);
  }

  private assertProduct(tenantId: string, productId: string): void {
    const db = getDatabase();
    const row = db.prepare(
      'SELECT id FROM products WHERE id = ? AND tenant_id = ?'
    ).get(productId, tenantId) as { id: string } | undefined;
    if (!row) throw new ValidationError(`商品 ${productId} 不存在或不属于当前租户`);
  }
  /** LC-01: 为指定场次导入沙箱模板数据（模拟一场直播的指标快照） */
  addSandboxMetrics(tenantId: string, sessionId: string): { imported: number; errors: string[] } {
    const db = getDatabase();
    const session = db.prepare(
      'SELECT * FROM live_sessions WHERE id = ? AND tenant_id = ?'
    ).get(sessionId, tenantId) as Record<string, unknown> | undefined;
    if (!session) throw new NotFoundError('直播场次', sessionId);

    const startTime = new Date((session.started_at as string) || new Date().toISOString());
    const errors: string[] = [];
    let imported = 0;

    // 模拟每30分钟一条快照，共8条
    const snapshots = [
      { minute: 5, uv: 120, users: 85, comments: 12, likes: 45, shares: 3, cartClicks: 8, orders: 2, gmv: 298, stay: 120 },
      { minute: 35, uv: 380, users: 210, comments: 56, likes: 189, shares: 12, cartClicks: 34, orders: 8, gmv: 1240, stay: 180 },
      { minute: 65, uv: 520, users: 290, comments: 78, likes: 312, shares: 21, cartClicks: 52, orders: 14, gmv: 2340, stay: 210 },
      { minute: 95, uv: 610, users: 340, comments: 95, likes: 425, shares: 28, cartClicks: 68, orders: 19, gmv: 3120, stay: 240 },
      { minute: 125, uv: 580, users: 310, comments: 88, likes: 398, shares: 25, cartClicks: 61, orders: 17, gmv: 2850, stay: 225 },
      { minute: 155, uv: 490, users: 260, comments: 72, likes: 298, shares: 19, cartClicks: 48, orders: 12, gmv: 2100, stay: 195 },
      { minute: 185, uv: 380, users: 195, comments: 54, likes: 210, shares: 14, cartClicks: 35, orders: 8, gmv: 1380, stay: 165 },
      { minute: 215, uv: 280, users: 130, comments: 38, likes: 145, shares: 9, cartClicks: 22, orders: 5, gmv: 820, stay: 135 },
    ];

    for (const snap of snapshots) {
      try {
        const capturedAt = new Date(startTime.getTime() + snap.minute * 60 * 1000).toISOString();
        db.prepare(
          `INSERT INTO live_metrics
           (id, tenant_id, session_id, captured_at, online_users, cumulative_uv,
            new_followers, comments, likes, shares, cart_clicks, orders, gmv, avg_stay_seconds, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          uuidv4(), tenantId, sessionId, capturedAt,
          snap.users, snap.uv,
          Math.floor(snap.uv * 0.08),
          snap.comments, snap.likes, snap.shares, snap.cartClicks,
          snap.orders, snap.gmv, snap.stay,
          'sandbox'
        );
        imported += 1;
      } catch (e) {
        errors.push(`第 ${snap.minute} 分钟快照导入失败: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return { imported, errors };
  }
}

// ══════════════════════════════════════════════════════════
// 五、工具函数
// ══════════════════════════════════════════════════════════

function round2(n: number): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}
function round4(n: number): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 10000) / 10000 : 0;
}
function pct(n: number): string {
  return `${(Number(n) * 100).toFixed(1)}%`;
}
function money(n: number): string {
  return `${round2(Number(n)).toFixed(2)} 元`;
}

function safeJsonArray<T>(raw: unknown, fallback: T[] = []): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

/** 计算两个时间字符串之间的分钟差；任一为空返回 0 */
function diffMinutes(start: string | null | undefined, end: string | null | undefined): number {
  if (!start || !end) return 0;
  const s = new Date(start.replace(' ', 'T')).getTime();
  const e = new Date(end.replace(' ', 'T')).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 0;
  return Math.round((e - s) / 60000);
}

/** 在时间字符串上加分钟，返回 'YYYY-MM-DD HH:mm' */
function addMinutes(base: string, minutes: number): string {
  const t = new Date(base.replace(' ', 'T')).getTime();
  if (!Number.isFinite(t)) return base;
  const d = new Date(t + minutes * 60000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function effectivePrice(p: LiveSessionProduct): number {
  const v = p.livePrice ?? p.sellingPrice ?? 0;
  return Number(v) || 0;
}

/**
 * 主播评分模型（0-100）：
 *   GMV 达成率 35% + UV 价值 25% + 转化率 20% + 平均停留 20%
 * 每个分项各自归一化并封顶，避免单项爆表拉高总分。
 */
function computeAnchorScore(input: {
  gmvAchievementRate: number; uvValue: number; conversionRate: number; avgStaySeconds: number;
}): number {
  // 达成率：1.0 得满分，超出部分按 1.2 封顶
  const gmvScore = Math.min(1, input.gmvAchievementRate / 1.0) * 100;
  // UV 价值：5 元视为满分
  const uvScore = Math.min(1, input.uvValue / 5) * 100;
  // 转化率：8% 视为满分
  const cvrScore = Math.min(1, input.conversionRate / 0.08) * 100;
  // 停留：240 秒（4 分钟）视为满分
  const stayScore = Math.min(1, input.avgStaySeconds / 240) * 100;

  const total = gmvScore * 0.35 + uvScore * 0.25 + cvrScore * 0.2 + stayScore * 0.2;
  return round2(Math.max(0, Math.min(100, total)));
}

/** 纯命中扫描，不带上下文（保存脚本时用，轻量） */
function scanText(text: string, field: 'talk_track' | 'cta_text'): ComplianceFlag[] {
  if (!text) return [];
  const flags: ComplianceFlag[] = [];
  const seen = new Set<string>();
  for (const entry of SORTED_LEXICON) {
    if (text.includes(entry.word) && !seen.has(entry.word)) {
      seen.add(entry.word);
      flags.push({
        word: entry.word, category: entry.category,
        severity: entry.severity, field, suggestion: entry.suggestion,
      });
    }
  }
  return flags;
}

/** 带上下文的扫描（合规检查报告用），同一个词多处命中会分别返回 */
function scanTextWithPosition(
  text: string,
  field: 'talk_track' | 'cta_text'
): Array<{ flag: ComplianceFlag; context: string }> {
  if (!text) return [];
  const results: Array<{ flag: ComplianceFlag; context: string }> = [];
  // 已被长词覆盖的区间不再重复命中短词（如「全网最低」命中后不再报「最低」）
  const covered: Array<[number, number]> = [];

  for (const entry of SORTED_LEXICON) {
    let from = 0;
    for (;;) {
      const idx = text.indexOf(entry.word, from);
      if (idx === -1) break;
      const end = idx + entry.word.length;
      const overlapped = covered.some(([s, e]) => idx < e && end > s);
      if (!overlapped) {
        covered.push([idx, end]);
        results.push({
          flag: {
            word: entry.word, category: entry.category,
            severity: entry.severity, field, suggestion: entry.suggestion,
          },
          context: text.slice(Math.max(0, idx - 12), Math.min(text.length, end + 12)).replace(/\n/g, ' '),
        });
      }
      from = end;
    }
  }
  return results;
}

// ── 行映射 ──

function mapSession(r: Record<string, unknown>): LiveSession {
  const targetGmv = Number(r.target_gmv || 0);
  const actualGmv = Number(r.actual_gmv || 0);
  return {
    id: String(r.id),
    tenantId: String(r.tenant_id),
    projectId: (r.project_id as string) || null,
    title: String(r.title || ''),
    platform: String(r.platform || 'douyin'),
    roomId: (r.room_id as string) || null,
    anchorEmployeeId: (r.anchor_employee_id as string) || null,
    anchorName: (r.anchor_name as string) || null,
    assistantEmployeeId: (r.assistant_employee_id as string) || null,
    assistantName: (r.assistant_name as string) || null,
    plannedStart: (r.planned_start as string) || null,
    plannedEnd: (r.planned_end as string) || null,
    actualStart: (r.actual_start as string) || null,
    actualEnd: (r.actual_end as string) || null,
    durationMinutes: Number(r.duration_minutes || 0),
    targetGmv: round2(targetGmv),
    actualGmv: round2(actualGmv),
    targetOrders: Number(r.target_orders || 0),
    actualOrders: Number(r.actual_orders || 0),
    status: (r.status as LiveSessionStatus) || 'planned',
    coverUrl: (r.cover_url as string) || null,
    remark: (r.remark as string) || null,
    createdAt: String(r.created_at || ''),
    updatedAt: String(r.updated_at || ''),
    gmvAchievementRate: targetGmv > 0 ? round4(actualGmv / targetGmv) : 0,
  };
}

function mapScript(r: Record<string, unknown>): LiveScript {
  return {
    id: String(r.id),
    tenantId: String(r.tenant_id),
    sessionId: String(r.session_id),
    segmentNo: Number(r.segment_no || 1),
    segmentType: (r.segment_type as LiveSegmentType) || 'sell',
    title: String(r.title || ''),
    productId: (r.product_id as string) || null,
    productName: (r.product_name as string) || null,
    durationMinutes: Number(r.duration_minutes || 5),
    talkTrack: String(r.talk_track || ''),
    sellingPoints: safeJsonArray<string>(r.selling_points),
    objectionHandling: safeJsonArray<{ objection: string; response: string }>(r.objection_handling),
    ctaText: String(r.cta_text || ''),
    complianceFlags: safeJsonArray<ComplianceFlag>(r.compliance_flags),
    createdAt: String(r.created_at || ''),
    updatedAt: String(r.updated_at || ''),
  };
}

function mapSessionProduct(r: Record<string, unknown>): LiveSessionProduct {
  return {
    id: String(r.id),
    tenantId: String(r.tenant_id),
    sessionId: String(r.session_id),
    productId: String(r.product_id),
    sku: (r.sku as string) || null,
    productName: (r.product_name as string) || null,
    category: (r.category as string) || null,
    sellingPrice: r.selling_price !== null && r.selling_price !== undefined ? Number(r.selling_price) : null,
    marketPrice: r.market_price !== null && r.market_price !== undefined ? Number(r.market_price) : null,
    costPrice: r.cost_price !== null && r.cost_price !== undefined ? Number(r.cost_price) : null,
    stock: Number(r.stock || 0),
    sortOrder: Number(r.sort_order || 0),
    plannedSlotStart: (r.planned_slot_start as string) || null,
    plannedDurationMinutes: Number(r.planned_duration_minutes || 5),
    livePrice: r.live_price !== null && r.live_price !== undefined ? Number(r.live_price) : null,
    stockLocked: Number(r.stock_locked || 0),
    explainedCount: Number(r.explained_count || 0),
    soldQty: Number(r.sold_qty || 0),
    gmv: round2(Number(r.gmv || 0)),
    conversionRate: round4(Number(r.conversion_rate || 0)),
    createdAt: String(r.created_at || ''),
  };
}

function mapMetric(r: Record<string, unknown>): LiveMetric {
  return {
    id: String(r.id),
    tenantId: String(r.tenant_id),
    sessionId: String(r.session_id),
    capturedAt: String(r.captured_at || ''),
    onlineUsers: Number(r.online_users || 0),
    cumulativeUv: Number(r.cumulative_uv || 0),
    newFollowers: Number(r.new_followers || 0),
    comments: Number(r.comments || 0),
    likes: Number(r.likes || 0),
    shares: Number(r.shares || 0),
    cartClicks: Number(r.cart_clicks || 0),
    orders: Number(r.orders || 0),
    gmv: round2(Number(r.gmv || 0)),
    avgStaySeconds: round2(Number(r.avg_stay_seconds || 0)),
    source: String(r.source || 'manual'),
  };
}

function mapReview(r: Record<string, unknown>): LiveReview {
  return {
    id: String(r.id),
    tenantId: String(r.tenant_id),
    sessionId: String(r.session_id),
    gmvAchievementRate: round4(Number(r.gmv_achievement_rate || 0)),
    uvValue: round2(Number(r.uv_value || 0)),
    conversionRate: round4(Number(r.conversion_rate || 0)),
    avgStaySeconds: round2(Number(r.avg_stay_seconds || 0)),
    bestProductId: (r.best_product_id as string) || null,
    bestProductName: (r.best_product_name as string) || null,
    worstProductId: (r.worst_product_id as string) || null,
    worstProductName: (r.worst_product_name as string) || null,
    highlights: safeJsonArray<DiagnosisItem>(r.highlights),
    problems: safeJsonArray<DiagnosisItem>(r.problems),
    actions: safeJsonArray<DiagnosisItem>(r.actions),
    anchorScore: round2(Number(r.anchor_score || 0)),
    reviewerId: (r.reviewer_id as string) || null,
    createdAt: String(r.created_at || ''),
  };
}


export const livestreamService = new LivestreamService();
