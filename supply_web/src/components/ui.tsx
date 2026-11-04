import clsx from "clsx";
import type { OrderState } from "@/lib/types";

export const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 0 });
export const money = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

export function Num({ v, dec = false, className }: { v: number; dec?: boolean; className?: string }) {
  return <span className={clsx("num", className)}>{(dec ? money : nf).format(v)}</span>;
}

export function formatDate(iso: string | null | undefined, withTime = false) {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { day: "numeric", month: "short", year: "numeric" }).format(d);
  if (!withTime) return date;
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${date} — ${time}`;
}

const STATE: Record<OrderState, { label: string; cls: string }> = {
  draft: { label: "مسودة", cls: "bg-slate-100 text-slate-700" },
  confirmed: { label: "مؤكد", cls: "bg-brand-50 text-brand-700" },
  closed: { label: "مغلق", cls: "bg-green-50 text-green-700" },
  cancel: { label: "ملغي", cls: "bg-red-50 text-red-700" },
};

export function Badge({ children, tone = "slate", className }: { children: React.ReactNode; tone?: "slate" | "brand" | "green" | "amber" | "red"; className?: string }) {
  const tones = {
    slate: "bg-slate-100 text-slate-700", brand: "bg-brand-50 text-brand-700", green: "bg-green-50 text-green-700",
    amber: "bg-amber-50 text-amber-700", red: "bg-red-50 text-red-700",
  };
  return <span className={clsx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold", tones[tone], className)}>{children}</span>;
}

export function StateBadge({ state }: { state: OrderState }) {
  const s = STATE[state];
  return <span className={clsx("inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold", s.cls)}>{s.label}</span>;
}

export const FULFILL = { none: "لم يبدأ", partial: "جزئي", done: "منفّذ" } as const;
export const INVOICE = { nothing: "لا شيء للفوترة", to_invoice: "جاهز للفوترة", invoiced: "مفوتر" } as const;
export const TYPE = { sale: "توريد لعميل", purchase: "شراء من مورد" } as const;

export function Fulfillment({ s }: { s: keyof typeof FULFILL }) {
  return <Badge tone={s === "done" ? "green" : s === "partial" ? "amber" : "slate"}>{FULFILL[s]}</Badge>;
}
export function InvoiceBadge({ s }: { s: keyof typeof INVOICE }) {
  return <Badge tone={s === "invoiced" ? "green" : s === "to_invoice" ? "amber" : "slate"}>{INVOICE[s]}</Badge>;
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

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="font-bold">{title}</p>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="card border-red-200 bg-red-50 p-5 text-sm text-red-800" role="alert">
      <p className="font-bold">تعذّر تحميل البيانات من أودو</p>
      <p className="mt-1">{message}</p>
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
