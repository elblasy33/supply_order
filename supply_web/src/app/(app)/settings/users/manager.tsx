"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil } from "lucide-react";
import { saveUser } from "@/app/actions/settings";
import { Dialog } from "@/components/dialog";
import { useToast } from "@/components/toast";
import { Field, Badge } from "@/components/ui";
import { useT } from "@/lib/i18n/client";

type U = { id: number; username: string; name: string; roleId: number; active: boolean; synced: boolean };
type Draft = { id?: number; name: string; username: string; password: string; roleId: number; active: boolean };

export function UsersManager({ users, roles, meId }: { users: U[]; roles: { id: number; name: string }[]; meId: number }) {
  const t = useT();
  const router = useRouter();
  const { push } = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const roleName = (id: number) => roles.find((r) => r.id === id)?.name ?? "—";

  async function save() {
    if (!draft) return;
    setBusy(true);
    const res = await saveUser({ ...draft, password: draft.password || undefined });
    setBusy(false);
    if (!res.ok) return push("error", res.error);
    push("ok", t("تم الحفظ."));
    setDraft(null);
    router.refresh();
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <button className="btn-primary" onClick={() => setDraft({ name: "", username: "", password: "", roleId: roles[roles.length - 1]?.id ?? roles[0].id, active: true })}><Plus className="size-4" />  {t("مستخدم جديد")}</button>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="bg-canvas/60"><tr><th className="th">{t("الاسم")}</th><th className="th">{t("اسم المستخدم")}</th><th className="th">{t("الدور")}</th><th className="th">{t("الحالة")}</th><th className="th">{t("أودو")}</th><th className="th w-16" /></tr></thead>
          <tbody className="divide-y divide-line">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-canvas/50">
                <td className="td font-bold">{u.name} {u.id === meId && <Badge tone="brand">{t("أنت")}</Badge>}</td>
                <td className="td" dir="ltr"><span className="font-mono text-sm">{u.username}</span></td>
                <td className="td">{t(roleName(u.roleId))}</td>
                <td className="td"><Badge tone={u.active ? "green" : "slate"}>{u.active ? t("نشط") : t("معطّل")}</Badge></td>
                <td className="td"><Badge tone={u.synced ? "green" : "amber"}>{u.synced ? t("مرتبط") : t("عند أول إجراء")}</Badge></td>
                <td className="td"><button className="btn-ghost px-2" aria-label={t("تعديل")} onClick={() => setDraft({ id: u.id, name: u.name, username: u.username, password: "", roleId: u.roleId, active: u.active })}><Pencil className="size-4" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? t("تعديل مستخدم") : t("مستخدم جديد")}
        footer={<><button className="btn-secondary" onClick={() => setDraft(null)}>{t("إلغاء")}</button><button className="btn-primary" disabled={busy} onClick={save}>{t("حفظ")}</button></>}>
        {draft && (
          <div className="space-y-4">
            <Field label={t("الاسم")}><input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus /></Field>
            <Field label={t("اسم المستخدم")}><input dir="ltr" className="input font-mono" value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} /></Field>
            <Field label={draft.id ? t("كلمة مرور جديدة (اتركها فارغة لعدم التغيير)") : t("كلمة المرور (8 أحرف على الأقل)")}>
              <input dir="ltr" type="password" autoComplete="new-password" className="input" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} /></Field>
            <Field label={t("الدور")}>
              <select className="input" value={draft.roleId} onChange={(e) => setDraft({ ...draft, roleId: Number(e.target.value) })}>{roles.map((r) => <option key={r.id} value={r.id}>{t(r.name)}</option>)}</select></Field>
            <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={draft.active} disabled={draft.id === meId} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />  {t("الحساب نشط")}</label>
          </div>
        )}
      </Dialog>
    </>
  );
}
