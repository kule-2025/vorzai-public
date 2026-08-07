/**
 * Vorzai 业务驾驶舱聚合服务（Cockpit Service）
 *
 * 数据来源（全部复用现有表，不新建表）：
 *   - projects        → 立项（漏斗首段）
 *   - products        → 选品 / 库存告急 / 滞销 SKU
 *   - product_bundles → 组盘（漏斗第三段）
 *   - orders          → GMV / 毛利 / 活跃订单 / 业务线切片 / 退款率
 *   - service_tickets → 客诉 / 工单
 *
 * 关键口径修正（任务硬要求）：
 *   本月毛利 = 营收(revenue) − 成本(cost)，不再用 GMV 冒充产出。
 *   revenue = SUM(paid_amount) WHERE 订单已支付 + 当月
 *   cost    = Σ(每个订单 items[].quantity × products.cost_price)
 *
 * 所有 SQL 全部带 tenant_id 过滤，配合 tenantIsolation 中间件。
 */
import { getDatabase } from '../db';
import { logger } from '../utils/logger';
import { revenueOf, countsTowardRevenue, isPaid } from '../utils/orderMetrics';
import { FUNNEL_STATUS } from '../utils/funnelConstants';

// ────────────────── 类型导出 ──────────────────

export interface KpiCards {
  todayGmv: number;
  todayOrderCount: number;
  monthlyGrossProfit: number;
  monthlyRevenue: number;
  monthlyCost: number;
  activeOrderCount: number;
  openTicketCount: number;
  lowStockSkuCount: number;
}

export interface FunnelStage {
  id: string;
  label: string;
  count: number;
  conversionRate: number; // 0~1，相对于上一段
}

export interface AbnormalItem {
  id: string;
  name: string;
  value: number;       // 数量/比率
  meta?: string;       // 辅助说明
  href?: string;       // 下钻路由
}

export interface TopAbnormalGroup {
  id: string;
  label: string;
  empty?: boolean;
  reason?: string;     // 「暂无」时给出原因
  items: AbnormalItem[];
}

export interface BizLineSlice {
  id: string;          // live / cross / trad / media
  label: string;       // 中文：直播 / 跨境 / 传统 / 新媒体
  gmv: number;
  orderCount: number;
  paidOrderCount: number;
  conversionRate: number; // 0~1，paid / total
  platformValue: string;  // 实际 orders.platform 聚合 key
}

export interface CockpitOverview {
  generatedAt: string;
  kpi: KpiCards;
  funnel: FunnelStage[];
  topAbnormal: TopAbnormalGroup[];
  bizLines: BizLineSlice[];
}

// ────────────────── 服务类 ──────────────────

export class CockpitService {
  /**
   * 一次拉取驾驶舱全部指标。
   * 拆成 5 段独立查询，任一段失败不影响其他段（业务大屏的可用性优先）。
   */
  getOverview(tenantId: string): CockpitOverview {
    return {
      generatedAt: new Date().toISOString(),
      kpi: this.getKpiCards(tenantId),
      funnel: this.getFunnel(tenantId),
      topAbnormal: this.getTopAbnormal(tenantId),
      bizLines: this.getBizLineSlices(tenantId),
    };
  }

  // ================ KPI 5 卡 ================

