"use client";

import clsx from "clsx";
import { Badge } from "@/components/badge";
import { useT } from "@/lib/i18n/client";
import type { OrderState } from "@/lib/types";

const STATE: Record<OrderState, { label: string; cls: string }> = {
  draft: { label: "مسودة", cls: "bg-slate-100 text-slate-700" },
  confirmed: { label: "مؤكد", cls: "bg-brand-50 text-brand-700" },
  closed: { label: "مغلق", cls: "bg-green-50 text-green-700" },
  cancel: { label: "ملغي", cls: "bg-red-50 text-red-700" },
};

export function StateBadge({ state }: { state: OrderState }) {
  const t = useT();
  const s = STATE[state];
  return <span className={clsx("inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold", s.cls)}>{t(s.label)}</span>;
}

const FULFILL = { none: "لم يبدأ", partial: "جزئي", done: "منفّذ" } as const;
const INVOICE = { nothing: "لا شيء للفوترة", to_invoice: "جاهز للفوترة", invoiced: "مفوتر" } as const;

export function Fulfillment({ s }: { s: keyof typeof FULFILL }) {
  const t = useT();
  return <Badge tone={s === "done" ? "green" : s === "partial" ? "amber" : "slate"}>{t(FULFILL[s])}</Badge>;
}
export function InvoiceBadge({ s }: { s: keyof typeof INVOICE }) {
  const t = useT();
  return <Badge tone={s === "invoiced" ? "green" : s === "to_invoice" ? "amber" : "slate"}>{t(INVOICE[s])}</Badge>;
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  const t = useT();
  return (
    <div className="px-6 py-14 text-center">
      <p className="font-bold">{t(title)}</p>
      {hint && <p className="mt-1 text-sm text-muted">{t(hint)}</p>}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  const t = useT();
  return (
    <div className="card border-red-200 bg-red-50 p-5 text-sm text-red-800" role="alert">
      <p className="font-bold">{t("تعذّر تحميل البيانات من أودو")}</p>
      <p className="mt-1">{t(message)}</p>
      <a href="/settings/odoo" className="mt-3 inline-block font-bold underline">{t("افتح إعدادات الاتصال بأودو")}</a>
    </div>
  );
}

