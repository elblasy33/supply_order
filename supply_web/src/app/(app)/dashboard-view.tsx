"use client";

import Link from "next/link";
import { useState } from "react";
import clsx from "clsx";
import { AlertOctagon, AlertTriangle, CalendarClock, ClipboardCheck, Clock, FileText, PackageCheck, Truck } from "lucide-react";
import { ColumnChart, LineChart } from "@/components/viz/charts";
import { Funnel, Heatmap, Meter, RankedBars, SegmentedBar, StatTile } from "@/components/viz/blocks";
import { ChartCard, EmptyChart, Legend } from "@/components/viz/parts";
import { useLocale, useT } from "@/lib/i18n/client";
import type { DashboardData } from "@/lib/types";
import { compact, delta, fullNumber } from "@/lib/viz";

const PERIODS = [7, 30, 90, 365] as const;
const WEEKDAYS = ["الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"]; // index 0 = Monday, as Odoo sends it
const CHANGE_LABEL: Record<string, string> = { add: "إضافة صنف", remove: "حذف صنف", substitute: "استبدال", qty: "تعديل كمية", price: "تعديل سعر/خصم" };

function Switch<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, string][]; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex overflow-hidden rounded-lg border border-line text-xs font-bold">
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)} className={clsx("px-3 py-1.5 max-lg:min-h-9", value === v ? "bg-brand-500 text-white" : "bg-surface text-muted hover:text-ink")}>{text}</button>
      ))}
    </div>
  );
}

