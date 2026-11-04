"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Table2 } from "lucide-react";
import { useT } from "@/lib/i18n/client";

/** Width of an element, kept up to date: charts draw at the size they are given (phone to wide monitor). */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.round(el.getBoundingClientRect().width));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export type TipRow = { label: string; value: string; color?: string };

/** Hover / focus readout: the value leads, the name follows, series are keyed by a short line (not a box). */
export function Tip({ x, y, width, title, rows }: { x: number; y: number; width: number; title?: string; rows: TipRow[] }) {
  const W = 190;
  const left = Math.max(0, Math.min(x + 14, width - W));
  return (
    <div className="pointer-events-none absolute z-10 rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-lg" style={{ left, top: Math.max(0, y - 8), width: W }} dir="auto" role="tooltip">
      {title && <p className="mb-1 font-bold text-muted">{title}</p>}
      {rows.map((r) => (
        <p key={r.label} className="flex items-center gap-2 leading-6">
          {r.color && <span className="h-0.5 w-3 shrink-0 rounded" style={{ background: r.color }} />}
          <b className="num text-sm text-ink">{r.value}</b>
          <span className="truncate text-muted">{r.label}</span>
        </p>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; line?: boolean }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className={clsx("shrink-0", i.line ? "h-0.5 w-4 rounded" : "size-2.5 rounded-sm")} style={{ background: i.color }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

export type TableData = { columns: string[]; rows: (string | number)[][] };

/** A card for one chart: title, a legend slot, and a switch to the same numbers as a table. */
export function ChartCard({
  title, subtitle, legend, table, actions, className, children,
}: { title: string; subtitle?: string; legend?: React.ReactNode; table?: TableData; actions?: React.ReactNode; className?: string; children: React.ReactNode }) {
  const t = useT();
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={clsx("card flex min-w-0 flex-col p-4 sm:p-5", className)} aria-label={title}>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-extrabold leading-6">{title}</h2>
          {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-1">
          {actions}
          {table && (
            <button type="button" className={clsx("btn-ghost px-2 py-1.5 text-xs max-lg:min-h-10 max-lg:min-w-10", asTable && "bg-canvas text-ink")} aria-pressed={asTable} onClick={() => setAsTable((v) => !v)} title={t("عرض كجدول")}>
              <Table2 className="size-4" /><span className="sr-only">{t("عرض كجدول")}</span>
            </button>
          )}
        </div>
      </header>
      {legend && !asTable && <div className="mb-2">{legend}</div>}
      {asTable && table ? (
        <div className="relative max-h-80 overflow-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-canvas"><tr>{table.columns.map((c) => <th key={c} className="th">{c}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">
              {table.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className={clsx("td", typeof v === "number" && "num")}>{v}</td>)}</tr>)}
            </tbody>
          </table>
        </div>
      ) : children}
    </section>
  );
}

export function EmptyChart({ text }: { text: string }) {
  return <p className="grid min-h-32 flex-1 place-items-center rounded-xl bg-canvas/60 px-4 text-center text-sm text-muted">{text}</p>;
}
