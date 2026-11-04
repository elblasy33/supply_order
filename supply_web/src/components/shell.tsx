"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import clsx from "clsx";
import {
  Bell, ChevronsLeft, ChevronsRight, ClipboardList, Gift, LayoutDashboard, LogOut, Menu, Plug, Scale,
  ShieldCheck, Users, Warehouse, X,
} from "lucide-react";
import { LocaleToggle } from "@/components/locale-toggle";
import { OdooStatusBanner, OdooStatusPill, OdooStatusProvider } from "@/components/odoo-status";
import { InstallPrompt } from "@/components/pwa";
import { ThemeToggle } from "@/components/theme-toggle";
import { useLocale, useT } from "@/lib/i18n/client";

type Item = { href: string; label: string; icon: React.ReactNode; perm: string; section?: string };

const ITEMS: Item[] = [
  { href: "/", label: "لوحة التحكم", icon: <LayoutDashboard className="size-5" />, perm: "orders.view" },
  { href: "/orders", label: "أوامر التوريد", icon: <ClipboardList className="size-5" />, perm: "orders.view" },
  { href: "/warehouse", label: "المخزن (تسليم/استلام)", icon: <Warehouse className="size-5" />, perm: "warehouse.view" },
  { href: "/alerts", label: "التنبيهات", icon: <Bell className="size-5" />, perm: "alerts.view" },
  { href: "/accounting/reconcile", label: "التسوية الجماعية", icon: <Scale className="size-5" />, perm: "accounting.reconcile", section: "المحاسبة" },
  { href: "/rebates", label: "الخصومات المؤجلة", icon: <Gift className="size-5" />, perm: "rebates.view", section: "المحاسبة" },
  { href: "/settings/users", label: "المستخدمون", icon: <Users className="size-5" />, perm: "settings.users", section: "الإعدادات" },
  { href: "/settings/roles", label: "الأدوار والصلاحيات", icon: <ShieldCheck className="size-5" />, perm: "settings.roles", section: "الإعدادات" },
  { href: "/settings/odoo", label: "الاتصال بأودو", icon: <Plug className="size-5" />, perm: "settings.odoo", section: "الإعدادات" },
];

