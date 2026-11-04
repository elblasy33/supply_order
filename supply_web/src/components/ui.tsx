import clsx from "clsx";

export const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 0 });
export const money = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

export function Num({ v, dec = false, className }: { v: number; dec?: boolean; className?: string }) {
  return <span className={clsx("num", className)}>{(dec ? money : nf).format(v)}</span>;
}

export function formatDate(iso: string | null | undefined, withTime = false) {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; // neutral: reads the same in Arabic and English
  return withTime ? `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}` : date;
}

export function PageHeader({ title, subtitle, actions }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Progress({ done, total, tone = "brand" }: { done: number; total: number; tone?: "brand" | "green" }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={clsx("h-full rounded-full", tone === "green" || pct >= 100 ? "bg-ok" : "bg-brand-500")} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** A labelled control: the label wraps it, so clicking the label focuses it and screen readers announce it. */
export function Field({ label, className, children }: { label: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <label className={clsx("block", className)}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export const TYPE = { sale: "توريد لعميل", purchase: "شراء من مورد" } as const;
export { Badge } from "./badge";
export { StateBadge, Fulfillment, InvoiceBadge, Empty, ErrorBox } from "./ui-text";
