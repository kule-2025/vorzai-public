/**
 * Vorzai 库存预警引擎 + 业务-HR 归因服务
 *
 * 本文件包含两块能力：
 *   A. InventoryService  —— 库存预警规则 CRUD、规则评估引擎、告警生命周期管理
 *   B. AttributionService —— 订单/工单归因到员工，打通业务数据与 HR 人效
 *
 * 关键口径（与 cockpitService 保持完全一致，不得自行发明）：
 *   revenue      = 订单 paid_amount（为 0 时回落 total_amount）
 *   cost         = Σ(items[].quantity × products.cost_price)
 *   gross_profit = revenue − cost
 *
 * 所有 SQL 必须带 tenant_id 过滤，配合 tenantIsolation 中间件做租户隔离。
 * 涉及表：products / orders / service_tickets / users / employees / departments
 *        inventory_alert_rules / inventory_alerts / performance_attributions
 */
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db';
import { logger } from '../utils/logger';

// ════════════════════════════════════════════════════════════
// 类型定义
// ════════════════════════════════════════════════════════════

/** 规则作用域：全部商品 / 指定类目 / 指定单品 */
export type RuleScope = 'all' | 'category' | 'product';
/** 规则类型 */
export type RuleType = 'low_stock' | 'out_of_stock' | 'overstock' | 'slow_moving' | 'stockout_eta';
/** 严重度 */
export type AlertSeverity = 'info' | 'warning' | 'critical';
/** 告警状态 */
export type AlertStatus = 'open' | 'acknowledged' | 'resolved' | 'ignored';

