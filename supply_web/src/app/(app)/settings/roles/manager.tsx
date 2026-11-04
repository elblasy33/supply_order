"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Plus, Trash2 } from "lucide-react";
import { deleteRole, saveRole } from "@/app/actions/settings";
import { useToast } from "@/components/toast";
import { Field } from "@/components/ui";
import { PERMISSIONS, PERMISSION_GROUPS } from "@/lib/permissions";
import { useT } from "@/lib/i18n/client";

type Role = { id: number; name: string; permissions: string[]; users: number };

export function RolesManager({ roles }: { roles: Role[] }) {
  const t = useT();
  const router = useRouter();
  const { push } = useToast();
  const [sel, setSel] = useState<number | "new">(roles[0]?.id ?? "new");
  const current = sel === "new" ? null : roles.find((r) => r.id === sel) ?? null;
  const [name, setName] = useState(current?.name ?? "");
  const [perms, setPerms] = useState<Set<string>>(new Set(current?.permissions ?? []));
  const [busy, setBusy] = useState(false);

  function choose(v: number | "new") {
    setSel(v);
    const r = v === "new" ? null : roles.find((x) => x.id === v) ?? null;
    setName(r?.name ?? "");
    setPerms(new Set(r?.permissions ?? []));
  }
  const toggle = (k: string) => setPerms((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  async function save() {
    setBusy(true);
    const res = await saveRole({ id: current?.id, name, permissions: [...perms] });
    setBusy(false);
    if (!res.ok) return push("error", res.error);
    push("ok", t("تم حفظ الدور."));
    router.refresh();
  }
  async function remove() {
    if (!current) return;
    setBusy(true);
    const res = await deleteRole(current.id);
    setBusy(false);
    if (!res.ok) return push("error", res.error);
    push("ok", t("تم حذف الدور."));
    choose(roles.find((r) => r.id !== current.id)?.id ?? "new");
    router.refresh();
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[16rem_1fr]">
      <div className="card h-fit p-2">
        {roles.map((r) => (
          <button key={r.id} onClick={() => choose(r.id)} aria-current={sel === r.id}
            className={clsx("flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-start text-sm font-semibold", sel === r.id ? "bg-brand-50 text-brand-700" : "hover:bg-canvas")}>
            {t(r.name)}<span className="num text-xs text-muted">{r.users}</span>
          </button>
        ))}
        <button onClick={() => choose("new")} className="mt-1 flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold text-brand-700 hover:bg-brand-50"><Plus className="size-4" />  {t("دور جديد")}</button>
      </div>
      <div className="card p-5">
        <Field label={t("اسم الدور")} className="mb-5"><input className="input max-w-sm" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="space-y-6">
          {PERMISSION_GROUPS.map((g) => (
            <fieldset key={g.title}>
              <legend className="mb-2 flex w-full items-center justify-between text-sm font-extrabold">
                {t(g.title)}
                <button type="button" className="text-xs font-semibold text-brand-700 hover:underline"
                  onClick={() => setPerms((s) => { const n = new Set(s); const all = g.keys.every((k) => n.has(k)); g.keys.forEach((k) => (all ? n.delete(k) : n.add(k))); return n; })}>
                  {g.keys.every((k) => perms.has(k)) ? t("إلغاء الكل") : t("تحديد الكل")}
                </button>
              </legend>
              <div className="grid gap-1 sm:grid-cols-2">
                {g.keys.map((k) => (
                  <label key={k} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-canvas">
                    <input type="checkbox" className="mt-1" checked={perms.has(k)} onChange={() => toggle(k)} />{t(PERMISSIONS[k])}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        <div className="mt-6 flex items-center justify-between border-t border-line pt-4">
          <button className="btn-ghost text-bad hover:bg-red-50" disabled={busy || !current} onClick={remove}><Trash2 className="size-4" />  {t("حذف الدور")}</button>
          <button className="btn-primary" disabled={busy || !name.trim()} onClick={save}>{current ? t("حفظ التعديلات") : t("إنشاء الدور")}</button>
        </div>
      </div>
    </div>
  );
}
