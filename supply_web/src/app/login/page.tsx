import { redirect } from "next/navigation";
import { login } from "@/app/actions/auth";
import { AuthForm, AuthShell } from "@/components/auth-form";
import { getCurrentUser, hasUsers } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic"; // depends on the database (first run) and the session
export async function generateMetadata() {
  const t = await getT();
  return { title: t("تسجيل الدخول") };
}

export default async function LoginPage() {
  const t = await getT();
  if (!hasUsers()) redirect("/setup");
  if (await getCurrentUser()) redirect("/");
  return (
    <AuthShell title={t("أوامر التوريد")} subtitle={t("سجّل الدخول للمتابعة")}>
      <AuthForm
        action={login}
        submit={t("دخول")}
        fields={[
          { name: "username", label: t("اسم المستخدم"), autoComplete: "username", autoFocus: true },
          { name: "password", label: t("كلمة المرور"), type: "password", autoComplete: "current-password" },
        ]}
      />
    </AuthShell>
  );
}
