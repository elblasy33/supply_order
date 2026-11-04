import Link from "next/link";

export const metadata = { title: "غير مسموح" };

export default function Forbidden() {
  return (
    <main className="grid min-h-screen place-items-center p-4">
      <div className="card max-w-md p-8 text-center">
        <p className="text-5xl font-black text-brand-500">403</p>
        <h1 className="mt-3 text-xl font-extrabold">ليست لديك صلاحية لهذه الصفحة</h1>
        <p className="mt-2 text-sm text-muted">اطلب من مدير النظام إضافة الصلاحية لدورك.</p>
        <Link href="/" className="btn-primary mt-6">العودة للرئيسية</Link>
      </div>
    </main>
  );
}