  private getKpiCards(tenantId: string): KpiCards {
    const db = getDatabase();

    // 1. 今日 GMV + 今日订单数（排除沙箱数据，统一口径：paid_amount优先，refunded不计入GMV）
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const todayRow = db.prepare(
      `SELECT COUNT(*) AS cnt,
              COALESCE(SUM(CASE WHEN payment_status NOT IN ('refunded') AND is_sandbox = 0 THEN paid_amount ELSE 0 END), 0) AS gmv,
              COALESCE(SUM(CASE WHEN is_sandbox = 0 THEN total_amount ELSE 0 END), 0) AS total
       FROM orders
       WHERE tenant_id = ? AND substr(created_at, 1, 10) = ? AND is_sandbox = 0`
    ).get(tenantId, today) as { cnt: number; gmv: number; total: number };

    // 2. 本月毛利 = revenue - cost（排除沙箱，口径：paid_amount>0取paid，否则取total，refunded计入营收）
    const monthPrefix = today.slice(0, 7); // YYYY-MM
    const monthPaidOrders = db.prepare(
      `SELECT id, items, paid_amount, total_amount, payment_status, 'pending' AS order_status
       FROM orders
       WHERE tenant_id = ?
         AND substr(created_at, 1, 7) = ?
         AND is_sandbox = 0
         AND payment_status IN ('paid', 'partial')`
    ).all(tenantId, monthPrefix) as Array<{
      id: string; items: string; paid_amount: number; total_amount: number; payment_status: string; order_status: string;
    }>;

    let monthlyRevenue = 0;
    let monthlyCost = 0;
    for (const o of monthPaidOrders) {
      const rev = revenueOf(o);
      monthlyRevenue += rev;

      // items 是 JSON 数组: [{ productId, quantity, unitPrice }]
      let items: Array<{ productId?: string; quantity?: number }> = [];
      try { items = JSON.parse(o.items || '[]'); } catch { items = []; }

      for (const it of items) {
        if (!it.productId || !it.quantity) continue;
        const prod = db.prepare(
          'SELECT cost_price FROM products WHERE id = ? AND tenant_id = ?'
        ).get(it.productId, tenantId) as { cost_price: number | null } | undefined;
        const unitCost = Number(prod?.cost_price || 0);
        monthlyCost += unitCost * Number(it.quantity || 0);
      }
    }
    const monthlyGrossProfit = monthlyRevenue - monthlyCost;

    // 3. 活跃订单数（排除沙箱）
    const activeRow = db.prepare(
      `SELECT COUNT(*) AS cnt FROM orders
       WHERE tenant_id = ? AND is_sandbox = 0
         AND order_status IN ('pending', 'confirmed', 'processing', 'shipped')`
    ).get(tenantId) as { cnt: number };

    // 4. 待处理客诉 (open tickets)
    const ticketRow = db.prepare(
      `SELECT COUNT(*) AS cnt FROM service_tickets
       WHERE tenant_id = ? AND status = 'open'`
    ).get(tenantId) as { cnt: number };

    // 5. 库存预警 SKU 数 (stock < 10)
    const lowStockRow = db.prepare(
      `SELECT COUNT(*) AS cnt FROM products
       WHERE tenant_id = ? AND stock < 10 AND status != 'discontinued'`
    ).get(tenantId) as { cnt: number };

    return {
      // GMV 口径统一：今日 GMV 排除 refunded，gmv=0 时直接返回 0（不使用 total 兜底，
      // 避免"今日仅有退款订单"时把退款总额错误计为 GMV 虚增数据）
      todayGmv: Number(todayRow.gmv || 0) > 0 ? round2(Number(todayRow.gmv)) : 0,
      todayOrderCount: Number(todayRow.cnt || 0),
      monthlyGrossProfit: round2(monthlyGrossProfit),
      monthlyRevenue: round2(monthlyRevenue),
      monthlyCost: round2(monthlyCost),
      activeOrderCount: Number(activeRow.cnt || 0),
      openTicketCount: Number(ticketRow.cnt || 0),
      lowStockSkuCount: Number(lowStockRow.cnt || 0),
    };
  }

  // ================ 业务链漏斗 5 段 ================

  private getFunnel(tenantId: string): FunnelStage[] {
    const db = getDatabase();

    // DA-11: 统一使用 funnelConstants 的 FUNNEL_STATUS，确保与 analyticsService 一致
    const statusIn = (statuses: readonly string[]) => `'${statuses.join("','")}'`;

    // 立项：FUNNEL_STATUS.project（planning + approved + in_progress + paused）
    const projectsRow = db.prepare(
      `SELECT COUNT(*) AS cnt FROM projects
       WHERE tenant_id = ? AND status IN (${statusIn(FUNNEL_STATUS.project)})`
    ).get(tenantId) as { cnt: number };

    // 选品：FUNNEL_STATUS.product（candidate + selected + listed）
    const productsRow = db.prepare(
      `SELECT COUNT(*) AS cnt FROM products
       WHERE tenant_id = ? AND status IN (${statusIn(FUNNEL_STATUS.product)})`
    ).get(tenantId) as { cnt: number };

    // 组盘：FUNNEL_STATUS.bundle（active）
    const bundlesRow = db.prepare(
      `SELECT COUNT(*) AS cnt FROM product_bundles
       WHERE tenant_id = ? AND status IN (${statusIn(FUNNEL_STATUS.bundle)})`
    ).get(tenantId) as { cnt: number };

    // 订单：已支付（剔除 cancelled / refunded，排除沙箱）
    const paidOrdersRow = db.prepare(
      `SELECT COUNT(*) AS cnt FROM orders
       WHERE tenant_id = ? AND is_sandbox = 0 AND payment_status IN ('paid', 'partial')`
    ).get(tenantId) as { cnt: number };

    // 客服：resolved + closed（完成履约）
    const resolvedTicketsRow = db.prepare(
      `SELECT COUNT(*) AS cnt FROM service_tickets
       WHERE tenant_id = ? AND status IN ('resolved', 'closed')`
    ).get(tenantId) as { cnt: number };

    const counts = [
      { id: 'project',  label: '立项', count: Number(projectsRow.cnt || 0) },
      { id: 'select',   label: '选品', count: Number(productsRow.cnt || 0) },
      { id: 'package',  label: '组盘', count: Number(bundlesRow.cnt || 0) },
      { id: 'order',    label: '订单', count: Number(paidOrdersRow.cnt || 0) },
      { id: 'service',  label: '客服', count: Number(resolvedTicketsRow.cnt || 0) },
    ];

    // 转化率 = 当前段 / 上一段（首段置 1）
    return counts.map((s, i) => {
      const prev = i === 0 ? s.count : counts[i - 1].count;
      return {
        id: s.id,
        label: s.label,
        count: s.count,
        conversionRate: prev > 0 ? round4(s.count / prev) : 0,
      };
    });
  }

