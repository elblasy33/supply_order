import "server-only";

export type CheckStatus = "ok" | "warn" | "fail" | "skip";
export type CheckStep = { id: string; label: string; status: CheckStatus; detail: string };
export type CheckResult = { ok: boolean; steps: CheckStep[]; info?: OdooInfo };

export type OdooInfo = {
  version: string;
  major: number;
  edition: "community" | "enterprise";
  database: string;
  languages?: string[];
  modules: Record<string, { state: string; version: string }>;
  service_user: { id: number; login: string; name: string; configured: boolean; is_service_user: boolean };
  company: { id: number; name: string; currency: string };
};

/** Modules without which the app cannot work, and the ones that only switch a screen off. */
const REQUIRED = ["supply_order", "supply_api"];
const OPTIONAL: Record<string, string> = {
  product_tracking_plus: "التشغيلات والباركود",
  smart_alerts: "تنبيهات الصلاحية والمشتريات التلقائية",
  invoice_customization: "الفاتورة التجارية وتجميع الأصناف",
  discounts_rebates: "الخصومات الشرطية والمؤجلة",
  smart_reconciliation: "التسوية الجماعية",
};

export function normalizeUrl(input: string): string | null {
  let v = input.trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) v = `http://${v}`;
  try {
    const u = new URL(v);
    return `${u.protocol}//${u.host}`; // drop any path such as /odoo or /web
  } catch {
    return null;
  }
}

