"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import clsx from "clsx";
import { Bell, ClipboardList, Gift, LayoutDashboard, LogOut, Menu, Scale, ShieldCheck, Users, X, Plug } from "lucide-react";

type Item = { href: string; label: string; icon: React.ReactNode; perm: string | string[]; section?: string };

const ITEMS: Item[] = [
  { href: "/", label: "لوحة التحكم", icon: <LayoutDashboard className="size-5" />, perm: "orders.view" },
  { href: "/orders", label: "أوامر التوريد", icon: <ClipboardList className="size-5" />, perm: "orders.view" },
  { href: "/alerts", label: "التنبيهات", icon: <Bell className="size-5" />, perm: "alerts.view" },
  { href: "/accounting/reconcile", label: "التسوية الجماعية", icon: <Scale className="size-5" />, perm: "accounting.reconcile", section: "المحاسبة" },
  { href: "/rebates", label: "الخصومات المؤجلة", icon: <Gift className="size-5" />, perm: "rebates.view", section: "المحاسبة" },
  { href: "/settings/users", label: "المستخدمون", icon: <Users className="size-5" />, perm: "settings.users", section: "الإعدادات" },
  { href: "/settings/roles", label: "الأدوار والصلاحيات", icon: <ShieldCheck className="size-5" />, perm: "settings.roles", section: "الإعدادات" },
  { href: "/settings/odoo", label: "الاتصال بأودو", icon: <Plug className="size-5" />, perm: "settings.odoo", section: "الإعدادات" },
];

export function Shell({
  user, permissions, logoutAction, children,
}: {
  user: { name: string; roleName: string };
  permissions: string[];
  logoutAction: () => Promise<void>;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const visible = ITEMS.filter((i) => (Array.isArray(i.perm) ? i.perm : [i.perm]).some((p) => permissions.includes(p)));
  const sections = visible.reduce<Record<string, Item[]>>((acc, i) => {
    (acc[i.section ?? ""] ??= []).push(i);
    return acc;
  }, {});
  const active = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));

  const nav = (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="التنقل الرئيسي">
      {Object.entries(sections).map(([title, items]) => (
        <div key={title}>
          {title && <p className="mb-1 px-3 text-[11px] font-bold tracking-wide text-muted">{title}</p>}
          <ul className="space-y-0.5">
            {items.map((i) => (
              <li key={i.href}>
                <Link
                  href={i.href}
                  onClick={() => setOpen(false)}
                  aria-current={active(i.href) ? "page" : undefined}
                  className={clsx(
                    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition",
                    active(i.href) ? "bg-brand-50 text-brand-700" : "text-ink/80 hover:bg-canvas",
                  )}
                >
                  {i.icon}
                  {i.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[17rem_1fr]">
      {/* desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen flex-col border-e border-line bg-surface lg:flex">
        <Brand />
        {nav}
        <UserBox user={user} logoutAction={logoutAction} />
      </aside>

      {/* mobile bar + drawer */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface px-4 py-3 lg:hidden">
        <button className="btn-ghost -ms-2 px-2" aria-label="القائمة" onClick={() => setOpen(true)}><Menu className="size-6" /></button>
        <span className="font-extrabold">أوامر التوريد</span>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button aria-label="إغلاق" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 start-0 flex w-72 flex-col bg-surface shadow-xl">
            <div className="flex items-center justify-between pe-3">
              <Brand />
              <button className="btn-ghost px-2" aria-label="إغلاق" onClick={() => setOpen(false)}><X className="size-5" /></button>
            </div>
            {nav}
            <UserBox user={user} logoutAction={logoutAction} />
          </aside>
        </div>
      )}

      <main className="min-w-0 p-4 sm:p-6 lg:p-8">{children}</main>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-3 px-5 py-5">
      <div className="grid size-10 place-items-center rounded-xl bg-brand-500 text-lg font-black text-white">ت</div>
      <div className="leading-tight">
        <p className="font-extrabold">أوامر التوريد</p>
        <p className="text-xs text-muted">متصل بأودو</p>
      </div>
    </div>
  );
}

function UserBox({ user, logoutAction }: { user: { name: string; roleName: string }; logoutAction: () => Promise<void> }) {
  return (
    <div className="border-t border-line p-3">
      <div className="flex items-center gap-3 rounded-xl px-2 py-2">
        <div className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-100 font-bold text-brand-700">{user.name.slice(0, 1)}</div>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-bold">{user.name}</p>
          <p className="truncate text-xs text-muted">{user.roleName}</p>
        </div>
        <form action={logoutAction}>
          <button className="btn-ghost px-2" aria-label="تسجيل الخروج" title="تسجيل الخروج"><LogOut className="size-5" /></button>
        </form>
      </div>
    </div>
  );
}