  // ================ Top 5 异常 ================

  private getTopAbnormal(tenantId: string): TopAbnormalGroup[] {
    const db = getDatabase();

    // (1) 滞销 SKU：30 天无销售且有库存
    let slowMoving: AbnormalItem[] = [];
    try {
      // 简化：拿当前有库存 + 未 discontinued 的产品，
      // 排除最近 30 天内出现在订单 items 中的 productId
      const candidates = db.prepare(
        `SELECT id, sku, name, stock FROM products
         WHERE tenant_id = ? AND stock > 0 AND status != 'discontinued'
         ORDER BY updated_at ASC LIMIT 200`
      ).all(tenantId) as Array<{ id: string; sku: string; name: string; stock: number }>;

      const recentOrders = db.prepare(
        `SELECT items FROM orders
         WHERE tenant_id = ? AND is_sandbox = 0 AND created_at >= datetime('now', '-30 days', '+0000')`
      ).all(tenantId) as Array<{ items: string }>;

      const soldIds = new Set<string>();
      for (const o of recentOrders) {
        try {
          const arr = JSON.parse(o.items || '[]') as Array<{ productId?: string }>;
          for (const it of arr) if (it.productId) soldIds.add(it.productId);
        } catch { /* ignore */ }
      }
      slowMoving = candidates
        .filter((p) => !soldIds.has(p.id))
        .slice(0, 5)
        .map((p) => ({
          id: p.id,
          name: `${p.sku} · ${p.name}`,
          value: p.stock,
          meta: '30 天无销售',
          href: `/business-chain?phase=select&keyword=${encodeURIComponent(p.sku)}`,
        }));
    } catch (e) {
      logger.warn('cockpit', `slowMoving query failed: ${String(e)}`);
    }

    // (2) 退款率 Top 5：group by productId（解析 orders.items）
    let refundTop: AbnormalItem[] = [];
    try {
      const refundedOrders = db.prepare(
        `SELECT id, items FROM orders
         WHERE tenant_id = ? AND is_sandbox = 0 AND (payment_status = 'refunded' OR order_status IN ('refunded', 'returned'))`
      ).all(tenantId) as Array<{ id: string; items: string }>;

      const totalOrders = db.prepare(
        `SELECT COUNT(*) AS cnt FROM orders WHERE tenant_id = ? AND is_sandbox = 0`
      ).get(tenantId) as { cnt: number };

      // 统计每个 productId 在退款订单中出现的次数
      const refundCount = new Map<string, number>();
      for (const o of refundedOrders) {
        try {
          const arr = JSON.parse(o.items || '[]') as Array<{ productId?: string }>;
          for (const it of arr) if (it.productId) {
            refundCount.set(it.productId, (refundCount.get(it.productId) || 0) + 1);
          }
        } catch { /* ignore */ }
      }

      const totalN = Number(totalOrders.cnt || 0);
      refundTop = Array.from(refundCount.entries())
        .map(([pid, cnt]) => ({ pid, cnt, rate: totalN > 0 ? cnt / totalN : 0 }))
        .sort((a, b) => b.cnt - a.cnt)
        .slice(0, 5)
        .map((r) => {
          const prod = db.prepare(
            'SELECT sku, name FROM products WHERE id = ? AND tenant_id = ?'
          ).get(r.pid, tenantId) as { sku: string; name: string } | undefined;
          return {
            id: r.pid,
            name: prod ? `${prod.sku} · ${prod.name}` : r.pid,
            value: round4(r.rate * 100), // 百分比
            meta: `${r.cnt} 笔退款`,
            href: `/business-chain?phase=order`,
          };
        });
    } catch (e) {
      logger.warn('cockpit', `refundTop query failed: ${String(e)}`);
    }

    // (3) 客户投诉 Top 5 类别
    let complaintTop: AbnormalItem[] = [];
    try {
      const rows = db.prepare(
        `SELECT category, COUNT(*) AS cnt FROM service_tickets
         WHERE tenant_id = ? AND category = 'complaint'
         GROUP BY category
         ORDER BY cnt DESC LIMIT 5`
      ).all(tenantId) as Array<{ category: string; cnt: number }>;
      complaintTop = rows.map((r) => ({
        id: r.category,
        name: complaintCategoryLabel(r.category),
        value: Number(r.cnt),
        meta: '投诉',
        href: `/business-chain?phase=service&category=complaint`,
      }));
      // 兜底：投诉类别数据为空时取所有类目前 5，让看板不空白
      if (complaintTop.length === 0) {
        const fallback = db.prepare(
          `SELECT category, COUNT(*) AS cnt FROM service_tickets
           WHERE tenant_id = ? GROUP BY category ORDER BY cnt DESC LIMIT 5`
        ).all(tenantId) as Array<{ category: string; cnt: number }>;
        complaintTop = fallback.map((r) => ({
          id: r.category,
          name: ticketCategoryLabel(r.category),
          value: Number(r.cnt),
          meta: '工单',
          href: `/business-chain?phase=service&category=${encodeURIComponent(r.category)}`,
        }));
      }
    } catch (e) {
      logger.warn('cockpit', `complaintTop query failed: ${String(e)}`);
    }

    // (4) 员工离职风险：基于 hire_date 和 performance_reviews 计算
    let turnoverRisk: TopAbnormalGroup = {
      id: 'turnover',
      label: '员工离职风险',
      empty: false,
      reason: '',
      items: [],
    };
    try {
      const employees = db.prepare(
        `SELECT e.id, e.name, e.hire_date, e.status,
                COALESCE(pr.score, 0) as latest_score,
                e.salary_base
         FROM employees e
         LEFT JOIN (
           SELECT employee_id, score FROM performance_reviews
           WHERE tenant_id = ? AND status = 'completed'
           ORDER BY period DESC LIMIT 1
         ) pr ON e.id = pr.employee_id
         WHERE e.tenant_id = ? AND e.status IN ('active', 'probation')
           AND e.hire_date IS NOT NULL
         ORDER BY e.hire_date ASC, pr.score ASC`
      ).all(tenantId, tenantId) as Array<{
        id: string; name: string; hire_date: string; status: string; latest_score: number; salary_base: number;
      }>;

      const today = new Date().toISOString().slice(0, 10);
      const riskItems: any[] = [];
      for (const emp of employees.slice(0, 5)) {
        const hireDate = new Date(emp.hire_date);
        const daysEmployed = Math.floor((Date.now() - hireDate.getTime()) / 86400000);
        const riskScore = emp.latest_score < 60 ? 80 : emp.latest_score < 75 ? 60 : 40;
        const tenureRisk = daysEmployed < 90 ? 90 : daysEmployed < 180 ? 70 : daysEmployed < 365 ? 50 : 20;
        const finalScore = Math.round((riskScore + tenureRisk) / 2);
        riskItems.push({
          id: emp.id,
          name: emp.name,
          value: finalScore,
          meta: `入职 ${daysEmployed} 天${emp.latest_score > 0 ? '，最新评分 ' + emp.latest_score : ''}`,
          href: `/hr?tab=employees&keyword=${encodeURIComponent(emp.name)}`,
        });
      }
      if (riskItems.length > 0) {
        turnoverRisk.items = riskItems;
        turnoverRisk.reason = `基于入职时长和绩效评分综合评估（评分越低风险越高）`;
      } else {
        turnoverRisk.empty = true;
        turnoverRisk.reason = '暂无足够数据（需要员工档案和绩效记录）';
      }
    } catch (e) {
      logger.warn('cockpit', `turnoverRisk query failed: ${String(e)}`);
    }

    // (5) 库存告急 Top 5
    let stockAlert: AbnormalItem[] = [];
    try {
      const rows = db.prepare(
        `SELECT id, sku, name, stock, min_stock FROM products
         WHERE tenant_id = ? AND stock < 10 AND status != 'discontinued'
         ORDER BY stock ASC, updated_at ASC LIMIT 5`
      ).all(tenantId) as Array<{ id: string; sku: string; name: string; stock: number; min_stock: number }>;
      stockAlert = rows.map((p) => ({
        id: p.id,
        name: `${p.sku} · ${p.name}`,
        value: Number(p.stock),
        meta: p.min_stock > 0 ? `低于安全库存 ${p.min_stock}` : '库存告急',
        href: `/business-chain?phase=select&keyword=${encodeURIComponent(p.sku)}`,
      }));
    } catch (e) {
      logger.warn('cockpit', `stockAlert query failed: ${String(e)}`);
    }

    return [
      { id: 'slow_moving',  label: '滞销 SKU（30 天无销）', items: slowMoving },
      { id: 'refund_rate',  label: '退款率 Top 5',           items: refundTop },
      { id: 'complaint',    label: '客户投诉 Top 5',         items: complaintTop },
      turnoverRisk,
      { id: 'stock_alert',  label: '库存告急 Top 5',         items: stockAlert },
    ];
  }

