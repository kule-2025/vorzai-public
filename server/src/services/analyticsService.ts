/**
 * Vorzai 数据分析服务（Analytics Service）
 *
 * 设计铁律：
 *   1. 全部数字来自真实 SQL 聚合，没有任何占位或虚构数据、也不以随机方式兜底。
 *   2. 数据不足时返回 available=false + reason，由前端诚实展示「暂无数据」。
 *   3. 每个指标都带 formula 字段，说明「这个数字是怎么算出来的」。
 *   4. 所有 SQL 强制带 tenant_id 过滤，配合 tenantIsolation 中间件。
 *
 * 毛利口径（与 cockpitService 完全一致，禁止偏离）：
 *   revenue = Σ(paid_amount > 0 ? paid_amount : total_amount)
 *             WHERE payment_status IN ('paid','partial','refunded')
 *   cost    = Σ(每个订单 items[].quantity × products.cost_price)
 *   毛利     = revenue − cost
 *
 * 性能策略：
 *   订单区间数据一次性载入内存后在 JS 侧做多维聚合。
 *   桌面端 SQLite 单租户数据量可控，且这样能保证所有模块共用同一口径，
 *   避免各处 SQL 各写各的导致数字对不上（数据分析的死罪）。
 */
import { getDatabase, transaction } from '../db';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { FUNNEL_STATUS, buildFunnelDateClause } from '../utils/funnelConstants';

// ══════════════════ 类型定义 ══════════════════

/** 时间区间（闭区间，YYYY-MM-DD） */
export interface DateRange {
  from: string;
  to: string;
}

/** 对比模式：none 不对比 / prev 环比（紧邻上一等长区间）/ yoy 同比（去年同期） */
export type CompareMode = 'none' | 'prev' | 'yoy';

/** 指标单位，前端据此决定格式化方式 */
export type MetricUnit = 'currency' | 'count' | 'percent';

/** 单个指标（含同环比） */
export interface MetricValue {
  key: string;
  label: string;
  unit: MetricUnit;
  value: number;
  /** 对比区间值；compare=none 或对比区间无数据时为 null */
  prevValue: number | null;
  /** (value - prevValue) / |prevValue|；无法计算时为 null */
  changeRate: number | null;
  /** 口径说明，前端 tooltip 直接展示 */
  formula: string;
}

export interface OverviewResult {
  range: DateRange;
  compare: CompareMode;
  compareRange: DateRange | null;
  /** 区间内订单总条数，0 表示整个总览无数据 */
  sampleSize: number;
  metrics: MetricValue[];
  generatedAt: string;
}

export type TrendMetric =
  | 'gmv' | 'orders' | 'aov' | 'gross_profit' | 'conversion' | 'refund_rate';
export type Granularity = 'day' | 'week' | 'month';

export interface TrendPoint {
  /** 桶起始日期（day: YYYY-MM-DD / week: 周一日期 / month: YYYY-MM） */
  bucket: string;
  label: string;
  value: number;
}

export interface TrendResult {
  metric: TrendMetric;
  granularity: Granularity;
  unit: MetricUnit;
  range: DateRange;
  formula: string;
  points: TrendPoint[];
  /** 区间内是否有任何订单 */
  hasData: boolean;
}

export interface FunnelStageDetail {
  id: string;
  label: string;
  count: number;
  /** 相对上一段的转化率（首段为 1） */
  conversionRate: number;
  /** 相对上一段的流失数（首段为 0） */
  lossCount: number;
  formula: string;
}

export interface FunnelResult {
  range: DateRange;
  stages: FunnelStageDetail[];
  hasData: boolean;
}

export type BreakdownDimension =
  | 'platform' | 'category' | 'product' | 'employee'
  | 'department' | 'business_line' | 'live_session';
export type BreakdownMetric = 'gmv' | 'orders' | 'gross_profit';

export interface BreakdownItem {
  key: string;
  label: string;
  value: number;
  /** 占合计的比例 0~1 */
  share: number;
  /** true 表示这是「其他」合并项 */
  isOther?: boolean;
}

export interface BreakdownResult {
  dimension: BreakdownDimension;
  metric: BreakdownMetric;
  unit: MetricUnit;
  range: DateRange;
  total: number;
  items: BreakdownItem[];
  formula: string;
  available: boolean;
  reason?: string;
}

export interface ProductStatRow {
  productId: string;
  sku: string;
  name: string;
  category: string;
  quantity: number;
  gmv: number;
  cost: number;
  grossProfit: number;
  marginRate: number;
  /** ABC 分类 */
  abc: 'A' | 'B' | 'C';
  /** 累计 GMV 占比 0~1 */
  cumulativeShare: number;
}

export interface SlowMovingRow {
  productId: string;
  sku: string;
  name: string;
  stock: number;
  category: string;
  /** 距上次更新的天数（无销售记录时用于排序参考） */
  lastUpdatedAt: string;
}

export interface ProductAnalysisResult {
  range: DateRange;
  available: boolean;
  reason?: string;
  /** ABC 三档汇总 */
  abcSummary: Array<{ tier: 'A' | 'B' | 'C'; skuCount: number; gmv: number; gmvShare: number; desc: string }>;
  rows: ProductStatRow[];
  /** 动销率 = 有销量 SKU 数 / 在售 SKU 总数 */
  sellThroughRate: number | null;
  soldSkuCount: number;
  totalSkuCount: number;
  slowMoving: SlowMovingRow[];
  marginTop: ProductStatRow[];
  marginBottom: ProductStatRow[];
  formulas: Record<string, string>;
}

export interface EmployeeEfficiencyRow {
  employeeId: string;
  employeeName: string;
  departmentId: string | null;
  departmentName: string;
  gmv: number;
  grossProfit: number;
  orderCount: number;
  ticketCount: number;
}

export interface DepartmentEfficiencyRow {
  departmentId: string;
  departmentName: string;
  headcount: number;
  gmv: number;
  grossProfit: number;
  gmvPerCapita: number;
  profitPerCapita: number;
}

export interface EmployeeEfficiencyResult {
  period: string;
  available: boolean;
  reason?: string;
  headcount: number;
  /** DA-15: 绑定订单（owner_employee_id 非空）的在职员工数，用于组织效能归因覆盖率分母 */
  orderOwnerCount: number;
  attributedEmployeeCount: number;
  totalGmv: number;
  totalGrossProfit: number;
  gmvPerCapita: number | null;
  profitPerCapita: number | null;
  employees: EmployeeEfficiencyRow[];
  departments: DepartmentEfficiencyRow[];
  formulas: Record<string, string>;
}

export interface CustomerTier {
  tier: string;
  desc: string;
  customerCount: number;
  totalSpend: number;
  /** 该层最低累计消费额门槛 */
  minSpend: number;
  maxSpend: number;
}

export interface CustomerAnalysisResult {
  range: DateRange;
  available: boolean;
  reason?: string;
  /** 区间内产生支付订单的可识别客户数 */
  identifiedCustomers: number;
  /** 无任何识别字段的订单数（被排除） */
  anonymousOrders: number;
  newCustomers: number;
  returningCustomers: number;
  repurchaseRate: number | null;
  /** 复购周期中位数（天），样本不足时 null */
  repurchaseCycleMedianDays: number | null;
  repurchaseSampleSize: number;
  tiers: CustomerTier[];
  formulas: Record<string, string>;
}

export interface HealthDimension {
  key: string;
  label: string;
  /** 数据不足时为 null，不得用假分数拉平均 */
  score: number | null;
  /** 该维度依据的原始指标 */
  rawValue: number | null;
  rawLabel: string;
  /** 评分规则与阈值 */
  rule: string;
  /** 诊断结论 */
  diagnosis: string;
  /** 改进建议 */
  suggestion: string;
}

export interface HealthScoreResult {
  /** 综合分 = 有效维度算术平均；全部无效时为 null */
  overallScore: number | null;
  grade: string;
  evaluatedDimensions: number;
  totalDimensions: number;
  dimensions: HealthDimension[];
  generatedAt: string;
  note: string;
}

export interface SnapshotComputeResult {
  periodType: SnapshotPeriodType;
  periodStart: string;
  periodEnd: string;
  written: number;
  metrics: Array<{ metricKey: string; value: number }>;
}

export type SnapshotPeriodType = 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface ReportResult {
  range: DateRange;
  generatedAt: string;
  overview: OverviewResult;
  funnel: FunnelResult;
  products: ProductAnalysisResult;
  customers: CustomerAnalysisResult;
  employees: EmployeeEfficiencyResult;
  health: HealthScoreResult;
  topPlatforms: BreakdownResult;
  topProducts: BreakdownResult;
  /** 基于真实数字自动生成的结论文本 */
  conclusions: string[];
}

// ══════════════════ 内部行类型 ══════════════════

interface OrderRow {
  id: string;
  created_at: string;
  items: string;
  paid_amount: number;
  total_amount: number;
  payment_status: string;
  order_status: string;
  platform: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  live_session_id: string | null;
  owner_employee_id: string | null;
}