export interface InventoryAlertRule {
  id: string;
  tenantId: string;
  name: string;
  scope: RuleScope;
  scopeValue: string | null;
  ruleType: RuleType;
  threshold: number;
  windowDays: number;
  severity: AlertSeverity;
  notifyChannels: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RuleInput {
  name: string;
  scope?: RuleScope;
  scopeValue?: string | null;
  ruleType: RuleType;
  threshold: number;
  windowDays?: number;
  severity?: AlertSeverity;
  notifyChannels?: string[];
  enabled?: boolean;
}

export type RuleUpdateInput = Partial<RuleInput>;

export interface InventoryAlert {
  id: string;
  tenantId: string;
  ruleId: string | null;
  ruleName: string | null;
  productId: string;
  productSku: string | null;
  productName: string | null;
  productCategory: string | null;
  alertType: RuleType | string;
  severity: AlertSeverity;
  currentStock: number;
  threshold: number;
  dailySalesAvg: number;
  daysOfSupply: number | null;
  suggestedQty: number;
  message: string;
  status: AlertStatus;
  acknowledgedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface AlertListFilter {
  status?: AlertStatus;
  severity?: AlertSeverity;
  productId?: string;
  alertType?: string;
  page?: number;
  limit?: number;
}

export interface AlertListResult {
  items: InventoryAlert[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface AlertStats {
  total: number;
  bySeverity: { critical: number; warning: number; info: number };
  byStatus: { open: number; acknowledged: number; resolved: number; ignored: number };
  /** 待处理（open + acknowledged）总数 */
  pending: number;
  /** 需要补货的 SKU 数（open 状态且 suggested_qty > 0 的去重商品数） */
  restockSkuCount: number;
  /** 建议补货总件数 */
  suggestedQtyTotal: number;
}

export interface EvaluateResult {
  evaluatedAt: string;
  ruleCount: number;
  productCount: number;
  created: number;
  updated: number;
  /** 因商品恢复正常而自动关闭的历史告警数 */
  autoResolved: number;
  bySeverity: { critical: number; warning: number; info: number };
}

export interface AttributionRow {
  id: string;
  employeeId: string;
  employeeName: string;
  sourceType: string;
  sourceId: string;
  period: string;
  roleInSource: string | null;
  attributionRatio: number;
  gmv: number;
  grossProfit: number;
  orderCount: number;
  ticketCount: number;
  computedAt: string;
}

export interface ComputeAttributionResult {
  period: string;
  orderRows: number;
  ticketRows: number;
  skippedOrders: number;
  skippedTickets: number;
  employeeCount: number;
  totalGmv: number;
  totalGrossProfit: number;
  computedAt: string;
}

export interface EmployeeAttribution {
  employeeId: string;
  employeeName: string;
  employeeNo: string;
  departmentName: string | null;
  position: string | null;
  period: string;
  gmv: number;
  grossProfit: number;
  orderCount: number;
  ticketCount: number;
  details: AttributionRow[];
}

export interface RankingItem {
  rank: number;
  employeeId: string;
  employeeName: string;
  employeeNo: string;
  departmentName: string | null;
  position: string | null;
  gmv: number;
  grossProfit: number;
  orderCount: number;
  ticketCount: number;
  /** 毛利率 = grossProfit / gmv */
  marginRate: number;
}

export interface EfficiencySummary {
  period: string;
  totalGmv: number;
  totalGrossProfit: number;
  totalOrderCount: number;
  totalTicketCount: number;
  /** 在职员工数（active + probation） */
  headcount: number;
  /** 本期有归因产出的员工数 */
  contributorCount: number;
  gmvPerCapita: number;
  grossProfitPerCapita: number;
  orderPerCapita: number;
  top3: RankingItem[];
  bottom3: RankingItem[];
}

// ════════════════════════════════════════════════════════════
// 常量
// ════════════════════════════════════════════════════════════

/** 补货建议的安全备货周期（天） */
const SAFETY_STOCK_DAYS = 30;
/** 单次评估扫描的商品上限，避免超大租户拖垮同步查询 */
const MAX_SCAN_PRODUCTS = 5000;
/** 已支付口径（与 cockpitService 对齐） */
const PAID_STATUSES = ['paid', 'partial'];

const RULE_TYPE_LABEL: Record<string, string> = {
  low_stock: '低库存',
  out_of_stock: '断货',
  overstock: '库存积压',
  slow_moving: '滞销',
  stockout_eta: '预计断货',
};

// ════════════════════════════════════════════════════════════
// 工具函数
// ════════════════════════════════════════════════════════════

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toBool(v: unknown): boolean {
  return Number(v) === 1;
}

/** 校验 period 是否为 YYYY-MM */
export function isValidPeriod(period: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(period);
}

/** 当前月份 YYYY-MM */
export function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

/** 安全解析 JSON 数组 */
function parseJsonArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

// ── 数据库原始行类型 ──

interface RuleRow {
  id: string;
  tenant_id: string;
  name: string;
  scope: string;
  scope_value: string | null;
  rule_type: string;
  threshold: number;
  window_days: number;
  severity: string;
  notify_channels: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

interface ProductRow {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  stock: number;
  min_stock: number;
  cost_price: number | null;
  selling_price: number | null;
  status: string;
}

interface OrderItem {
  productId?: string;
  quantity?: number;
  unitPrice?: number;
}

function mapRule(r: RuleRow): InventoryAlertRule {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    name: r.name,
    scope: (r.scope as RuleScope) || 'all',
    scopeValue: r.scope_value,
    ruleType: r.rule_type as RuleType,
    threshold: Number(r.threshold || 0),
    windowDays: Number(r.window_days || 7),
    severity: (r.severity as AlertSeverity) || 'warning',
    notifyChannels: parseJsonArray<string>(r.notify_channels),
    enabled: toBool(r.enabled),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ════════════════════════════════════════════════════════════
// A. 库存预警服务
// ════════════════════════════════════════════════════════════

export class InventoryService {
  // ────────────── 规则 CRUD ──────────────

  /**
   * 租户首次访问时自动创建 3 条常用规则（幂等）。
   * 幂等依据：同租户下已存在同 rule_type 的规则则跳过。
   */
  ensureDefaultRules(tenantId: string): number {
    const db = getDatabase();
    const existing = db
      .prepare('SELECT rule_type FROM inventory_alert_rules WHERE tenant_id = ?')
      .all(tenantId) as Array<{ rule_type: string }>;
    const existingTypes = new Set(existing.map((r) => r.rule_type));

    const defaults: RuleInput[] = [
      {
        name: '低库存预警（≤10 件）',
        scope: 'all',
        ruleType: 'low_stock',
        threshold: 10,
        windowDays: 7,
        severity: 'warning',
      },
      {
        name: '断货预警',
        scope: 'all',
        ruleType: 'out_of_stock',
        threshold: 0,
        windowDays: 7,
        severity: 'critical',
      },
      {
        name: '滞销预警（30 天无销量）',
        scope: 'all',
        ruleType: 'slow_moving',
        threshold: 0,
        windowDays: 30,
        severity: 'info',
      },
    ];

    let created = 0;
    for (const d of defaults) {
      if (existingTypes.has(d.ruleType)) continue;
      this.createRule(tenantId, d);
      created += 1;
    }
    if (created > 0) {
      logger.info('inventory', `租户 ${tenantId} 初始化默认库存预警规则 ${created} 条`);
    }
    return created;
  }

  listRules(tenantId: string): InventoryAlertRule[] {
    const db = getDatabase();
    const rows = db
      .prepare(
        `SELECT * FROM inventory_alert_rules
         WHERE tenant_id = ?
         ORDER BY enabled DESC, created_at ASC`
      )
      .all(tenantId) as RuleRow[];
    return rows.map(mapRule);
  }

  getRule(tenantId: string, id: string): InventoryAlertRule | null {
    const db = getDatabase();
    const row = db
      .prepare('SELECT * FROM inventory_alert_rules WHERE id = ? AND tenant_id = ?')
      .get(id, tenantId) as RuleRow | undefined;
    return row ? mapRule(row) : null;
  }

  createRule(tenantId: string, input: RuleInput): InventoryAlertRule {
    const db = getDatabase();
    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO inventory_alert_rules
         (id, tenant_id, name, scope, scope_value, rule_type, threshold,
          window_days, severity, notify_channels, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      tenantId,
      input.name,
      input.scope || 'all',
      input.scope === 'all' ? null : input.scopeValue ?? null,
      input.ruleType,
      Number(input.threshold ?? 0),
      Number(input.windowDays ?? 7),
      input.severity || 'warning',
      JSON.stringify(input.notifyChannels && input.notifyChannels.length ? input.notifyChannels : ['inapp']),
      input.enabled === false ? 0 : 1,
      now,
      now
    );

    const rule = this.getRule(tenantId, id);
    if (!rule) throw new Error('规则创建失败');
    return rule;
  }

  updateRule(tenantId: string, id: string, input: RuleUpdateInput): InventoryAlertRule {
    const db = getDatabase();
    const existing = this.getRule(tenantId, id);
    if (!existing) throw new Error('规则不存在或无权访问');

    const merged: InventoryAlertRule = {
      ...existing,
      name: input.name ?? existing.name,
      scope: input.scope ?? existing.scope,
      scopeValue: input.scopeValue !== undefined ? input.scopeValue : existing.scopeValue,
      ruleType: input.ruleType ?? existing.ruleType,
      threshold: input.threshold !== undefined ? Number(input.threshold) : existing.threshold,
      windowDays: input.windowDays !== undefined ? Number(input.windowDays) : existing.windowDays,
      severity: input.severity ?? existing.severity,
      notifyChannels: input.notifyChannels ?? existing.notifyChannels,
      enabled: input.enabled !== undefined ? input.enabled : existing.enabled,
    };

    db.prepare(
      `UPDATE inventory_alert_rules
       SET name = ?, scope = ?, scope_value = ?, rule_type = ?, threshold = ?,
           window_days = ?, severity = ?, notify_channels = ?, enabled = ?, updated_at = ?
       WHERE id = ? AND tenant_id = ?`
    ).run(
      merged.name,
      merged.scope,
      merged.scope === 'all' ? null : merged.scopeValue,
      merged.ruleType,
      merged.threshold,
      merged.windowDays,
      merged.severity,
      JSON.stringify(merged.notifyChannels),
      merged.enabled ? 1 : 0,
      new Date().toISOString(),
      id,
      tenantId
    );

    const rule = this.getRule(tenantId, id);
    if (!rule) throw new Error('规则更新失败');
    return rule;
  }

  /** 删除规则，同时清理其名下未处理的告警，避免出现孤儿告警 */
  deleteRule(tenantId: string, id: string): { id: string } {
    const db = getDatabase();
    const existing = this.getRule(tenantId, id);
    if (!existing) throw new Error('规则不存在或无权访问');

    db.prepare(
      `DELETE FROM inventory_alerts
       WHERE tenant_id = ? AND rule_id = ? AND status IN ('open', 'acknowledged')`
    ).run(tenantId, id);
    db.prepare('DELETE FROM inventory_alert_rules WHERE id = ? AND tenant_id = ?').run(id, tenantId);
    return { id };
  }

  /** 启停规则；不传 enabled 时取反 */
  toggleRule(tenantId: string, id: string, enabled?: boolean): InventoryAlertRule {
    const existing = this.getRule(tenantId, id);
    if (!existing) throw new Error('规则不存在或无权访问');
    const next = enabled !== undefined ? enabled : !existing.enabled;
    return this.updateRule(tenantId, id, { enabled: next });
  }

  // ────────────── 规则评估引擎 ──────────────

  /**
   * 遍历租户下所有启用规则，扫描商品，命中即写入 inventory_alerts。
   * 同一 (rule_id, product_id) 已存在 open 告警时执行更新而非重复插入。
   */
  evaluateRules(tenantId: string): EvaluateResult {
    const db = getDatabase();
    const now = new Date().toISOString();

    // 首次评估自动补齐默认规则，保证新租户开箱即用
    this.ensureDefaultRules(tenantId);

    const rules = this.listRules(tenantId).filter((r) => r.enabled);
    const products = db
      .prepare(
        `SELECT id, sku, name, category, stock, min_stock, cost_price, selling_price, status
         FROM products
         WHERE tenant_id = ? AND status != 'discontinued'
         ORDER BY stock ASC
         LIMIT ?`
      )
      .all(tenantId, MAX_SCAN_PRODUCTS) as ProductRow[];

    const result: EvaluateResult = {
      evaluatedAt: now,
      ruleCount: rules.length,
      productCount: products.length,
      created: 0,
      updated: 0,
      autoResolved: 0,
      bySeverity: { critical: 0, warning: 0, info: 0 },
    };
    if (rules.length === 0 || products.length === 0) return result;

    // 按规则用到的 window_days 预先聚合销量，避免逐商品反复扫订单
    const windowDaysSet = new Set<number>(rules.map((r) => Math.max(1, r.windowDays || 7)));
    const salesByWindow = new Map<number, Map<string, number>>();
    for (const wd of windowDaysSet) {
      salesByWindow.set(wd, this.aggregateSales(tenantId, wd));
    }

    // 记录本轮命中的 (ruleId|productId)，用于自动关闭已恢复的历史告警
    const hitKeys = new Set<string>();

    for (const rule of rules) {
      const wd = Math.max(1, rule.windowDays || 7);
      const salesMap = salesByWindow.get(wd) || new Map<string, number>();

      for (const p of products) {
        if (!this.matchScope(rule, p)) continue;

        const stock = Number(p.stock || 0);
        const soldQty = Number(salesMap.get(p.id) || 0);
        const dailyAvg = round2(soldQty / wd);
        const daysOfSupply = dailyAvg > 0 ? round2(stock / dailyAvg) : null;

        const hit = this.checkRuleHit(rule, stock, soldQty, dailyAvg, daysOfSupply);
        if (!hit) continue;

        const suggestedQty = this.calcSuggestedQty(rule, p, stock, dailyAvg);
        const message = this.buildMessage(rule, p, stock, dailyAvg, daysOfSupply, suggestedQty);

        hitKeys.add(`${rule.id}|${p.id}`);
        const upserted = this.upsertAlert({
          tenantId,
          rule,
          productId: p.id,
          stock,
          dailyAvg,
          daysOfSupply,
          suggestedQty,
          message,
          now,
        });
        if (upserted === 'created') result.created += 1;
        else result.updated += 1;
        result.bySeverity[rule.severity] += 1;

        // DC-06: 创建新告警时主动推送通知给租户管理员
        if (upserted === 'created' && rule.severity !== 'info') {
          const adminUsers = db.prepare(
            `SELECT id, display_name FROM users
             WHERE tenant_id = ? AND role IN ('owner', 'admin', 'manager')`
          ).all(tenantId) as Array<{ id: string; display_name: string }>;
          for (const admin of adminUsers) {
            db.prepare(
              `INSERT INTO notifications
               (id, tenant_id, user_id, title, content, type, resource_type, resource_id, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(
              uuidv4(), tenantId, admin.id,
              `[${rule.severity === 'critical' ? '紧急' : '提醒'}] 库存预警: ${p.name}`,
              message,
              rule.severity === 'critical' ? 'error' : 'warning',
              'inventory_alert',
              null,
              now
            );
          }
        }
      }
    }

    // 自动关闭：本轮未命中但仍处于 open 的告警 → 视为已恢复
    const openAlerts = db
      .prepare(
        `SELECT id, rule_id, product_id FROM inventory_alerts
         WHERE tenant_id = ? AND status = 'open'`
      )
      .all(tenantId) as Array<{ id: string; rule_id: string | null; product_id: string }>;
    for (const a of openAlerts) {
      if (!a.rule_id) continue;
      if (hitKeys.has(`${a.rule_id}|${a.product_id}`)) continue;
      // 规则被停用/删除的情况不动，仅处理仍启用规则下已恢复正常的商品
      if (!rules.some((r) => r.id === a.rule_id)) continue;
      db.prepare(
        `UPDATE inventory_alerts SET status = 'resolved', resolved_at = ?
         WHERE id = ? AND tenant_id = ?`
      ).run(now, a.id, tenantId);
      result.autoResolved += 1;
    }

    logger.info(
      'inventory',
      `租户 ${tenantId} 库存评估完成：规则 ${result.ruleCount} 条 / 商品 ${result.productCount} 个 / 新增 ${result.created} / 更新 ${result.updated} / 自动关闭 ${result.autoResolved}`
    );
    return result;
  }

  /** 统计 windowDays 天内每个商品的销量（解析 orders.items JSON） */
  private aggregateSales(tenantId: string, windowDays: number): Map<string, number> {
    const db = getDatabase();
    const map = new Map<string, number>();
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

    const orders = db
      .prepare(
        `SELECT items FROM orders
         WHERE tenant_id = ?
           AND created_at >= ?
           AND order_status NOT IN ('cancelled', 'returned', 'refunded')`
      )
      .all(tenantId, since) as Array<{ items: string }>;

    for (const o of orders) {
      const items = parseJsonArray<OrderItem>(o.items);
      for (const it of items) {
        if (!it.productId) continue;
        const qty = Number(it.quantity || 0);
        if (qty <= 0) continue;
        map.set(it.productId, (map.get(it.productId) || 0) + qty);
      }
    }
    return map;
  }

  /** 判断商品是否落在规则作用域内 */
  private matchScope(rule: InventoryAlertRule, p: ProductRow): boolean {
    if (rule.scope === 'all') return true;
    if (!rule.scopeValue) return false;
    if (rule.scope === 'category') return (p.category || '') === rule.scopeValue;
    if (rule.scope === 'product') return p.id === rule.scopeValue || p.sku === rule.scopeValue;
    return false;
  }

  /** 按规则类型判定是否命中 */
  private checkRuleHit(
    rule: InventoryAlertRule,
    stock: number,
    soldQty: number,
    dailyAvg: number,
    daysOfSupply: number | null
  ): boolean {
    switch (rule.ruleType) {
      case 'low_stock':
        // 低于阈值即告警；断货交由 out_of_stock 规则处理，此处仍纳入以免漏报
        return stock <= rule.threshold;
      case 'out_of_stock':
        return stock <= 0;
      case 'overstock':
        return stock >= rule.threshold && rule.threshold > 0;
      case 'slow_moving':
        // 窗口期内零销量且仍有库存占用
        return soldQty === 0 && stock > 0;
      case 'stockout_eta':
        // 有销量才能预测断货时点；可售天数低于阈值即告警
        return dailyAvg > 0 && daysOfSupply !== null && daysOfSupply < rule.threshold;
      default:
        return false;
    }
  }

  /**
   * 补货建议 = 日均销量 × 安全周期 − 当前库存，向上取整，最小 0。
   * 积压类规则不建议补货，恒为 0。
   * 无历史销量时（如新品断货）回落到 max(规则阈值, 商品安全库存 min_stock) 作为基线。
   */
  private calcSuggestedQty(
    rule: InventoryAlertRule,
    p: ProductRow,
    stock: number,
    dailyAvg: number
  ): number {
    if (rule.ruleType === 'overstock' || rule.ruleType === 'slow_moving') return 0;
    const baseline =
      dailyAvg > 0
        ? dailyAvg * SAFETY_STOCK_DAYS
        : Math.max(rule.threshold, Number(p.min_stock || 0), 0);
    return Math.max(0, Math.ceil(baseline - stock));
  }

  /** 生成中文告警文案 */
  private buildMessage(
    rule: InventoryAlertRule,
    p: ProductRow,
    stock: number,
    dailyAvg: number,
    daysOfSupply: number | null,
    suggestedQty: number
  ): string {
    const label = RULE_TYPE_LABEL[rule.ruleType] || rule.ruleType;
    const head = `【${label}】${p.sku} · ${p.name}`;
    switch (rule.ruleType) {
      case 'low_stock':
        return `${head}：当前库存 ${stock} 件，已低于阈值 ${rule.threshold} 件，建议补货 ${suggestedQty} 件。`;
      case 'out_of_stock':
        return suggestedQty > 0
          ? `${head}：库存已清零，请立即补货 ${suggestedQty} 件以免持续断售。`
          : `${head}：库存已清零，请尽快补货（该商品暂无历史销量与安全库存基线，无法给出建议数量）。`;
      case 'overstock':
        return `${head}：当前库存 ${stock} 件，超过积压阈值 ${rule.threshold} 件，建议促销去化。`;
      case 'slow_moving':
        return `${head}：近 ${rule.windowDays} 天零销量，仍积压 ${stock} 件，建议清仓或下架。`;
      case 'stockout_eta':
        return `${head}：日均销量 ${dailyAvg} 件，预计 ${daysOfSupply ?? 0} 天后断货（阈值 ${rule.threshold} 天），建议补货 ${suggestedQty} 件。`;
      default:
        return `${head}：命中规则「${rule.name}」，当前库存 ${stock} 件。`;
    }
  }

  /** 同 (rule, product) 已有未闭环告警则更新，否则插入 */
  private upsertAlert(args: {
    tenantId: string;
    rule: InventoryAlertRule;
    productId: string;
    stock: number;
    dailyAvg: number;
    daysOfSupply: number | null;
    suggestedQty: number;
    message: string;
    now: string;
  }): 'created' | 'updated' {
    const db = getDatabase();
    const { tenantId, rule, productId } = args;

    const existing = db
      .prepare(
        `SELECT id FROM inventory_alerts
         WHERE tenant_id = ? AND rule_id = ? AND product_id = ?
           AND status IN ('open', 'acknowledged')
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(tenantId, rule.id, productId) as { id: string } | undefined;

    if (existing) {
      db.prepare(
        `UPDATE inventory_alerts
         SET severity = ?, current_stock = ?, threshold = ?, daily_sales_avg = ?,
             days_of_supply = ?, suggested_qty = ?, message = ?
         WHERE id = ? AND tenant_id = ?`
      ).run(
        rule.severity,
        args.stock,
        rule.threshold,
        args.dailyAvg,
        args.daysOfSupply,
        args.suggestedQty,
        args.message,
        existing.id,
        tenantId
      );
      return 'updated';
    }

    db.prepare(
      `INSERT INTO inventory_alerts
         (id, tenant_id, rule_id, product_id, alert_type, severity, current_stock, threshold,
          daily_sales_avg, days_of_supply, suggested_qty, message, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`
    ).run(
      uuidv4(),
      tenantId,
      rule.id,
      productId,
      rule.ruleType,
      rule.severity,
      args.stock,
      rule.threshold,
      args.dailyAvg,
      args.daysOfSupply,
      args.suggestedQty,
      args.message,
      args.now
    );
    return 'created';
  }

  // ────────────── 告警管理 ──────────────

  listAlerts(tenantId: string, filter: AlertListFilter = {}): AlertListResult {
    const db = getDatabase();
    const page = Math.max(1, Number(filter.page || 1));
    const limit = Math.min(200, Math.max(1, Number(filter.limit || 20)));
    const offset = (page - 1) * limit;

    const where: string[] = ['a.tenant_id = ?'];
    const params: unknown[] = [tenantId];
    if (filter.status) {
      where.push('a.status = ?');
      params.push(filter.status);
    }
    if (filter.severity) {
      where.push('a.severity = ?');
      params.push(filter.severity);
    }
    if (filter.productId) {
      where.push('a.product_id = ?');
      params.push(filter.productId);
    }
    if (filter.alertType) {
      where.push('a.alert_type = ?');
      params.push(filter.alertType);
    }
    const whereSql = where.join(' AND ');

    const totalRow = db
      .prepare(`SELECT COUNT(*) AS cnt FROM inventory_alerts a WHERE ${whereSql}`)
      .get(...params) as { cnt: number };
    const total = Number(totalRow.cnt || 0);

    const rows = db
      .prepare(
        `SELECT a.*, p.sku AS product_sku, p.name AS product_name, p.category AS product_category,
                r.name AS rule_name
         FROM inventory_alerts a
         LEFT JOIN products p ON p.id = a.product_id AND p.tenant_id = a.tenant_id
         LEFT JOIN inventory_alert_rules r ON r.id = a.rule_id AND r.tenant_id = a.tenant_id
         WHERE ${whereSql}
         ORDER BY
           CASE a.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
           CASE a.status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END,
           a.created_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as Array<Record<string, unknown>>;

    return {
      items: rows.map((r) => this.mapAlert(r)),
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  private mapAlert(r: Record<string, unknown>): InventoryAlert {
    return {
      id: String(r.id),
      tenantId: String(r.tenant_id),
      ruleId: (r.rule_id as string) ?? null,
      ruleName: (r.rule_name as string) ?? null,
      productId: String(r.product_id),
      productSku: (r.product_sku as string) ?? null,
      productName: (r.product_name as string) ?? null,
      productCategory: (r.product_category as string) ?? null,
      alertType: String(r.alert_type),
      severity: (r.severity as AlertSeverity) || 'warning',
      currentStock: Number(r.current_stock || 0),
      threshold: Number(r.threshold || 0),
      dailySalesAvg: Number(r.daily_sales_avg || 0),
      daysOfSupply: r.days_of_supply === null || r.days_of_supply === undefined ? null : Number(r.days_of_supply),
      suggestedQty: Number(r.suggested_qty || 0),
      message: (r.message as string) || '',
      status: (r.status as AlertStatus) || 'open',
      acknowledgedBy: (r.acknowledged_by as string) ?? null,
      resolvedAt: (r.resolved_at as string) ?? null,
      createdAt: String(r.created_at || ''),
    };
  }

  getAlertStats(tenantId: string): AlertStats {
    const db = getDatabase();

    const sevRows = db
      .prepare(
        `SELECT severity, COUNT(*) AS cnt FROM inventory_alerts
         WHERE tenant_id = ? AND status IN ('open', 'acknowledged')
         GROUP BY severity`
      )
      .all(tenantId) as Array<{ severity: string; cnt: number }>;

    const statusRows = db
      .prepare(
        `SELECT status, COUNT(*) AS cnt FROM inventory_alerts
         WHERE tenant_id = ? GROUP BY status`
      )
      .all(tenantId) as Array<{ status: string; cnt: number }>;

    const restockRow = db
      .prepare(
        `SELECT COUNT(DISTINCT product_id) AS sku_cnt, COALESCE(SUM(suggested_qty), 0) AS qty_sum
         FROM inventory_alerts
         WHERE tenant_id = ? AND status IN ('open', 'acknowledged') AND suggested_qty > 0`
      )
      .get(tenantId) as { sku_cnt: number; qty_sum: number };

    const bySeverity = { critical: 0, warning: 0, info: 0 };
    for (const r of sevRows) {
      if (r.severity === 'critical' || r.severity === 'warning' || r.severity === 'info') {
        bySeverity[r.severity] = Number(r.cnt || 0);
      }
    }

    const byStatus = { open: 0, acknowledged: 0, resolved: 0, ignored: 0 };
    let total = 0;
    for (const r of statusRows) {
      const cnt = Number(r.cnt || 0);
      total += cnt;
      if (r.status === 'open' || r.status === 'acknowledged' || r.status === 'resolved' || r.status === 'ignored') {
        byStatus[r.status] = cnt;
      }
    }

    return {
      total,
      bySeverity,
      byStatus,
      pending: byStatus.open + byStatus.acknowledged,
      restockSkuCount: Number(restockRow?.sku_cnt || 0),
      suggestedQtyTotal: Number(restockRow?.qty_sum || 0),
    };
  }

  acknowledgeAlert(tenantId: string, alertId: string, userId: string): InventoryAlert {
    return this.transitAlert(tenantId, alertId, 'acknowledged', userId);
  }

  resolveAlert(tenantId: string, alertId: string, userId: string): InventoryAlert {
    return this.transitAlert(tenantId, alertId, 'resolved', userId);
  }

  ignoreAlert(tenantId: string, alertId: string, userId: string): InventoryAlert {
    return this.transitAlert(tenantId, alertId, 'ignored', userId);
  }

  private transitAlert(
    tenantId: string,
    alertId: string,
    status: AlertStatus,
    userId: string
  ): InventoryAlert {
    const db = getDatabase();
    const existing = db
      .prepare('SELECT id FROM inventory_alerts WHERE id = ? AND tenant_id = ?')
      .get(alertId, tenantId) as { id: string } | undefined;
    if (!existing) throw new Error('告警不存在或无权访问');

    const resolvedAt = status === 'resolved' || status === 'ignored' ? new Date().toISOString() : null;
    db.prepare(
      `UPDATE inventory_alerts SET status = ?, acknowledged_by = ?, resolved_at = ?
       WHERE id = ? AND tenant_id = ?`
    ).run(status, userId, resolvedAt, alertId, tenantId);

    const row = db
      .prepare(
        `SELECT a.*, p.sku AS product_sku, p.name AS product_name, p.category AS product_category,
                r.name AS rule_name
         FROM inventory_alerts a
         LEFT JOIN products p ON p.id = a.product_id AND p.tenant_id = a.tenant_id
         LEFT JOIN inventory_alert_rules r ON r.id = a.rule_id AND r.tenant_id = a.tenant_id
         WHERE a.id = ? AND a.tenant_id = ?`
      )
      .get(alertId, tenantId) as Record<string, unknown> | undefined;
    if (!row) throw new Error('告警状态更新失败');
    return this.mapAlert(row);
  }
}

// ════════════════════════════════════════════════════════════
// B. 业务-HR 归因服务
// ════════════════════════════════════════════════════════════

export class AttributionService {
  /**
   * 计算指定月份的员工归因数据并落库（UPSERT）。
   * - 订单归因：orders.owner_employee_id 非空的已支付订单
   * - 工单归因：service_tickets.assigned_to（users.id）→ employees.user_id
   */
  computeAttributions(tenantId: string, period: string): ComputeAttributionResult {
    if (!isValidPeriod(period)) throw new Error('period 格式非法，应为 YYYY-MM');
    const db = getDatabase();
    const now = new Date().toISOString();

    // 本租户有效员工 id 集合，用于校验外键有效性
    const employeeIds = new Set(
      (db.prepare('SELECT id FROM employees WHERE tenant_id = ?').all(tenantId) as Array<{ id: string }>).map(
        (e) => e.id
      )
    );

    // ── 1. 订单归因 ──
    const orders = db
      .prepare(
        `SELECT id, items, paid_amount, total_amount, owner_employee_id
         FROM orders
         WHERE tenant_id = ?
           AND substr(created_at, 1, 7) = ?
           AND owner_employee_id IS NOT NULL
           AND owner_employee_id != ''
           AND payment_status IN (${PAID_STATUSES.map(() => '?').join(',')})`
      )
      .all(tenantId, period, ...PAID_STATUSES) as Array<{
      id: string;
      items: string;
      paid_amount: number;
      total_amount: number;
      owner_employee_id: string;
    }>;

    // 成本查询缓存，避免同一商品重复查库
    const costCache = new Map<string, number>();
    const getCostPrice = (productId: string): number => {
      if (costCache.has(productId)) return costCache.get(productId) as number;
      const row = db
        .prepare('SELECT cost_price FROM products WHERE id = ? AND tenant_id = ?')
        .get(productId, tenantId) as { cost_price: number | null } | undefined;
      const cost = Number(row?.cost_price || 0);
      costCache.set(productId, cost);
      return cost;
    };

    let orderRows = 0;
    let skippedOrders = 0;
    let totalGmv = 0;
    let totalGrossProfit = 0;
    const touchedEmployees = new Set<string>();

    for (const o of orders) {
      if (!employeeIds.has(o.owner_employee_id)) {
        skippedOrders += 1;
        logger.warn('attribution', `订单 ${o.id} 的负责人 ${o.owner_employee_id} 不在员工表中，已跳过`);
        continue;
      }

      // 口径与 cockpitService 完全一致
      const revenue = Number(o.paid_amount || 0) > 0 ? Number(o.paid_amount) : Number(o.total_amount || 0);
      let cost = 0;
      for (const it of parseJsonArray<OrderItem>(o.items)) {
        if (!it.productId || !it.quantity) continue;
        cost += getCostPrice(it.productId) * Number(it.quantity || 0);
      }
      const grossProfit = revenue - cost;

      this.upsertAttribution({
        tenantId,
        employeeId: o.owner_employee_id,
        sourceType: 'order',
        sourceId: o.id,
        period,
        roleInSource: 'owner',
        gmv: round2(revenue),
        grossProfit: round2(grossProfit),
        orderCount: 1,
        ticketCount: 0,
        computedAt: now,
      });
      orderRows += 1;
      totalGmv += revenue;
      totalGrossProfit += grossProfit;
      touchedEmployees.add(o.owner_employee_id);
    }

    // ── 2. 工单归因（assigned_to 是 users.id，需经 employees.user_id 映射） ──
    const tickets = db
      .prepare(
        `SELECT t.id, t.assigned_to, e.id AS employee_id
         FROM service_tickets t
         LEFT JOIN employees e ON e.user_id = t.assigned_to AND e.tenant_id = t.tenant_id
         WHERE t.tenant_id = ?
           AND substr(t.created_at, 1, 7) = ?
           AND t.assigned_to IS NOT NULL
           AND t.assigned_to != ''`
      )
      .all(tenantId, period) as Array<{ id: string; assigned_to: string; employee_id: string | null }>;

    let ticketRows = 0;
    let skippedTickets = 0;
    for (const t of tickets) {
      if (!t.employee_id) {
        skippedTickets += 1;
        logger.warn('attribution', `工单 ${t.id} 的处理人 ${t.assigned_to} 未关联员工档案，已跳过`);
        continue;
      }
      this.upsertAttribution({
        tenantId,
        employeeId: t.employee_id,
        sourceType: 'ticket',
        sourceId: t.id,
        period,
        roleInSource: 'assignee',
        gmv: 0,
        grossProfit: 0,
        orderCount: 0,
        ticketCount: 1,
        computedAt: now,
      });
      ticketRows += 1;
      touchedEmployees.add(t.employee_id);
    }

    logger.info(
      'attribution',
      `租户 ${tenantId} ${period} 归因完成：订单 ${orderRows} 条 / 工单 ${ticketRows} 条 / 跳过 ${skippedOrders + skippedTickets} 条`
    );

    return {
      period,
      orderRows,
      ticketRows,
      skippedOrders,
      skippedTickets,
      employeeCount: touchedEmployees.size,
      totalGmv: round2(totalGmv),
      totalGrossProfit: round2(totalGrossProfit),
      computedAt: now,
    };
  }

  /** UNIQUE(tenant_id, employee_id, source_type, source_id) 冲突时更新 */
  private upsertAttribution(args: {
    tenantId: string;
    employeeId: string;
    sourceType: string;
    sourceId: string;
    period: string;
    roleInSource: string;
    gmv: number;
    grossProfit: number;
    orderCount: number;
    ticketCount: number;
    computedAt: string;
  }): void {
    const db = getDatabase();
    db.prepare(
      `INSERT INTO performance_attributions
         (id, tenant_id, employee_id, source_type, source_id, period, role_in_source,
          attribution_ratio, gmv, gross_profit, order_count, ticket_count, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1.0, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, employee_id, source_type, source_id) DO UPDATE SET
         period = excluded.period,
         role_in_source = excluded.role_in_source,
         gmv = excluded.gmv,
         gross_profit = excluded.gross_profit,
         order_count = excluded.order_count,
         ticket_count = excluded.ticket_count,
         computed_at = excluded.computed_at`
    ).run(
      uuidv4(),
      args.tenantId,
      args.employeeId,
      args.sourceType,
      args.sourceId,
      args.period,
      args.roleInSource,
      args.gmv,
      args.grossProfit,
      args.orderCount,
      args.ticketCount,
      args.computedAt
    );
  }

  /** 单员工归因明细 */
  getEmployeeAttribution(tenantId: string, employeeId: string, period: string): EmployeeAttribution {
    if (!isValidPeriod(period)) throw new Error('period 格式非法，应为 YYYY-MM');
    const db = getDatabase();

    const emp = db
      .prepare(
        `SELECT e.id, e.name, e.employee_no, e.position, d.name AS department_name
         FROM employees e
         LEFT JOIN departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
         WHERE e.id = ? AND e.tenant_id = ?`
      )
      .get(employeeId, tenantId) as
      | { id: string; name: string; employee_no: string; position: string | null; department_name: string | null }
      | undefined;
    if (!emp) throw new Error('员工不存在或无权访问');

    const rows = db
      .prepare(
        `SELECT * FROM performance_attributions
         WHERE tenant_id = ? AND employee_id = ? AND period = ?
         ORDER BY gmv DESC, computed_at DESC`
      )
      .all(tenantId, employeeId, period) as Array<Record<string, unknown>>;

    let gmv = 0;
    let grossProfit = 0;
    let orderCount = 0;
    let ticketCount = 0;
    const details: AttributionRow[] = rows.map((r) => {
      gmv += Number(r.gmv || 0);
      grossProfit += Number(r.gross_profit || 0);
      orderCount += Number(r.order_count || 0);
      ticketCount += Number(r.ticket_count || 0);
      return {
        id: String(r.id),
        employeeId: String(r.employee_id),
        employeeName: emp.name,
        sourceType: String(r.source_type),
        sourceId: String(r.source_id),
        period: String(r.period),
        roleInSource: (r.role_in_source as string) ?? null,
        attributionRatio: Number(r.attribution_ratio || 1),
        gmv: Number(r.gmv || 0),
        grossProfit: Number(r.gross_profit || 0),
        orderCount: Number(r.order_count || 0),
        ticketCount: Number(r.ticket_count || 0),
        computedAt: String(r.computed_at || ''),
      };
    });

    return {
      employeeId: emp.id,
      employeeName: emp.name,
      employeeNo: emp.employee_no,
      departmentName: emp.department_name,
      position: emp.position,
      period,
      gmv: round2(gmv),
      grossProfit: round2(grossProfit),
      orderCount,
      ticketCount,
      details,
    };
  }

  /** 员工 GMV / 毛利排行榜（带部门名） */
  getAttributionRanking(tenantId: string, period: string, limit = 10): RankingItem[] {
    if (!isValidPeriod(period)) throw new Error('period 格式非法，应为 YYYY-MM');
    const db = getDatabase();
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 10));

    const rows = db
      .prepare(
        `SELECT a.employee_id,
                e.name AS employee_name,
                e.employee_no,
                e.position,
                d.name AS department_name,
                COALESCE(SUM(a.gmv), 0) AS gmv,
                COALESCE(SUM(a.gross_profit), 0) AS gross_profit,
                COALESCE(SUM(a.order_count), 0) AS order_count,
                COALESCE(SUM(a.ticket_count), 0) AS ticket_count
         FROM performance_attributions a
         JOIN employees e ON e.id = a.employee_id AND e.tenant_id = a.tenant_id
         LEFT JOIN departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
         WHERE a.tenant_id = ? AND a.period = ?
         GROUP BY a.employee_id, e.name, e.employee_no, e.position, d.name
         ORDER BY gmv DESC, gross_profit DESC
         LIMIT ?`
      )
      .all(tenantId, period, safeLimit) as Array<{
      employee_id: string;
      employee_name: string;
      employee_no: string;
      position: string | null;
      department_name: string | null;
      gmv: number;
      gross_profit: number;
      order_count: number;
      ticket_count: number;
    }>;

    return rows.map((r, idx) => {
      const gmv = round2(Number(r.gmv || 0));
      const grossProfit = round2(Number(r.gross_profit || 0));
      return {
        rank: idx + 1,
        employeeId: r.employee_id,
        employeeName: r.employee_name,
        employeeNo: r.employee_no,
        departmentName: r.department_name,
        position: r.position,
        gmv,
        grossProfit,
        orderCount: Number(r.order_count || 0),
        ticketCount: Number(r.ticket_count || 0),
        marginRate: gmv > 0 ? round2(grossProfit / gmv) : 0,
      };
    });
  }

  /**
   * 人效汇总 —— 打通业务与 HR 的核心产出。
   * bottom3 从「全体在职员工」中取（含零产出员工），否则会漏掉最该关注的人。
   */
  getEfficiencySummary(tenantId: string, period: string): EfficiencySummary {
    if (!isValidPeriod(period)) throw new Error('period 格式非法，应为 YYYY-MM');
    const db = getDatabase();

    const totalRow = db
      .prepare(
        `SELECT COALESCE(SUM(gmv), 0) AS gmv,
                COALESCE(SUM(gross_profit), 0) AS gross_profit,
                COALESCE(SUM(order_count), 0) AS order_count,
                COALESCE(SUM(ticket_count), 0) AS ticket_count,
                COUNT(DISTINCT employee_id) AS contributor_cnt
         FROM performance_attributions
         WHERE tenant_id = ? AND period = ?`
      )
      .get(tenantId, period) as {
      gmv: number;
      gross_profit: number;
      order_count: number;
      ticket_count: number;
      contributor_cnt: number;
    };

    const headcountRow = db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM employees
         WHERE tenant_id = ? AND status IN ('active', 'probation')`
      )
      .get(tenantId) as { cnt: number };

    // 全体在职员工 LEFT JOIN 归因，零产出员工也纳入排序
    const allRows = db
      .prepare(
        `SELECT e.id AS employee_id,
                e.name AS employee_name,
                e.employee_no,
                e.position,
                d.name AS department_name,
                COALESCE(SUM(a.gmv), 0) AS gmv,
                COALESCE(SUM(a.gross_profit), 0) AS gross_profit,
                COALESCE(SUM(a.order_count), 0) AS order_count,
                COALESCE(SUM(a.ticket_count), 0) AS ticket_count
         FROM employees e
         LEFT JOIN departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
         LEFT JOIN performance_attributions a
                ON a.employee_id = e.id AND a.tenant_id = e.tenant_id AND a.period = ?
         WHERE e.tenant_id = ? AND e.status IN ('active', 'probation')
         GROUP BY e.id, e.name, e.employee_no, e.position, d.name
         ORDER BY gmv DESC, gross_profit DESC`
      )
      .all(period, tenantId) as Array<{
      employee_id: string;
      employee_name: string;
      employee_no: string;
      position: string | null;
      department_name: string | null;
      gmv: number;
      gross_profit: number;
      order_count: number;
      ticket_count: number;
    }>;

    const ranked: RankingItem[] = allRows.map((r, idx) => {
      const gmv = round2(Number(r.gmv || 0));
      const grossProfit = round2(Number(r.gross_profit || 0));
      return {
        rank: idx + 1,
        employeeId: r.employee_id,
        employeeName: r.employee_name,
        employeeNo: r.employee_no,
        departmentName: r.department_name,
        position: r.position,
        gmv,
        grossProfit,
        orderCount: Number(r.order_count || 0),
        ticketCount: Number(r.ticket_count || 0),
        marginRate: gmv > 0 ? round2(grossProfit / gmv) : 0,
      };
    });

    const headcount = Number(headcountRow?.cnt || 0);
    const totalGmv = round2(Number(totalRow?.gmv || 0));
    const totalGrossProfit = round2(Number(totalRow?.gross_profit || 0));
    const totalOrderCount = Number(totalRow?.order_count || 0);

    // bottom3：倒序取尾部 3 人，并保持从低到高展示
    const bottom3 = ranked.length > 3 ? ranked.slice(-3).reverse() : [];

    return {
      period,
      totalGmv,
      totalGrossProfit,
      totalOrderCount,
      totalTicketCount: Number(totalRow?.ticket_count || 0),
      headcount,
      contributorCount: Number(totalRow?.contributor_cnt || 0),
      gmvPerCapita: headcount > 0 ? round2(totalGmv / headcount) : 0,
      grossProfitPerCapita: headcount > 0 ? round2(totalGrossProfit / headcount) : 0,
      orderPerCapita: headcount > 0 ? round2(totalOrderCount / headcount) : 0,
      top3: ranked.slice(0, 3),
      bottom3,
    };
  }
}

// ════════════════════════════════════════════════════════════
// 单例导出
// ════════════════════════════════════════════════════════════

export const inventoryService = new InventoryService();
export const attributionService = new AttributionService();