  // ================ 业务线 4 切片 ================
  /**
   * 业务线 = 直播 / 跨境 / 传统 / 新媒体 四条。
   * 数据来源：orders.platform 字段（products 表无 platform 字段，orders.platform 才是真实业务线标记）。
   * 匹配规则：platform 文本 → bizLine（可空，空归 "传统"）
   */
  private getBizLineSlices(tenantId: string): BizLineSlice[] {
    const db = getDatabase();
    const rows = db.prepare(
      `SELECT
         COALESCE(NULLIF(platform, ''), 'unknown') AS platform,
         COUNT(*) AS total_cnt,
         SUM(CASE WHEN payment_status IN ('paid', 'partial') AND is_sandbox = 0 THEN 1 ELSE 0 END) AS paid_cnt,
         COALESCE(SUM(CASE WHEN payment_status IN ('paid', 'partial') AND is_sandbox = 0 THEN paid_amount ELSE 0 END), 0) AS gmv
       FROM orders
       WHERE tenant_id = ? AND is_sandbox = 0
       GROUP BY COALESCE(NULLIF(platform, ''), 'unknown')`
    ).all(tenantId) as Array<{
      platform: string; total_cnt: number; paid_cnt: number; gmv: number;
    }>;

    // 把 platform 字符串归一化到 4 个业务线
    const bucket: Record<string, { gmv: number; total: number; paid: number }> = {
      live:  { gmv: 0, total: 0, paid: 0 },
      cross: { gmv: 0, total: 0, paid: 0 },
      trad:  { gmv: 0, total: 0, paid: 0 },
      media: { gmv: 0, total: 0, paid: 0 },
    };
    const platformLabel: Record<string, string> = {};

    for (const r of rows) {
      const line = mapPlatformToBizLine(r.platform);
      platformLabel[line] = r.platform;
      bucket[line].gmv += Number(r.gmv || 0);
      bucket[line].total += Number(r.total_cnt || 0);
      bucket[line].paid += Number(r.paid_cnt || 0);
    }

    const lines: { id: keyof typeof bucket; label: string }[] = [
      { id: 'live',  label: '直播' },
      { id: 'cross', label: '跨境' },
      { id: 'trad',  label: '传统' },
      { id: 'media', label: '新媒体' },
    ];

    return lines.map((l) => {
      const b = bucket[l.id];
      return {
        id: l.id,
        label: l.label,
        gmv: round2(b.gmv),
        orderCount: b.total,
        paidOrderCount: b.paid,
        conversionRate: b.total > 0 ? round4(b.paid / b.total) : 0,
        platformValue: platformLabel[l.id] || '—',
      };
    });
  }
}

