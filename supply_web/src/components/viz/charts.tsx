"use client";

import { useCallback, useState } from "react";
import { compact, dateLabel, dateLabelLong, fullNumber, niceScale } from "@/lib/viz";
import { Tip, useWidth, type TipRow } from "./parts";

export type Series = { key: string; label: string; color: string };
export type Point = { date: string; values: number[] };
type Granularity = "day" | "week" | "month";

const M = { l: 44, r: 12, t: 10, b: 26 };

/** Evenly spread x labels that never touch: as many as fit, always including the last. */
function xTicks(n: number, plotW: number, minGap = 62): number[] {
  if (n <= 1) return [0];
  const fit = Math.max(2, Math.floor(plotW / minGap));
  const step = Math.ceil((n - 1) / (fit - 1));
  const out: number[] = [];
  for (let i = n - 1; i >= 0; i -= step) out.unshift(i);
  return out;
}

function Frame({ width, height, ticks, max, plotW, plotH, children }: { width: number; height: number; ticks: number[]; max: number; plotW: number; plotH: number; children: React.ReactNode }) {
  return (
    <>
      {ticks.map((v) => {
        const y = M.t + plotH - (v / max) * plotH;
        return (
          <g key={v}>
            <line x1={M.l} x2={M.l + plotW} y1={y} y2={y} stroke={v === 0 ? "var(--viz-axis)" : "var(--viz-grid)"} strokeWidth={1} />
            <text x={M.l - 8} y={y + 4} textAnchor="end" fontSize={11} fill="var(--viz-muted)">{compact(v)}</text>
          </g>
        );
      })}
      {children}
      <rect x={0} y={0} width={width} height={height} fill="none" />
    </>
  );
}

