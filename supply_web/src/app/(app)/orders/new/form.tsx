"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Barcode, Loader2, Trash2, Truck, ShoppingCart } from "lucide-react";
import { createOrder, lookup } from "@/app/actions/orders";
import { PartnerPicker, ProductPicker } from "@/components/pickers";
import { useToast } from "@/components/toast";
import { useAction } from "@/components/use-action";
import { Field } from "@/components/ui";
import type { LookupPartner, LookupProduct } from "@/lib/types";
import { useT } from "@/lib/i18n/client";

type Row = { product: LookupProduct; qty: string; price: string; note: string };

export function NewOrderForm() {
  const t = useT();
  const router = useRouter();
  const { push } = useToast();
  const { run, busy } = useAction();
  const [type, setType] = useState<"sale" | "purchase">("sale");
  const [partner, setPartner] = useState<LookupPartner | null>(null);
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);

  const price = (p: LookupProduct, t = type) => String(t === "sale" ? p.sale_price : p.cost);

  function add(p: LookupProduct) {
    setRows((rs) => {
      const i = rs.findIndex((r) => r.product.id === p.id);
      if (i >= 0) return rs.map((r, j) => (j === i ? { ...r, qty: String(Number(r.qty) + 1) } : r));
      return [...rs, { product: p, qty: "1", price: price(p), note: "" }];
    });
  }

  function changeType(t: "sale" | "purchase") {
    setType(t);
    setRows((rs) => rs.map((r) => ({ ...r, price: price(r.product, t) })));
  }

  async function scanCode() {
    const c = code.trim();
    if (!c) return;
    setScanning(true);
    const res = await lookup("product", c);
    setScanning(false);
    setCode("");
    if (!res.ok) return push("error", res.error);
    const found = (res.data as LookupProduct[]).filter((p) => p.barcode === c || p.code === c);
    if (found.length === 1) add(found[0]);
    else push("error", t(`لا يوجد صنف بهذا الباركود: ${c}`));
  }

  const total = rows.reduce((s, r) => s + Number(r.qty) * Number(r.price), 0);
  const valid = !!partner && rows.length > 0 && rows.every((r) => Number(r.qty) > 0 && Number(r.price) >= 0);

  async function submit() {
    if (!partner) return;
    const res = await run("create-order", (k) => createOrder({
      key: k, partner_id: partner.id, order_type: type, supply_ref: ref.trim() || undefined, note: note.trim() || undefined,
      lines: rows.map((r) => ({ product_id: r.product.id, qty_requested: Number(r.qty), price_unit: Number(r.price), note: r.note.trim() || undefined })),
    }), { success: t("تم إنشاء الأمر كمسودة."), refresh: false });
    if (res.ok) router.push(`/orders/${res.data.id}`);
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
      <div className="space-y-5">
        <section className="card p-5">
          <h2 className="mb-4 font-extrabold">{t("بيانات الأمر")}</h2>
          <div className="mb-4 grid grid-cols-2 gap-3" role="radiogroup" aria-label={t("نوع الأمر")}>
            {([["sale", t("توريد لعميل"), <Truck key="a" className="size-5" />], ["purchase", t("شراء من مورد"), <ShoppingCart key="b" className="size-5" />]] as const).map(([v, t, icon]) => (
              <button key={v} type="button" role="radio" aria-checked={type === v} onClick={() => changeType(v)}
                className={clsx("flex items-center justify-center gap-2 rounded-xl border-2 px-4 py-3 font-bold transition",
                  type === v ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line hover:border-brand-200")}>
                {icon} {t}
              </button>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <span className="label">{type === "sale" ? t("العميل") : t("المورد")}</span>
              {partner ? (
                <div className="flex items-center justify-between rounded-xl border border-brand-200 bg-brand-50 px-3 py-2">
                  <b>{partner.name}</b><button className="text-sm font-semibold text-brand-700 hover:underline" onClick={() => setPartner(null)}>{t("تغيير")}</button>
                </div>
              ) : <PartnerPicker onPick={setPartner} placeholder={type === "sale" ? t("ابحث عن عميل…") : t("ابحث عن مورد…")} />}
            </div>
            <Field label={<>{t("رقم أمر التوريد (كما يعرفه")} {type === "sale" ? t("العميل") : t("المورد")})</>}>
              <input className="input num" value={ref} onChange={(e) => setRef(e.target.value)} placeholder={t("مثال: 11100")} /></Field>
            <Field label={t("ملاحظات")} className="md:col-span-2">
              <textarea className="input min-h-20" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
        </section>

        <section className="card overflow-hidden">
          <div className="space-y-3 border-b border-line p-5">
            <h2 className="font-extrabold">{t("الأصناف")}</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <ProductPicker onPick={add} clearOnPick />
              <div className="relative">
                <Barcode className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <input dir="ltr" className="input ps-9 font-mono" placeholder={t("أو امسح باركود ثم Enter")} value={code} disabled={scanning}
                  onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); scanCode(); } }} />
                {scanning && <Loader2 className="absolute end-3 top-1/2 size-4 -translate-y-1/2 animate-spin" />}
              </div>
            </div>
          </div>
          {rows.length === 0 ? <p className="px-6 py-12 text-center text-muted">{t("أضف أصنافاً بالبحث أو بمسح الباركود.")}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem]">
                <thead className="bg-canvas/60"><tr><th className="th w-10">#</th><th className="th">{t("الصنف")}</th><th className="th w-28">{t("الكمية")}</th><th className="th w-32">{t("السعر")}</th><th className="th">{t("ملاحظة")}</th><th className="th w-12" /></tr></thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r, i) => (
                    <tr key={r.product.id}>
                      <td className="td num text-muted">{i + 1}</td>
                      <td className="td font-bold">{r.product.name}<div className="text-xs font-normal text-muted">{r.product.uom}</div></td>
                      <td className="td"><input aria-label={t("الكمية")} className="input num" type="number" min={0} step="any" value={r.qty} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} /></td>
                      <td className="td"><input aria-label={t("السعر")} className="input num" type="number" min={0} step="any" value={r.price} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} /></td>
                      <td className="td"><input aria-label={t("ملاحظة")} className="input" value={r.note} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} /></td>
                      <td className="td"><button className="btn-ghost px-2 hover:text-bad" aria-label={t("حذف")} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <aside>
        <div className="card sticky top-6 p-5">
          <h2 className="mb-3 font-extrabold">{t("الملخص")}</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-muted">{t("عدد الأصناف")}</dt><dd className="num font-semibold">{rows.length}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">{t("إجمالي تقريبي (قبل الضريبة)")}</dt><dd className="num text-lg font-extrabold">{total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd></div>
          </dl>
          <button className="btn-primary mt-5 w-full py-2.5" disabled={!valid || busy} onClick={submit}>
            {busy && <Loader2 className="size-4 animate-spin" />}  {t("إنشاء الأمر (مسودة)")}
          </button>
          {!valid && <p className="mt-2 text-xs text-muted">{t("اختر")} {type === "sale" ? t("العميل") : t("المورد")}  {t("وأضف صنفاً واحداً على الأقل.")}</p>}
        </div>
      </aside>
    </div>
  );
}