interface OrderItem {
  productId?: string;
  quantity?: number;
  unitPrice?: number;
}

/** 区间核心聚合结果 */
interface RangeAggregate {
  totalOrders: number;
  paidOrders: number;
  refundedOrders: number;
  revenue: number;
  cost: number;
  grossProfit: number;
  activeSkuCount: number;
}

// ══════════════════ 服务实现 ══════════════════

export class AnalyticsService {
  // ─────────── 基础数据装载 ───────────

  /** 载入区间内订单（闭区间，按 created_at 日期部分匹配，排除沙箱） */
  private loadOrders(tenantId: string, range: DateRange): OrderRow[] {
    const db = getDatabase();
    return db.prepare(
      `SELECT id, created_at, items, paid_amount, total_amount,
              payment_status, order_status, platform,
              customer_name, customer_phone, customer_email,
              live_session_id, owner_employee_id
       FROM orders
       WHERE tenant_id = ? AND is_sandbox = 0
         AND substr(created_at, 1, 10) >= ?
         AND substr(created_at, 1, 10) <= ?
       ORDER BY created_at ASC`
    ).all(tenantId, range.from, range.to) as OrderRow[];
  }

  /** productId → cost_price 映射（一次性载入，避免逐单查询） */
  private buildCostMap(tenantId: string): Map<string, number> {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT id, cost_price FROM products WHERE tenant_id = ?'
    ).all(tenantId) as Array<{ id: string; cost_price: number | null }>;
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.id, Number(r.cost_price || 0));
    return map;
  }

  /** 计算单笔订单的成本（口径同 cockpitService） */
  private orderCost(order: OrderRow, costMap: Map<string, number>): number {
    let cost = 0;
    for (const it of parseItems(order.items)) {
      if (!it.productId || !it.quantity) continue;
      cost += (costMap.get(it.productId) || 0) * Number(it.quantity || 0);
    }
    return cost;
  }

  /** 区间核心聚合 */
  private aggregate(orders: OrderRow[], costMap: Map<string, number>): RangeAggregate {
    let revenue = 0;
    let cost = 0;
    let paidOrders = 0;
    let refundedOrders = 0;
    const skuSet = new Set<string>();

    for (const o of orders) {
      if (isPaid(o)) paidOrders += 1;
      if (isRefunded(o)) refundedOrders += 1;
      if (!countsTowardRevenue(o)) continue;

      revenue += revenueOf(o);
      cost += this.orderCost(o, costMap);
      for (const it of parseItems(o.items)) {
        if (it.productId) skuSet.add(it.productId);
      }
    }

    return {
      totalOrders: orders.length,
      paidOrders,
      refundedOrders,
      revenue: round2(revenue),
      cost: round2(cost),
      grossProfit: round2(revenue - cost),
      activeSkuCount: skuSet.size,
    };
  }

  // ─────────── 1. 总览 ───────────

  getOverview(
    tenantId: string,
    opts: { from: string; to: string; compare?: CompareMode }
  ): OverviewResult {
    const range: DateRange = { from: opts.from, to: opts.to };
    const compare: CompareMode = opts.compare || 'none';
    const compareRange = compare === 'none' ? null : shiftRange(range, compare);

    const costMap = this.buildCostMap(tenantId);
    const cur = this.aggregate(this.loadOrders(tenantId, range), costMap);
    const prev = compareRange
      ? this.aggregate(this.loadOrders(tenantId, compareRange), costMap)
      : null;

    /** 对比区间完全无订单时，prevValue 置 null（不能拿 0 硬算 -100%） */
    const prevHasData = !!prev && prev.totalOrders > 0;

    const build = (
      key: string, label: string, unit: MetricUnit, formula: string,
      pick: (a: RangeAggregate) => number | null
    ): MetricValue => {
      const value = pick(cur);
      const prevValue = prevHasData ? pick(prev as RangeAggregate) : null;
      return {
        key, label, unit,
        value: value === null ? 0 : round4(value),
        prevValue: prevValue === null ? null : round4(prevValue),
        changeRate: computeChangeRate(value, prevValue),
        formula,
      };
    };

    const metrics: MetricValue[] = [
      build('gmv', 'GMV（成交额）', 'currency',
        'Σ(paid_amount>0 ? paid_amount : total_amount)，取 payment_status ∈ {paid, partial, refunded} 的订单',
        (a) => a.revenue),
      build('orders', '订单数', 'count',
        '区间内 orders 表全部订单条数（含未支付）',
        (a) => a.totalOrders),
      build('aov', '客单价 AOV', 'currency',
        'GMV ÷ 已支付订单数（payment_status ∈ {paid, partial}）；无已支付订单时为 0',
        (a) => (a.paidOrders > 0 ? a.revenue / a.paidOrders : 0)),
      build('gross_profit', '毛利', 'currency',
        '毛利 = GMV − 成本；成本 = Σ(订单 items[].quantity × products.cost_price)',
        (a) => a.grossProfit),
      build('gross_margin_rate', '毛利率', 'percent',
        '毛利 ÷ GMV；GMV 为 0 时为 0',
        (a) => (a.revenue > 0 ? a.grossProfit / a.revenue : 0)),
      build('conversion', '支付转化率', 'percent',
        '已支付订单数 ÷ 订单总数（payment_status ∈ {paid, partial} 记为已支付）',
        (a) => (a.totalOrders > 0 ? a.paidOrders / a.totalOrders : 0)),
      build('refund_rate', '退款率', 'percent',
        '退款订单数 ÷ 订单总数；退款判定 = payment_status=refunded 或 order_status ∈ {refunded, returned}',
        (a) => (a.totalOrders > 0 ? a.refundedOrders / a.totalOrders : 0)),
      build('active_sku', '动销 SKU 数', 'count',
        '区间内计入营收的订单 items[] 中出现过的去重 productId 数量',
        (a) => a.activeSkuCount),
    ];

    return {
      range,
      compare,
      compareRange,
      sampleSize: cur.totalOrders,
      metrics,
      generatedAt: new Date().toISOString(),
    };
  }

  // ─────────── 2. 趋势 ───────────

  getTrend(
    tenantId: string,
    opts: { metric: TrendMetric; granularity: Granularity; from: string; to: string }
  ): TrendResult {
    const range: DateRange = { from: opts.from, to: opts.to };
    const costMap = this.buildCostMap(tenantId);
    const orders = this.loadOrders(tenantId, range);

    // 按粒度分桶
    const buckets = enumerateBuckets(range, opts.granularity);
    const grouped = new Map<string, OrderRow[]>();
    for (const b of buckets) grouped.set(b, []);
    for (const o of orders) {
      const b = bucketOf(o.created_at.slice(0, 10), opts.granularity);
      const arr = grouped.get(b);
      // 落在区间外的边界数据直接丢弃，不做任何填充
      if (arr) arr.push(o);
    }

    const meta = TREND_META[opts.metric];
    const points: TrendPoint[] = buckets.map((b) => {
      const agg = this.aggregate(grouped.get(b) || [], costMap);
      return {
        bucket: b,
        label: bucketLabel(b, opts.granularity),
        value: round4(meta.pick(agg)),
      };
    });

    return {
      metric: opts.metric,
      granularity: opts.granularity,
      unit: meta.unit,
      range,
      formula: meta.formula,
      points,
      hasData: orders.length > 0,
    };
  }

  // ─────────── 3. 全链路漏斗 ───────────

  getFunnel(tenantId: string, opts: { from: string; to: string }): FunnelResult {
    const db = getDatabase();
    const range: DateRange = { from: opts.from, to: opts.to };
    // DA-11/DA-12: 统一使用 funnelConstants 的 FUNNEL_STATUS，避免双副本漂移
    const [dateClause, [dFrom, dTo]] = buildFunnelDateClause(range.from, range.to);

    const scalar = (sql: string): number => {
      const row = db.prepare(sql).get(tenantId, dFrom, dTo) as { cnt: number } | undefined;
      return Number(row?.cnt || 0);
    };

    const statusIn = (statuses: readonly string[]) => `'${statuses.join("','")}'`;

    const projectCount = scalar(
      `SELECT COUNT(*) AS cnt FROM projects
       WHERE tenant_id = ? AND ${dateClause}
         AND status IN (${statusIn(FUNNEL_STATUS.project)})`
    );
    const productCount = scalar(
      `SELECT COUNT(*) AS cnt FROM products
       WHERE tenant_id = ? AND ${dateClause}
         AND status IN (${statusIn(FUNNEL_STATUS.product)})`
    );
    const bundleCount = scalar(
      `SELECT COUNT(*) AS cnt FROM product_bundles
       WHERE tenant_id = ? AND ${dateClause}
         AND status IN (${statusIn(FUNNEL_STATUS.bundle)})`
    );

    const orders = this.loadOrders(tenantId, range);
    const orderCount = orders.length;
    const paidCount = orders.filter(isPaid).length;

    // 复购：区间内同一客户第 2 笔及以后的已支付订单数
    const perCustomer = new Map<string, number>();
    for (const o of orders) {
      if (!isPaid(o)) continue;
      const key = customerKeyOf(o);
      if (!key) continue;
      perCustomer.set(key, (perCustomer.get(key) || 0) + 1);
    }
    let repurchaseCount = 0;
    for (const n of perCustomer.values()) if (n > 1) repurchaseCount += n - 1;

    const raw = [
      {
        id: 'project', label: '立项', count: projectCount,
        formula: '区间内创建且状态非 cancelled 的 projects 条数',
      },
      {
        id: 'select', label: '选品', count: productCount,
        formula: '区间内创建且状态非 discontinued 的 products 条数',
      },
      {
        id: 'bundle', label: '组盘', count: bundleCount,
        formula: '区间内创建且状态非 cancelled 的 product_bundles 条数',
      },
      {
        id: 'order', label: '下单', count: orderCount,
        formula: '区间内创建的 orders 全部条数',
      },
      {
        id: 'paid', label: '支付', count: paidCount,
        formula: 'payment_status ∈ {paid, partial} 的订单条数',
      },
      {
        id: 'repurchase', label: '复购', count: repurchaseCount,
        formula: '区间内同一客户（手机/邮箱/姓名任一可识别）第 2 笔及以后的已支付订单数',
      },
    ];

    const stages: FunnelStageDetail[] = raw.map((s, i) => {
      if (i === 0) {
        return { ...s, conversionRate: 1, lossCount: 0 };
      }
      const prev = raw[i - 1].count;
      return {
        ...s,
        conversionRate: prev > 0 ? round4(s.count / prev) : 0,
        lossCount: Math.max(0, prev - s.count),
      };
    });

    return {
      range,
      stages,
      hasData: raw.some((s) => s.count > 0),
    };
  }

  // ─────────── 4. 多维拆解 ───────────

  getDimensionBreakdown(
    tenantId: string,
    opts: {
      dimension: BreakdownDimension; metric: BreakdownMetric;
      from: string; to: string; limit: number;
    }
  ): BreakdownResult {
    const range: DateRange = { from: opts.from, to: opts.to };
    const costMap = this.buildCostMap(tenantId);
    const orders = this.loadOrders(tenantId, range);
    const unit: MetricUnit = opts.metric === 'orders' ? 'count' : 'currency';

    const base: Omit<BreakdownResult, 'items' | 'total' | 'available' | 'reason'> = {
      dimension: opts.dimension,
      metric: opts.metric,
      unit,
      range,
      formula: BREAKDOWN_FORMULA[opts.dimension] + ' · ' + BREAKDOWN_METRIC_FORMULA[opts.metric],
    };

    if (orders.length === 0) {
      return {
        ...base, total: 0, items: [], available: false,
        reason: '所选区间内没有任何订单记录，无法拆解',
      };
    }

    // 累加器：key → { label, value }
    const acc = new Map<string, { label: string; value: number }>();
    const bump = (key: string, label: string, v: number) => {
      if (!Number.isFinite(v)) return;
      const cur = acc.get(key);
      if (cur) cur.value += v;
      else acc.set(key, { label, value: v });
    };

    if (opts.dimension === 'category' || opts.dimension === 'product') {
      // 商品级维度：从 items 明细拆
      const meta = this.loadProductMeta(tenantId);
      for (const o of orders) {
        if (!countsTowardRevenue(o)) continue;
        for (const it of parseItems(o.items)) {
          if (!it.productId) continue;
          const p = meta.get(it.productId);
          const qty = Number(it.quantity || 0);
          const lineGmv = qty * Number(it.unitPrice || 0);
          const lineCost = qty * (costMap.get(it.productId) || 0);
          const key = opts.dimension === 'product'
            ? it.productId
            : (p?.category || '__uncategorized__');
          const label = opts.dimension === 'product'
            ? (p ? `${p.sku} · ${p.name}` : `已删除商品(${it.productId.slice(0, 8)})`)
            : (p?.category || '未分类');
          const v = opts.metric === 'gmv' ? lineGmv
            : opts.metric === 'gross_profit' ? lineGmv - lineCost
            : 1; // orders：按明细行计数
          bump(key, label, v);
        }
      }
    } else {
      // 订单级维度
      const resolver = this.buildOrderDimensionResolver(tenantId, opts.dimension);
      for (const o of orders) {
        const counted = countsTowardRevenue(o);
        const { key, label } = resolver(o);
        const v = opts.metric === 'orders'
          ? 1
          : counted
            ? (opts.metric === 'gmv' ? revenueOf(o) : revenueOf(o) - this.orderCost(o, costMap))
            : 0;
        bump(key, label, v);
      }
    }

    const all = Array.from(acc.entries())
      .map(([key, v]) => ({ key, label: v.label, value: round2(v.value) }))
      .filter((x) => x.value !== 0)
      .sort((a, b) => b.value - a.value);

    if (all.length === 0) {
      return {
        ...base, total: 0, items: [], available: false,
        reason: '所选区间内该维度没有可归集的数值（可能是订单未关联该维度字段）',
      };
    }

    const total = all.reduce((s, x) => s + x.value, 0);
    const head = all.slice(0, opts.limit);
    const tail = all.slice(opts.limit);

    const items: BreakdownItem[] = head.map((x) => ({
      key: x.key,
      label: x.label,
      value: x.value,
      share: total !== 0 ? round4(x.value / total) : 0,
    }));

    if (tail.length > 0) {
      const otherValue = round2(tail.reduce((s, x) => s + x.value, 0));
      items.push({
        key: '__other__',
        label: `其他（${tail.length} 项）`,
        value: otherValue,
        share: total !== 0 ? round4(otherValue / total) : 0,
        isOther: true,
      });
    }

    return { ...base, total: round2(total), items, available: true };
  }

  /** products 元数据缓存（sku/name/category） */
  private loadProductMeta(tenantId: string):
    Map<string, { sku: string; name: string; category: string }> {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT id, sku, name, category FROM products WHERE tenant_id = ?'
    ).all(tenantId) as Array<{ id: string; sku: string; name: string; category: string | null }>;
    const map = new Map<string, { sku: string; name: string; category: string }>();
    for (const r of rows) {
      map.set(r.id, { sku: r.sku, name: r.name, category: r.category || '未分类' });
    }
    return map;
  }

  /** 构造订单级维度的 key/label 解析器 */
  private buildOrderDimensionResolver(
    tenantId: string, dimension: BreakdownDimension
  ): (o: OrderRow) => { key: string; label: string } {
    const db = getDatabase();

    if (dimension === 'platform') {
      return (o) => {
        const p = (o.platform || '').trim();
        return { key: p || '__unknown__', label: p || '未标记平台' };
      };
    }

    if (dimension === 'business_line') {
      return (o) => {
        const line = mapPlatformToBizLine(o.platform || '');
        return { key: line, label: BIZ_LINE_LABEL[line] };
      };
    }

    if (dimension === 'employee' || dimension === 'department') {
      const emps = db.prepare(
        `SELECT e.id, e.name, e.department_id, d.name AS dept_name
         FROM employees e
         LEFT JOIN departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
         WHERE e.tenant_id = ?`
      ).all(tenantId) as Array<{
        id: string; name: string; department_id: string | null; dept_name: string | null;
      }>;
      const map = new Map(emps.map((e) => [e.id, e]));

      if (dimension === 'employee') {
        return (o) => {
          const id = o.owner_employee_id;
          if (!id) return { key: '__unassigned__', label: '未归属员工' };
          const e = map.get(id);
          return { key: id, label: e?.name || `离职/已删除员工(${id.slice(0, 8)})` };
        };
      }
      return (o) => {
        const id = o.owner_employee_id;
        const e = id ? map.get(id) : undefined;
        if (!e || !e.department_id) return { key: '__nodept__', label: '未归属部门' };
        return { key: e.department_id, label: e.dept_name || '未命名部门' };
      };
    }

    // live_session：直播表由其他模块并行开发，容忍缺失
    let sessionMap = new Map<string, string>();
    try {
      const rows = db.prepare(
        'SELECT id, title FROM live_sessions WHERE tenant_id = ?'
      ).all(tenantId) as Array<{ id: string; title: string }>;
      sessionMap = new Map(rows.map((r) => [r.id, r.title]));
    } catch (e) {
      logger.warn('analytics', `live_sessions 查询失败，直播维度降级: ${String(e)}`);
    }
    return (o) => {
      const id = o.live_session_id;
      if (!id) return { key: '__nonlive__', label: '非直播订单' };
      return { key: id, label: sessionMap.get(id) || `已删除场次(${id.slice(0, 8)})` };
    };
  }

  // ─────────── 5. 商品分析 ───────────

  getProductAnalysis(tenantId: string, opts: { from: string; to: string }): ProductAnalysisResult {
    const db = getDatabase();
    const range: DateRange = { from: opts.from, to: opts.to };
    const costMap = this.buildCostMap(tenantId);
    const meta = this.loadProductMeta(tenantId);
    const orders = this.loadOrders(tenantId, range);

    const formulas = {
      abc: 'ABC 分类：按商品 GMV 降序累计，累计占比 ≤70% 为 A 类，70%~90% 为 B 类，>90% 为 C 类',
      sellThrough: '动销率 = 区间内有销量的 SKU 数 ÷ 在售 SKU 总数（status ≠ discontinued）',
      slowMoving: '滞销 = 在售且库存 > 0，但区间内订单 items[] 中零出现的 SKU',
      productGmv: '商品 GMV = Σ(items[].quantity × items[].unitPrice)，仅计入 payment_status ∈ {paid, partial, refunded} 的订单',
      productMargin: '商品毛利率 = (商品 GMV − Σ quantity × products.cost_price) ÷ 商品 GMV',
    };

    // 在售 SKU 总数
    const totalSkuRow = db.prepare(
      `SELECT COUNT(*) AS cnt FROM products
       WHERE tenant_id = ? AND status != 'discontinued'`
    ).get(tenantId) as { cnt: number };
    const totalSkuCount = Number(totalSkuRow?.cnt || 0);

    // 逐商品聚合
    const stat = new Map<string, { quantity: number; gmv: number; cost: number }>();
    for (const o of orders) {
      if (!countsTowardRevenue(o)) continue;
      for (const it of parseItems(o.items)) {
        if (!it.productId) continue;
        const qty = Number(it.quantity || 0);
        const cur = stat.get(it.productId) || { quantity: 0, gmv: 0, cost: 0 };
        cur.quantity += qty;
        cur.gmv += qty * Number(it.unitPrice || 0);
        cur.cost += qty * (costMap.get(it.productId) || 0);
        stat.set(it.productId, cur);
      }
    }

    const soldSkuCount = stat.size;

    if (totalSkuCount === 0 && soldSkuCount === 0) {
      return {
        range, available: false,
        reason: '商品库为空，请先在「选品」模块录入商品后再查看商品分析',
        abcSummary: [], rows: [], sellThroughRate: null,
        soldSkuCount: 0, totalSkuCount: 0,
        slowMoving: [], marginTop: [], marginBottom: [], formulas,
      };
    }

    // 排序 + ABC
    const sorted = Array.from(stat.entries())
      .map(([productId, s]) => {
        const m = meta.get(productId);
        const grossProfit = s.gmv - s.cost;
        return {
          productId,
          sku: m?.sku || productId.slice(0, 8),
          name: m?.name || '已删除商品',
          category: m?.category || '未分类',
          quantity: s.quantity,
          gmv: round2(s.gmv),
          cost: round2(s.cost),
          grossProfit: round2(grossProfit),
          marginRate: s.gmv > 0 ? round4(grossProfit / s.gmv) : 0,
        };
      })
      .sort((a, b) => b.gmv - a.gmv);

    const gmvTotal = sorted.reduce((s, x) => s + x.gmv, 0);
    let cum = 0;
    const rows: ProductStatRow[] = sorted.map((r) => {
      cum += r.gmv;
      const cumulativeShare = gmvTotal > 0 ? cum / gmvTotal : 0;
      const abc: 'A' | 'B' | 'C' =
        cumulativeShare <= 0.7 ? 'A' : cumulativeShare <= 0.9 ? 'B' : 'C';
      return { ...r, abc, cumulativeShare: round4(cumulativeShare) };
    });

    const abcSummary = (['A', 'B', 'C'] as const).map((tier) => {
      const group = rows.filter((r) => r.abc === tier);
      const gmv = round2(group.reduce((s, x) => s + x.gmv, 0));
      return {
        tier,
        skuCount: group.length,
        gmv,
        gmvShare: gmvTotal > 0 ? round4(gmv / gmvTotal) : 0,
        desc: tier === 'A' ? '核心贡献品（累计 GMV 前 70%），优先保供保库存'
          : tier === 'B' ? '腰部潜力品（累计 GMV 70%~90%），可测试提量'
          : '长尾品（累计 GMV 后 10%），评估是否收缩 SKU',
      };
    });

    // 滞销清单
    const slowRows = db.prepare(
      `SELECT id, sku, name, stock, category, updated_at FROM products
       WHERE tenant_id = ? AND stock > 0 AND status != 'discontinued'
       ORDER BY stock DESC`
    ).all(tenantId) as Array<{
      id: string; sku: string; name: string; stock: number;
      category: string | null; updated_at: string;
    }>;
    const slowMoving: SlowMovingRow[] = slowRows
      .filter((p) => !stat.has(p.id))
      .slice(0, 20)
      .map((p) => ({
        productId: p.id,
        sku: p.sku,
        name: p.name,
        stock: Number(p.stock || 0),
        category: p.category || '未分类',
        lastUpdatedAt: p.updated_at,
      }));

    // 毛利率 Top/Bottom（仅统计有成交的商品，避免 0 GMV 干扰）
    const withSales = rows.filter((r) => r.gmv > 0);
    const byMargin = [...withSales].sort((a, b) => b.marginRate - a.marginRate);

    return {
      range,
      available: true,
      abcSummary,
      rows,
      sellThroughRate: totalSkuCount > 0 ? round4(soldSkuCount / totalSkuCount) : null,
      soldSkuCount,
      totalSkuCount,
      slowMoving,
      marginTop: byMargin.slice(0, 10),
      marginBottom: byMargin.slice(-10).reverse(),
      formulas,
    };
  }

  // ─────────── 6. 人效分析 ───────────

  getEmployeeEfficiency(tenantId: string, opts: { period: string }): EmployeeEfficiencyResult {
    const db = getDatabase();
    const period = opts.period;
    const formulas = {
      source: '数据源：performance_attributions（业务-HR 归因表），由「库存预警/归因计算」任务写入',
      perCapita: '人均 GMV = 归因 GMV 合计 ÷ 在职员工数（employees.status ∈ {active, probation}）；人均毛利同理。',
      dept: '部门人效 = 该部门归因 GMV ÷ 该部门在职人数',
    };

    const headcountRow = db.prepare(
      `SELECT COUNT(*) AS cnt FROM employees
       WHERE tenant_id = ? AND status IN ('active','probation')`
    ).get(tenantId) as { cnt: number };
    const headcount = Number(headcountRow?.cnt || 0);

    // DA-15: 组织效能归因覆盖率分母改为"绑定订单的在职员工"，排除纯管理/非业务岗
    const orderOwnerRow = db.prepare(
      `SELECT COUNT(DISTINCT e.id) AS cnt FROM employees e
       INNER JOIN orders o ON o.owner_employee_id = e.id
       WHERE e.tenant_id = ? AND e.status IN ('active','probation')`
    ).get(tenantId) as { cnt: number };
    const orderOwnerCount = Number(orderOwnerRow?.cnt || 0);

    const rows = db.prepare(
      `SELECT a.employee_id,
              COALESCE(SUM(a.gmv), 0)           AS gmv,
              COALESCE(SUM(a.gross_profit), 0)  AS gross_profit,
              COALESCE(SUM(a.order_count), 0)   AS order_count,
              COALESCE(SUM(a.ticket_count), 0)  AS ticket_count,
              e.name        AS emp_name,
              e.department_id,
              d.name        AS dept_name
       FROM performance_attributions a
       LEFT JOIN employees   e ON e.id = a.employee_id   AND e.tenant_id = a.tenant_id
       LEFT JOIN departments d ON d.id = e.department_id AND d.tenant_id = a.tenant_id
       WHERE a.tenant_id = ? AND a.period LIKE ?
       GROUP BY a.employee_id
       ORDER BY gmv DESC`
    ).all(tenantId, `${period}%`) as Array<{
      employee_id: string; gmv: number; gross_profit: number;
      order_count: number; ticket_count: number;
      emp_name: string | null; department_id: string | null; dept_name: string | null;
    }>;

    if (rows.length === 0) {
      return {
        period,
        available: false,
        reason: '归因数据未生成。请先在「库存预警 / 业务归因」模块执行归因计算，把订单 GMV 归属到员工后再查看人效分析。',
        headcount,
        orderOwnerCount,
        attributedEmployeeCount: 0,
        totalGmv: 0,
        totalGrossProfit: 0,
        gmvPerCapita: null,
        profitPerCapita: null,
        employees: [],
        departments: [],
        formulas,
      };
    }

    const employees: EmployeeEfficiencyRow[] = rows.map((r) => ({
      employeeId: r.employee_id,
      employeeName: r.emp_name || `已删除员工(${r.employee_id.slice(0, 8)})`,
      departmentId: r.department_id,
      departmentName: r.dept_name || '未归属部门',
      gmv: round2(Number(r.gmv || 0)),
      grossProfit: round2(Number(r.gross_profit || 0)),
      orderCount: Number(r.order_count || 0),
      ticketCount: Number(r.ticket_count || 0),
    }));

    const totalGmv = round2(employees.reduce((s, x) => s + x.gmv, 0));
    const totalGrossProfit = round2(employees.reduce((s, x) => s + x.grossProfit, 0));

    // 部门在职人数
    const deptHeadRows = db.prepare(
      `SELECT COALESCE(department_id, '__nodept__') AS did, COUNT(*) AS cnt
       FROM employees
       WHERE tenant_id = ? AND status IN ('active','probation')
       GROUP BY COALESCE(department_id, '__nodept__')`
    ).all(tenantId) as Array<{ did: string; cnt: number }>;
    const deptHead = new Map(deptHeadRows.map((r) => [r.did, Number(r.cnt || 0)]));

    const deptAgg = new Map<string, DepartmentEfficiencyRow>();
    for (const e of employees) {
      const did = e.departmentId || '__nodept__';
      const cur = deptAgg.get(did) || {
        departmentId: did,
        departmentName: e.departmentName,
        headcount: deptHead.get(did) || 0,
        gmv: 0, grossProfit: 0, gmvPerCapita: 0, profitPerCapita: 0,
      };
      cur.gmv += e.gmv;
      cur.grossProfit += e.grossProfit;
      deptAgg.set(did, cur);
    }
    const departments = Array.from(deptAgg.values())
      .map((d) => ({
        ...d,
        gmv: round2(d.gmv),
        grossProfit: round2(d.grossProfit),
        gmvPerCapita: d.headcount > 0 ? round2(d.gmv / d.headcount) : 0,
        profitPerCapita: d.headcount > 0 ? round2(d.grossProfit / d.headcount) : 0,
      }))
      .sort((a, b) => b.gmvPerCapita - a.gmvPerCapita);

    return {
      period,
      available: true,
      headcount,
      orderOwnerCount,
      attributedEmployeeCount: employees.length,
      totalGmv,
      totalGrossProfit,
      gmvPerCapita: headcount > 0 ? round2(totalGmv / headcount) : null,
      profitPerCapita: headcount > 0 ? round2(totalGrossProfit / headcount) : null,
      employees,
      departments,
      formulas,
    };
  }

  // ─────────── 7. 客户分析 ───────────

  getCustomerAnalysis(tenantId: string, opts: { from: string; to: string }): CustomerAnalysisResult {
    const db = getDatabase();
    const range: DateRange = { from: opts.from, to: opts.to };
    const formulas = {
      identity: '客户标识优先级：customer_phone > customer_email > customer_name；三者皆空的订单计为匿名并排除出客户分析',
      newVsOld: '新客 = 其历史首笔已支付订单落在所选区间内；老客 = 首单早于区间起点',
      repurchase: '复购率 = 区间内下过 ≥2 笔已支付订单的客户数 ÷ 区间内有已支付订单的客户数',
      cycle: '复购周期 = 同一客户相邻两笔已支付订单的间隔天数，取全部样本的中位数',
      tier: '价值分层：按客户历史累计支付金额排序，以 25%/50%/75% 分位数为界切 4 层，门槛值随真实分布浮动',
    };

    const orders = this.loadOrders(tenantId, range);
    const paidInRange = orders.filter(isPaid);

    const anonymousOrders = paidInRange.filter((o) => !customerKeyOf(o)).length;
    const identified = paidInRange.filter((o) => !!customerKeyOf(o));

    if (identified.length === 0) {
      return {
        range, available: false,
        reason: anonymousOrders > 0
          ? `区间内 ${anonymousOrders} 笔已支付订单均缺少客户手机号/邮箱/姓名，无法做客户识别。请在订单录入或平台同步时补全客户字段。`
          : '所选区间内没有已支付订单，无法进行客户分析',
        identifiedCustomers: 0, anonymousOrders,
        newCustomers: 0, returningCustomers: 0,
        repurchaseRate: null, repurchaseCycleMedianDays: null, repurchaseSampleSize: 0,
        tiers: [], formulas,
      };
    }

    // 全历史已支付订单（用于判定新老客 / 累计消费 / 复购周期，排除沙箱）
    const allPaid = db.prepare(
      `SELECT created_at, paid_amount, total_amount, payment_status,
              customer_name, customer_phone, customer_email
       FROM orders
       WHERE tenant_id = ? AND is_sandbox = 0 AND payment_status IN ('paid','partial')
       ORDER BY created_at ASC`
    ).all(tenantId) as Array<{
      created_at: string; paid_amount: number; total_amount: number; payment_status: string;
      customer_name: string | null; customer_phone: string | null; customer_email: string | null;
    }>;

    interface Hist { firstAt: string; dates: string[]; totalSpend: number }
    const hist = new Map<string, Hist>();
    for (const r of allPaid) {
      const key = customerKeyOf(r as unknown as OrderRow);
      if (!key) continue;
      const amount = Number(r.paid_amount || 0) > 0 ? Number(r.paid_amount) : Number(r.total_amount || 0);
      const h = hist.get(key) || { firstAt: r.created_at, dates: [], totalSpend: 0 };
      h.dates.push(r.created_at);
      h.totalSpend += amount;
      hist.set(key, h);
    }

    // 区间内客户集合 + 下单次数
    const inRange = new Map<string, number>();
    for (const o of identified) {
      const key = customerKeyOf(o) as string;
      inRange.set(key, (inRange.get(key) || 0) + 1);
    }

    let newCustomers = 0;
    let returningCustomers = 0;
    for (const key of inRange.keys()) {
      const h = hist.get(key);
      const firstDate = (h?.firstAt || '').slice(0, 10);
      if (firstDate && firstDate >= range.from) newCustomers += 1;
      else returningCustomers += 1;
    }

    const repeatCustomers = Array.from(inRange.values()).filter((n) => n > 1).length;
    const repurchaseRate = inRange.size > 0 ? round4(repeatCustomers / inRange.size) : null;

    // 复购周期中位数（全历史样本，样本量不足时诚实置 null）
    const gaps: number[] = [];
    for (const h of hist.values()) {
      if (h.dates.length < 2) continue;
      const sorted = [...h.dates].sort();
      for (let i = 1; i < sorted.length; i++) {
        const d = diffDays(sorted[i - 1].slice(0, 10), sorted[i].slice(0, 10));
        if (d >= 0) gaps.push(d);
      }
    }
    const repurchaseCycleMedianDays = gaps.length > 0 ? round2(median(gaps)) : null;

    // 价值分层（四分位）
    const spends = Array.from(hist.values()).map((h) => h.totalSpend).sort((a, b) => a - b);
    const q1 = quantile(spends, 0.25);
    const q2 = quantile(spends, 0.5);
    const q3 = quantile(spends, 0.75);
    const tierDefs: Array<{ tier: string; desc: string; min: number; max: number }> = [
      { tier: '高价值客户', desc: `累计消费 ≥ ${fmt(q3)}（Top 25%）`, min: q3, max: Number.POSITIVE_INFINITY },
      { tier: '中高价值客户', desc: `累计消费 ${fmt(q2)} ~ ${fmt(q3)}`, min: q2, max: q3 },
      { tier: '中价值客户', desc: `累计消费 ${fmt(q1)} ~ ${fmt(q2)}`, min: q1, max: q2 },
      { tier: '低价值客户', desc: `累计消费 < ${fmt(q1)}（Bottom 25%）`, min: 0, max: q1 },
    ];
    const tiers: CustomerTier[] = tierDefs.map((t, idx) => {
      const members = Array.from(hist.values()).filter((h) => {
        // 最高层含上界，其余左闭右开，避免重复计数
        if (idx === 0) return h.totalSpend >= t.min;
        return h.totalSpend >= t.min && h.totalSpend < t.max;
      });
      return {
        tier: t.tier,
        desc: t.desc,
        customerCount: members.length,
        totalSpend: round2(members.reduce((s, x) => s + x.totalSpend, 0)),
        minSpend: round2(t.min),
        maxSpend: Number.isFinite(t.max) ? round2(t.max) : round2(spends[spends.length - 1] || 0),
      };
    });

    return {
      range,
      available: true,
      identifiedCustomers: inRange.size,
      anonymousOrders,
      newCustomers,
      returningCustomers,
      repurchaseRate,
      repurchaseCycleMedianDays,
      repurchaseSampleSize: gaps.length,
      tiers,
      formulas,
    };
  }

  // ─────────── 8. 经营健康度 ───────────

  getHealthScore(tenantId: string): HealthScoreResult {
    const db = getDatabase();
    const today = todayStr();
    const cur: DateRange = { from: addDays(today, -29), to: today };
    const prev: DateRange = { from: addDays(today, -59), to: addDays(today, -30) };

    const costMap = this.buildCostMap(tenantId);
    const curAgg = this.aggregate(this.loadOrders(tenantId, cur), costMap);
    const prevAgg = this.aggregate(this.loadOrders(tenantId, prev), costMap);

    const dims: HealthDimension[] = [];

    // ① 增长性
    if (curAgg.totalOrders === 0 || prevAgg.revenue <= 0) {
      dims.push({
        key: 'growth', label: '增长性', score: null,
        rawValue: null, rawLabel: '近 30 天 GMV 环比增长率',
        rule: 'GMV 环比 ≥ +20% 记 100 分；0~+20% 线性映射 60~100；-20%~0 线性映射 20~60；≤ -20% 记 0 分',
        diagnosis: '缺少可对比的历史数据：近 30 天或前 30 天没有产生成交，无法计算增长率。',
        suggestion: '连续运营满 60 天并产生成交后，该维度将自动启用。',
      });
    } else {
      const g = (curAgg.revenue - prevAgg.revenue) / prevAgg.revenue;
      const score = growthScore(g);
      dims.push({
        key: 'growth', label: '增长性', score: round2(score),
        rawValue: round4(g), rawLabel: '近 30 天 GMV 环比增长率',
        rule: 'GMV 环比 ≥ +20% 记 100 分；0~+20% 线性映射 60~100；-20%~0 线性映射 20~60；≤ -20% 记 0 分',
        diagnosis: g >= 0.2 ? `GMV 环比增长 ${pct(g)}，处于高速增长区间。`
          : g >= 0 ? `GMV 环比增长 ${pct(g)}，增长平稳但未达高速档（+20%）。`
          : `GMV 环比下滑 ${pct(Math.abs(g))}，规模在收缩。`,
        suggestion: g >= 0.2 ? '保持当前投放与选品节奏，重点保障 A 类商品供应链稳定。'
          : g >= 0 ? '拆解「多维拆解」中占比下滑的平台/品类，定位增长瓶颈。'
          : '优先排查流量端（平台维度 GMV 下滑项）与转化端（支付转化率），先止血再谈增长。',
      });
    }

    // ② 盈利性
    if (curAgg.revenue <= 0) {
      dims.push({
        key: 'profit', label: '盈利性', score: null,
        rawValue: null, rawLabel: '毛利率',
        rule: '毛利率 ≥ 40% 记 100 分；0~40% 线性映射 0~100；毛利为负记 0 分',
        diagnosis: '近 30 天无成交额，无法计算毛利率。',
        suggestion: '产生成交后该维度自动启用；同时请确认 products.cost_price 已填写，否则成本恒为 0 会虚高毛利。',
      });
    } else {
      const m = curAgg.grossProfit / curAgg.revenue;
      const score = clamp((m / 0.4) * 100, 0, 100);
      const missingCost = countMissingCostSku(db, tenantId);
      dims.push({
        key: 'profit', label: '盈利性', score: round2(score),
        rawValue: round4(m), rawLabel: '毛利率',
        rule: '毛利率 ≥ 40% 记 100 分；0~40% 线性映射 0~100；毛利为负记 0 分',
        diagnosis: `近 30 天毛利率 ${pct(m)}（毛利 ${fmt(curAgg.grossProfit)} / GMV ${fmt(curAgg.revenue)}）。`
          + (missingCost > 0 ? ` 注意：有 ${missingCost} 个 SKU 未填成本价，实际毛利率可能低于此值。` : ''),
        suggestion: missingCost > 0
          ? '先补齐未填成本价的 SKU，再据「毛利率 Bottom 10」优化低毛利商品的定价或供应链。'
          : m >= 0.4 ? '毛利结构健康，可尝试用低毛利爆品引流、高毛利品承接利润。'
          : '参考「毛利率 Bottom 10」清单，对低毛利 SKU 做提价、换供应商或下架处理。',
      });
    }

    // ③ 库存健康
    const pa = this.getProductAnalysis(tenantId, cur);
    if (!pa.available || pa.sellThroughRate === null) {
      dims.push({
        key: 'inventory', label: '库存健康', score: null,
        rawValue: null, rawLabel: '动销率',
        rule: '动销率得分 = 动销率 × 100（权重 60%）；滞销健康分 = (1 − 滞销SKU占比) × 100（权重 40%）',
        diagnosis: pa.reason || '商品库为空，无法评估库存健康度。',
        suggestion: '在「选品」模块录入商品并维护库存后启用。',
      });
    } else {
      const slowShare = pa.totalSkuCount > 0 ? pa.slowMoving.length / pa.totalSkuCount : 0;
      const score = clamp(pa.sellThroughRate * 100, 0, 100) * 0.6
        + clamp((1 - slowShare) * 100, 0, 100) * 0.4;
      dims.push({
        key: 'inventory', label: '库存健康', score: round2(score),
        rawValue: round4(pa.sellThroughRate), rawLabel: '动销率',
        rule: '动销率得分 = 动销率 × 100（权重 60%）；滞销健康分 = (1 − 滞销SKU占比) × 100（权重 40%）',
        diagnosis: `动销率 ${pct(pa.sellThroughRate)}（${pa.soldSkuCount}/${pa.totalSkuCount} SKU 有销量），`
          + `滞销 SKU ${pa.slowMoving.length} 个。`,
        suggestion: pa.sellThroughRate >= 0.6
          ? 'SKU 效率良好，关注 C 类长尾品是否值得继续备货。'
          : '动销率偏低，建议按「滞销清单」清仓或下架，把库存资金压到 A 类商品上。',
      });
    }

    // ④ 客户健康
    const ca = this.getCustomerAnalysis(tenantId, cur);
    if (!ca.available || ca.repurchaseRate === null) {
      dims.push({
        key: 'customer', label: '客户健康', score: null,
        rawValue: null, rawLabel: '复购率',
        rule: '复购率 ≥ 30% 记 100 分；0~30% 线性映射 0~100',
        diagnosis: ca.reason || '缺少可识别客户数据，无法计算复购率。',
        suggestion: '在订单中补全客户手机号/邮箱字段，或接入平台订单同步后自动带入。',
      });
    } else {
      const score = clamp((ca.repurchaseRate / 0.3) * 100, 0, 100);
      dims.push({
        key: 'customer', label: '客户健康', score: round2(score),
        rawValue: round4(ca.repurchaseRate), rawLabel: '复购率',
        rule: '复购率 ≥ 30% 记 100 分；0~30% 线性映射 0~100',
        diagnosis: `近 30 天可识别客户 ${ca.identifiedCustomers} 人，复购率 ${pct(ca.repurchaseRate)}，`
          + `新客 ${ca.newCustomers} / 老客 ${ca.returningCustomers}。`,
        suggestion: ca.repurchaseRate >= 0.3
          ? '复购基本盘稳固，可针对高价值层做专属权益提升客单。'
          : '复购偏低，建议对「中高价值客户」做定向召回，并检查售后满意度。',
      });
    }

    // ⑤ 履约质量
    const ticketRow = db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status IN ('resolved','closed') THEN 1 ELSE 0 END) AS done
       FROM service_tickets
       WHERE tenant_id = ?
         AND substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?`
    ).get(tenantId, cur.from, cur.to) as { total: number; done: number };
    const ticketTotal = Number(ticketRow?.total || 0);
    const ticketDone = Number(ticketRow?.done || 0);

    if (curAgg.totalOrders === 0) {
      dims.push({
        key: 'fulfillment', label: '履约质量', score: null,
        rawValue: null, rawLabel: '退款率',
        rule: '退款率 0% 记 100 分，≥10% 记 0 分，线性递减（权重 50%）；工单解决率 × 100（权重 50%）。无工单时退款率独占 100% 权重',
        diagnosis: '近 30 天无订单，无法评估履约质量。',
        suggestion: '产生订单后自动启用。',
      });
    } else {
      const refundRate = curAgg.refundedOrders / curAgg.totalOrders;
      const refundScore = clamp((1 - refundRate / 0.1) * 100, 0, 100);
      const hasTickets = ticketTotal > 0;
      const resolveRate = hasTickets ? ticketDone / ticketTotal : 0;
      const score = hasTickets ? refundScore * 0.5 + resolveRate * 100 * 0.5 : refundScore;
      dims.push({
        key: 'fulfillment', label: '履约质量', score: round2(score),
        rawValue: round4(refundRate), rawLabel: '退款率',
        rule: '退款率 0% 记 100 分，≥10% 记 0 分，线性递减（权重 50%）；工单解决率 × 100（权重 50%）。无工单时退款率独占 100% 权重',
        diagnosis: `退款率 ${pct(refundRate)}（${curAgg.refundedOrders}/${curAgg.totalOrders} 单）。`
          + (hasTickets
            ? ` 工单 ${ticketTotal} 条，已解决 ${ticketDone} 条，解决率 ${pct(resolveRate)}。`
            : ' 近 30 天无客服工单，本项仅按退款率评分。'),
        suggestion: refundRate > 0.05
          ? '退款率偏高，结合驾驶舱「退款率 Top 5」定位问题商品，核查描述一致性与物流时效。'
          : '履约表现良好，保持当前发货与售后 SLA。',
      });
    }

    // ⑥ 组织效能（DA-15: 归因覆盖率分母用 orderOwnerCount，排除非业务岗）
    const ee = this.getEmployeeEfficiency(tenantId, { period: today.slice(0, 7) });
    const orgDenom = ee.orderOwnerCount || ee.headcount; // fallback: 若 orderOwnerCount=0 则回退全部在职
    if (!ee.available || ee.headcount === 0) {
      dims.push({
        key: 'organization', label: '组织效能', score: null,
        rawValue: null, rawLabel: '业务归因覆盖率',
        rule: '归因覆盖率 = 有 GMV 归因产出的员工数 ÷ 有订单归属的在职员工数，× 100 得分（排除非业务岗）',
        diagnosis: ee.headcount === 0
          ? '员工档案为空，无法评估组织效能。'
          : (ee.reason as string),
        suggestion: ee.headcount === 0
          ? '在「人力资源」模块录入员工档案后启用。'
          : '在「库存预警 / 业务归因」模块执行归因计算，把订单归属到员工后启用。',
      });
    } else {
      const coverage = orgDenom > 0 ? ee.attributedEmployeeCount / orgDenom : 0;
      const score = clamp(coverage * 100, 0, 100);
      dims.push({
        key: 'organization', label: '组织效能', score: round2(score),
        rawValue: round4(coverage), rawLabel: '业务归因覆盖率',
        rule: '归因覆盖率 = 有 GMV 归因产出的员工数 ÷ 有订单归属的在职员工数，× 100 得分（排除非业务岗）',
        diagnosis: `本月 ${ee.attributedEmployeeCount}/${orgDenom} 名有订单归属的在职员工有业务归因产出，`
          + `人均 GMV ${fmt(ee.gmvPerCapita || 0)}。`
          + '（说明：本维度分母为"有订单归属的在职员工"，已排除 HR/财务/行政等非业务岗。）',
        suggestion: coverage >= 0.8
          ? '归因覆盖充分，可基于「员工排行」做激励分配。'
          : '超过 20% 的在职员工无业务归因，请检查订单 owner_employee_id 是否落库，或调整归因规则。',
      });
    }

    const valid = dims.filter((d) => d.score !== null) as Array<HealthDimension & { score: number }>;
    const overallScore = valid.length > 0
      ? round2(valid.reduce((s, d) => s + d.score, 0) / valid.length)
      : null;

    return {
      overallScore,
      grade: gradeOf(overallScore),
      evaluatedDimensions: valid.length,
      totalDimensions: dims.length,
      dimensions: dims,
      generatedAt: new Date().toISOString(),
      note: overallScore === null
        ? '当前 6 个维度均缺少足够真实数据，综合分不予计算。'
        : `综合分 = ${valid.length} 个有效维度的算术平均；${dims.length - valid.length} 个维度因数据不足被排除（不参与拉平均）。统计窗口为近 30 天。`,
    };
  }

  // ─────────── 9. 指标快照固化 ───────────

  computeSnapshots(
    tenantId: string,
    periodType: SnapshotPeriodType,
    date: string
  ): SnapshotComputeResult {
    const db = getDatabase();
    const { start, end } = periodBounds(date, periodType);
    const costMap = this.buildCostMap(tenantId);
    const agg = this.aggregate(this.loadOrders(tenantId, { from: start, to: end }), costMap);

    const metrics: Array<{ metricKey: string; value: number }> = [
      { metricKey: 'gmv', value: agg.revenue },
      { metricKey: 'orders', value: agg.totalOrders },
      { metricKey: 'paid_orders', value: agg.paidOrders },
      { metricKey: 'aov', value: agg.paidOrders > 0 ? round2(agg.revenue / agg.paidOrders) : 0 },
      { metricKey: 'cost', value: agg.cost },
      { metricKey: 'gross_profit', value: agg.grossProfit },
      { metricKey: 'gross_margin_rate', value: agg.revenue > 0 ? round4(agg.grossProfit / agg.revenue) : 0 },
      { metricKey: 'conversion', value: agg.totalOrders > 0 ? round4(agg.paidOrders / agg.totalOrders) : 0 },
      { metricKey: 'refund_rate', value: agg.totalOrders > 0 ? round4(agg.refundedOrders / agg.totalOrders) : 0 },
      { metricKey: 'active_sku', value: agg.activeSkuCount },
    ];

    // 注意：dimension_value 必须写实值而非 NULL。
    // SQLite 的 UNIQUE 约束中 NULL 互不相等，写 NULL 会导致 ON CONFLICT 永不命中、快照无限追加。
    const extra = JSON.stringify({ sampleOrders: agg.totalOrders, source: 'analyticsService' });
    transaction((tx) => {
      const upsert = tx.prepare(
        `INSERT INTO analytics_snapshots
           (id, tenant_id, metric_key, dimension, dimension_value,
            period_type, period_start, period_end, value, extra, computed_at)
         VALUES (?, ?, ?, 'total', 'all', ?, ?, ?, ?, ?, datetime('now', '+0000'))
         ON CONFLICT(tenant_id, metric_key, dimension, dimension_value, period_type, period_start)
         DO UPDATE SET value = excluded.value,
                       period_end = excluded.period_end,
                       extra = excluded.extra,
                       computed_at = excluded.computed_at`
      );
      for (const m of metrics) {
        upsert.run(uuidv4(), tenantId, m.metricKey, periodType, start, end, m.value, extra);
      }
    });

    logger.info('analytics', `快照固化完成 ${periodType} ${start}~${end}，写入 ${metrics.length} 条指标`);

    return { periodType, periodStart: start, periodEnd: end, written: metrics.length, metrics };
  }

  // ─────────── 10. 结构化报告 ───────────

  exportReport(tenantId: string, opts: { from: string; to: string }): ReportResult {
    const range: DateRange = { from: opts.from, to: opts.to };
    const overview = this.getOverview(tenantId, { ...range, compare: 'prev' });
    const funnel = this.getFunnel(tenantId, range);
    const products = this.getProductAnalysis(tenantId, range);
    const customers = this.getCustomerAnalysis(tenantId, range);
    const employees = this.getEmployeeEfficiency(tenantId, { period: range.to.slice(0, 7) });
    const health = this.getHealthScore(tenantId);
    const topPlatforms = this.getDimensionBreakdown(tenantId, {
      dimension: 'platform', metric: 'gmv', ...range, limit: 5,
    });
    const topProducts = this.getDimensionBreakdown(tenantId, {
      dimension: 'product', metric: 'gmv', ...range, limit: 10,
    });

    const conclusions: string[] = [];
    const m = (key: string) => overview.metrics.find((x) => x.key === key);

    if (overview.sampleSize === 0) {
      conclusions.push(`${range.from} ~ ${range.to} 区间内没有任何订单记录，本报告无可分析数据。`);
    } else {
      const gmv = m('gmv');
      const gp = m('gross_profit');
      const gmr = m('gross_margin_rate');
      const conv = m('conversion');
      const rr = m('refund_rate');

      if (gmv) {
        conclusions.push(
          `区间 GMV ${fmt(gmv.value)}，共 ${overview.sampleSize} 笔订单`
          + (gmv.changeRate !== null ? `，环比${gmv.changeRate >= 0 ? '增长' : '下滑'} ${pct(Math.abs(gmv.changeRate))}。` : '（无可比历史区间）。')
        );
      }
      if (gp && gmr) {
        conclusions.push(`毛利 ${fmt(gp.value)}，毛利率 ${pct(gmr.value)}（口径：GMV − Σ数量×成本价）。`);
      }
      if (conv) conclusions.push(`支付转化率 ${pct(conv.value)}。`);
      if (rr && rr.value > 0.05) conclusions.push(`退款率 ${pct(rr.value)} 高于 5% 警戒线，需重点排查。`);

      if (products.available) {
        const a = products.abcSummary.find((x) => x.tier === 'A');
        if (a && a.skuCount > 0) {
          conclusions.push(`A 类核心商品 ${a.skuCount} 个，贡献 GMV ${pct(a.gmvShare)}；滞销 SKU ${products.slowMoving.length} 个。`);
        }
      }
      if (customers.available && customers.repurchaseRate !== null) {
        conclusions.push(`可识别客户 ${customers.identifiedCustomers} 人，复购率 ${pct(customers.repurchaseRate)}，新客 ${customers.newCustomers} 人。`);
      }
      if (!employees.available) {
        conclusions.push('人效分析未启用：业务归因数据尚未生成。');
      }
      if (health.overallScore !== null) {
        conclusions.push(`经营健康度综合分 ${health.overallScore}（${health.grade}），基于 ${health.evaluatedDimensions}/${health.totalDimensions} 个有效维度。`);
      } else {
        conclusions.push('经营健康度：6 个维度均数据不足，未计算综合分。');
      }
    }

    return {
      range,
      generatedAt: new Date().toISOString(),
      overview, funnel, products, customers, employees, health,
      topPlatforms, topProducts,
      conclusions,
    };
  }
}

// ══════════════════ 订单口径判定（全局唯一来源）══════════════════

/** 已支付：口径同 cockpitService 漏斗段 */
function isPaid(o: OrderRow): boolean {
  return o.payment_status === 'paid' || o.payment_status === 'partial';
}

/** 计入营收：口径同 cockpitService 本月毛利计算 */
function countsTowardRevenue(o: OrderRow): boolean {
  return o.payment_status === 'paid'
    || o.payment_status === 'partial'
    || o.payment_status === 'refunded';
}

/** 退款判定 */
function isRefunded(o: OrderRow): boolean {
  return o.payment_status === 'refunded'
    || o.order_status === 'refunded'
    || o.order_status === 'returned';
}

/** 单笔订单营收：口径同 cockpitService */
function revenueOf(o: OrderRow): number {
  const paid = Number(o.paid_amount || 0);
  return paid > 0 ? paid : Number(o.total_amount || 0);
}

function parseItems(raw: string): OrderItem[] {
  try {
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? (arr as OrderItem[]) : [];
  } catch {
    return [];
  }
}

/** 客户唯一标识：手机 > 邮箱 > 姓名；均为空返回 null（匿名订单） */
function customerKeyOf(o: Pick<OrderRow, 'customer_phone' | 'customer_email' | 'customer_name'>): string | null {
  const phone = (o.customer_phone || '').trim();
  if (phone) return `p:${phone}`;
  const email = (o.customer_email || '').trim().toLowerCase();
  if (email) return `e:${email}`;
  const name = (o.customer_name || '').trim();
  if (name) return `n:${name}`;
  return null;
}

/** 业务线映射：与 cockpitService.mapPlatformToBizLine 保持一致 */
function mapPlatformToBizLine(platform: string): 'live' | 'cross' | 'trad' | 'media' {
  const p = (platform || '').toLowerCase();
  if (/(douyin|抖音|tiktok|快手|小红书直播|taobao_live|淘宝直播|video|live|主播)/.test(p)) return 'live';
  if (/(amazon|亚马逊|ebay|aliexpress|速卖通|shopee|lazada|跨境|cross_border)/.test(p)) return 'cross';
  if (/(xhs|小红书|wechat|微信|公众号|视频号|新媒体|social|新抖|media)/.test(p)) return 'media';
  return 'trad';
}

const BIZ_LINE_LABEL: Record<string, string> = {
  live: '直播电商', cross: '跨境电商', trad: '传统电商', media: '新媒体电商',
};

// ══════════════════ 指标元数据 ══════════════════

const TREND_META: Record<TrendMetric, {
  unit: MetricUnit; formula: string; pick: (a: RangeAggregate) => number;
}> = {
  gmv: {
    unit: 'currency',
    formula: 'Σ(paid_amount>0 ? paid_amount : total_amount)，取 payment_status ∈ {paid, partial, refunded}',
    pick: (a) => a.revenue,
  },
  orders: {
    unit: 'count',
    formula: '该时间桶内 orders 全部条数',
    pick: (a) => a.totalOrders,
  },
  aov: {
    unit: 'currency',
    formula: 'GMV ÷ 已支付订单数；无已支付订单记 0',
    pick: (a) => (a.paidOrders > 0 ? a.revenue / a.paidOrders : 0),
  },
  gross_profit: {
    unit: 'currency',
    formula: 'GMV − Σ(items[].quantity × products.cost_price)',
    pick: (a) => a.grossProfit,
  },
  conversion: {
    unit: 'percent',
    formula: '已支付订单数 ÷ 订单总数',
    pick: (a) => (a.totalOrders > 0 ? a.paidOrders / a.totalOrders : 0),
  },
  refund_rate: {
    unit: 'percent',
    formula: '退款订单数 ÷ 订单总数',
    pick: (a) => (a.totalOrders > 0 ? a.refundedOrders / a.totalOrders : 0),
  },
};

const BREAKDOWN_FORMULA: Record<BreakdownDimension, string> = {
  platform: '按 orders.platform 原始值分组',
  category: '按订单 items[].productId 关联 products.category 分组',
  product: '按订单 items[].productId 关联 products 分组',
  employee: '按 orders.owner_employee_id 关联 employees 分组',
  department: '按 orders.owner_employee_id → employees.department_id → departments 分组',
  business_line: '按 orders.platform 归一化为直播/跨境/传统/新媒体四条业务线',
  live_session: '按 orders.live_session_id 关联 live_sessions 分组',
};

const BREAKDOWN_METRIC_FORMULA: Record<BreakdownMetric, string> = {
  gmv: 'GMV 口径同总览（商品级维度按 quantity × unitPrice 拆行）',
  orders: '订单条数（商品级维度按明细行数计）',
  gross_profit: '毛利 = GMV − Σ(quantity × cost_price)',
};

// ══════════════════ 通用工具 ══════════════════

function round2(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
function round4(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : 0;
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}
function fmt(n: number): string {
  return `¥${round2(n).toLocaleString('zh-CN')}`;
}

function computeChangeRate(value: number | null, prevValue: number | null): number | null {
  if (value === null || prevValue === null) return null;
  if (prevValue === 0) return null; // 基期为 0 无法计算增长率，诚实返回 null
  return round4((value - prevValue) / Math.abs(prevValue));
}

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** 线性插值分位数 */
function quantile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const pos = (sortedAsc.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
}

function growthScore(g: number): number {
  if (g >= 0.2) return 100;
  if (g >= 0) return 60 + (g / 0.2) * 40;
  if (g >= -0.2) return 20 + ((g + 0.2) / 0.2) * 40;
  return clamp(20 + (g + 0.2) * 100, 0, 20);
}

function gradeOf(score: number | null): string {
  if (score === null) return '数据不足';
  if (score >= 85) return '优秀';
  if (score >= 70) return '良好';
  if (score >= 55) return '合格';
  if (score >= 40) return '预警';
  return '危险';
}

function countMissingCostSku(db: ReturnType<typeof getDatabase>, tenantId: string): number {
  const row = db.prepare(
    `SELECT COUNT(*) AS cnt FROM products
     WHERE tenant_id = ? AND status != 'discontinued'
       AND (cost_price IS NULL OR cost_price <= 0)`
  ).get(tenantId) as { cnt: number };
  return Number(row?.cnt || 0);
}

// ══════════════════ 日期工具（统一 UTC，规避时区漂移）══════════════════

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function toDate(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}

export function addDays(s: string, n: number): string {
  const d = toDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function diffDays(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86400000);
}

/** 生成对比区间 */
function shiftRange(range: DateRange, mode: CompareMode): DateRange {
  if (mode === 'yoy') {
    return { from: shiftYear(range.from, -1), to: shiftYear(range.to, -1) };
  }
  // prev：紧邻的等长上一区间
  const span = diffDays(range.from, range.to) + 1;
  return { from: addDays(range.from, -span), to: addDays(range.from, -1) };
}

function shiftYear(s: string, n: number): string {
  const d = toDate(s);
  d.setUTCFullYear(d.getUTCFullYear() + n);
  return d.toISOString().slice(0, 10);
}

/** 该日期所属时间桶的 key */
function bucketOf(date: string, g: Granularity): string {
  if (g === 'month') return date.slice(0, 7);
  if (g === 'week') return weekStart(date);
  return date;
}

/** 周一为一周起点 */
function weekStart(date: string): string {
  const d = toDate(date);
  const dow = d.getUTCDay(); // 0=周日
  const offset = dow === 0 ? -6 : 1 - dow;
  return addDays(date, offset);
}

/** 枚举区间内全部时间桶（缺数据的桶后续补 0，不做虚构填充） */
function enumerateBuckets(range: DateRange, g: Granularity): string[] {
  const out: string[] = [];
  if (g === 'month') {
    let cur = range.from.slice(0, 7);
    const last = range.to.slice(0, 7);
    let guard = 0;
    while (cur <= last && guard < 240) {
      out.push(cur);
      cur = nextMonth(cur);
      guard += 1;
    }
    return out;
  }
  if (g === 'week') {
    let cur = weekStart(range.from);
    let guard = 0;
    while (cur <= range.to && guard < 520) {
      out.push(cur);
      cur = addDays(cur, 7);
      guard += 1;
    }
    return out;
  }
  let cur = range.from;
  let guard = 0;
  while (cur <= range.to && guard < 1100) {
    out.push(cur);
    cur = addDays(cur, 1);
    guard += 1;
  }
  return out;
}

function nextMonth(ym: string): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

function bucketLabel(bucket: string, g: Granularity): string {
  if (g === 'month') return `${bucket.slice(0, 4)}年${bucket.slice(5, 7)}月`;
  if (g === 'week') return `${bucket.slice(5, 7)}/${bucket.slice(8, 10)} 起`;
  return `${bucket.slice(5, 7)}/${bucket.slice(8, 10)}`;
}

/** 按周期类型求闭区间边界 */
export function periodBounds(date: string, periodType: SnapshotPeriodType): { start: string; end: string } {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));

  if (periodType === 'day') return { start: date, end: date };
  if (periodType === 'week') {
    const s = weekStart(date);
    return { start: s, end: addDays(s, 6) };
  }
  if (periodType === 'month') {
    const start = `${date.slice(0, 7)}-01`;
    return { start, end: addDays(nextMonth(date.slice(0, 7)) + '-01', -1) };
  }
  if (periodType === 'quarter') {
    const qStartMonth = Math.floor((m - 1) / 3) * 3 + 1;
    const start = `${y}-${String(qStartMonth).padStart(2, '0')}-01`;
    const endMonthYm = qStartMonth + 2 === 12 ? `${y}-12` : `${y}-${String(qStartMonth + 2).padStart(2, '0')}`;
    return { start, end: addDays(nextMonth(endMonthYm) + '-01', -1) };
  }
  return { start: `${y}-01-01`, end: `${y}-12-31` };
}

export const analyticsService = new AnalyticsService();