async function post(url: string, path: string, body: unknown, headers: Record<string, string>) {
  return fetch(`${url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
}

/** Checks, step by step, that an Odoo 20 server with our modules can be used with these credentials. */
export async function diagnose(conn: { url: string; database: string; apiKey: string }): Promise<CheckResult> {
  const steps: CheckStep[] = [];
  const add = (id: string, label: string, status: CheckStatus, detail: string) => steps.push({ id, label, status, detail });
  const stop = (): CheckResult => ({ ok: false, steps });
  const skipRest = (from: string[]) => {
    const labels: Record<string, string> = { key: "قبول مفتاح API", module: "موديول التوريد مثبّت", user: "مستخدم التكامل", features: "الموديولات الاختيارية" };
    for (const id of from) add(id, labels[id], "skip", "لم يُفحص بسبب خطأ سابق.");
  };

  const url = normalizeUrl(conn.url);
  if (!url) {
    add("reach", "الوصول إلى الخادم", "fail", "عنوان أودو غير صالح. مثال: https://odoo.example.com أو http://localhost:8069");
    skipRest(["key", "module", "user", "features"]);
    return stop();
  }
  const dbHeader: Record<string, string> = conn.database ? { "X-Odoo-Database": conn.database } : {};

  // 1. is there an Odoo, and which version?
  let major = 0;
  try {
    const res = await post(url, "/web/webclient/version_info", { jsonrpc: "2.0", method: "call", params: {} }, dbHeader);
    const body = (await res.json().catch(() => null)) as { result?: { server_version?: string; server_version_info?: unknown[] } } | null;
    const version = body?.result?.server_version;
    if (!res.ok || !version) {
      add("reach", "الوصول إلى الخادم", "fail", `العنوان يستجيب لكنه لا يبدو خادم أودو (HTTP ${res.status}).`);
      skipRest(["key", "module", "user", "features"]);
      return stop();
    }
    major = Number(body?.result?.server_version_info?.[0]) || parseInt(version, 10);
    add("reach", "الوصول إلى الخادم", "ok", `${url} — أودو ${version}`);
  } catch (e) {
    const timeout = e instanceof Error && /timeout|aborted/i.test(e.message);
    add("reach", "الوصول إلى الخادم", "fail", timeout ? "انتهت المهلة دون ردّ. تأكد من العنوان ومن أن الخادم يعمل." : "تعذّر الاتصال. تأكد من العنوان ومن أن الخادم يعمل ويقبل الاتصال من هذا الجهاز.");
    skipRest(["key", "module", "user", "features"]);
    return stop();
  }

  // 2. version 20
  if (major === 20) add("version", "إصدار أودو 20", "ok", "الإصدار مدعوم.");
  else {
    add("version", "إصدار أودو 20", "fail", `هذا أودو ${major}. الموديولات والواجهة مبنية لأودو 20 فقط.`);
    skipRest(["key", "module", "user", "features"]);
    return stop();
  }

  // 3. key + module
  if (!conn.apiKey) {
    add("key", "قبول مفتاح API", "fail", "أدخل مفتاح API لمستخدم التكامل.");
    skipRest(["module", "user", "features"]);
    return stop();
  }
  let info: OdooInfo | undefined;
  try {
    const res = await post(url, "/json/2/supply.api/info", { context: {} }, { Authorization: `Bearer ${conn.apiKey}`, ...dbHeader });
    if (res.status === 401 || res.status === 403) {
      add("key", "قبول مفتاح API", "fail", "رفض أودو المفتاح (غير صحيح أو منتهي أو ليس بنطاق rpc). ولّد مفتاحاً جديداً من Account Security.");
      skipRest(["module", "user", "features"]);
      return stop();
    }
    add("key", "قبول مفتاح API", "ok", "المفتاح مقبول.");
    if (res.status === 404 || res.status === 422) {
      add("module", "موديول التوريد مثبّت", "fail", conn.database
        ? "موديول supply_api غير مثبّت في هذه القاعدة (أو الإصدار قديم لا يحوي الدالة info). ثبّته/حدّثه ثم أعد الفحص."
        : "لم تُوجد واجهة supply_api. إما أن الموديول غير مثبّت، أو أن للخادم أكثر من قاعدة بيانات: اكتب اسم القاعدة أدناه.");
      skipRest(["user", "features"]);
      return stop();
    }
    const env = (await res.json().catch(() => null)) as { ok?: boolean; data?: OdooInfo; error?: { message: string } } | null;
    if (!res.ok || !env?.ok || !env.data) {
      add("module", "موديول التوريد مثبّت", "fail", env?.error?.message ?? `ردّ غير متوقع من أودو (HTTP ${res.status}).`);
      skipRest(["user", "features"]);
      return stop();
    }
    info = env.data;
  } catch {
    add("key", "قبول مفتاح API", "fail", "انقطع الاتصال أثناء الفحص.");
    skipRest(["module", "user", "features"]);
    return stop();
  }

  const missing = REQUIRED.filter((m) => info!.modules[m]?.state !== "installed");
  if (missing.length) {
    add("module", "موديول التوريد مثبّت", "fail", `غير مثبّت في قاعدة ${info.database}: ${missing.join("، ")}`);
    skipRest(["user", "features"]);
    return { ok: false, steps, info };
  }
  add("module", "موديول التوريد مثبّت", "ok", `قاعدة ${info.database} · ${info.edition === "enterprise" ? "Enterprise" : "Community"} · supply_order ${info.modules.supply_order.version}`);

  // 4. the key's user is the configured integration user
  const su = info.service_user;
  if (su.is_service_user) add("user", "مستخدم التكامل", "ok", `${su.name} (${su.login}) — معامل supply_order.service_user_id مضبوط عليه.`);
  else if (su.configured) add("user", "مستخدم التكامل", "fail", `المفتاح يخص ${su.login} (رقم ${su.id}) لكن المعامل supply_order.service_user_id مضبوط على مستخدم آخر. بدونه لا يُسجَّل المستخدم الفعلي.`);
  else add("user", "مستخدم التكامل", "fail", `اضبط معامل النظام supply_order.service_user_id على الرقم ${su.id} (المستخدم ${su.login}) ثم أعد الفحص.`);

  // 5. optional modules
  const off = Object.entries(OPTIONAL).filter(([m]) => info!.modules[m]?.state !== "installed");
  if (off.length) add("features", "الموديولات الاختيارية", "warn", `غير مثبّتة، فتتعطل: ${off.map(([, f]) => f).join("، ")}`);
  else add("features", "الموديولات الاختيارية", "ok", "كل موديولات المشروع مثبّتة.");

  return { ok: !steps.some((s) => s.status === "fail"), steps, info };
}
