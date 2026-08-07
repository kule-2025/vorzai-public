/**
 * 跨境电商中心（Cross-Border Hub）
 *
 * 五大 Tab：
 *   1. 概览            — 合规完成度 / 汇率新鲜度 / 目的国分布 / 最近测算
 *   2. 合规管理        — 商品跨境属性维护 + 单品合规体检
 *   3. HS Code 查询    — 中英文模糊检索内置参考库
 *   4. 汇率管理        — 本地手工维护多币种汇率（非实时，绝不伪装）
 *   5. 落地成本测算    — 采购/头程/关税/进口税/渠道费/尾程 全口径利润测算
 *
 * 数据全部来自后端 api.crossborder.*，零 Mock。
 * 所有样式使用 CSS 变量主题，不硬编码配色。
 */
import { useState, useEffect, useCallback } from 'react';
import { Card } from '@components/Common/Card';
import { Badge } from '@components/Common/Badge';
import { Button } from '@components/Common/Button';
import { Input } from '@components/Common/Input';
import { Select } from '@components/Common/Select';
import { Tab } from '@components/Common/Tab';
import {
  crossborderApi,
  HsCodeSearchItem,
  ProductCompliance,
  ComplianceCheckResult,
  ExchangeRateView,
  CountryEntry,
  CurrencyEntry,
  ShippingModeEntry,
  CrossBorderOverview,
  LandedCostResult,
} from '@api/crossborder';

// ============================================================
// 主题色（CSS 变量 + 兜底，避免个别变量缺失时破版）
// ============================================================
const C = {
  textPrimary: 'var(--text-primary, #1f2937)',
  textSecondary: 'var(--text-secondary, #6b7280)',
  textMuted: 'var(--text-muted, #9ca3af)',
  border: 'var(--border-color, #e5e7eb)',
  bgCard: 'var(--bg-card, #ffffff)',
  bgApp: 'var(--bg-app, #f5f6fa)',
  bgSoft: 'var(--bg-card-hover, #f3f4f6)',
  primary: 'var(--primary, #2563eb)',
  danger: 'var(--danger, #dc2626)',
  warning: 'var(--warning, #f59e0b)',
  success: 'var(--success, #16a34a)',
  info: 'var(--info, #0ea5e9)',
};

const pageStyle: React.CSSProperties = {
  padding: 20, display: 'flex', flexDirection: 'column', gap: 16,
  background: C.bgApp, minHeight: '100%', color: C.textPrimary,
};
const gridStyle = (min = 180): React.CSSProperties => ({
  display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 12,
});
const sectionTitle: React.CSSProperties = {
  fontSize: 14, fontWeight: 600, color: C.textPrimary, margin: '4px 0',
};
const muted: React.CSSProperties = { fontSize: 12, color: C.textSecondary };
const tableStyle: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', fontSize: 13,
};
const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px', borderBottom: `1px solid ${C.border}`,
  color: C.textSecondary, fontWeight: 600, background: C.bgSoft,
};
const tdStyle: React.CSSProperties = {
  padding: '8px 10px', borderBottom: `1px solid ${C.border}`, color: C.textPrimary,
};
const formGrid: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12,
};

