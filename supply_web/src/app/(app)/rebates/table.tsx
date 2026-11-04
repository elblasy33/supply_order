"use client";

import Link from "next/link";
import clsx from "clsx";
import { Badge, Empty, Num, formatDate, money } from "@/components/ui";
import { rebateAction } from "@/app/actions/accounting";
import { useAction } from "@/components/use-action";
import type { RebateAccrual } from "@/lib/types";
import { useT } from "@/lib/i18n/client";

const STATE: Record<RebateAccrual["state"], [string, "slate" | "amber" | "brand" | "green" | "red"]> = {
  draft: ["للمراجعة", "amber"], confirmed: ["مكوَّن (للتسوية)", "brand"], settled: ["مُسوّى", "green"], cancel: ["ملغي", "red"],
};
const REWARD: Record<string, string> = { percent: "نسبة", fixed: "مبلغ ثابت", free_product: "منتجات مجانية" };

const STATES = [["", "الكل"], ["draft", "للمراجعة"], ["confirmed", "مكوَّن"], ["settled", "مُسوّى"], ["cancel", "ملغي"]] as const;
const TYPES = [["", "الكل"], ["sale", "عملاء (نمنح)"], ["purchase", "موردون (نستلم)"]] as const;

export function RebateTable({ rows, canManage, state, type }: { rows: RebateAccrual[]; canManage: boolean; state: string; type: string }) {
  const t = useT();
  const { run, busy } = useAction();
  const go = (id: number, action: "confirm" | "settle" | "cancel" | "reset_draft", success: string) =>
    run(`rebate-${id}-${action}`, (k) => rebateAction(id, action, k), { success });
  const chips = (label: string, opts: readonly (readonly [string, string])[], cur: string, field: "state" | "type") => (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="me-1 text-xs font-bold text-muted">{label}</span>
      {opts.map(([v, text]) => {
        const qs = new URLSearchParams({ state, type, [field]: v });
        for (const [k, val] of [...qs]) if (!val) qs.delete(k);
        return <Link key={v} href={`/rebates${qs.size ? `?${qs}` : ""}`} className={clsx("rounded-full border px-3 py-1 text-xs font-semibold",
          cur === v ? "border-brand-500 bg-brand-500 text-white" : "border-line bg-surface hover:border-brand-200")}>{t(text)}</Link>;
      })}
    </div>
  );
  return (
    <>
      <div className="card mb-4 space-y-3 p-4">{chips(t("الحالة"), STATES, state, "state")}{chips(t("النوع"), TYPES, type, "type")}</div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[56rem]">
          <thead className="bg-canvas/60"><tr>
            <th className="th">{t("الشريك")}</th><th className="th">{t("البرنامج")}</th><th className="th">{t("الفترة")}</th><th className="th">{t("حجم التعامل")}</th>
            <th className="th">{t("المكافأة")}</th><th className="th">{t("المستحق")}</th><th className="th">{t("الحالة")}</th><th className="th w-48" />
          </tr></thead>
          <tbody className="divide-y divide-line">
            {rows.map((a) => (
              <tr key={a.id} className="hover:bg-canvas/50">
                <td className="td font-bold">{a.partner.name}<div className="text-xs font-normal text-muted">{a.applies_to === "sale" ? t("عميل") : t("مورد")}</div></td>
                <td className="td">{a.program}</td>
                <td className="td whitespace-nowrap text-muted">{formatDate(a.date_from)} ← {formatDate(a.date_to)}</td>
                <td className="td"><span className="num">{money.format(a.turnover)}</span></td>
                <td className="td">{t(REWARD[a.reward_type] ?? "—")}</td>
                <td className="td font-bold">{a.reward_type === "free_product" ? (a.free_goods_order ? <Link href={`/orders/${a.free_goods_order.id}`} className="text-brand-700 hover:underline">{a.free_goods_order.name}</Link> : t("بضاعة مجانية")) : <span className="num">{money.format(a.amount)}</span>}</td>
                <td className="td"><Badge tone={STATE[a.state][1]}>{t(STATE[a.state][0])}</Badge>{a.credit_note && <div className="mt-1 text-xs text-muted">{a.credit_note.name}</div>}</td>
                <td className="td">
                  {canManage && (
                    <div className="flex justify-end gap-1.5">
                      {a.state === "draft" && <button className="btn-primary px-3 py-1.5 text-xs" disabled={busy} onClick={() => go(a.id, "confirm", t("تم تكوين المخصص."))}>{t("تكوين المخصص")}</button>}
                      {a.state === "confirmed" && <button className="btn-primary px-3 py-1.5 text-xs" disabled={busy} onClick={() => go(a.id, "settle", t("تمت التسوية."))}>{a.reward_type === "free_product" ? t("تسليم") : t("إصدار إشعار")}</button>}
                      {(a.state === "draft" || a.state === "confirmed") && <button className="btn-secondary px-3 py-1.5 text-xs" disabled={busy} onClick={() => go(a.id, "cancel", t("أُلغي المخصص."))}>{t("إلغاء")}</button>}
                      {a.state === "cancel" && <button className="btn-secondary px-3 py-1.5 text-xs" disabled={busy} onClick={() => go(a.id, "reset_draft", t("أُعيد للمراجعة."))}>{t("إعادة")}</button>}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <Empty title={t("لا نتائج لهذا المرشح")} />}
      </div>
      <p className="mt-3 text-xs text-muted">{t("إجمالي المستحق في القائمة:")} <Num v={rows.filter((r) => r.state !== "cancel").reduce((s, r) => s + r.amount, 0)} dec /></p>
    </>
  );
}
