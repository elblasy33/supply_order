"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import type { FormState } from "@/app/actions/auth";
import { LocaleToggle } from "@/components/locale-toggle";
import { ThemeToggle } from "@/components/theme-toggle";
import { useT } from "@/lib/i18n/client";

type Field = { name: string; label: string; type?: string; autoComplete?: string; autoFocus?: boolean };

export function AuthForm({ action, fields, submit }: { action: (s: FormState, f: FormData) => Promise<FormState>; fields: Field[]; submit: string }) {
  const t = useT();
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="space-y-4">
      {fields.map((f) => (
        <div key={f.name}>
          <label htmlFor={f.name} className="label">{f.label}</label>
          <input id={f.name} name={f.name} type={f.type ?? "text"} className="input" required autoComplete={f.autoComplete}
            autoFocus={f.autoFocus} dir={f.type === "password" || f.name === "username" ? "ltr" : undefined} />
        </div>
      ))}
      {state?.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{t(state.error)}</p>}
      <button className="btn-primary w-full py-2.5" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" />} {submit}
      </button>
    </form>
  );
}

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  const t = useT();
  return (
    <main className="grid min-h-screen place-items-center bg-[radial-gradient(60rem_40rem_at_100%_-10%,var(--color-brand-100),transparent),var(--color-canvas)] p-4">
      <div className="card relative w-full max-w-md p-8">
        <div className="absolute end-3 top-3 flex"><ThemeToggle compact /><LocaleToggle compact /></div>
        <div className="mb-6 flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-brand-500 text-xl font-black text-white">{t("ت")}</div>
          <div>
            <h1 className="text-xl font-extrabold">{title}</h1>
            <p className="text-sm text-muted">{subtitle}</p>
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}