// ============================================================
// 通用工具
// ============================================================
function formatCny(n: number): string {
  if (!Number.isFinite(n)) return '¥0.00';
  const abs = Math.abs(n);
  if (abs >= 1e8) return `¥${(n / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `¥${(n / 1e4).toFixed(2)}万`;
  return `¥${n.toFixed(2)}`;
}
function formatNum(n: number, d = 2): string {
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function formatPct(n: number): string {
  if (!Number.isFinite(n)) return '0%';
  return `${(n * 100).toFixed(1)}%`;
}
function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('zh-CN', { hour12: false }); }
  catch { return iso; }
}
function rateSourceLabel(src: string): string {
  if (src === 'builtin_reference') return '内置基准';
  if (src === 'manual' || src === 'base' || src === 'identity') return '手工';
  return src || '手工';
}

// ============================================================
// 通用状态组件
// ============================================================
function LoadingState({ text = '加载中…' }: { text?: string }) {
  return <div style={{ padding: 40, textAlign: 'center', color: C.textSecondary }}>{text}</div>;
}
function ErrorState({ msg, onRetry }: { msg: string; onRetry?: () => void }) {
  return (
    <div style={{ padding: 32, textAlign: 'center', color: C.danger }}>
      <div style={{ marginBottom: 12 }}>加载失败：{msg}</div>
      {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>重试</Button>}
    </div>
  );
}
function EmptyState({ text = '暂无数据' }: { text?: string }) {
  return <div style={{ padding: 32, textAlign: 'center', color: C.textMuted }}>{text}</div>;
}

// ============================================================
// Tab 1：概览
// ============================================================
function OverviewTab() {
  const [data, setData] = useState<CrossBorderOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await crossborderApi.getOverview()); }
    catch (e: any) { setError(e?.message || '未知错误'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState msg={error} onRetry={load} />;
  if (!data) return <EmptyState />;

  const c = data.compliance;
  const r = data.rates;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={gridStyle(200)}>
        <Card>
          <div style={{ fontSize: 12, color: C.textSecondary }}>在售商品数</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{formatNum(c.totalProducts, 0)}</div>
        </Card>
        <Card>
          <div style={{ fontSize: 12, color: C.textSecondary }}>已填 HS Code</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: C.primary }}>
            {formatNum(c.withHsCode, 0)}
            <span style={{ fontSize: 13, color: C.textMuted }}> / {c.missingHsCode} 缺失</span>
          </div>
        </Card>
        <Card>
          <div style={{ fontSize: 12, color: C.textSecondary }}>已填原产国</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: C.success }}>
            {formatNum(c.withOriginCountry, 0)}
          </div>
        </Card>
        <Card>
          <div style={{ fontSize: 12, color: C.textSecondary }}>完全合规商品</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>
            {formatNum(c.fullyCompliant, 0)}
            <span style={{ fontSize: 13, color: C.textMuted }}>（{formatPct(c.completionRate)}）</span>
          </div>
        </Card>
        <Card>
          <div style={{ fontSize: 12, color: C.textSecondary }}>标记禁运</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: c.prohibitedCount > 0 ? C.danger : C.textPrimary }}>
            {formatNum(c.prohibitedCount, 0)}
          </div>
        </Card>
      </div>

      <div style={gridStyle(280)}>
        <Card>
          <div style={sectionTitle}>汇率新鲜度</div>
          <div style={{ fontSize: 13, color: C.textSecondary, lineHeight: 1.9 }}>
            维护币种：{r.total} 种<br />
            手工录入：{r.manualCount} · 内置基准：{r.builtinCount}<br />
            已过期（&gt;{r.staleDaysThreshold}天）：{r.staleCount}<br />
            最近更新：{formatDate(r.latestUpdatedAt)}
          </div>
          {r.staleCount > 0 && <Badge variant="warning">有 {r.staleCount} 条汇率已过期</Badge>}
        </Card>
        <Card>
          <div style={sectionTitle}>目的国订单分布（Top）</div>
          {data.destinations.length === 0
            ? <div style={muted}>暂无跨境订单数据</div>
            : (
              <table style={tableStyle}>
                <thead><tr>
                  <th style={thStyle}>国家</th><th style={thStyle}>订单数</th>
                  <th style={thStyle}>金额</th><th style={thStyle}>进口税率</th>
                </tr></thead>
                <tbody>
                  {data.destinations.map((d) => (
                    <tr key={d.country}>
                      <td style={tdStyle}>{d.nameZh}（{d.country}）</td>
                      <td style={tdStyle}>{formatNum(d.orderCount, 0)}</td>
                      <td style={tdStyle}>{formatCny(d.amount)}</td>
                      <td style={tdStyle}>{formatPct(d.vatRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </Card>
      </div>

      <Card>
        <div style={sectionTitle}>最近测算（最多 5 条）</div>
        {data.recentCalculations.length === 0
          ? <div style={muted}>尚未进行落地成本测算</div>
          : (
            <table style={tableStyle}>
              <thead><tr>
                <th style={thStyle}>时间</th><th style={thStyle}>商品</th>
                <th style={thStyle}>目的国</th><th style={thStyle}>营收(CNY)</th>
                <th style={thStyle}>总成本(CNY)</th><th style={thStyle}>毛利(CNY)</th>
                <th style={thStyle}>毛利率</th>
              </tr></thead>
              <tbody>
                {data.recentCalculations.map((h) => (
                  <tr key={h.id}>
                    <td style={tdStyle}>{formatDate(h.calculatedAt)}</td>
                    <td style={tdStyle}>{h.productName || h.productSku || '—'}</td>
                    <td style={tdStyle}>{h.destinationNameZh}</td>
                    <td style={tdStyle}>{formatCny(h.revenueCny)}</td>
                    <td style={tdStyle}>{formatCny(h.totalCostCny)}</td>
                    <td style={{ ...tdStyle, color: h.grossProfitCny >= 0 ? C.success : C.danger }}>
                      {formatCny(h.grossProfitCny)}
                    </td>
                    <td style={tdStyle}>{formatPct(h.grossMarginRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        <div style={{ ...muted, marginTop: 8 }}>
          内置 HS Code 参考 {data.hsLibrarySize} 条 · 目的国 {data.countryLibrarySize} 个
        </div>
      </Card>
    </div>
  );
}

// ============================================================
// Tab 2：合规管理
// ============================================================
function ComplianceTab() {
  const [list, setList] = useState<ProductCompliance[]>([]);
  const [countries, setCountries] = useState<CountryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);

  const [selected, setSelected] = useState<ProductCompliance | null>(null);
  const [check, setCheck] = useState<ComplianceCheckResult | null>(null);
  const [targetCountry, setTargetCountry] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [l, cs] = await Promise.all([
        crossborderApi.listProducts({ keyword: keyword || undefined, onlyIncomplete, limit: 200 }),
        crossborderApi.listCountries(),
      ]);
      setList(l); setCountries(cs);
    } catch (e: any) { setError(e?.message || '未知错误'); }
    finally { setLoading(false); }
  }, [keyword, onlyIncomplete]);

  useEffect(() => { loadList(); }, [loadList]);

  const openProduct = (p: ProductCompliance) => {
    setSelected(p);
    setCheck(null);
    setForm({
      hsCode: p.hsCode || '',
      originCountry: p.originCountry || '',
      declaredNameEn: p.declaredNameEn || '',
      declaredValue: p.declaredValue || 0,
      netWeightKg: p.netWeightKg || 0,
      grossWeightKg: p.grossWeightKg || 0,
      lengthCm: p.lengthCm || 0,
      widthCm: p.widthCm || 0,
      heightCm: p.heightCm || 0,
      isBattery: p.isBattery,
      isLiquid: p.isLiquid,
      isMagnetic: p.isMagnetic,
      isProhibited: p.isProhibited,
      certifications: (p.certifications || []).join(', '),
    });
    setTargetCountry('');
    setMsg(null);
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true); setMsg(null);
    try {
      const certs = String(form.certifications || '')
        .split(',').map((s) => s.trim()).filter(Boolean);
      const updated = await crossborderApi.upsertProductCompliance(selected.productId, {
        hsCode: form.hsCode ? String(form.hsCode) : null,
        originCountry: form.originCountry ? String(form.originCountry) : null,
        declaredNameEn: form.declaredNameEn ? String(form.declaredNameEn) : null,
        declaredValue: Number(form.declaredValue) || 0,
        netWeightKg: Number(form.netWeightKg) || 0,
        grossWeightKg: Number(form.grossWeightKg) || 0,
        lengthCm: Number(form.lengthCm) || 0,
        widthCm: Number(form.widthCm) || 0,
        heightCm: Number(form.heightCm) || 0,
        isBattery: !!form.isBattery,
        isLiquid: !!form.isLiquid,
        isMagnetic: !!form.isMagnetic,
        isProhibited: !!form.isProhibited,
        certifications: certs,
      });
      setSelected(updated);
      setMsg({ tone: 'ok', text: '跨境属性已保存' });
      loadList();
    } catch (e: any) { setMsg({ tone: 'err', text: e?.message || '保存失败' }); }
    finally { setSaving(false); }
  };

  const runCheck = async () => {
    if (!selected || !targetCountry) return;
    setCheck(null); setMsg(null);
    try {
      setCheck(await crossborderApi.checkCompliance(selected.productId, targetCountry));
    } catch (e: any) { setMsg({ tone: 'err', text: e?.message || '体检失败' }); }
  };

  const riskVariant: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
    clear: 'success', low: 'info', medium: 'warning', high: 'danger', critical: 'danger',
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState msg={error} onRetry={loadList} />;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) minmax(360px, 1.3fr)', gap: 16, alignItems: 'start' }}>
      {/* 左：商品列表 */}
      <Card>
        <div style={{ ...formGrid, marginBottom: 12 }}>
          <Input placeholder="搜索 SKU / 名称 / HS Code" value={keyword}
            onChange={(e) => setKeyword(e.target.value)} />
          <Select
            options={[{ value: 'all', label: '全部商品' }, { value: 'incomplete', label: '仅看待完善' }]}
            value={onlyIncomplete ? 'incomplete' : 'all'}
            onChange={(v) => setOnlyIncomplete(v === 'incomplete')}
          />
        </div>
        <div style={{ maxHeight: 540, overflowY: 'auto' }}>
          {list.length === 0
            ? <EmptyState text="没有匹配的商品" />
            : list.map((p) => (
              <div key={p.productId}
                onClick={() => openProduct(p)}
                style={{
                  padding: '10px 12px', borderBottom: `1px solid ${C.border}`,
                  cursor: 'pointer',
                  background: selected?.productId === p.productId ? C.bgSoft : 'transparent',
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontWeight: 600 }}>{p.name}</span>
                  {p.isProhibited && <Badge variant="danger">禁运</Badge>}
                </div>
                <div style={{ ...muted, marginTop: 2 }}>
                  {p.sku} · HS {p.hsCode || '未填'} · 原产 {p.originCountry || '未填'}
                </div>
              </div>
            ))}
        </div>
      </Card>

      {/* 右：编辑 + 体检 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {!selected
          ? <Card><EmptyState text="从左侧选择一个商品以维护跨境属性" /></Card>
          : (
            <Card>
              <div style={sectionTitle}>跨境属性 · {selected.name}（{selected.sku}）</div>
              <div style={formGrid}>
                <Input label="HS Code" value={form.hsCode}
                  onChange={(e) => setForm({ ...form, hsCode: e.target.value })} />
                <Input label="原产国（ISO 2位）" value={form.originCountry}
                  onChange={(e) => setForm({ ...form, originCountry: e.target.value.toUpperCase() })} />
                <Input label="英文申报品名" value={form.declaredNameEn}
                  onChange={(e) => setForm({ ...form, declaredNameEn: e.target.value })} />
                <Input label="申报价值" type="number" value={form.declaredValue}
                  onChange={(e) => setForm({ ...form, declaredValue: e.target.value })} />
                <Input label="净重(kg)" type="number" value={form.netWeightKg}
                  onChange={(e) => setForm({ ...form, netWeightKg: e.target.value })} />
                <Input label="毛重(kg)" type="number" value={form.grossWeightKg}
                  onChange={(e) => setForm({ ...form, grossWeightKg: e.target.value })} />
                <Input label="长(cm)" type="number" value={form.lengthCm}
                  onChange={(e) => setForm({ ...form, lengthCm: e.target.value })} />
                <Input label="宽(cm)" type="number" value={form.widthCm}
                  onChange={(e) => setForm({ ...form, widthCm: e.target.value })} />
                <Input label="高(cm)" type="number" value={form.heightCm}
                  onChange={(e) => setForm({ ...form, heightCm: e.target.value })} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                  <label style={{ color: C.textSecondary }}>
                    <input type="checkbox" checked={!!form.isBattery}
                      onChange={(e) => setForm({ ...form, isBattery: e.target.checked })} /> 含电池
                  </label>
                  <label style={{ color: C.textSecondary }}>
                    <input type="checkbox" checked={!!form.isLiquid}
                      onChange={(e) => setForm({ ...form, isLiquid: e.target.checked })} /> 含液体
                  </label>
                  <label style={{ color: C.textSecondary }}>
                    <input type="checkbox" checked={!!form.isMagnetic}
                      onChange={(e) => setForm({ ...form, isMagnetic: e.target.checked })} /> 含磁性
                  </label>
                  <label style={{ color: C.danger }}>
                    <input type="checkbox" checked={!!form.isProhibited}
                      onChange={(e) => setForm({ ...form, isProhibited: e.target.checked })} /> 标记禁运
                  </label>
                </div>
                <Input label="认证（逗号分隔）" value={form.certifications}
                  onChange={(e) => setForm({ ...form, certifications: e.target.value })} />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <Button onClick={save} loading={saving}>保存属性</Button>
                <Select
                  placeholder="选择目的国做体检"
                  options={countries.map((c) => ({ value: c.code, label: `${c.nameZh}（${c.code}）` }))}
                  value={targetCountry}
                  onChange={setTargetCountry}
                />
                <Button variant="secondary" onClick={runCheck} disabled={!targetCountry}>合规体检</Button>
              </div>
              {msg && (
                <div style={{ marginTop: 10, color: msg.tone === 'ok' ? C.success : C.danger, fontSize: 13 }}>
                  {msg.text}
                </div>
              )}
            </Card>
          )}

        {selected && check && (
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={sectionTitle}>体检结果 · {check.targetCountryNameZh}</span>
              <Badge variant={riskVariant[check.riskLevel]}>{check.riskLabel}</Badge>
              <span style={{ ...muted }}>合规分 {check.score}/100</span>
            </div>
            <div style={{ display: 'flex', gap: 16, fontSize: 13, color: C.textSecondary, marginBottom: 10 }}>
              <span>适用关税：{formatPct(check.applicableDutyRate)}</span>
              <span>{check.vatLabel}：{formatPct(check.applicableVatRate)}</span>
              <span>起征点：{check.deMinimis} {check.deMinimisCurrency}</span>
            </div>
            {check.issues.length === 0
              ? <div style={{ color: C.success, fontSize: 13 }}>未发现合规问题，可放心出运。</div>
              : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {check.issues.map((it, i) => (
                    <div key={i} style={{
                      borderLeft: `3px solid ${it.level === 'blocker' ? C.danger : it.level === 'warning' ? C.warning : C.info}`,
                      padding: '8px 10px', background: C.bgSoft, borderRadius: 4,
                    }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>
                        [{it.level === 'blocker' ? '卡关' : it.level === 'warning' ? '风险' : '提示'}] {it.title}
                      </div>
                      <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 2 }}>{it.detail}</div>
                      <div style={{ fontSize: 12, color: C.primary, marginTop: 2 }}>建议：{it.suggestion}</div>
                    </div>
                  ))}
                </div>
              )}
            {check.missingCertifications.length > 0 && (
              <div style={{ marginTop: 10, fontSize: 13, color: C.danger }}>
                缺失认证：{check.missingCertifications.join('、')}
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Tab 3：HS Code 查询
// ============================================================
function HsCodeTab() {
  const [keyword, setKeyword] = useState('');
  const [items, setItems] = useState<HsCodeSearchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (kw: string) => {
    setLoading(true); setError(null);
    try { setItems(await crossborderApi.searchHsCodes(kw || undefined, 80)); }
    catch (e: any) { setError(e?.message || '未知错误'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { search(''); }, [search]);

  return (
    <Card>
      <Input placeholder="输入 HS Code / 中文品名 / 英文品名 / 关键词，如 610910、T恤、shoe" value={keyword}
        onChange={(e) => setKeyword(e.target.value)} />
      <div style={{ margin: '12px 0 6px', ...muted }}>
        共 {items.length} 条匹配（内置参考，关税率随目的国税区变化）
      </div>
      {loading ? <LoadingState /> : error ? <ErrorState msg={error} onRetry={() => search(keyword)} />
        : items.length === 0 ? <EmptyState text="没有匹配的 HS Code" />
        : (
          <div style={{ maxHeight: 540, overflowY: 'auto' }}>
            <table style={tableStyle}>
              <thead><tr>
                <th style={thStyle}>HS Code</th>
                <th style={thStyle}>中文品名</th>
                <th style={thStyle}>英文申报品名</th>
                <th style={thStyle}>类目</th>
                <th style={thStyle}>参考关税区间</th>
              </tr></thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.code}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{it.code}</td>
                    <td style={tdStyle}>{it.nameZh}</td>
                    <td style={{ ...tdStyle, color: C.textSecondary }}>{it.nameEn}</td>
                    <td style={tdStyle}>{it.categoryZh}</td>
                    <td style={tdStyle}>{it.dutyRangeText}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </Card>
  );
}

// ============================================================
// Tab 4：汇率管理
// ============================================================
function RatesTab() {
  const [rates, setRates] = useState<ExchangeRateView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [from, setFrom] = useState('');
  const [rate, setRate] = useState('');
  const [source, setSource] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRates(await crossborderApi.getRates()); }
    catch (e: any) { setError(e?.message || '未知错误'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!from || !rate) return;
    try {
      await crossborderApi.upsertRate({ from, rate: Number(rate), source: source || undefined });
      setRate(''); setSource('');
      load();
    } catch (e: any) { setError(e?.message || '保存失败'); }
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState msg={error} onRetry={load} />;

  const editable = rates.filter((r) => r.fromCurrency !== 'CNY');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <div style={sectionTitle}>录入 / 更新汇率（外币 → CNY）</div>
        <div style={{ ...muted, marginBottom: 10 }}>
          ⚠️ 本系统不联网抓取汇率，所有数值由你本地手工维护。录入后记录时间与来源；
          超过 {rates[0]?.isStale ? '阈值' : '7'} 天未更新会标记为过期。
        </div>
        <div style={formGrid}>
          <Select placeholder="选择币种" options={editable.map((r) => ({ value: r.fromCurrency, label: `${r.fromCurrency} ${r.symbol}` }))}
            value={from} onChange={setFrom} />
          <Input placeholder="汇率（1外币 = ? CNY）" type="number" value={rate}
            onChange={(e) => setRate(e.target.value)} />
          <Input placeholder="来源（选填，如 银行结汇单）" value={source}
            onChange={(e) => setSource(e.target.value)} />
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <Button onClick={save} disabled={!from || !rate}>保存汇率</Button>
          </div>
        </div>
      </Card>

      <Card>
        <div style={sectionTitle}>当前汇率表</div>
        <table style={tableStyle}>
          <thead><tr>
            <th style={thStyle}>币种</th><th style={thStyle}>汇率(CNY)</th>
            <th style={thStyle}>来源</th><th style={thStyle}>更新时间</th>
            <th style={thStyle}>状态</th>
          </tr></thead>
          <tbody>
            {editable.map((r) => (
              <tr key={r.fromCurrency}>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{r.fromCurrency} {r.symbol}</td>
                <td style={tdStyle}>{formatNum(r.rate, 4)}</td>
                <td style={tdStyle}>{rateSourceLabel(r.source)}</td>
                <td style={tdStyle}>{formatDate(r.updatedAt)}</td>
                <td style={tdStyle}>
                  {r.isBuiltinDefault
                    ? <Badge variant="warning">内置基准·未更新</Badge>
                    : r.isStale
                      ? <Badge variant="warning">已过期 {r.ageDays} 天</Badge>
                      : <Badge variant="success">正常</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ============================================================
// Tab 5：落地成本测算
// ============================================================
function LandedCostTab() {
  const [products, setProducts] = useState<ProductCompliance[]>([]);
  const [countries, setCountries] = useState<CountryEntry[]>([]);
  const [currencies, setCurrencies] = useState<CurrencyEntry[]>([]);
  const [modes, setModes] = useState<ShippingModeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<Record<string, any>>({
    productId: '', qty: 100, destinationCountry: '', sellingPrice: 0,
    sellingCurrency: '', shippingMode: 'express',
    costPrice: 0, weightKg: 0, freightRatePerKg: 0, declaredValuePerUnit: 0,
    lengthCm: 0, widthCm: 0, heightCm: 0,
    platformFeeRate: 0.15, paymentFeeRate: 0.03, adRate: 0.05, lastMileFeePerUnit: 0,
  });
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const [result, setResult] = useState<LandedCostResult | null>(null);
  const [calcErr, setCalcErr] = useState<string | null>(null);
  const [calcLoading, setCalcLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      try {
        const [ps, cs, cur, ms] = await Promise.all([
          crossborderApi.listProducts({ limit: 200 }),
          crossborderApi.listCountries(),
          crossborderApi.listCurrencies(),
          crossborderApi.listShippingModes(),
        ]);
        setProducts(ps); setCountries(cs); setCurrencies(cur); setModes(ms);
      } catch (e: any) { setError(e?.message || '未知错误'); }
      finally { setLoading(false); }
    })();
  }, []);

  const onProductChange = (pid: string) => {
    set('productId', pid);
    const p = products.find((x) => x.productId === pid);
    if (p) {
      setForm((f) => ({
        ...f, productId: pid,
        costPrice: p.costPrice || f.costPrice,
        weightKg: p.grossWeightKg || p.netWeightKg || f.weightKg,
        lengthCm: p.lengthCm || f.lengthCm,
        widthCm: p.widthCm || f.widthCm,
        heightCm: p.heightCm || f.heightCm,
        declaredValuePerUnit: p.declaredValue || f.declaredValuePerUnit,
      }));
    }
  };

  const calc = async () => {
    setCalcLoading(true); setCalcErr(null); setResult(null);
    try {
      const r = await crossborderApi.calculateLandedCost({
        productId: form.productId || undefined,
        costPrice: Number(form.costPrice) || undefined,
        qty: Number(form.qty) || 1,
        destinationCountry: form.destinationCountry,
        sellingPrice: Number(form.sellingPrice),
        sellingCurrency: form.sellingCurrency || countries.find((c) => c.code === form.destinationCountry)?.currency || 'USD',
        shippingMode: form.shippingMode,
        weightKg: Number(form.weightKg) || undefined,
        lengthCm: Number(form.lengthCm) || undefined,
        widthCm: Number(form.widthCm) || undefined,
        heightCm: Number(form.heightCm) || undefined,
        freightRatePerKg: Number(form.freightRatePerKg) || undefined,
        declaredValuePerUnit: Number(form.declaredValuePerUnit) || undefined,
        platformFeeRate: Number(form.platformFeeRate) || 0,
        paymentFeeRate: Number(form.paymentFeeRate) || 0,
        adRate: Number(form.adRate) || 0,
        lastMileFeePerUnit: Number(form.lastMileFeePerUnit) || undefined,
      });
      setResult(r);
    } catch (e: any) { setCalcErr(e?.message || '测算失败'); }
    finally { setCalcLoading(false); }
  };

  const groupLabel: Record<string, string> = { goods: '货品', logistics: '物流', tax: '税费', channel: '渠道' };
  const groupColor: Record<string, string> = {
    goods: C.textPrimary, logistics: C.info, tax: C.warning, channel: C.success,
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState msg={error} onRetry={() => { setLoading(true); }} />;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(360px, 1fr) minmax(360px, 1fr)', gap: 16, alignItems: 'start' }}>
      <Card>
        <div style={sectionTitle}>测算参数</div>
        <div style={formGrid}>
          <Select placeholder="选择商品（可选）"
            options={[{ value: '', label: '不关联商品（手动填写）' }, ...products.map((p) => ({ value: p.productId, label: `${p.name}（${p.sku}）` }))]}
            value={form.productId} onChange={onProductChange} />
          <Input label="数量" type="number" value={form.qty} onChange={(e) => set('qty', e.target.value)} />
          <Select placeholder="目的国" options={countries.map((c) => ({ value: c.code, label: `${c.nameZh}（${c.code} · ${c.vatLabel} ${formatPct(c.vatRate)}）` }))}
            value={form.destinationCountry} onChange={(v) => {
              set('destinationCountry', v);
              const cc = countries.find((c) => c.code === v);
              if (cc) set('sellingCurrency', cc.currency);
            }} />
          <Input label="售价" type="number" value={form.sellingPrice} onChange={(e) => set('sellingPrice', e.target.value)} />
          <Select placeholder="售价币种" options={currencies.map((c) => ({ value: c.code, label: `${c.code} ${c.symbol}` }))}
            value={form.sellingCurrency} onChange={(v) => set('sellingCurrency', v)} />
          <Select placeholder="运输方式" options={modes.map((m) => ({ value: m.mode, label: `${m.nameZh}（${m.leadTimeDays}天 · ¥${m.defaultRatePerKg}/kg）` }))}
            value={form.shippingMode} onChange={(v) => set('shippingMode', v)} />
          <Input label="采购单价(CNY)" type="number" value={form.costPrice} onChange={(e) => set('costPrice', e.target.value)} />
          <Input label="单件重量(kg)" type="number" value={form.weightKg} onChange={(e) => set('weightKg', e.target.value)} />
          <Input label="长(cm)" type="number" value={form.lengthCm} onChange={(e) => set('lengthCm', e.target.value)} />
          <Input label="宽(cm)" type="number" value={form.widthCm} onChange={(e) => set('widthCm', e.target.value)} />
          <Input label="高(cm)" type="number" value={form.heightCm} onChange={(e) => set('heightCm', e.target.value)} />
          <Input label="头程单价(CNY/kg)" type="number" value={form.freightRatePerKg} onChange={(e) => set('freightRatePerKg', e.target.value)} />
          <Input label="单件申报价值(CNY)" type="number" value={form.declaredValuePerUnit} onChange={(e) => set('declaredValuePerUnit', e.target.value)} />
          <Input label="平台佣金率" type="number" value={form.platformFeeRate} onChange={(e) => set('platformFeeRate', e.target.value)} addonRight={<span style={muted}>0~1</span>} />
          <Input label="支付费率" type="number" value={form.paymentFeeRate} onChange={(e) => set('paymentFeeRate', e.target.value)} />
          <Input label="广告费占比" type="number" value={form.adRate} onChange={(e) => set('adRate', e.target.value)} />
          <Input label="尾程配送(售价币种/件)" type="number" value={form.lastMileFeePerUnit} onChange={(e) => set('lastMileFeePerUnit', e.target.value)} />
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <Button onClick={calc} loading={calcLoading}>开始测算</Button>
        </div>
        {calcErr && <div style={{ marginTop: 10, color: C.danger, fontSize: 13 }}>测算失败：{calcErr}</div>}
      </Card>

      <Card>
        <div style={sectionTitle}>测算结果</div>
        {!result
          ? <EmptyState text="填写参数后点击「开始测算」" />
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={gridStyle(150)}>
                <div><div style={muted}>落地总成本(CNY)</div><div style={{ fontSize: 20, fontWeight: 700 }}>{formatCny(result.totalCostCny)}</div></div>
                <div><div style={muted}>单件成本</div><div style={{ fontSize: 20, fontWeight: 700 }}>{formatNum(result.unitCostLocal, 2)} {result.sellingCurrency}</div></div>
                <div><div style={muted}>毛利(CNY)</div><div style={{ fontSize: 20, fontWeight: 700, color: result.grossProfitCny >= 0 ? C.success : C.danger }}>{formatCny(result.grossProfitCny)}</div></div>
                <div><div style={muted}>毛利率</div><div style={{ fontSize: 20, fontWeight: 700 }}>{formatPct(result.grossMarginRate)}</div></div>
                <div><div style={muted}>ROI</div><div style={{ fontSize: 20, fontWeight: 700 }}>{formatPct(result.roi)}</div></div>
                <div><div style={muted}>盈亏平衡售价</div><div style={{ fontSize: 20, fontWeight: 700 }}>{formatNum(result.breakEvenPriceLocal, 2)} {result.sellingCurrency}</div></div>
              </div>

              <div style={{ ...muted }}>
                汇率 1 {result.sellingCurrency} = {formatNum(result.fxRate, 4)} CNY（{rateSourceLabel(result.fxSource)}
                {result.fxIsStale ? ' · 已过期' : ''}）· HS {result.hsCode || '未指定'} · 关税 {formatPct(result.dutyRate)} · {result.vatLabel} {formatPct(result.vatRate)}
              </div>

              <div>
                <div style={sectionTitle}>成本瀑布</div>
                <table style={tableStyle}>
                  <thead><tr>
                    <th style={thStyle}>项目</th><th style={thStyle}>金额(CNY)</th>
                    <th style={thStyle}>占比</th><th style={thStyle}>计算口径</th>
                  </tr></thead>
                  <tbody>
                    {result.lines.map((l) => (
                      <tr key={l.key}>
                        <td style={tdStyle}>
                          <span style={{ color: groupColor[l.group], fontWeight: 600 }}>●</span> {l.label}
                        </td>
                        <td style={tdStyle}>{formatCny(l.amountCny)}</td>
                        <td style={tdStyle}>{formatPct(l.ratio)}</td>
                        <td style={{ ...tdStyle, fontSize: 12, color: C.textSecondary }}>{l.formula}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {result.notes?.length > 0 && (
                <div style={{ background: C.bgSoft, padding: 10, borderRadius: 6 }}>
                  {result.notes.map((n, i) => <div key={i} style={{ ...muted }}>· {n}</div>)}
                </div>
              )}
            </div>
          )}
      </Card>
    </div>
  );
}

// ============================================================
// 主入口
// ============================================================
export default function CrossBorderHub() {
  return (
    <div style={pageStyle}>
      <div style={{ fontSize: 18, fontWeight: 700, color: C.textPrimary }}>跨境电商中心</div>
      <Tab
        items={[
          { key: 'overview', label: '概览', content: <OverviewTab /> },
          { key: 'compliance', label: '合规管理', content: <ComplianceTab /> },
          { key: 'hscode', label: 'HS Code 查询', content: <HsCodeTab /> },
          { key: 'rates', label: '汇率管理', content: <RatesTab /> },
          { key: 'landed', label: '落地成本测算', content: <LandedCostTab /> },
        ]}
      />
    </div>
  );
}
