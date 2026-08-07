/**
 * 漏斗阶段共享常量与时间过滤 — DA-11/DA-12 统一
 *
 * 用途：
 *   1. 定义各阶段应包含的 status 集合（避免 analytics/cockpit 双副本漂移）
 *   2. buildDateClause：统一的 SQL 日期过滤（闭区间、含 created_at range）
 *
 * 设计原则：漏斗各阶段统计"该阶段中处于活跃/在途状态的资源"，
 *   已完成（completed）、已过期（expired）、已停售（out_of_stock）不计入。
 */

// ── 1. 漏斗各阶段应包含的 status ─────────────────────────────

export const FUNNEL_STATUS = {
  /** 立项：planning + approved + in_progress + paused（不含 completed / cancelled） */
  project: ['planning', 'approved', 'in_progress', 'paused'],
  /** 选品：candidate + selected + listed（不含 out_of_stock / discontinued） */
  product: ['candidate', 'selected', 'listed'],
  /** 组盘：active（不含 draft / expired） */
  bundle: ['active'],
} as const;

// ── 2. 漏斗时间过滤：统一的闭区间 WHERE 子句 ───────────────────
//    所有漏斗阶段（含 orders）统一使用此函数生成日期过滤条件

/**
 * 构建漏斗 SQL 时间过滤子句。
 * 使用 `created_at >= ? AND created_at < nextDay` 的 range 查询（优于 substr）
 * 返回 SQL 片段和参数。
 *
 * @param from 区间起始日期 YYYY-MM-DD（含）
 * @param to   区间结束日期 YYYY-MM-DD（含）
 * @returns [sql, params]
 */
export function buildFunnelDateClause(from: string, to: string): [string, [string, string]] {
  // to 含尾日：使用 substr 确保 YYYY-MM-DD 尾日全部命中
  // 注：analyticsService 历史使用 substr(created_at,1,10) 做闭区间，此处保持一致
  return [
    'substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?',
    [from, to],
  ];
}

/**
 * 获取表名的 created_at 字段字符串（供 SQL 拼接）。
 * 当前所有漏斗相关表均使用 `created_at`。
 */
export function funnelDateColumn(_tableName: string): string {
  return 'created_at';
}

// ── 3. 漏斗阶段元信息（前端展示用） ────────────────────────────

export const FUNNEL_STAGES = [
  { id: 'project', label: '立项', desc: '处于活跃状态的立项项目数' },
  { id: 'select', label: '选品', desc: '已入池的候选/已选/上架商品数' },
  { id: 'bundle', label: '组盘', desc: '活跃组盘方案数' },
  { id: 'order', label: '下单', desc: '已支付订单数（排除沙箱）' },
  { id: 'paid', label: '支付', desc: '已全额/部分支付订单数' },
  { id: 'repurchase', label: '复购', desc: '同一客户第 2 笔及以后的已支付订单数' },
] as const;
