/**
 * 订单口径计算工具单元测试（B2 · 覆盖率提升）
 * 覆盖：revenueOf / countsTowardRevenue / isPaid / isRefunded / aggregateRevenue
 * 这是全系统 GMV/营收口径的唯一来源，须保证零缺陷。
 */
import { describe, it, expect } from 'vitest';
import {
  revenueOf,
  countsTowardRevenue,
  isPaid,
  isRefunded,
  aggregateRevenue,
  type OrderRow,
} from '../src/utils/orderMetrics';

describe('utils/orderMetrics — 单笔口径', () => {
  it('revenueOf: paid_amount>0 取 paid', () => {
    expect(revenueOf({ id: '1', paid_amount: 100, total_amount: 50, payment_status: 'paid', order_status: 'completed' })).toBe(100);
  });

  it('revenueOf: paid=0 且 total>0 取 total（兜底）', () => {
    expect(revenueOf({ id: '1', paid_amount: 0, total_amount: 80, payment_status: 'unpaid', order_status: 'pending' })).toBe(80);
  });

  it('revenueOf: 全为 0 返回 0', () => {
    expect(revenueOf({ id: '1', paid_amount: 0, total_amount: 0, payment_status: 'cancelled', order_status: 'cancelled' })).toBe(0);
  });

  it('revenueOf: 空值安全', () => {
    expect(revenueOf({ id: '1', payment_status: 'unpaid', order_status: 'pending' })).toBe(0);
    expect(revenueOf({ id: '1', paid_amount: null, total_amount: null, payment_status: 'unpaid', order_status: 'pending' })).toBe(0);
  });

  it('countsTowardRevenue: paid/partial 计入', () => {
    expect(countsTowardRevenue({ id: '1', payment_status: 'paid', order_status: 'completed' })).toBe(true);
    expect(countsTowardRevenue({ id: '1', payment_status: 'partial', order_status: 'processing' })).toBe(true);
    expect(countsTowardRevenue({ id: '1', payment_status: 'unpaid', order_status: 'pending' })).toBe(false);
    expect(countsTowardRevenue({ id: '1', payment_status: 'refunded', order_status: 'refunded' })).toBe(false);
  });

  it('isPaid: paid/partial', () => {
    expect(isPaid({ id: '1', payment_status: 'paid', order_status: 'x' })).toBe(true);
    expect(isPaid({ id: '1', payment_status: 'partial', order_status: 'x' })).toBe(true);
    expect(isPaid({ id: '1', payment_status: 'unpaid', order_status: 'x' })).toBe(false);
  });

  it('isRefunded: 支付状态或订单状态为退款/退货', () => {
    expect(isRefunded({ id: '1', payment_status: 'refunded', order_status: 'x' })).toBe(true);
    expect(isRefunded({ id: '1', payment_status: 'x', order_status: 'refunded' })).toBe(true);
    expect(isRefunded({ id: '1', payment_status: 'x', order_status: 'returned' })).toBe(true);
    expect(isRefunded({ id: '1', payment_status: 'paid', order_status: 'completed' })).toBe(false);
  });
});

describe('utils/orderMetrics — aggregateRevenue', () => {
  const orders: OrderRow[] = [
    { id: '1', paid_amount: 100, total_amount: 100, payment_status: 'paid', order_status: 'completed' },
    { id: '2', paid_amount: 50, total_amount: 50, payment_status: 'partial', order_status: 'processing' },
    { id: '3', paid_amount: 0, total_amount: 0, payment_status: 'refunded', order_status: 'refunded' },
    { id: '4', paid_amount: 0, total_amount: 0, payment_status: 'unpaid', order_status: 'pending' },
    { id: '5', paid_amount: 0, total_amount: 70, payment_status: 'unpaid', order_status: 'pending' },
  ];

  it('聚合营收/已付/退款/总数口径', () => {
    const agg = aggregateRevenue(orders);
    // countsTowardRevenue 仅含 paid/partial；order5 为 unpaid（仅 total>0 兜底，不计入营收）
    expect(agg.revenue).toBe(100 + 50 + 0 + 0 + 0);
    expect(agg.paidCount).toBe(2); // paid + partial
    expect(agg.refundedCount).toBe(1);
    expect(agg.totalCount).toBe(5);
  });

  it('空数组安全', () => {
    const agg = aggregateRevenue([]);
    expect(agg).toEqual({ revenue: 0, paidCount: 0, refundedCount: 0, totalCount: 0 });
  });
});
