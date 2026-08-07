/**
 * Vorzai 数据分析 — 内联 SVG 图表组件库
 *
 * 全部手写 SVG，零第三方依赖（不引入 ECharts / Chart.js / D3），
 * 桌面端包体积敏感，且不破坏现有构建。
 *
 * 配色策略：使用中间调语义色，亮/暗主题下均有足够对比度；
 * 文字与网格线一律走 CSS 变量，跟随主题切换。
 */
import { useState } from 'react';
import type { ReactNode, CSSProperties } from 'react';

// ═══════════════ 通用配色 ═══════════════

/** 分类调色板：亮暗主题下都能看清的中间调 */
export const PALETTE = [
  '#2563eb', '#16a34a', '#f59e0b', '#dc2626',
  '#7c3aed', '#0891b2', '#db2777', '#65a30d',
  '#ea580c', '#0d9488', '#9333ea', '#4b5563',
];

export const COLOR_UP = '#16a34a';    // 涨（绿）
export const COLOR_DOWN = '#dc2626';  // 跌（红）
export const COLOR_NEUTRAL = 'var(--text-muted)';

const AXIS = 'var(--border-card)';
const TEXT_MUTED = 'var(--text-muted)';
const TEXT_PRIMARY = 'var(--text-primary)';

export function colorAt(i: number): string {
  return PALETTE[i % PALETTE.length];
}

// ═══════════════ 三态占位组件 ═══════════════

/** 加载骨架 */
export function ChartSkeleton({ height = 200 }: { height?: number }) {
  return (
    <div
      style={{
        height,
        borderRadius: 8,
        background: 'linear-gradient(90deg, var(--bg-row-hover) 25%, var(--bg-card-hover, var(--bg-toolbar)) 50%, var(--bg-row-hover) 75%)',
        backgroundSize: '200% 100%',
        animation: 'vorzai-shimmer 1.4s ease-in-out infinite',
      }}
      aria-label="加载中"
    />
  );
}

/** 空数据引导 */
export function EmptyState({
  title, reason, action, height = 200,
}: { title: string; reason?: string; action?: ReactNode; height?: number }) {
  return (
    <div
      style={{
        minHeight: height,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 8, padding: 20, textAlign: 'center',
      }}
    >
      <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
        <rect x="6" y="20" width="6" height="13" rx="1.5" fill={TEXT_MUTED} opacity="0.35" />
        <rect x="17" y="13" width="6" height="20" rx="1.5" fill={TEXT_MUTED} opacity="0.25" />
        <rect x="28" y="24" width="6" height="9" rx="1.5" fill={TEXT_MUTED} opacity="0.35" />
        <line x1="4" y1="35" x2="36" y2="35" stroke={TEXT_MUTED} strokeWidth="1.5" opacity="0.5" />
      </svg>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>{title}</div>
      {reason && (
        <div style={{ fontSize: 11, color: TEXT_MUTED, maxWidth: 420, lineHeight: 1.6 }}>
          {reason}
        </div>
      )}
      {action}
    </div>
  );
}

/** 错误重试 */
export function ErrorState({
  message, onRetry, height = 160,
}: { message: string; onRetry?: () => void; height?: number }) {
  return (
    <div
      style={{
        minHeight: height,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 10, padding: 20, textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: COLOR_DOWN }}>加载失败</div>
      <div style={{ fontSize: 11, color: TEXT_MUTED, maxWidth: 420, lineHeight: 1.6 }}>{message}</div>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            marginTop: 4, padding: '5px 14px', borderRadius: 6, cursor: 'pointer',
            border: '1px solid var(--border-card)', background: 'var(--bg-toolbar)',
            color: TEXT_PRIMARY, fontSize: 12,
          }}
        >
          重新加载
        </button>
      )}
    </div>
  );
}

