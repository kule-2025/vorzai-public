/**
 * 售后闭环中心 (V2 · C1)
 *
 * 后端：server/src/services/aftersalesService.ts + /api/business/returns/*
 * 四步闭环：提交退货 → 审批 → 收货入库 → 退款
 * 联动：库存回写 + 订单支付状态更新
 */
import { useState, useEffect } from 'react';
import { api } from '@api/client';
import { Card } from '@components/Common/Card';
import { Badge } from '@components/Common/Badge';
import { Button } from '@components/Common/Button';
import { toast } from '@components/Common/Toast';
import { Loading } from '@components/Common/Loading';
import { Empty } from '@components/Common/Empty';

const STATUS_LABEL: Record<string, string> = {
  pending: '待审批',
  approved: '已审批',
  rejected: '已驳回',
  in_transit: '运输中',
  received: '已收货',
  refunded: '已退款',
};

const STATUS_COLOR: Record<string, string> = {
  pending: 'var(--warning-500)',
  approved: 'var(--info-500)',
  rejected: 'var(--error-500)',
  in_transit: 'var(--accent-500)',
  received: 'var(--success-500)',
  refunded: 'var(--success-600)',
};

export default function AftersalesHub() {
  const [returns, setReturns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ orderId: '', reason: '', items: '', note: '' });

  useEffect(() => { loadReturns(); }, [filter]);

  async function loadReturns() {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (filter) params.status = filter;
      const res = await api.business.listReturns(params);
      if (res.success && res.data) setReturns(res.data as any[]);
      else setReturns([]);
    } catch (e) {
      console.warn('[AftersalesHub] 加载退货工单失败:', e);
      toast('error', '加载退货工单失败');
      setReturns([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    try {
      const items = JSON.parse(form.items || '[]');
      if (!Array.isArray(items) || items.length === 0) {
        toast('warning', '请至少添加一个退货商品');
        return;
      }
      const res = await api.business.createReturn({
        orderId: form.orderId || undefined,
        reason: form.reason || undefined,
        returnItems: items,
        note: form.note || undefined,
      });
      if (res.success) {
        toast('success', '退货申请已提交');
        setShowForm(false);
        setForm({ orderId: '', reason: '', items: '', note: '' });
        loadReturns();
      } else {
        toast('error', res.error?.message || '提交失败');
      }
    } catch (e: any) {
      toast('error', `提交失败: ${e?.message || '未知错误'}`);
    }
  }

  async function handleAction(id: string, action: string) {
    try {
      const fn: Record<string, () => Promise<any>> = {
        approve: () => api.business.approveReturn(id),
        reject: () => api.business.rejectReturn(id),
        receive: () => api.business.receiveReturn(id),
        refund: () => api.business.processRefund(id),
      };
      const res = await fn[action]();
      if (res.success) {
        toast('success', `已${STATUS_LABEL[action] || action}`);
        loadReturns();
      } else {
        toast('error', res.error?.message || '操作失败');
      }
    } catch (e) {
      console.warn('[AftersalesHub] 操作失败:', e);
      toast('error', '操作失败，请重试');
    }
  }

  const stats = {
    pending: returns.filter(r => r.status === 'pending').length,
    approved: returns.filter(r => r.status === 'approved').length,
    in_transit: returns.filter(r => r.status === 'in_transit').length,
    received: returns.filter(r => r.status === 'received').length,
    refunded: returns.filter(r => r.status === 'refunded').length,
    rejected: returns.filter(r => r.status === 'rejected').length,
  } as Record<string, number>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 统计卡 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
        {([
          ['pending', '待审批', 'var(--warning-500)'],
          ['approved', '已审批', 'var(--info-500)'],
          ['in_transit', '运输中', 'var(--accent-500)'],
          ['received', '已收货', 'var(--success-500)'],
          ['refunded', '已退款', 'var(--success-600)'],
          ['rejected', '已驳回', 'var(--error-500)'],
        ] as [string, string, string][]).map(([key, label, color]) => (
          <Card key={key} className="stat-card card-hoverable" onClick={() => setFilter(filter === key ? '' : key)}>
            <div style={{ fontSize: 24, fontWeight: 700, color }}>{stats[key]}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</div>
          </Card>
        ))}
      </div>

      {/* 筛选 + 新建 */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-color)', fontSize: 14 }}
        >
          <option value="">全部状态</option>
          <option value="pending">待审批</option>
          <option value="approved">已审批</option>
          <option value="in_transit">运输中</option>
          <option value="received">已收货</option>
          <option value="refunded">已退款</option>
          <option value="rejected">已驳回</option>
        </select>
        <Button variant="primary" size="sm" onClick={() => setShowForm(!showForm)}>
          {showForm ? '取消' : '+ 新建退货申请'}
        </Button>
      </div>

      {/* 新建表单 */}
      {showForm && (
        <Card className="card-hoverable">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              placeholder="订单 ID（可选）"
              value={form.orderId}
              onChange={e => setForm(f => ({ ...f, orderId: e.target.value }))}
              style={{ padding: 8, borderRadius: 6, border: '1px solid var(--border-color)', fontSize: 14 }}
            />
            <textarea
              placeholder="退货原因"
              value={form.reason}
              onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
              style={{ padding: 8, borderRadius: 6, border: '1px solid var(--border-color)', fontSize: 14, minHeight: 60 }}
            />
            <textarea
              placeholder='退货商品 JSON（例：[{"productId":"xxx","sku":"S-001","name":"商品A","quantity":2,"unitPrice":99}]）'
              value={form.items}
              onChange={e => setForm(f => ({ ...f, items: e.target.value }))}
              style={{ padding: 8, borderRadius: 6, border: '1px solid var(--border-color)', fontSize: 14, minHeight: 80, fontFamily: 'monospace' }}
            />
            <textarea
              placeholder="备注（可选）"
              value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              style={{ padding: 8, borderRadius: 6, border: '1px solid var(--border-color)', fontSize: 14 }}
            />
            <Button variant="primary" size="sm" onClick={handleSubmit}>提交退货申请</Button>
          </div>
        </Card>
      )}

      {/* 工单列表 */}
      {loading ? (
        <Loading text="加载退货工单..." />
      ) : returns.length === 0 ? (
        <Empty title={filter ? '无匹配工单' : '暂无退货工单'} description="新建退货申请开始管理售后流程" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {returns.map((ret: any) => (
            <Card key={ret.id} className="card-hoverable">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{ret.return_no}</span>
                    <Badge variant={ret.status === 'pending' ? 'warning' : ret.status === 'rejected' ? 'danger' : 'info'}>
                    {STATUS_LABEL[ret.status] || ret.status}
                  </Badge>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {ret.order_id && `订单: ${ret.order_id.slice(0, 8)}...`}
                    {ret.reason && ` | 原因: ${ret.reason}`}
                  </div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>
                    {(ret.return_items || []).map((item: any, i: number) => (
                      <span key={i} style={{ marginRight: 12 }}>
                        {item.name || item.sku || '商品'} × {item.quantity} @ ¥{item.unitPrice}
                      </span>
                    ))}
                  </div>
                  {ret.refund_amount > 0 && (
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--error-500)', marginTop: 4 }}>
                      退款金额: ¥{ret.refund_amount.toFixed(2)}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {ret.status === 'pending' && (
                    <>
                      <Button variant="primary" size="sm" onClick={() => handleAction(ret.id, 'approve')}>审批通过</Button>
                      <Button variant="danger" size="sm" onClick={() => handleAction(ret.id, 'reject')}>驳回</Button>
                    </>
                  )}
                  {ret.status === 'approved' && (
                    <Button variant="primary" size="sm" onClick={() => handleAction(ret.id, 'receive')}>确认收货</Button>
                  )}
                  {ret.status === 'received' && (
                    <Button variant="primary" size="sm" onClick={() => handleAction(ret.id, 'refund')}>处理退款</Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