/** Lines over time, one axis. Crosshair + one tooltip for every series; arrow keys move it too. */
export function LineChart({ points, series, granularity, label }: { points: Point[]; series: Series[]; granularity: Granularity; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const height = width < 480 ? 200 : 250;
  const [hover, setHover] = useState<number | null>(null);
  const plotW = Math.max(40, width - M.l - M.r);
  const plotH = height - M.t - M.b;
  const maxV = Math.max(0, ...points.flatMap((p) => p.values));
  const { max, ticks } = niceScale(maxV);
  const n = points.length;
  const x = useCallback((i: number) => M.l + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW), [n, plotW]);
  const y = (v: number) => M.t + plotH - (v / max) * plotH;
  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect(); // the plot area: the pointer only has to be near a day, not on a line
    setHover(n <= 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((e.clientX - box.left) / box.width) * (n - 1)))));
  };
  const tipRows: TipRow[] = hover === null ? [] : series.map((s, k) => ({ label: s.label, value: fullNumber(points[hover].values[k]), color: s.color }));

  return (
    <div ref={ref} className="relative w-full" dir="ltr" data-chart-scroll>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label} tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
            if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? n) - 1));
            if (e.key === "Escape") setHover(null);
          }} onBlur={() => setHover(null)} className="block overflow-visible outline-none focus-visible:ring-2 focus-visible:ring-brand-200 rounded">
          <Frame width={width} height={height} ticks={ticks} max={max} plotW={plotW} plotH={plotH}>
            {xTicks(n, plotW).map((i) => (
              <text key={i} x={x(i)} y={height - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize={11} fill="var(--viz-muted)">{dateLabel(points[i].date, granularity)}</text>
            ))}
            {series.map((s, k) => {
              const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.values[k]).toFixed(1)}`).join("");
              const area = `${d}L${x(n - 1).toFixed(1)},${M.t + plotH}L${x(0).toFixed(1)},${M.t + plotH}Z`;
              return (
                <g key={s.key}>
                  {series.length === 1 && <path d={area} fill={s.color} opacity={0.1} />}
                  <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  {n > 0 && <circle cx={x(n - 1)} cy={y(points[n - 1].values[k])} r={4} fill={s.color} stroke="var(--color-surface)" strokeWidth={2} />}
                </g>
              );
            })}
            {hover !== null && (
              <g pointerEvents="none">
                <line x1={x(hover)} x2={x(hover)} y1={M.t} y2={M.t + plotH} stroke="var(--viz-axis)" strokeWidth={1} />
                {series.map((s, k) => <circle key={s.key} cx={x(hover)} cy={y(points[hover].values[k])} r={4} fill={s.color} stroke="var(--color-surface)" strokeWidth={2} />)}
              </g>
            )}
            <rect x={M.l} y={M.t} width={plotW} height={plotH} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} style={{ touchAction: "pan-y" }} />
          </Frame>
        </svg>
      )}
      {hover !== null && <Tip x={x(hover)} y={M.t + 6} width={width} title={dateLabelLong(points[hover].date, granularity)} rows={tipRows} />}
    </div>
  );
}

/** Columns over time; several series stack with a 2px surface gap. One tooltip per column. */
export function ColumnChart({ points, series, granularity, label }: { points: Point[]; series: Series[]; granularity: Granularity; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const height = width < 480 ? 200 : 250;
  const [hover, setHover] = useState<number | null>(null);
  const plotW = Math.max(40, width - M.l - M.r);
  const plotH = height - M.t - M.b;
  const totals = points.map((p) => p.values.reduce((a, b) => a + b, 0));
  const { max, ticks } = niceScale(Math.max(0, ...totals));
  const n = points.length;
  const band = plotW / Math.max(1, n);
  const bw = Math.max(3, Math.min(24, band * 0.7));
  const cx = (i: number) => M.l + band * i + band / 2;
  const tipRows: TipRow[] = hover === null ? [] : [...series.map((s, k) => ({ label: s.label, value: fullNumber(points[hover].values[k]), color: s.color }))];

  return (
    <div ref={ref} className="relative w-full" dir="ltr" data-chart-scroll>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label} className="block overflow-visible">
          <Frame width={width} height={height} ticks={ticks} max={max} plotW={plotW} plotH={plotH}>
            {xTicks(n, plotW, 56).map((i) => (
              <text key={i} x={cx(i)} y={height - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize={11} fill="var(--viz-muted)">{dateLabel(points[i].date, granularity)}</text>
            ))}
            {points.map((p, i) => {
              let acc = 0;
              const segs = p.values.map((v, k) => ({ v, k })).filter((s) => s.v > 0);
              return (
                <g key={p.date} opacity={hover === null || hover === i ? 1 : 0.55}>
                  {segs.map((s, idx) => {
                    const h = (s.v / max) * plotH;
                    const yTop = M.t + plotH - ((acc + s.v) / max) * plotH;
                    acc += s.v;
                    const isTop = idx === segs.length - 1;
                    const gap = idx === 0 ? 0 : 2; // the surface shows through between stacked segments
                    const hh = Math.max(1, h - gap);
                    const r = isTop ? Math.min(4, bw / 2, hh) : 0;
                    const x0 = cx(i) - bw / 2, x1 = cx(i) + bw / 2, yb = yTop + hh;
                    const path = `M${x0},${yb}V${yTop + r}${r ? `Q${x0},${yTop} ${x0 + r},${yTop}` : ""}H${x1 - r}${r ? `Q${x1},${yTop} ${x1},${yTop + r}` : ""}V${yb}Z`;
                    return <path key={s.k} d={path} fill={series[s.k].color} />;
                  })}
                </g>
              );
            })}
            {points.map((p, i) => (
              <rect key={`hit-${p.date}`} x={M.l + band * i} y={M.t} width={band} height={plotH} fill="transparent" tabIndex={0}
                aria-label={`${dateLabelLong(p.date, granularity)}: ${series.map((s, k) => `${s.label} ${p.values[k]}`).join(", ")}`}
                onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} />
            ))}
          </Frame>
        </svg>
      )}
      {hover !== null && <Tip x={cx(hover)} y={M.t + 4} width={width} title={dateLabelLong(points[hover].date, granularity)} rows={tipRows} />}
    </div>
  );
}