/** 口径说明小图标（hover 展开 tooltip） */
export function FormulaTip({ text, label = '口径' }: { text: string; label?: string }) {
  const [show, setShow] = useState(false);
  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <span
        style={{
          width: 14, height: 14, borderRadius: '50%',
          border: `1px solid ${AXIS}`, color: TEXT_MUTED,
          fontSize: 9, lineHeight: '12px', textAlign: 'center',
          cursor: 'help', userSelect: 'none', display: 'inline-block',
        }}
        aria-label={`${label}说明`}
      >
        ?
      </span>
      {show && (
        <span
          style={{
            position: 'absolute', bottom: '150%', left: '50%', transform: 'translateX(-50%)',
            zIndex: 40, width: 260, padding: '8px 10px', borderRadius: 6,
            background: 'var(--bg-tooltip, #1f2937)', color: '#f9fafb',
            fontSize: 11, lineHeight: 1.6, textAlign: 'left',
            boxShadow: '0 4px 14px rgba(0,0,0,0.25)', pointerEvents: 'none',
            whiteSpace: 'normal',
          }}
        >
          <strong style={{ display: 'block', marginBottom: 2 }}>{label}</strong>
          {text}
        </span>
      )}
    </span>
  );
}

// ═══════════════ 折线图 ═══════════════

export interface LinePoint { label: string; value: number }

/**
 * 折线图：带网格、坐标轴、hover 数值提示。
 * 空数组 / 全 0 也如实呈现，不做任何视觉美化填充。
 */
