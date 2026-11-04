"use client";

import { useState } from "react";
import clsx from "clsx";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { fullNumber } from "@/lib/viz";
import { Tip, useWidth, type TipRow } from "./parts";

/** Ranked horizontal bars (one hue). With `done`, the bar shows how much of the request was met. */
export function RankedBars({ rows, unit, color = "var(--viz-1)", emptyLabel }: {
  rows: { id: number | string; label: string; value: number; done?: number; display: string; detail?: TipRow[] }[]; unit?: string; color?: string; emptyLabel: string;
}) {
  const [hover, setHover] = useState<string | number | null>(null);
  const max = Math.max(...rows.map((r) => r.value), 0);
  if (!rows.length) return <p className="grid min-h-32 place-items-center rounded-xl bg-canvas/60 text-sm text-muted">{emptyLabel}</p>;
  return (
    <ol className="space-y-3">
      {rows.map((r) => {
        const w = max ? (r.value / max) * 100 : 0;
        const doneW = r.done !== undefined && r.value ? Math.min(100, (r.done / r.value) * 100) : null;
        return (
          <li key={r.id} className="relative" tabIndex={0} onPointerEnter={() => setHover(r.id)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(r.id)} onBlur={() => setHover(null)}
            aria-label={`${r.label}: ${r.display}`}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-semibold">{r.label}</span>
              <span className="num shrink-0 text-xs font-bold text-muted">{r.display}{unit ? ` ${unit}` : ""}</span>
            </div>
            <div className="h-2.5 w-full" style={{ opacity: hover === null || hover === r.id ? 1 : 0.55 }}>
              <div className="h-full rounded-e-[4px]" style={{ width: `${Math.max(w, 1.5)}%`, background: doneW === null ? color : `color-mix(in oklab, ${color} 28%, var(--color-surface))` }}>
                {doneW !== null && <div className="h-full rounded-e-[4px]" style={{ width: `${doneW}%`, background: color }} />}
              </div>
            </div>
            {hover === r.id && r.detail && <div className="absolute end-0 top-0"><Tip x={0} y={-10} width={190} rows={r.detail} title={r.label} /></div>}
          </li>
        );
      })}
    </ol>
  );
}

export type Part = { key: string; label: string; value: number; color: string; ink?: string };

/** One whole split into a few parts, read at a glance: a tall bar, names in the legend, shares printed where they fit. */
export function SegmentedBar({ parts, label }: { parts: Part[]; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  const total = parts.reduce((s, p) => s + p.value, 0);
  const shown = parts.filter((p) => p.value > 0);
  return (
    <div>
      <div ref={ref} className="flex h-7 w-full gap-0.5" role="img" aria-label={`${label}: ${shown.map((p) => `${p.label} ${p.value}`).join(", ")}`}>
        {shown.map((p) => {
          const w = (p.value / total) * width;
          const pct = Math.round((p.value / total) * 100);
          return (
            <div key={p.key} tabIndex={0} className="relative flex h-full min-w-1 items-center justify-start overflow-visible rounded-[4px] ps-2 text-xs font-bold"
              style={{ flexGrow: p.value, flexBasis: 0, background: p.color, color: p.ink ?? "#fff", opacity: hover === null || hover === p.key ? 1 : 0.6 }}
              onPointerEnter={() => setHover(p.key)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(p.key)} onBlur={() => setHover(null)}>
              {w > 44 && <span className="num">{pct}%</span>}
              {hover === p.key && <div className="absolute start-0 top-full mt-1"><Tip x={0} y={0} width={190} rows={[{ label: p.label, value: `${fullNumber(p.value)} · ${pct}%`, color: p.color }]} /></div>}
            </div>
          );
        })}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {parts.map((p) => <li key={p.key} className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: p.color }} />{p.label}</li>)}
      </ul>
    </div>
  );
}

/** Ordered stages: bar length = how many reached it, shade steps along one ramp, share of the first stage beside it. */
export function Funnel({ stages, emptyLabel }: { stages: { key: string; label: string; count: number }[]; emptyLabel: string }) {
  const t = useT();
  const first = stages[0]?.count ?? 0;
  if (!first) return <p className="grid min-h-32 place-items-center rounded-xl bg-canvas/60 text-sm text-muted">{emptyLabel}</p>;
  return (
    <ol className="space-y-3">
      {stages.map((s, i) => {
        const pct = Math.round((s.count / first) * 100);
        const lost = i < stages.length - 1 ? s.count - stages[i + 1].count : 0;
        return (
          <li key={s.key} tabIndex={0} aria-label={`${s.label}: ${s.count} (${pct}%)`}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="font-semibold">{s.label}</span>
              <span className="num text-xs font-bold text-muted">{fullNumber(s.count)} · {pct}%</span>
            </div>
            <div className="h-5 w-full">
              <div className="h-full rounded-e-[4px]" style={{ width: `${Math.max(pct, 1.5)}%`, background: `var(--viz-ord-${i + 1})` }} />
            </div>
            {lost > 0 && <p className="mt-0.5 text-[11px] text-muted">{t("لم يصل للمرحلة التالية: {0}", { 0: lost })}</p>}
          </li>
        );
      })}
    </ol>
  );
}

