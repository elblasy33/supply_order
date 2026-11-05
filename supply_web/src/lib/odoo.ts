import "server-only";
import { randomUUID } from "node:crypto";
import { getConnection, getLangs, setLangs, type OdooConnection } from "./settings";
import { pickOdooLang } from "./i18n/core";
import { getLocale } from "./i18n/server";

/** Error code of the supply.api contract (docs/API_CONTRACT.yaml) plus the transport failures. */
export type OdooErrorCode =
  | "user_error"
  | "validation_error"
  | "access_denied"
  | "not_found"
  | "conflict"
  | "nothing_to_do"
  | "unreachable"
  | "unauthorized"
  | "server_error";

export class OdooError extends Error {
  constructor(
    public code: OdooErrorCode,
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

export type Page<T> = { data: T[]; total: number; offset: number; limit: number; balance_total?: number };

function config(): OdooConnection {
  const c = getConnection();
  if (!c.url || !c.apiKey) {
    throw new OdooError("unauthorized", "لم يُضبط الاتصال بأودو بعد. اضبطه من الإعدادات ← الاتصال بأودو.");
  }
  return c;
}

type CallOptions = {
  /** `external.user` id of the app user who acts (honoured by Odoo for the integration user only). */
  extUserId?: number | null;
  /** Writes are idempotent: the same key replays the first answer instead of repeating the effect. */
  idempotencyKey?: string;
  lang?: string;
  /** Time zone the answer is bucketed in (dashboard days, hours). */
  tz?: string;
};

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: OdooErrorCode; message: string; field?: string } };

async function raw(path: string, init: RequestInit) {
  const { url, apiKey: key, database } = config();
  try {
    return await fetch(`${url}${path}`, {
      ...init,
      cache: "no-store",
      headers: { Authorization: `Bearer ${key}`, ...(database ? { "X-Odoo-Database": database } : {}), ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new OdooError("unreachable", "تعذّر الاتصال بخادم أودو. تأكد من تشغيله ومن عنوان الاتصال.");
  }
}

function transportError(status: number): OdooError {
  if (status === 401) return new OdooError("unauthorized", "مفتاح API غير صالح أو منتهي.");
  if (status === 404) return new OdooError("server_error", "الواجهة غير موجودة في أودو: هل موديول supply_api مثبّت؟");
  return new OdooError("server_error", `ردّ أودو بخطأ غير متوقع (${status}).`);
}

/**
 * The language to ask Odoo for, among those installed there (Odoo refuses the whole request for a language it
 * does not have). Learned once from `info` and kept with the connection; undefined = Odoo's own default.
 */
export async function odooLang(): Promise<string | undefined> {
  const locale = await getLocale().catch(() => "ar" as const);
  let langs = getLangs();
  if (langs === null) {
    try {
      const res = await raw("/json/2/supply.api/info", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ context: {} }) });
      const body = (await res.json()) as { ok?: boolean; data?: { languages?: string[] } };
      langs = body.ok ? (body.data?.languages ?? []) : null;
      if (langs) setLangs(langs);
    } catch { return undefined; }
  }
  return pickOdooLang(locale, langs);
}

/** Calls `POST /json/2/supply.api/<method>` and returns the whole envelope fields (data + page info). */
export async function odooCall<T = unknown>(
  method: string,
  args: Record<string, unknown> = {},
  opts: CallOptions = {},
): Promise<{ data: T; page?: { total: number; offset: number; limit: number; balance_total?: number } }> {
  const context: Record<string, unknown> = {};
  if (opts.extUserId) context.ext_user_id = opts.extUserId;
  if (opts.tz) context.tz = opts.tz;
  const lang = opts.lang ?? (await odooLang());
  if (lang) context.lang = lang;
  const body: Record<string, unknown> = { ...args, context };
  if (opts.idempotencyKey) body.idempotency_key = opts.idempotencyKey;
  const send = () => raw(`/json/2/supply.api/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let res = await send();
  if (!res.ok && context.lang && /invalid language/i.test(await res.clone().text())) {
    delete context.lang; // that language was removed from Odoo since we last looked: carry on in its default
    setLangs([]);
    res = await send();
  }
  if (!res.ok) throw transportError(res.status);
  const env = (await res.json()) as Envelope<T> & { total?: number; offset?: number; limit?: number; balance_total?: number };
  if (!env.ok) throw new OdooError(env.error.code, env.error.message, env.error.field || undefined);
  const page = env.total === undefined ? undefined : { total: env.total, offset: env.offset ?? 0, limit: env.limit ?? 0, balance_total: env.balance_total };
  return { data: env.data, page };
}

export async function odooData<T = unknown>(method: string, args: Record<string, unknown> = {}, opts: CallOptions = {}) {
  return (await odooCall<T>(method, args, opts)).data;
}

export async function odooPage<T>(method: string, args: Record<string, unknown> = {}, opts: CallOptions = {}): Promise<Page<T>> {
  const { data, page } = await odooCall<T[]>(method, args, opts);
  return { data, total: page?.total ?? data.length, offset: page?.offset ?? 0, limit: page?.limit ?? data.length, balance_total: page?.balance_total };
}

/** Key-authenticated print/download route of supply_api; returns the upstream response to stream. */
export async function odooPrint(kind: string, fmt: string, id: number, lang?: string) {
  const q = lang ? `?lang=${encodeURIComponent(lang)}` : "";
  const res = await raw(`/supply_api/print/${kind}/${fmt}/${id}${q}`, { method: "GET" });
  if (!res.ok && res.status !== 404) throw transportError(res.status);
  return res;
}

export const newKey = () => randomUUID();

export async function odooPing(): Promise<{ ok: true; whoami: unknown } | { ok: false; error: string }> {
  try {
    return { ok: true, whoami: await odooData("whoami") };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
