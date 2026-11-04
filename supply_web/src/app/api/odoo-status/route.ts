import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { OdooError, odooData } from "@/lib/odoo";

export type OdooState = "ok" | "slow" | "down" | "unauthorized" | "unconfigured";
export type OdooStatus = { state: OdooState; ms: number | null; message: string; company?: string; checkedAt: number };

const SLOW_MS = 1500;
let cache: { at: number; value: OdooStatus } | null = null;

/** Is Odoo reachable right now, how fast, and with a key it accepts? Cheap call, answered from a 4 s cache. */
async function check(): Promise<OdooStatus> {
  const started = Date.now();
  try {
    const who = await odooData<{ company: { name: string } }>("whoami");
    const ms = Date.now() - started;
    return { state: ms > SLOW_MS ? "slow" : "ok", ms, message: "", company: who.company?.name, checkedAt: Date.now() };
  } catch (e) {
    const checkedAt = Date.now();
    if (e instanceof OdooError) {
      if (e.code === "unauthorized") {
        const unset = /لم يُضبط/.test(e.message);
        return { state: unset ? "unconfigured" : "unauthorized", ms: null, message: e.message, checkedAt };
      }
      return { state: "down", ms: null, message: e.message, checkedAt };
    }
    return { state: "down", ms: null, message: "تعذّر الاتصال بخادم أودو.", checkedAt };
  }
}

export async function GET(req: Request) {
  if (!(await getCurrentUser())) return new NextResponse(null, { status: 401 });
  const fresh = new URL(req.url).searchParams.has("fresh"); // a retry or a failed action must not be answered from the cache
  if (fresh || !cache || Date.now() - cache.at > 4000) cache = { at: Date.now(), value: await check() };
  return NextResponse.json(cache.value, { headers: { "cache-control": "no-store" } });
}
