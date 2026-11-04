/** Small helpers shared by the charts: number formats, nice axis ticks, date labels. */
const full = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** 1,284 · 12.9K · 4.2M — full under 10,000, compact above. */
export function compact(n: number): string {
  const a = Math.abs(n);
  if (a < 10_000) return full.format(Math.round(n * 100) / 100);
  if (a < 1_000_000) return `${full.format(Math.round(n / 100) / 10)}K`;
  if (a < 1_000_000_000) return `${full.format(Math.round(n / 1e5) / 10)}M`;
  return `${full.format(Math.round(n / 1e8) / 10)}B`;
}
export const fullNumber = (n: number) => full.format(Math.round(n * 100) / 100);

/** A round maximum and evenly spaced ticks (0 … max) for an axis that starts at zero. */
export function niceScale(max: number, want = 4): { max: number; ticks: number[] } {
  if (!(max > 0)) return { max: 1, ticks: [0, 1] };
  const rough = max / want;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? pow * 10;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { max: top, ticks };
}

/** "04/11" for a day bucket, "2026-W45" style is avoided: week buckets show the Monday, months show mm/yyyy. */
export function dateLabel(iso: string, granularity: "day" | "week" | "month"): string {
  const [y, m, d] = iso.split("-");
  return granularity === "month" ? `${m}/${y}` : `${d}/${m}`;
}
export function dateLabelLong(iso: string, granularity: "day" | "week" | "month"): string {
  const [y, m, d] = iso.split("-");
  return granularity === "month" ? `${m}/${y}` : granularity === "week" ? `${d}/${m}/${y} +7` : `${d}/${m}/${y}`;
}

/** Percent change against the previous period, or null when there is nothing to compare with. */
export function delta(now: number, before: number): number | null {
  if (!before) return null;
  return Math.round(((now - before) / before) * 1000) / 10;
}
