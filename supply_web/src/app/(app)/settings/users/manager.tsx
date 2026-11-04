"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil } from "lucide-react";
import { saveUser } from "@/app/actions/settings";
import { Dialog } from "@/components/dialog";
import { useToast } from "@/components/toast";
import { Field, Badge } from "@/components/ui";

type U = { id: number; username: string; name: string; roleId: number; active: boolean; synced: boolean };
type Draft = { id?: number; name: string; username: string; password: string; roleId: number; active: boolean };

export function UsersManager({ users, roles, meId }: { users: U[]; roles: { id: number; name: string }[]; meId: number }) {
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
    push("ok", "تم الحفظ.");
    setDraft(null);
    router.refresh();
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <button className="btn-primary" onClick={() => setDraft({ name: "", username: "", password: "", roleId: roles[roles.length - 1]?.id ?? roles[0].id, active: true })}><Plus className="size-4" /> مستخدم جديد</button>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="bg-canvas/60"><tr><th className="th">الاسم</th><th className="th">اسم المستخدم</th><th className="th">الدور</th><th className="th">الحالة</th><th className="th">أودو</th><th className="th w-16" /></tr></thead>
          <tbody className="divide-y divide-line">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-canvas/50">
                <td className="td font-bold">{u.name} {u.id === meId && <Badge tone="brand">أنت</Badge>}</td>
                <td className="td" dir="ltr"><span className="font-mono text-sm">{u.username}</span></td>
                <td className="td">{roleName(u.roleId)}</td>
                <td className="td"><Badge tone={u.active ? "green" : "slate"}>{u.active ? "نشط" : "معطّل"}</Badge></td>
                <td className="td"><Badge tone={u.synced ? "green" : "amber"}>{u.synced ? "مرتبط" : "عند أول إجراء"}</Badge></td>
                <td className="td"><button className="btn-ghost px-2" aria-label="تعديل" onClick={() => setDraft({ id: u.id, name: u.name, username: u.username, password: "", roleId: u.roleId, active: u.active })}><Pencil className="size-4" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? "تعديل مستخدم" : "مستخدم جديد"}
        footer={<><button className="btn-secondary" onClick={() => setDraft(null)}>إلغاء</button><button className="btn-primary" disabled={busy} onClick={save}>حفظ</button></>}>
        {draft && (
          <div className="space-y-4">
            <Field label="الاسم"><input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus /></Field>
            <Field label="اسم المستخدم"><input dir="ltr" className="input font-mono" value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} /></Field>
            <Field label={draft.id ? "كلمة مرور جديدة (اتركها فارغة لعدم التغيير)" : "كلمة المرور (8 أحرف على الأقل)"}>
              <input dir="ltr" type="password" autoComplete="new-password" className="input" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} /></Field>
            <Field label="الدور">
              <select className="input" value={draft.roleId} onChange={(e) => setDraft({ ...draft, roleId: Number(e.target.value) })}>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
            <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={draft.active} disabled={draft.id === meId} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> الحساب نشط</label>
          </div>
        )}
      </Dialog>
    </>
  );
}