/** A grid of days × hours: darker = more. Lightest cells recede into the surface. */
export function Heatmap({ matrix, rowLabels, rowOrder, hourLabel, cellLabel }: { matrix: number[][]; rowLabels: string[]; rowOrder: number[]; hourLabel: string; cellLabel: (row: string, hour: number, n: number) => string }) {
  const [hover, setHover] = useState<[number, number] | null>(null);
  const max = Math.max(1, ...matrix.flat());
  const shade = (v: number) => (v === 0 ? "color-mix(in oklab, var(--viz-1) 6%, var(--color-surface))" : `color-mix(in oklab, var(--viz-1) ${Math.round(18 + (v / max) * 82)}%, var(--color-surface))`);
  return (
    <div dir="ltr" className="select-none" data-chart-scroll>
      <div className="grid gap-0.5" style={{ gridTemplateColumns: "auto repeat(24, minmax(0, 1fr))" }}>
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="text-center text-[10px] leading-4 text-muted">{h % 6 === 0 ? h : ""}</span>
        ))}
        {rowOrder.map((r) => (
          <div key={r} className="contents">
            <span className="pe-2 text-end text-[11px] leading-5 text-muted" dir="auto">{rowLabels[r]}</span>
            {matrix[r].map((v, h) => (
              <span key={h} tabIndex={0} aria-label={cellLabel(rowLabels[r], h, v)} title={cellLabel(rowLabels[r], h, v)}
                className={clsx("aspect-square min-h-3 rounded-[3px]", hover?.[0] === r && hover?.[1] === h && "ring-2 ring-ink/60")}
                style={{ background: shade(v) }} onPointerEnter={() => setHover([r, h])} onPointerLeave={() => setHover(null)} onFocus={() => setHover([r, h])} onBlur={() => setHover(null)} />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between text-[11px] text-muted" dir="auto">
        <span>{hourLabel}</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-16 rounded" style={{ background: "linear-gradient(to right, color-mix(in oklab, var(--viz-1) 18%, var(--color-surface)), var(--viz-1))" }} /></span>
      </div>
    </div>
  );
}

export function Sparkline({ values, height = 28 }: { values: number[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const pts = values.length > 1 ? values : [0, ...values, 0];
  const max = Math.max(...pts, 1);
  const x = (i: number) => (i / (pts.length - 1)) * (width - 8) + 4;
  const y = (v: number) => height - 4 - (v / max) * (height - 8);
  const d = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return (
    <div ref={ref} className="w-full" dir="ltr" aria-hidden>
      {width > 0 && (
        <svg width={width} height={height} className="block overflow-visible">
          <path d={d} fill="none" stroke="var(--viz-gray)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1])} r={4} fill="var(--viz-1)" stroke="var(--color-surface)" strokeWidth={2} />
        </svg>
      )}
    </div>
  );
}

export function DeltaBadge({ pct, upIsGood = true }: { pct: number | null; upIsGood?: boolean }) {
  const t = useT();
  if (pct === null) return <span className="text-xs text-muted">{t("لا مقارنة")}</span>;
  if (pct === 0) return <span className="inline-flex items-center gap-0.5 text-xs font-bold text-muted"><Minus className="size-3.5" /> 0%</span>;
  const up = pct > 0;
  const good = up === upIsGood;
  return (
    <span className={clsx("inline-flex items-center gap-0.5 text-xs font-bold", good ? "text-ok" : "text-bad")}>
      {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
      <span className="num">{up ? "+" : ""}{pct}%</span>
    </span>
  );
}

/** A headline number with its change against the previous period and, optionally, a sparkline. */
export function StatTile({ label, value, unit, delta, upIsGood, spark, hero, note, children }: {
  label: string; value: string; unit?: string; delta?: number | null; upIsGood?: boolean; spark?: number[]; hero?: boolean; note?: string; children?: React.ReactNode;
}) {
  const t = useT();
  return (
    <div className={clsx("card flex min-w-0 flex-col justify-between gap-3 p-4 sm:p-5", hero && "sm:col-span-2 xl:col-span-1")}>
      <div>
        <p className="text-sm font-semibold text-muted">{label}</p>
        <p className={clsx("mt-1 font-extrabold leading-none tracking-tight", hero ? "text-5xl" : "text-3xl")}>
          <span className="num">{value}</span>{unit && <span className="ms-1.5 text-sm font-semibold text-muted">{unit}</span>}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-muted">
          {delta !== undefined && <><DeltaBadge pct={delta} upIsGood={upIsGood} /><span>{t("مقابل الفترة السابقة")}</span></>}
          {note && <span>{note}</span>}
        </div>
      </div>
      {children}
      {spark && <Sparkline values={spark} />}
    </div>
  );
}

export function Meter({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label} className="h-2 w-full overflow-hidden rounded-full" style={{ background: "color-mix(in oklab, var(--viz-1) 18%, var(--color-surface))" }}>
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--viz-1)" }} />
    </div>
  );
}
