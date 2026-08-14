/**
 * 业务倍增引擎视图 — 营销活动管理、ROI 优化、增长策略
 * 数据来源：后端 campaigns / ad_spend / product_reviews 真实 API
 */
import { useState, useEffect } from 'react';
import { api } from '@api/client';
import { useToast } from '@components/Common/Toast';

interface CampaignItem {
  id: string;
  name: string;
  platform: string;
  campaignType: string;
  status: string;
  budget: number;
  spent: number;
  targetGmv: number;
  targetOrders: number;
  startDate: string;
  endDate: string;
  gmv: number;
  orders: number;
  roi: number;
}

interface AdSpendSummary {
  totalSpend: number;
  totalGmv: number;
  overallRoi: number;
  totalOrders: number;
  totalImpression: number;
  totalClick: number;
  byPlatform: Array<{ platform: string; spend: number; gmv: number; roi: number; orders: number }>;
}

const SCENARIO_LABELS: Record<string, string> = {
  promotional: '促销活动', flash_sale: '秒杀活动', membership: '会员活动',
  new_customer: '新客活动', seasonal: '节日大促',
};

const STATUS_STYLES: Record<string, string> = {
  draft: 'var(--text-muted)', active: 'var(--success-500)',
  paused: 'var(--warning-500)', ended: 'var(--danger-500)',
  archived: 'var(--text-muted)',
};

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--ecom-amber-500)' }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function OptimizeTip({ title, desc, roi }: { title: string; desc: string; roi: string }) {
  return (
    <div className="card" style={{ padding: 12, borderLeft: '3px solid var(--accent-500)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{title}</span>
        <span className="badge badge-success" style={{ fontSize: 10 }}>ROI: {roi}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{desc}</div>
    </div>
  );
}

export default function GrowthEngine() {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<'overview' | 'campaigns' | 'ads' | 'reviews' | 'optimize'>('overview');
  const [campaigns, setCampaigns] = useState<CampaignItem[]>([]);
  const [adSummary, setAdSummary] = useState<AdSpendSummary | null>(null);
  const [reviews, setReviews] = useState<any[]>([]);
  const [reviewStats, setReviewStats] = useState<{ totalReviews: number; avgRating: number } | null>(null);
  const [loading, setLoading] = useState(false);

  // 加载真实活动列表
  const loadCampaigns = async () => {
    try {
      const res = await api.business.listCampaigns({ limit: 20 });
      const data = (res as any).data || [];
      const converted: CampaignItem[] = (data || []).map((c: any) => ({
        id: c.id,
        name: c.name || '未命名活动',
        platform: c.platform || '',
        campaignType: c.campaign_type || c.campaignType || 'promotional',
        status: c.status || 'draft',
        budget: Number(c.budget || 0),
        spent: (c.ad_spend || c.spent || 0), // 后端已跟踪实际花费
        targetGmv: Number(c.target_gmv || c.targetGmv || 0),
        targetOrders: Number(c.target_orders || c.targetOrders || 0),
        startDate: c.start_date || c.startDate || '',
        endDate: c.end_date || c.endDate || '',
        gmv: 0, // 需从 ad_spend 关联计算
        orders: 0,
        roi: 0,
      }));
      setCampaigns(converted);
    } catch (e) {
      toast.addToast('error', '加载营销活动失败', (e as Error).message);
      setCampaigns([]);
    }
  };

  // 加载投流汇总
  const loadAdSummary = async () => {
    try {
      const res = await api.business.getAdSpendSummary();
      const data = res.data as AdSpendSummary;
      if (data) setAdSummary(data);
    } catch (e) {
      toast.addToast('error', '加载投流数据失败', (e as Error).message);
      setAdSummary(null);
    }
  };

  // 加载评价统计
  const loadReviewStats = async () => {
    try {
      const res = await api.business.listReviews({ limit: 10 });
      const data = (res as any).data || [];
      setReviews(data as any[]);

      // 取第一个有数据的商品评价统计
      if (data.length > 0) {
        const productId = data[0].product_id || data[0].productId;
        if (productId) {
          try {
            const statsRes = await api.business.getProductReviewStats(productId);
            const stats = statsRes.data;
            setReviewStats(stats as { totalReviews: number; avgRating: number });
          } catch (e) {
            console.warn('[GrowthEngine] 加载商品评价统计失败:', e);
            setReviewStats(null);
          }
        }
      }
    } catch (e) {
      console.warn('[GrowthEngine] 加载评价数据失败:', e);
      setReviews([]);
      setReviewStats(null);
    }
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([loadCampaigns(), loadAdSummary(), loadReviewStats()]).finally(() => setLoading(false));
  }, []);

  // 从 ad_spend 汇总计算
  const totalSpend = adSummary?.totalSpend || 0;
  const totalAdGmv = adSummary?.totalGmv || 0;
  const overallRoi = adSummary?.overallRoi || 0;
  const byPlatform = adSummary?.byPlatform || [];

  // 活动 KPI（从 campaigns 列表）
  const activeCampaigns = campaigns.filter((c) => c.status === 'active').length;
  const totalBudget = campaigns.reduce((s, c) => s + c.budget, 0);

  return (
    <div className="hrms-container">
      <div className="hrms-header">
        <h2 className="page-title">业务倍增引擎</h2>
        <div className="hrms-header-actions">
          <span className="badge badge-success">{activeCampaigns} 个活跃活动</span>
          {totalSpend > 0 && <span className="badge badge-amber">投流 ROI {overallRoi.toFixed(2)}x</span>}
        </div>
      </div>

      {/* Tab 导航 */}
      <div className="kanban-header" style={{ marginBottom: 16 }}>
        <button className={`tab ${activeTab === 'overview' ? 'tab-active' : ''}`} onClick={() => setActiveTab('overview')}>总览</button>
        <button className={`tab ${activeTab === 'campaigns' ? 'tab-active' : ''}`} onClick={() => setActiveTab('campaigns')}>活动管理</button>
        <button className={`tab ${activeTab === 'ads' ? 'tab-active' : ''}`} onClick={() => setActiveTab('ads')}>投流数据</button>
        <button className={`tab ${activeTab === 'reviews' ? 'tab-active' : ''}`} onClick={() => setActiveTab('reviews')}>商品评价</button>
        <button className={`tab ${activeTab === 'optimize' ? 'tab-active' : ''}`} onClick={() => setActiveTab('optimize')}>优化建议</button>
      </div>

      {/* 总览 */}
      {activeTab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>加载中...</div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
                <KpiCard label="活跃活动数" value={String(activeCampaigns)} sub={`${campaigns.length} 个总计`} />
                <KpiCard label="活动总预算" value={`¥${totalBudget.toLocaleString()}`} />
                <KpiCard label="投流总花费" value={totalSpend > 0 ? `¥${totalSpend.toLocaleString()}` : '¥0'} />
                <KpiCard label="投流总营收" value={totalAdGmv > 0 ? `¥${totalAdGmv.toLocaleString()}` : '¥0'} />
                <KpiCard label="综合 ROI" value={totalSpend > 0 ? `${overallRoi.toFixed(2)}x` : '—'} />
              </div>

              {/* 按平台投流分布 */}
              {byPlatform.length > 0 && (
                <div className="card" style={{ padding: 16 }}>
                  <h3 className="section-title" style={{ marginBottom: 12 }}>投流 — 各平台 ROI</h3>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {byPlatform.map((p) => (
                      <div key={p.platform} className="card" style={{ flex: 1, minWidth: 120, padding: 10, textAlign: 'center' }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{p.platform}</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: p.roi >= 2 ? 'var(--success-500)' : p.roi > 1 ? 'var(--ecom-amber-500)' : 'var(--danger-500)' }}>
                          ROI {p.roi.toFixed(2)}x
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                          花费 ¥{p.spend.toLocaleString()} → 营收 ¥{p.gmv.toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {totalSpend === 0 && campaigns.length === 0 && (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
                  暂无数据。请先在「活动管理」创建营销活动，在「投流数据」录入投放记录。
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* 活动管理 */}
      {activeTab === 'campaigns' && (
        <div>
          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>加载中...</div>
          ) : campaigns.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
              暂无活动记录。请先创建活动。
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {campaigns.map((c) => (
                <div key={c.id} className="card" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_STYLES[c.status] || 'var(--text-muted)', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {SCENARIO_LABELS[c.campaignType] || c.campaignType}
                      {c.platform && ` · ${c.platform}`}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-muted)' }}>
                    预算 ¥{c.budget.toLocaleString()}<br/>
                    目标 GMV ¥{c.targetGmv.toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 投流数据 */}
      {activeTab === 'ads' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>加载中...</div>
          ) : adSummary && totalSpend > 0 ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
                <KpiCard label="总花费" value={`¥${totalSpend.toLocaleString()}`} />
                <KpiCard label="总营收" value={`¥${totalAdGmv.toLocaleString()}`} />
                <KpiCard label="总订单" value={String(adSummary.totalOrders || 0)} />
                <KpiCard label="综合 ROI" value={`${overallRoi.toFixed(2)}x`} />
              </div>
              {byPlatform.length > 0 && (
                <div className="card" style={{ padding: 16 }}>
                  <h3 className="section-title" style={{ marginBottom: 12 }}>各平台明细</h3>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                        <th style={{ padding: 6 }}>平台</th>
                        <th style={{ padding: 6 }}>花费</th>
                        <th style={{ padding: 6 }}>营收</th>
                        <th style={{ padding: 6 }}>ROI</th>
                        <th style={{ padding: 6 }}>订单</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byPlatform.map((p) => (
                        <tr key={p.platform} style={{ borderBottom: '1px solid var(--border-light)' }}>
                          <td style={{ padding: 6 }}>{p.platform}</td>
                          <td style={{ padding: 6 }}>¥{p.spend.toLocaleString()}</td>
                          <td style={{ padding: 6 }}>¥{p.gmv.toLocaleString()}</td>
                          <td style={{ padding: 6, color: p.roi >= 2 ? 'var(--success-500)' : p.roi > 1 ? 'var(--ecom-amber-500)' : 'var(--danger-500)' }}>
                            {p.roi.toFixed(2)}x
                          </td>
                          <td style={{ padding: 6 }}>{p.orders}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
              暂无投流数据。请先录入投放记录。
            </div>
          )}
        </div>
      )}

      {/* 商品评价 */}
      {activeTab === 'reviews' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>加载中...</div>
          ) : reviews.length > 0 ? (
            <>
              {reviewStats && (
                <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
                  <KpiCard label="总评价数" value={String(reviewStats.totalReviews)} />
                  <KpiCard label="平均评分" value={reviewStats.avgRating > 0 ? `${reviewStats.avgRating.toFixed(1)} / 5` : '—'} />
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {reviews.slice(0, 5).map((r: any) => (
                  <div key={r.id} className="card" style={{ padding: 10, display: 'flex', gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-primary)' }}>
                        {r.product_name || '商品'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        {r.description || '暂无评价内容'}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ecom-amber-500)' }}>
                        {'★'.repeat(r.rating || 0)}
                        {'☆'.repeat(5 - (r.rating || 0))}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                        {r.status === 'approved' ? '已审核' : r.status === 'pending' ? '待审核' : r.status}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
              暂无商品评价数据。
            </div>
          )}
        </div>
      )}

      {/* 优化建议 */}
      {activeTab === 'optimize' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {byPlatform.length > 0 && (
            byPlatform.filter((p) => p.roi < 1.5).length > 0 ? (
              byPlatform.filter((p) => p.roi < 1.5).map((p) => (
                <OptimizeTip
                  key={p.platform}
                  title={`优化 ${p.platform} 投放`}
                  desc={`当前 ROI ${p.roi.toFixed(2)}x，低于盈亏平衡线。建议调整出价策略或优化落地页转化率。`}
                  roi={`${p.roi.toFixed(2)}x`}
                />
              ))
            ) : (
              <OptimizeTip
                title="投放整体健康"
                desc="所有平台 ROI 均在盈亏平衡线以上，可考虑加大投放规模。"
                roi={`${overallRoi.toFixed(2)}x`}
              />
            )
          )}
          {campaigns.length > 0 && (
            <OptimizeTip
              title="活动覆盖率"
              desc={`${activeCampaigns} 个活动活跃中，覆盖 ${campaigns.length} 个活动。建议对已结束活动做复盘。`}
              roi="—"
            />
          )}
          {totalSpend === 0 && (
            <OptimizeTip
              title="开始投放"
              desc="目前无投流记录，建议先测试性投放小额预算，积累 ROI 数据后再放量。"
              roi="—"
            />
          )}
        </div>
      )}
    </div>
  );
}