export function Shell({
  user, permissions, logoutAction, defaultCollapsed, children,
}: {
  user: { name: string; roleName: string };
  permissions: string[];
  logoutAction: () => Promise<void>;
  defaultCollapsed: boolean;
  children: React.ReactNode;
}) {
  const t = useT();
  const locale = useLocale();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const visible = ITEMS.filter((i) => permissions.includes(i.perm));
  const sections = visible.reduce<Record<string, Item[]>>((acc, i) => {
    (acc[i.section ?? ""] ??= []).push(i);
    return acc;
  }, {});
  const active = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `sidebar=${next ? "collapsed" : "open"}; path=/; max-age=31536000; samesite=lax`;
  }

  // the arrow points where the sidebar will go: towards its own edge to hide, away from it to open
  const hideArrow = (locale === "ar") === collapsed ? <ChevronsLeft className="size-5" /> : <ChevronsRight className="size-5" />;

  const nav = (rail: boolean) => (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label={t("التنقل الرئيسي")}>
      {Object.entries(sections).map(([title, items]) => (
        <div key={title}>
          {title && (rail ? <hr className="mx-2 mb-2 border-line" /> : <p className="mb-1 px-3 text-[11px] font-bold tracking-wide text-muted">{t(title)}</p>)}
          <ul className="space-y-0.5">
            {items.map((i) => (
              <li key={i.href}>
                <Link
                  href={i.href}
                  onClick={() => setOpen(false)}
                  title={rail ? t(i.label) : undefined}
                  aria-label={rail ? t(i.label) : undefined}
                  aria-current={active(i.href) ? "page" : undefined}
                  className={clsx(
                    "flex items-center gap-3 rounded-xl py-2.5 text-sm font-semibold transition",
                    rail ? "justify-center px-0" : "px-3",
                    active(i.href) ? "bg-brand-50 text-brand-700" : "text-ink/80 hover:bg-canvas",
                  )}
                >
                  {i.icon}
                  {!rail && t(i.label)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <OdooStatusProvider>
    <div className={clsx("min-h-screen lg:grid lg:transition-[grid-template-columns] lg:duration-200", collapsed ? "lg:grid-cols-[4.5rem_1fr]" : "lg:grid-cols-[17rem_1fr]")}>
      {/* desktop sidebar: full, or a rail of icons to give the work area more room */}
      <aside className="sticky top-0 hidden h-screen flex-col overflow-hidden border-e border-line bg-surface lg:flex" data-collapsed={collapsed}>
        <div className={clsx("flex items-center", collapsed ? "flex-col gap-2 py-3" : "justify-between pe-2")}>
          <Brand rail={collapsed} />
          {collapsed && <OdooStatusPill compact className="size-9" />}
          <button className="btn-ghost px-2" onClick={toggle} aria-expanded={!collapsed} aria-label={collapsed ? t("توسيع الشريط الجانبي") : t("طيّ الشريط الجانبي")}
            title={collapsed ? t("توسيع الشريط الجانبي") : t("طيّ الشريط الجانبي")}>{hideArrow}</button>
        </div>
        {nav(collapsed)}
        <UserBox user={user} logoutAction={logoutAction} rail={collapsed} />
      </aside>

      {/* mobile bar + drawer */}
      <header className="safe-top sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface px-4 py-3 lg:hidden">
        <button className="btn-ghost -ms-2 px-2" aria-label={t("القائمة")} onClick={() => setOpen(true)}><Menu className="size-6" /></button>
        <span className="font-extrabold">{t("أوامر التوريد")}</span>
        <OdooStatusPill className="ms-auto min-h-10 rounded-full border border-line px-3" />
      </header>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button aria-label={t("إغلاق")} className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="safe-top safe-bottom absolute inset-y-0 start-0 flex w-72 flex-col bg-surface shadow-xl">
            <div className="flex items-center justify-between pe-3">
              <Brand />
              <button className="btn-ghost px-2" aria-label={t("إغلاق")} onClick={() => setOpen(false)}><X className="size-5" /></button>
            </div>
            {nav(false)}
            <UserBox user={user} logoutAction={logoutAction} />
          </aside>
        </div>
      )}

      <main className="safe-bottom min-w-0 p-4 sm:p-6 lg:p-8">
        <div className="mx-auto w-full max-w-[1800px]">
          <OdooStatusBanner canSettings={permissions.includes("settings.odoo")} />
          <InstallPrompt />
          {children}
        </div>
      </main>
    </div>
    </OdooStatusProvider>
  );
}

function Brand({ rail = false }: { rail?: boolean }) {
  const t = useT();
  return (
    <div className={clsx("flex items-center gap-3", rail ? "justify-center" : "px-5 py-5")}>
      <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-500 text-lg font-black text-white">{t("ت")}</div>
      {!rail && (
        <div className="min-w-0 leading-tight">
          <p className="font-extrabold">{t("أوامر التوريد")}</p>
          <OdooStatusPill className="-ms-0.5 mt-0.5" />
        </div>
      )}
    </div>
  );
}

function UserBox({ user, logoutAction, rail = false }: { user: { name: string; roleName: string }; logoutAction: () => Promise<void>; rail?: boolean }) {
  const t = useT();
  return (
    <div className="border-t border-line p-3">
      <div className={clsx("mb-2 flex gap-1", rail ? "flex-col items-center" : "items-center")}>
        <ThemeToggle compact={rail} />
        <LocaleToggle compact={rail} />
      </div>
      <div className={clsx("flex items-center gap-3 rounded-xl px-2 py-2", rail && "flex-col px-0")}>
        <div className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-100 font-bold text-brand-700" title={rail ? user.name : undefined}>{user.name.slice(0, 1)}</div>
        {!rail && (
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-bold">{user.name}</p>
            <p className="truncate text-xs text-muted">{t(user.roleName)}</p>
          </div>
        )}
        <form action={logoutAction}>
          <button className="btn-ghost px-2" aria-label={t("تسجيل الخروج")} title={t("تسجيل الخروج")}><LogOut className="size-5" /></button>
        </form>
      </div>
    </div>
  );
}
