/**
 * 转化与运营面板（V2 · C2/C3）
 *
 * 四件套齐备：
 *   - 后端 service:    server/src/services/aftersalesService.ts (analyzeConversion / getCustomerSegments)
 *   - 后端路由:        /api/business/conversion-analysis · /customer-segments · /customer-tags
 *   - 前端入口:        侧边栏「转化与运营」
 *   - 数据写入方:      客户标签由业务流产生（订单/评价等），本页只读聚合展示
 *
 * 能力：
 *   - C2 转化断点定位：漏斗各阶段转化/流失率，流失 >15% 自动给出行动建议
 *   - C3 客户分层运营：按标签聚合的客户分群（人数、样本客户）
 *
 * 工程诚信：全部来自后端聚合；无 Math.random / 无模拟。
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '@api/client';
import { useToast } from '@components/Common/Toast';
import { Loading } from '@components/Common/Loading';
import { Empty } from '@components/Common/Empty';

interface FunnelStage {
  stage: string;
  count: number;
  rate: number;
  dropRate: number;
}
interface Breakpoint {
  stage: string;
  dropRate: number;
  suggestion: string;
}
interface ConversionAnalysis {
  funnel: FunnelStage[];
  breakpoints: Breakpoint[];
  overallConversion: number;
}
interface Segment {
  tag: string;
  count: number;
  customers: string[];
}
interface CustomerTag {
  id: string;
  customer_id: string;
  customer_name: string | null;
  tag: string;
  category: string;
  score: number;
  source: string;
}

const DAYS_AGO = (d: number): string => {
  const x = new Date();
  x.setDate(x.getDate() - d);
  return x.toISOString().slice(0, 10);
};
const TODAY = (): string => new Date().toISOString().slice(0, 10);

const SEGMENT_COLORS: Record<string, string> = {
  behavior: '#3b82f6',
  demographic: '#8b5cf6',
  value: '#f59e0b',
  risk: '#ef4444',
  custom: '#10b981',
};

export default function ConversionHub() {
  const toastApi = useToast();
  const toast = (t: 'success' | 'error' | 'warning' | 'info', title: string, msg?: string) =>
    toastApi.addToast(t, title, msg);

  const [from, setFrom] = useState(DAYS_AGO(30));
  const [to, setTo] = useState(TODAY());
  const [analysis, setAnalysis] = useState<ConversionAnalysis | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [tags, setTags] = useState<CustomerTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cRes, sRes, tRes] = await Promise.all([
        api.business.analyzeConversion(from, to),
        api.business.getCustomerSegments(),
        api.business.listCustomerTags(),
      ]);
      if (cRes.success && cRes.data) setAnalysis(cRes.data as ConversionAnalysis);
      else setError(cRes.error?.message || '转化分析获取失败');
      if (sRes.success && sRes.data) setSegments(Array.isArray(sRes.data) ? (sRes.data as Segment[]) : []);
      if (tRes.success && tRes.data) setTags(Array.isArray(tRes.data) ? (tRes.data as CustomerTag[]) : []);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const maxFunnel = useMemo(
    () => (analysis && analysis.funnel.length > 0 ? analysis.funnel[0].count : 0),
    [analysis],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 控制条 */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label htmlFor="conv-from" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>起始</label>
        <input
          id="conv-from"
          className="input"
          type="date"
          value={from}
          max={to}
          onChange={(e) => setFrom(e.target.value)}
          style={{ minWidth: 150 }}
        />
        <label htmlFor="conv-to" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>结束</label>
        <input
          id="conv-to"
          className="input"
          type="date"
          value={to}
          min={from}
          onChange={(e) => setTo(e.target.value)}
          style={{ minWidth: 150 }}
        />
        <button className="btn-ecom-secondary" onClick={load} disabled={loading} style={{ minHeight: 36 }}>
          {loading ? '加载中…' : '刷新'}
        </button>
      </div>

      {loading ? (
        <Loading text="加载转化与运营数据…" />
      ) : error ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--danger-text)' }}>{error}</div>
      ) : (
        <>
          {/* C2 转化断点定位 */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>C2 · 转化断点定位</h3>
              {analysis && (
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  整体转化率{' '}
                  <strong style={{ color: 'var(--ecom-blue-500)', fontSize: 16 }}>{analysis.overallConversion}%</strong>
                </span>
              )}
            </div>

            {!analysis || analysis.funnel.length === 0 ? (
              <Empty title="暂无转化数据" description="所选区间内没有订单，无法绘制漏斗。" size="sm" />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {analysis.funnel.map((f) => (
                  <FunnelRow key={f.stage} stage={f} max={maxFunnel} />
                ))}
              </div>
            )}

            {/* 断点行动建议 */}
            {analysis && analysis.breakpoints.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--warning-600)' }}>
                  流失预警与行动建议（{analysis.breakpoints.length}）
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {analysis.breakpoints.map((b) => (
                    <div
                      key={b.stage}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '8px 12px', borderRadius: 8,
                        background: 'var(--warning-50)', border: '1px solid var(--warning-200)',
                      }}
                    >
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--warning-700)', minWidth: 72 }}>
                        {b.stage}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--warning-700)', minWidth: 64 }}>
                        流失 {b.dropRate}%
                      </span>
                      <span style={{ flex: 1, fontSize: 12, color: 'var(--text-secondary)' }}>
                        💡 {b.suggestion}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* C3 客户分层运营 */}
          <div className="card">
            <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 12px' }}>
              C3 · 客户分层运营（{segments.length} 个分群）
            </h3>
            {segments.length === 0 ? (
              <Empty title="暂无客户分群" description="为订单客户打标签后，将按标签自动聚合成分群。" size="sm" />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                {segments.map((s) => (
                  <SegmentCard key={s.tag} segment={s} />
                ))}
              </div>
            )}

            {/* 标签明细 */}
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>
                标签明细（{tags.length}）
              </div>
              {tags.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>暂无标签</div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {tags.map((t) => (
                    <span
                      key={t.id}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '3px 10px', borderRadius: 999, fontSize: 11,
                        background: 'var(--bg-row-hover)', color: 'var(--text-secondary)',
                        border: `1px solid ${SEGMENT_COLORS[t.category] || 'var(--border-color)'}`,
                      }}
                    >
                      <span
                        style={{
                          width: 6, height: 6, borderRadius: '50%',
                          background: SEGMENT_COLORS[t.category] || 'var(--text-muted)',
                        }}
                      />
                      {t.customer_name || t.customer_id} · {t.tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Funnel Row（memo） ─────────────────────────────
const FunnelRow = React.memo(function FunnelRow({ stage, max }: { stage: FunnelStage; max: number }) {
  const widthPct = max > 0 ? Math.max(2, (stage.count / max) * 100) : 0;
  const dropColor = stage.dropRate > 15 ? 'var(--danger-500)' : stage.dropRate > 5 ? 'var(--warning-500)' : 'var(--success-500)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 72, fontSize: 12, color: 'var(--text-secondary)', flexShrink: 0 }}>{stage.stage}</div>
      <div style={{ flex: 1, height: 22, background: 'var(--bg-row-hover)', borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
        <div
          style={{
            width: `${widthPct}%`, height: '100%',
            background: 'linear-gradient(90deg, var(--ecom-blue-500), var(--ecom-violet-500))',
            borderRadius: 6, transition: 'width 0.4s ease',
          }}
        />
        <span style={{ position: 'absolute', right: 8, top: 2, fontSize: 11, color: 'var(--text-primary)', fontWeight: 600 }}>
          {stage.count.toLocaleString()}
        </span>
      </div>
      <div style={{ width: 96, textAlign: 'right', flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>转化 {stage.rate}%</span>
        {stage.dropRate > 0 && (
          <span style={{ fontSize: 11, color: dropColor, marginLeft: 6 }}>↓{stage.dropRate}%</span>
        )}
      </div>
    </div>
  );
});

// ─── Segment Card（memo） ───────────────────────────
const SegmentCard = React.memo(function SegmentCard({ segment }: { segment: Segment }) {
  return (
    <div
      style={{
        background: 'var(--bg-row-hover)', border: '1px solid var(--border-card)',
        borderRadius: 10, padding: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{segment.tag}</span>
        <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--ecom-violet-500)', fontFamily: 'ui-monospace, monospace' }}>
          {segment.count}
        </span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>位客户</div>
      {segment.customers.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {segment.customers.slice(0, 5).join('、')}
          {segment.customers.length > 5 ? '…' : ''}
        </div>
      )}
    </div>
  );
});