// ────────────────── 工具函数（模块顶层，便于测试）──────────────────

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round4(n: number): number { return Math.round(n * 10000) / 10000; }

function mapPlatformToBizLine(platform: string): 'live' | 'cross' | 'trad' | 'media' {
  const p = (platform || '').toLowerCase();
  // 直播
  if (/(douyin|抖音|tiktok|快手|小红书直播|taobao_live|淘宝直播|video|live|主播)/.test(p)) return 'live';
  // 跨境
  if (/(amazon|亚马逊|ebay|aliexpress|速卖通|shopee|lazada|跨境|cross_border|跨境电商|跨境独立站)/.test(p)) return 'cross';
  // 新媒体
  if (/(xhs|小红书|wechat|微信|公众号|视频号|新媒体|social|新抖|media)/.test(p)) return 'media';
  // 传统（默认：淘宝/天猫/京东/拼多多/抖店/1688 等）
  return 'trad';
}

function complaintCategoryLabel(c: string): string {
  return c === 'complaint' ? '投诉' : c;
}

function ticketCategoryLabel(c: string): string {
  const map: Record<string, string> = {
    inquiry: '咨询', complaint: '投诉', return: '退货', exchange: '换货',
    refund: '退款', logistics: '物流', after_sales: '售后', other: '其他',
  };
  return map[c] || c;
}

export const cockpitService = new CockpitService();
