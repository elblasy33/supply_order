import { redirect } from "next/navigation";
import { createFirstAdmin } from "@/app/actions/auth";
import { AuthForm, AuthShell } from "@/components/auth-form";
import { hasUsers } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic"; // depends on the database (first run) and the session
export async function generateMetadata() {
  const t = await getT();
  return { title: t("الإعداد الأول") };
}

export default async function SetupPage() {
  const t = await getT();
  if (hasUsers()) redirect("/login");
  return (
    <AuthShell title={t("الإعداد الأول")} subtitle={t("أنشئ حساب مدير النظام. بقية المستخدمين تضيفهم من الإعدادات.")}>
      <AuthForm
        action={createFirstAdmin}
        submit={t("إنشاء الحساب والدخول")}
        fields={[
          { name: "name", label: t("الاسم"), autoFocus: true },
          { name: "username", label: t("اسم المستخدم"), autoComplete: "username" },
          { name: "password", label: t("كلمة المرور (8 أحرف على الأقل)"), type: "password", autoComplete: "new-password" },
        ]}
      />
    </AuthShell>
  );
}
