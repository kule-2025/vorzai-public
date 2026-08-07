/**
 * 订单口径计算工具 — 全系统唯一 GMV/营收口径来源
 *
 * 原则：
 *   - paid_amount > 0 → 用 paid_amount（优先）
 *   - paid_amount = 0 且 total_amount > 0 → 用 total_amount（兜底，含未付订单）
 *   - 全部为 0 → 返回 0
 *
 * 此模块被 analyticsService / cockpitService / hrService 共用，避免口径漂移。
 */

export interface OrderRow {
  id: string;
  paid_amount?: number | null;
  total_amount?: number | null;
  payment_status: string;
  order_status: string;
  is_sandbox?: number;
}

/** 单笔订单营收金额（口径：paid_amount>0则取paid，否则取total） */
export function revenueOf(o: OrderRow): number {
  const paid = Number(o.paid_amount ?? 0);
  return paid > 0 ? paid : Number(o.total_amount ?? 0);
}

/** 是否计入营收（用于 GMV 类聚合，含已付/部分付，不含退款） */
export function countsTowardRevenue(o: OrderRow): boolean {
  return ['paid', 'partial'].includes(o.payment_status);
}

/** 是否算作"已支付"（用于转化率、人效分母） */
export function isPaid(o: OrderRow): boolean {
  return o.payment_status === 'paid' || o.payment_status === 'partial';
}

/** 是否退款（用于退款率） */
export function isRefunded(o: OrderRow): boolean {
  return (
    o.payment_status === 'refunded' ||
    o.order_status === 'refunded' ||
    o.order_status === 'returned'
  );
}

/** 区间营收聚合（批量，O(N) 单次遍历） */
export function aggregateRevenue(orders: OrderRow[]): {
  revenue: number;
  paidCount: number;
  refundedCount: number;
  totalCount: number;
} {
  let revenue = 0;
  let paidCount = 0;
  let refundedCount = 0;
  for (const o of orders) {
    if (isPaid(o)) paidCount++;
    if (isRefunded(o)) refundedCount++;
    if (countsTowardRevenue(o)) revenue += revenueOf(o);
  }
  return { revenue, paidCount, refundedCount, totalCount: orders.length };
}