export function DashboardView({ data, days }: { data: DashboardData; days: number }) {
  const t = useT();
  const locale = useLocale();
  const [itemsKind, setItemsKind] = useState<"sale" | "purchase">("sale");
  const [partnersKind, setPartnersKind] = useState<"sale" | "purchase">("sale");
  const o = data.orders;
  const w = data.warehouse;
  const g = data.period.granularity;
  const cur = data.currency;
  const granLabel = { day: t("يومي"), week: t("أسبوعي"), month: t("شهري") }[g];
  const totalPoints = o?.series ?? [];
  const spark = totalPoints.map((s) => s.count);
  const urgent = [
    o && { href: "/orders?state=draft", n: o.kpis.to_confirm, label: t("مسودات تنتظر التأكيد"), icon: <FileText className="size-4" /> },
    o && { href: "/orders?state=confirmed&invoice=to_invoice", n: o.kpis.to_invoice, label: t("جاهزة للفوترة"), icon: <ClipboardCheck className="size-4" /> },
    w && { href: "/warehouse?kind=delivery", n: w.ready.delivery, label: t("تسليمات جاهزة للتنفيذ"), icon: <Truck className="size-4" /> },
    w && { href: "/warehouse?kind=receipt", n: w.ready.receipt, label: t("استلامات جاهزة للتنفيذ"), icon: <PackageCheck className="size-4" /> },
    data.expiry && { href: "/alerts", n: data.expiry.buckets.filter((b) => b.key === "expired" || b.key === "d7").reduce((s, b) => s + b.lots, 0), label: t("تشغيلات منتهية أو تنتهي خلال أسبوع"), icon: <AlertTriangle className="size-4" /> },
  ].filter(Boolean) as { href: string; n: number; label: string; icon: React.ReactNode }[];

  return (
    <div className="space-y-5">
      {/* one row of filters above everything it scopes */}
      <nav className="flex flex-wrap items-center gap-1.5" aria-label={t("الفترة")}>
        <span className="me-1 text-xs font-bold text-muted">{t("الفترة")}</span>
        {PERIODS.map((p) => (
          <Link key={p} href={`/?days=${p}`} aria-current={days === p ? "true" : undefined} scroll={false}
            className={clsx("chip", days === p ? "border-brand-500 bg-brand-500 text-white" : "border-line bg-surface hover:border-brand-200")}>
            {p === 365 ? t("سنة") : t("{0} يوم", { 0: p })}
          </Link>
        ))}
      </nav>

      {/* what needs a person today */}
      {urgent.length > 0 && (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5" aria-label={t("بحاجة لإجراء")}>
          {urgent.map((u) => (
            <li key={u.href}>
              <Link href={u.href} className={clsx("card flex items-center justify-between gap-3 px-4 py-3 transition hover:border-brand-200 max-lg:min-h-12", u.n === 0 && "opacity-60")}>
                <span className="flex min-w-0 items-center gap-2 text-sm leading-5 text-muted"><span className="shrink-0">{u.icon}</span><span>{u.label}</span></span>
                <b className="num text-xl">{fullNumber(u.n)}</b>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {o && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile hero label={t("قيمة الأوامر")} value={compact(o.kpis.value.value)} unit={cur}
            delta={delta(o.kpis.value.value, o.kpis.value.previous)} note={undefined}>
            <p className="text-xs text-muted">
              <span className="me-3 inline-flex items-center gap-1.5"><span className="h-0.5 w-3 rounded" style={{ background: "var(--viz-1)" }} />{t("توريد لعملاء")} <b className="num text-ink">{compact(o.kpis.value.sale)}</b></span>
              <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-3 rounded" style={{ background: "var(--viz-2)" }} />{t("شراء من موردين")} <b className="num text-ink">{compact(o.kpis.value.purchase)}</b></span>
            </p>
          </StatTile>
          <StatTile label={t("عدد الأوامر")} value={fullNumber(o.kpis.orders.value)} delta={delta(o.kpis.orders.value, o.kpis.orders.previous)} spark={spark} />
          <StatTile label={t("نسبة التنفيذ الفعلي")} value={o.kpis.fill_rate.value === null ? "—" : `${o.kpis.fill_rate.value}%`}
            note={o.kpis.fill_rate.previous === null ? undefined : t("السابقة {0}%", { 0: o.kpis.fill_rate.previous })}>
            {o.kpis.fill_rate.value !== null && <Meter value={o.kpis.fill_rate.value} label={t("نسبة التنفيذ الفعلي")} />}
            <p className="text-xs text-muted">{t("ما سُلِّم أو استُلم فعلاً من المطلوب في الأوامر المؤكدة")}</p>
          </StatTile>
          <StatTile label={t("أوامر تعدّلت بعد التأكيد")} value={o.kpis.changed_share.value === null ? "—" : `${o.kpis.changed_share.value}%`}>
            {o.kpis.changed_share.value !== null && <Meter value={o.kpis.changed_share.value} label={t("أوامر تعدّلت بعد التأكيد")} />}
            <p className="text-xs text-muted">{t("كلما قلّت قلّ التغيير بعد الاتفاق")}</p>
          </StatTile>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {o && (
          <ChartCard className="md:col-span-2" title={t("قيمة الأوامر عبر الزمن")} subtitle={`${granLabel} · ${cur}`}
            legend={<Legend items={[{ label: t("توريد لعملاء"), color: "var(--viz-1)", line: true }, { label: t("شراء من موردين"), color: "var(--viz-2)", line: true }]} />}
            table={{ columns: [t("التاريخ"), t("توريد لعملاء"), t("شراء من موردين"), t("عدد الأوامر")], rows: o.series.map((s) => [s.date, s.sale, s.purchase, s.count]) }}>
            {o.series.every((s) => s.sale === 0 && s.purchase === 0) ? <EmptyChart text={t("لا أوامر في هذه الفترة")} /> :
              <LineChart label={t("قيمة الأوامر عبر الزمن")} granularity={g} points={o.series.map((s) => ({ date: s.date, values: [s.sale, s.purchase] }))}
                series={[{ key: "sale", label: t("توريد لعملاء"), color: "var(--viz-1)" }, { key: "purchase", label: t("شراء من موردين"), color: "var(--viz-2)" }]} />}
          </ChartCard>
        )}

        {o && (
          <ChartCard title={t("من التأكيد إلى الفوترة")} subtitle={t("كم أمراً وصل لكل مرحلة")}
            table={{ columns: [t("المرحلة"), t("عدد الأوامر")], rows: o.funnel.map((f) => [{ confirmed: t("أوامر مؤكدة"), moving: t("بدأ تنفيذها"), delivered: t("اكتمل تنفيذها"), invoiced: t("فُوترت") }[f.key], f.count]) }}>
            <Funnel emptyLabel={t("لا أوامر مؤكدة في هذه الفترة")}
              stages={o.funnel.map((f) => ({ key: f.key, count: f.count, label: { confirmed: t("أوامر مؤكدة"), moving: t("بدأ تنفيذها"), delivered: t("اكتمل تنفيذها"), invoiced: t("فُوترت") }[f.key] }))} />
          </ChartCard>
        )}

        {w && (
          <ChartCard className="md:col-span-2" title={t("حركة المخزن")} subtitle={`${granLabel} · ${t("{0} تسليم", { 0: w.totals.delivery })} (${compact(w.totals.units.delivery)} ${t("وحدة")}) · ${t("{0} استلام", { 0: w.totals.receipt })} (${compact(w.totals.units.receipt)} ${t("وحدة")})`}
            legend={<Legend items={[{ label: t("تسليم"), color: "var(--viz-1)" }, { label: t("استلام"), color: "var(--viz-2)" }]} />}
            table={{ columns: [t("التاريخ"), t("تسليم"), t("استلام")], rows: w.series.map((s) => [s.date, s.delivery, s.receipt]) }}>
            {w.totals.delivery + w.totals.receipt === 0 ? <EmptyChart text={t("لا أذونات منفّذة في هذه الفترة")} /> :
              <ColumnChart label={t("حركة المخزن")} granularity={g} points={w.series.map((s) => ({ date: s.date, values: [s.delivery, s.receipt] }))}
                series={[{ key: "delivery", label: t("تسليم"), color: "var(--viz-1)" }, { key: "receipt", label: t("استلام"), color: "var(--viz-2)" }]} />}
          </ChartCard>
        )}

        <div className="grid grid-cols-1 gap-4">
          {o && (
            <ChartCard title={t("حالة الأوامر")} subtitle={t("كل الأوامر المنشأة في الفترة")}
              table={{ columns: [t("الحالة"), t("العدد")], rows: [[t("مسودة"), o.status.draft], [t("مؤكد"), o.status.confirmed], [t("مغلق"), o.status.closed], [t("ملغي"), o.status.cancel]] }}>
              {Object.values(o.status).every((v) => v === 0) ? <EmptyChart text={t("لا أوامر في هذه الفترة")} /> :
                <SegmentedBar label={t("حالة الأوامر")} parts={[
                  { key: "draft", label: t("مسودة"), value: o.status.draft, color: "var(--viz-gray)", ink: "var(--color-ink)" },
                  { key: "confirmed", label: t("مؤكد"), value: o.status.confirmed, color: "var(--viz-1)" },
                  { key: "closed", label: t("مغلق"), value: o.status.closed, color: "var(--viz-3)" },
                  { key: "cancel", label: t("ملغي"), value: o.status.cancel, color: "var(--viz-2)" },
                ]} />}
            </ChartCard>
          )}
          {data.rebates && (
            <ChartCard title={t("الخصومات المؤجلة")} subtitle={`${t("غير المسوّى")}: ${compact(data.rebates.open_by_kind.sale + data.rebates.open_by_kind.purchase)} ${cur}`}
              table={{ columns: [t("الحالة"), cur], rows: [[t("للمراجعة"), data.rebates.by_state.draft], [t("مكوَّن"), data.rebates.by_state.confirmed], [t("مُسوّى"), data.rebates.by_state.settled]] }}>
              {Object.values(data.rebates.by_state).every((v) => v === 0) ? <EmptyChart text={t("لا خصومات مؤجلة بعد")} /> :
                <SegmentedBar label={t("الخصومات المؤجلة")} parts={[
                  { key: "draft", label: t("للمراجعة"), value: data.rebates.by_state.draft, color: "var(--viz-gray)", ink: "var(--color-ink)" },
                  { key: "confirmed", label: t("مكوَّن"), value: data.rebates.by_state.confirmed, color: "var(--viz-1)" },
                  { key: "settled", label: t("مُسوّى"), value: data.rebates.by_state.settled, color: "var(--viz-3)" },
                ]} />}
            </ChartCard>
          )}
        </div>

        {o && (
          <ChartCard title={t("أكثر الأصناف طلباً")} subtitle={t("الداكن = ما نُفِّذ فعلاً من المطلوب")}
            actions={<Switch value={itemsKind} onChange={setItemsKind} label={t("النوع")} options={[["sale", t("توريد")], ["purchase", t("شراء")]]} />}
            table={{ columns: [t("الصنف"), t("المطلوب"), t("المنفّذ")], rows: o.top_items[itemsKind].map((i) => [i.product.name, i.requested, i.done]) }}>
            <RankedBars emptyLabel={t("لا أصناف في هذه الفترة")} rows={o.top_items[itemsKind].map((i) => ({
              id: i.product.id, label: i.product.name, value: i.requested, done: i.done, display: `${fullNumber(i.done)} / ${fullNumber(i.requested)}`,
              detail: [{ label: t("المطلوب"), value: fullNumber(i.requested) }, { label: t("المنفّذ"), value: fullNumber(i.done) }, { label: t("نسبة التنفيذ"), value: `${i.requested ? Math.round((i.done / i.requested) * 100) : 0}%` }] }))} />
          </ChartCard>
        )}

        {o && (
          <ChartCard title={t("أكبر الشركاء قيمةً")} subtitle={cur}
            actions={<Switch value={partnersKind} onChange={setPartnersKind} label={t("النوع")} options={[["sale", t("عملاء")], ["purchase", t("موردون")]]} />}
            table={{ columns: [t("الشريك"), cur, t("عدد الأوامر")], rows: o.top_partners[partnersKind].map((p) => [p.partner.name, p.amount, p.orders]) }}>
            <RankedBars emptyLabel={t("لا أوامر في هذه الفترة")} color={partnersKind === "sale" ? "var(--viz-1)" : "var(--viz-2)"} rows={o.top_partners[partnersKind].map((p) => ({
              id: p.partner.id, label: p.partner.name, value: p.amount, display: compact(p.amount),
              detail: [{ label: cur, value: fullNumber(p.amount) }, { label: t("عدد الأوامر"), value: fullNumber(p.orders) }] }))} />
          </ChartCard>
        )}

        {o && (
          <ChartCard title={t("ماذا تغيّر بعد التأكيد؟")} subtitle={t("{0} تعديل في الفترة", { 0: o.changes.total })}
            table={{ columns: [t("نوع التعديل"), t("العدد")], rows: Object.entries(o.changes.by_type).map(([k, v]) => [t(CHANGE_LABEL[k] ?? k), v]) }}>
            <RankedBars emptyLabel={t("لا تعديلات بعد التأكيد في هذه الفترة")} color="var(--viz-3)"
              rows={Object.entries(o.changes.by_type).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ id: k, label: t(CHANGE_LABEL[k] ?? k), value: v, display: fullNumber(v) }))} />
          </ChartCard>
        )}

        {w && (
          <ChartCard className="md:col-span-2" title={t("متى يتحرك المخزن؟")} subtitle={t("عدد الأذونات المنفّذة حسب اليوم والساعة")}
            table={{ columns: [t("اليوم"), ...Array.from({ length: 24 }, (_, h) => String(h))], rows: [0, 1, 2, 3, 4, 5, 6].map((r) => [t(WEEKDAYS[r]), ...w.heat[r]]) }}>
            {w.heat.flat().every((v) => v === 0) ? <EmptyChart text={t("لا أذونات منفّذة في هذه الفترة")} /> :
              <Heatmap matrix={w.heat} rowLabels={WEEKDAYS.map((d) => t(d))} rowOrder={locale === "ar" ? [5, 6, 0, 1, 2, 3, 4] : [0, 1, 2, 3, 4, 5, 6]}
                hourLabel={t("الساعة (0–23)")} cellLabel={(row, h, n) => t("{0} الساعة {1}: {2} إذن", { 0: row, 1: h, 2: n })} />}
          </ChartCard>
        )}

        {data.expiry && (
          <ChartCard title={t("الصلاحية: ما المعرَّض؟")} subtitle={t("كميات التشغيلات المتوفرة حسب قربها من الانتهاء")}
            table={{ columns: [t("الفئة"), t("التشغيلات"), t("الكمية")], rows: data.expiry.buckets.map((b) => [{ expired: t("منتهية"), d7: t("خلال 7 أيام"), d30: t("8–30 يوماً"), d60: t("31–60 يوماً") }[b.key], b.lots, b.qty]) }}>
            <ExpiryColumns buckets={data.expiry.buckets} />
          </ChartCard>
        )}
      </div>
    </div>
  );
}

/** Four fixed classes of risk, so they use the status colours — each with an icon and a label, never colour alone. */
function ExpiryColumns({ buckets }: { buckets: NonNullable<DashboardData["expiry"]>["buckets"] }) {
  const t = useT();
  const meta = {
    expired: { label: t("منتهية"), color: "var(--viz-critical)", icon: <AlertOctagon className="size-4" /> },
    d7: { label: t("خلال 7 أيام"), color: "var(--viz-serious)", icon: <AlertTriangle className="size-4" /> },
    d30: { label: t("8–30 يوماً"), color: "var(--viz-warning)", icon: <Clock className="size-4" /> },
    d60: { label: t("31–60 يوماً"), color: "var(--viz-gray)", icon: <CalendarClock className="size-4" /> },
  } as const;
  const max = Math.max(...buckets.map((b) => b.qty), 0);
  if (max === 0) return <EmptyChart text={t("لا تشغيلات معرَّضة للانتهاء خلال 60 يوماً")} />;
  return (
    <ul className="grid grid-cols-4 gap-2">
      {buckets.map((b) => {
        const m = meta[b.key];
        return (
          <li key={b.key} className="flex min-w-0 flex-col items-center text-center" tabIndex={0} aria-label={`${m.label}: ${b.qty}, ${b.lots} ${t("التشغيلات")}`} title={`${m.label}: ${fullNumber(b.qty)} (${b.lots})`}>
            <b className="num text-lg leading-none">{compact(b.qty)}</b>
            <span className="num mb-1 text-[11px] text-muted">{b.lots} {t("التشغيلات")}</span>
            <div className="flex h-28 w-full items-end justify-center">
              <div className="w-full max-w-6 rounded-t-[4px]" style={{ height: `${Math.max(4, (b.qty / max) * 100)}%`, background: m.color }} />
            </div>
            <span className="mt-2 flex items-center gap-1 text-[11px] font-semibold leading-4 text-muted" dir="auto">{m.icon}<span>{m.label}</span></span>
          </li>
        );
      })}
    </ul>
  );
}
