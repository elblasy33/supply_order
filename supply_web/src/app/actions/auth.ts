"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db, audit, type UserRow } from "@/lib/db";
import { hasUsers } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/password";
import { createSession, destroySession } from "@/lib/session";

export type FormState = { error?: string } | undefined;

// A pre-computed hash so a wrong username costs the same time as a wrong password.
const DUMMY = "scrypt$00000000000000000000000000000000$" + "00".repeat(64);

export async function login(_prev: FormState, form: FormData): Promise<FormState> {
  const username = String(form.get("username") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!username || !password) return { error: "أدخل اسم المستخدم وكلمة المرور." };
  const user = db().prepare("SELECT * FROM users WHERE username = ? AND active = 1").get(username) as UserRow | undefined;
  const ok = await verifyPassword(password, user?.password_hash ?? DUMMY);
  if (!user || !ok) {
    audit(null, "login.failed", { username });
    return { error: "اسم المستخدم أو كلمة المرور غير صحيحة." };
  }
  await createSession(user.id);
  audit(user.id, "login");
  redirect("/");
}

const setup = z.object({
  name: z.string().trim().min(2, "اكتب الاسم."),
  username: z.string().trim().min(3, "اسم المستخدم 3 أحرف على الأقل.").regex(/^[\w.@-]+$/, "اسم المستخدم: حروف إنجليزية وأرقام ونقطة وشرطة فقط."),
  password: z.string().min(8, "كلمة المرور 8 أحرف على الأقل."),
});

/** First run only: creates the administrator. */
export async function createFirstAdmin(_prev: FormState, form: FormData): Promise<FormState> {
  if (hasUsers()) redirect("/login");
  const parsed = setup.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const role = db().prepare("SELECT id FROM roles ORDER BY id LIMIT 1").get() as { id: number };
  const info = db()
    .prepare("INSERT INTO users (username, name, password_hash, role_id) VALUES (?, ?, ?, ?)")
    .run(parsed.data.username, parsed.data.name, await hashPassword(parsed.data.password), role.id);
  await createSession(Number(info.lastInsertRowid));
  audit(Number(info.lastInsertRowid), "setup.admin");
  redirect("/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
