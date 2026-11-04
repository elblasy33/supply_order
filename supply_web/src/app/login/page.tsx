import { redirect } from "next/navigation";
import { login } from "@/app/actions/auth";
import { AuthForm, AuthShell } from "@/components/auth-form";
import { getCurrentUser, hasUsers } from "@/lib/auth";

export const dynamic = "force-dynamic"; // depends on the database (first run) and the session
export const metadata = { title: "تسجيل الدخول" };

export default async function LoginPage() {
  if (!hasUsers()) redirect("/setup");
  if (await getCurrentUser()) redirect("/");
  return (
    <AuthShell title="أوامر التوريد" subtitle="سجّل الدخول للمتابعة">
      <AuthForm
        action={login}
        submit="دخول"
        fields={[
          { name: "username", label: "اسم المستخدم", autoComplete: "username", autoFocus: true },
          { name: "password", label: "كلمة المرور", type: "password", autoComplete: "current-password" },
        ]}
      />
    </AuthShell>
  );
}
