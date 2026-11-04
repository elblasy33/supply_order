import Link from "next/link";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("غير مسموح") };
}

export default async function Forbidden() {
  const t = await getT();
  return (
    <main className="grid min-h-screen place-items-center p-4">
      <div className="card max-w-md p-8 text-center">
        <p className="text-5xl font-black text-brand-500">403</p>
        <h1 className="mt-3 text-xl font-extrabold">{t("ليست لديك صلاحية لهذه الصفحة")}</h1>
        <p className="mt-2 text-sm text-muted">{t("اطلب من مدير النظام إضافة الصلاحية لدورك.")}</p>
        <Link href="/" className="btn-primary mt-6">{t("العودة للرئيسية")}</Link>
      </div>
    </main>
  );
}