export function LineChart({
  points, format, color = PALETTE[0], height = 240,
}: {
  points: LinePoint[];
  format: (n: number) => string;
  color?: string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const W = 840;
  const H = height;
  const padL = 64, padR = 20, padT = 16, padB = 34;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  if (points.length === 0) {
    return <EmptyState title="暂无趋势数据" reason="所选区间内没有可用于绘制趋势的时间桶" height={height} />;
  }

  const values = points.map((p) => p.value);
  const rawMax = Math.max(...values, 0);
  const rawMin = Math.min(...values, 0);
  // 全 0 时给一个名义刻度，避免除零；曲线仍贴基线，不虚构高度
  const max = rawMax === rawMin ? (rawMax === 0 ? 1 : rawMax * 1.2) : rawMax;
  const min = rawMin < 0 ? rawMin : 0;
  const span = max - min || 1;

  const x = (i: number) =>
    points.length === 1 ? padL + innerW / 2 : padL + (i / (points.length - 1)) * innerW;
  const y = (v: number) => padT + innerH - ((v - min) / span) * innerH;

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const areaPath = `${path} L${x(points.length - 1).toFixed(1)},${y(min).toFixed(1)} L${x(0).toFixed(1)},${y(min).toFixed(1)} Z`;

  // y 轴 5 档刻度
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => min + span * t);
  // x 轴标签抽稀
  const labelStep = Math.max(1, Math.ceil(points.length / 8));

  const gradId = `vorzai-line-grad-${color.replace('#', '')}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height} role="img" aria-label="趋势折线图">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* 网格与 y 轴刻度 */}
      {ticks.map((t, i) => (
        <g key={i}>
          <line
            x1={padL} y1={y(t)} x2={W - padR} y2={y(t)}
            stroke={AXIS} strokeWidth="1" strokeDasharray={i === 0 ? '0' : '3 3'} opacity="0.7"
          />
          <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize="10" fill={TEXT_MUTED}>
            {format(t)}
          </text>
        </g>
      ))}

      {/* 面积 + 折线 */}
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

      {/* 数据点 */}
      {points.map((p, i) => (
        <circle
          key={i} cx={x(i)} cy={y(p.value)}
          r={hover === i ? 4.5 : points.length > 40 ? 0 : 2.5}
          fill="var(--bg-card)" stroke={color} strokeWidth="2"
        />
      ))}

      {/* x 轴标签 */}
      {points.map((p, i) =>
        i % labelStep === 0 || i === points.length - 1 ? (
          <text key={i} x={x(i)} y={H - 12} textAnchor="middle" fontSize="10" fill={TEXT_MUTED}>
            {p.label}
          </text>
        ) : null
      )}

      {/* hover 捕获层 */}
      {points.map((p, i) => (
        <rect
          key={`hit-${i}`}
          x={x(i) - innerW / Math.max(points.length, 1) / 2}
          y={padT}
          width={innerW / Math.max(points.length, 1)}
          height={innerH}
          fill="transparent"
          onMouseEnter={() => setHover(i)}
          onMouseLeave={() => setHover(null)}
        />
      ))}

      {/* hover 提示 */}
      {hover !== null && (
        <g pointerEvents="none">
          <line x1={x(hover)} y1={padT} x2={x(hover)} y2={padT + innerH} stroke={color} strokeWidth="1" strokeDasharray="4 3" opacity="0.6" />
          {(() => {
            const text = `${points[hover].label} · ${format(points[hover].value)}`;
            const w = text.length * 7.2 + 16;
            const tx = Math.min(Math.max(x(hover) - w / 2, padL), W - padR - w);
            const ty = Math.max(y(points[hover].value) - 34, padT);
            return (
              <>
                <rect x={tx} y={ty} width={w} height={24} rx="4" fill="var(--bg-tooltip, #1f2937)" opacity="0.95" />
                <text x={tx + w / 2} y={ty + 16} textAnchor="middle" fontSize="11" fill="#f9fafb">
                  {text}
                </text>
              </>
            );
          })()}
        </g>
      )}
    </svg>
  );
}

// ═══════════════ 横向柱状图 ═══════════════

export interface BarItem { key: string; label: string; value: number; share?: number; color?: string }

export function HorizontalBarChart({
  items, format, rowHeight = 30, labelWidth = 130,
}: {
  items: BarItem[];
  format: (n: number) => string;
  rowHeight?: number;
  labelWidth?: number;
}) {
  if (items.length === 0) {
    return <EmptyState title="暂无可拆解数据" height={140} />;
  }

  const W = 840;
  const H = items.length * rowHeight + 8;
  const padR = 110;
  const barMax = W - labelWidth - padR;
  const maxVal = Math.max(...items.map((i) => Math.abs(i.value)), 1);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="横向柱状图">
      {items.map((it, i) => {
        const w = Math.max((Math.abs(it.value) / maxVal) * barMax, it.value !== 0 ? 2 : 0);
        const yTop = i * rowHeight + 4;
        const fill = it.color || (it.key === '__other__' ? '#94a3b8' : colorAt(i));
        return (
          <g key={it.key}>
            <text x={labelWidth - 10} y={yTop + rowHeight / 2 + 1} textAnchor="end" fontSize="11" fill="var(--text-secondary)">
              {truncate(it.label, 14)}
            </text>
            <rect x={labelWidth} y={yTop + 4} width={barMax} height={rowHeight - 14} rx="3" fill="var(--bg-row-hover)" />
            <rect x={labelWidth} y={yTop + 4} width={w} height={rowHeight - 14} rx="3" fill={fill}>
              <title>{`${it.label}：${format(it.value)}`}</title>
            </rect>
            <text x={labelWidth + barMax + 8} y={yTop + rowHeight / 2 + 1} fontSize="11" fill={TEXT_PRIMARY}>
              {format(it.value)}
            </text>
            {it.share !== undefined && (
              <text x={W - 4} y={yTop + rowHeight / 2 + 1} textAnchor="end" fontSize="10" fill={TEXT_MUTED}>
                {(it.share * 100).toFixed(1)}%
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ═══════════════ 竖向柱状图 ═══════════════

export function VerticalBarChart({
  items, format, height = 220,
}: { items: BarItem[]; format: (n: number) => string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);

  if (items.length === 0) {
    return <EmptyState title="暂无对比数据" height={height} />;
  }

  const W = 840;
  const H = height;
  const padT = 20, padB = 40, padL = 56, padR = 16;
  const innerH = H - padT - padB;
  const innerW = W - padL - padR;
  const maxVal = Math.max(...items.map((i) => i.value), 1);
  const slot = innerW / items.length;
  const barW = Math.min(slot * 0.55, 48);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="竖向柱状图">
      {[0, 0.5, 1].map((t, i) => (
        <g key={i}>
          <line x1={padL} y1={padT + innerH * (1 - t)} x2={W - padR} y2={padT + innerH * (1 - t)}
            stroke={AXIS} strokeWidth="1" strokeDasharray={t === 0 ? '0' : '3 3'} opacity="0.7" />
          <text x={padL - 8} y={padT + innerH * (1 - t) + 4} textAnchor="end" fontSize="10" fill={TEXT_MUTED}>
            {format(maxVal * t)}
          </text>
        </g>
      ))}
      {items.map((it, i) => {
        const h = (it.value / maxVal) * innerH;
        const cx = padL + slot * i + slot / 2;
        return (
          <g key={it.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <rect
              x={cx - barW / 2} y={padT + innerH - h} width={barW} height={Math.max(h, it.value > 0 ? 2 : 0)}
              rx="3" fill={it.color || colorAt(i)} opacity={hover === null || hover === i ? 1 : 0.55}
            >
              <title>{`${it.label}：${format(it.value)}`}</title>
            </rect>
            <text x={cx} y={H - 22} textAnchor="middle" fontSize="10" fill="var(--text-secondary)">
              {truncate(it.label, 8)}
            </text>
            <text x={cx} y={H - 8} textAnchor="middle" fontSize="9" fill={TEXT_MUTED}>
              {format(it.value)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ═══════════════ 环形图 ═══════════════

export interface DonutSlice { key: string; label: string; value: number; color?: string }

export function DonutChart({
  slices, format, centerTitle, centerValue, size = 200,
}: {
  slices: DonutSlice[];
  format: (n: number) => string;
  centerTitle?: string;
  centerValue?: string;
  size?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const total = slices.reduce((s, x) => s + Math.max(x.value, 0), 0);

  if (total <= 0) {
    return <EmptyState title="暂无占比数据" reason="所有分项数值为 0，无法绘制占比" height={size} />;
  }

  const R = size / 2;
  const outer = R - 6;
  const inner = outer * 0.62;
  let acc = 0;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="占比环形图">
        {slices.map((s, i) => {
          const v = Math.max(s.value, 0);
          if (v <= 0) return null;
          const startAngle = (acc / total) * Math.PI * 2 - Math.PI / 2;
          acc += v;
          const endAngle = (acc / total) * Math.PI * 2 - Math.PI / 2;
          const large = endAngle - startAngle > Math.PI ? 1 : 0;
          const grow = hover === i ? 2 : 0;

          const p = (ang: number, r: number) =>
            `${(R + Math.cos(ang) * r).toFixed(2)},${(R + Math.sin(ang) * r).toFixed(2)}`;

          // 满圆特判：单一分片占 100% 时 arc 会退化
          const d = v === total
            ? `M ${R},${R - outer - grow} A ${outer + grow},${outer + grow} 0 1 1 ${R - 0.01},${R - outer - grow}`
              + ` L ${R - 0.01},${R - inner} A ${inner},${inner} 0 1 0 ${R},${R - inner} Z`
            : `M ${p(startAngle, outer + grow)} A ${outer + grow},${outer + grow} 0 ${large} 1 ${p(endAngle, outer + grow)}`
              + ` L ${p(endAngle, inner)} A ${inner},${inner} 0 ${large} 0 ${p(startAngle, inner)} Z`;

          return (
            <path
              key={s.key} d={d} fill={s.color || colorAt(i)}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
              style={{ cursor: 'default', transition: 'opacity .15s' }}
              opacity={hover === null || hover === i ? 1 : 0.55}
            >
              <title>{`${s.label}：${format(v)}（${((v / total) * 100).toFixed(1)}%）`}</title>
            </path>
          );
        })}
        {centerValue && (
          <text x={R} y={R + 2} textAnchor="middle" fontSize="18" fontWeight="700" fill={TEXT_PRIMARY}>
            {centerValue}
          </text>
        )}
        {centerTitle && (
          <text x={R} y={R + 20} textAnchor="middle" fontSize="10" fill={TEXT_MUTED}>
            {centerTitle}
          </text>
        )}
      </svg>

      {/* 图例 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 180, flex: 1 }}>
        {slices.map((s, i) => (
          <div
            key={s.key}
            style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color || colorAt(i), flexShrink: 0 }} />
            <span style={{ color: 'var(--text-secondary)', flex: 1 }}>{truncate(s.label, 16)}</span>
            <span style={{ color: TEXT_PRIMARY }}>{format(s.value)}</span>
            <span style={{ color: TEXT_MUTED, width: 46, textAlign: 'right' }}>
              {((Math.max(s.value, 0) / total) * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════ 漏斗图 ═══════════════

export interface FunnelStageItem {
  id: string;
  label: string;
  count: number;
  conversionRate: number;
  lossCount: number;
}

export function FunnelChart({ stages }: { stages: FunnelStageItem[] }) {
  if (stages.length === 0) {
    return <EmptyState title="暂无漏斗数据" height={200} />;
  }

  const W = 840;
  const rowH = 54;
  const H = stages.length * rowH + 16;
  const maxCount = Math.max(...stages.map((s) => s.count), 1);
  const centerX = W / 2 - 60;
  const maxHalf = 230;

  const halfOf = (c: number) => Math.max((c / maxCount) * maxHalf, c > 0 ? 6 : 1.5);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="全链路漏斗图">
      {stages.map((s, i) => {
        const yTop = i * rowH + 8;
        const yBot = yTop + rowH - 14;
        const h1 = halfOf(s.count);
        const h2 = i < stages.length - 1 ? halfOf(stages[i + 1].count) : h1 * 0.92;
        const fill = colorAt(i);

        return (
          <g key={s.id}>
            {/* 梯形段 */}
            <path
              d={`M ${centerX - h1},${yTop} L ${centerX + h1},${yTop} L ${centerX + h2},${yBot} L ${centerX - h2},${yBot} Z`}
              fill={fill} opacity="0.85"
            >
              <title>{`${s.label}：${s.count}`}</title>
            </path>

            {/* 段内文字 */}
            <text x={centerX} y={yTop + (rowH - 14) / 2 + 4} textAnchor="middle" fontSize="12" fontWeight="600" fill="#ffffff">
              {s.label} · {s.count.toLocaleString('zh-CN')}
            </text>

            {/* 左侧转化率 */}
            {i > 0 && (
              <text x={centerX - maxHalf - 16} y={yTop + 4} textAnchor="end" fontSize="11" fill="var(--text-secondary)">
                转化 {(s.conversionRate * 100).toFixed(1)}%
              </text>
            )}

            {/* 右侧流失（红色标注） */}
            {i > 0 && s.lossCount > 0 && (
              <text x={centerX + maxHalf + 16} y={yTop + 4} fontSize="11" fill={COLOR_DOWN}>
                流失 {s.lossCount.toLocaleString('zh-CN')}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ═══════════════ 雷达图 ═══════════════

export interface RadarDim { key: string; label: string; score: number | null }

/**
 * 六维雷达图。
 * score 为 null 的维度不参与连线（不画成 0 分，避免误导），
 * 轴标签标注「无数据」。
 */
export function RadarChart({ dims, size = 300 }: { dims: RadarDim[]; size?: number }) {
  if (dims.length < 3) {
    return <EmptyState title="维度不足，无法绘制雷达图" height={size} />;
  }

  const C = size / 2;
  const R = size / 2 - 46;
  const n = dims.length;
  const angleOf = (i: number) => (i / n) * Math.PI * 2 - Math.PI / 2;
  const pt = (i: number, r: number) => ({
    x: C + Math.cos(angleOf(i)) * r,
    y: C + Math.sin(angleOf(i)) * r,
  });

  const rings = [0.25, 0.5, 0.75, 1];
  const valid = dims.map((d, i) => ({ d, i })).filter((x) => x.d.score !== null);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="经营健康度雷达图">
      {/* 同心网格 */}
      {rings.map((r, ri) => (
        <polygon
          key={ri}
          points={dims.map((_, i) => { const p = pt(i, R * r); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join(' ')}
          fill="none" stroke={AXIS} strokeWidth="1" opacity={ri === rings.length - 1 ? 0.9 : 0.5}
        />
      ))}

      {/* 轴线 */}
      {dims.map((_, i) => {
        const p = pt(i, R);
        return <line key={i} x1={C} y1={C} x2={p.x} y2={p.y} stroke={AXIS} strokeWidth="1" opacity="0.5" />;
      })}

      {/* 有效分数连线：仅相邻两点都有效时连接 */}
      {valid.length >= 2 && dims.map((d, i) => {
        const next = (i + 1) % n;
        if (d.score === null || dims[next].score === null) return null;
        const a = pt(i, R * (d.score / 100));
        const b = pt(next, R * ((dims[next].score as number) / 100));
        return <line key={`seg-${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={PALETTE[0]} strokeWidth="2" />;
      })}

      {/* 有效区域填充（全维度有效时才填，避免残缺多边形误导） */}
      {valid.length === n && (
        <polygon
          points={dims.map((d, i) => {
            const p = pt(i, R * ((d.score as number) / 100));
            return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
          }).join(' ')}
          fill={PALETTE[0]} opacity="0.16"
        />
      )}

      {/* 数据点 */}
      {dims.map((d, i) => {
        if (d.score === null) return null;
        const p = pt(i, R * (d.score / 100));
        return (
          <circle key={`dot-${i}`} cx={p.x} cy={p.y} r="4" fill={PALETTE[0]} stroke="var(--bg-card)" strokeWidth="1.5">
            <title>{`${d.label}：${d.score} 分`}</title>
          </circle>
        );
      })}

      {/* 轴标签 */}
      {dims.map((d, i) => {
        const p = pt(i, R + 24);
        const anchor = Math.abs(p.x - C) < 6 ? 'middle' : p.x > C ? 'start' : 'end';
        return (
          <g key={`lb-${i}`}>
            <text x={p.x} y={p.y} textAnchor={anchor} fontSize="11" fill="var(--text-secondary)" fontWeight="500">
              {d.label}
            </text>
            <text
              x={p.x} y={p.y + 13} textAnchor={anchor} fontSize="10"
              fill={d.score === null ? TEXT_MUTED : TEXT_PRIMARY}
            >
              {d.score === null ? '无数据' : `${d.score} 分`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ═══════════════ 热力条（堆叠占比条）═══════════════

export interface HeatSegment { key: string; label: string; value: number; color?: string }

export function StackedHeatBar({
  segments, format, height = 26,
}: { segments: HeatSegment[]; format: (n: number) => string; height?: number }) {
  const total = segments.reduce((s, x) => s + Math.max(x.value, 0), 0);
  if (total <= 0) {
    return <EmptyState title="暂无分布数据" height={80} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', width: '100%', height, borderRadius: 6, overflow: 'hidden' }}>
        {segments.map((s, i) => {
          const share = Math.max(s.value, 0) / total;
          if (share <= 0) return null;
          return (
            <div
              key={s.key}
              title={`${s.label}：${format(s.value)}（${(share * 100).toFixed(1)}%）`}
              style={{
                width: `${share * 100}%`,
                background: s.color || colorAt(i),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, color: '#fff', fontWeight: 600, overflow: 'hidden',
              }}
            >
              {share > 0.08 ? `${(share * 100).toFixed(0)}%` : ''}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {segments.map((s, i) => (
          <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-secondary)' }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color || colorAt(i) }} />
            {s.label} · {format(s.value)}
          </span>
        ))}
      </div>
    </div>
  );
}

// ═══════════════ 同环比箭头 ═══════════════

export function ChangeBadge({
  changeRate, invert = false,
}: {
  /** null 表示无可比基期 */
  changeRate: number | null;
  /** true 表示「跌才是好」（如退款率），配色反转 */
  invert?: boolean;
}) {
  if (changeRate === null) {
    return <span style={{ fontSize: 11, color: COLOR_NEUTRAL }}>无可比基期</span>;
  }
  const up = changeRate > 0;
  const flat = Math.abs(changeRate) < 0.0001;
  const good = invert ? !up : up;
  const color = flat ? COLOR_NEUTRAL : good ? COLOR_UP : COLOR_DOWN;
  const arrow = flat ? '—' : up ? '▲' : '▼';
  return (
    <span style={{ fontSize: 11, color, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <span>{arrow}</span>
      <span>{(Math.abs(changeRate) * 100).toFixed(1)}%</span>
    </span>
  );
}

// ═══════════════ 小工具 ═══════════════

export function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** 表格通用样式 */
export const tableStyle: CSSProperties = {
  width: '100%', borderCollapse: 'collapse', fontSize: 11,
};
export const thStyle: CSSProperties = {
  textAlign: 'left', padding: '7px 8px', color: TEXT_MUTED,
  borderBottom: `1px solid ${AXIS}`, fontWeight: 500, whiteSpace: 'nowrap',
};
export const tdStyle: CSSProperties = {
  padding: '7px 8px', color: 'var(--text-secondary)',
  borderBottom: '1px solid var(--border-card)', whiteSpace: 'nowrap',
};
