import { redirect } from "next/navigation";
import { createFirstAdmin } from "@/app/actions/auth";
import { AuthForm, AuthShell } from "@/components/auth-form";
import { hasUsers } from "@/lib/auth";

export const dynamic = "force-dynamic"; // depends on the database (first run) and the session
export const metadata = { title: "الإعداد الأول" };

export default function SetupPage() {
  if (hasUsers()) redirect("/login");
  return (
    <AuthShell title="الإعداد الأول" subtitle="أنشئ حساب مدير النظام. بقية المستخدمين تضيفهم من الإعدادات.">
      <AuthForm
        action={createFirstAdmin}
        submit="إنشاء الحساب والدخول"
        fields={[
          { name: "name", label: "الاسم", autoFocus: true },
          { name: "username", label: "اسم المستخدم", autoComplete: "username" },
          { name: "password", label: "كلمة المرور (8 أحرف على الأقل)", type: "password", autoComplete: "new-password" },
        ]}
      />
    </AuthShell>
  );
}
