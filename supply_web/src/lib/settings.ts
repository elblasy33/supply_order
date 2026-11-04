import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { db } from "./db";

export type OdooConnection = {
  url: string;
  database: string;
  apiKey: string;
  /** where the values come from: saved in the app (Settings screen), the environment, or nothing yet */
  source: "saved" | "env" | "none";
};

function secretKey(): Buffer {
  const s = process.env.SESSION_SECRET ?? "";
  if (s.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters.");
  return Buffer.from(hkdfSync("sha256", s, "supply-web", "settings-encryption", 32));
}

/** The Odoo API key is a credential: it is stored encrypted (AES-256-GCM), never in clear text. */
function encrypt(text: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", secretKey(), iv);
  const body = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

function decrypt(blob: string): string {
  const [v, iv, tag, body] = blob.split(".");
  if (v !== "v1") throw new Error("unknown format");
  const d = createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(body, "base64")), d.final()]).toString("utf8");
}

function read(key: string): string | null {
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function write(key: string, value: string) {
  db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

/** Connection used for every Odoo call: what was saved in the app wins over the environment. */
export function getConnection(): OdooConnection {
  const url = read("odoo.url");
  const enc = read("odoo.api_key");
  if (url && enc) {
    try {
      return { url, database: read("odoo.database") ?? "", apiKey: decrypt(enc), source: "saved" };
    } catch {
      // unreadable (SESSION_SECRET changed): fall through, the user must enter the key again
    }
  }
  const eurl = (process.env.ODOO_URL ?? "").replace(/\/+$/, "");
  const ekey = process.env.ODOO_API_KEY ?? "";
  if (eurl && ekey) return { url: eurl, database: process.env.ODOO_DB ?? "", apiKey: ekey, source: "env" };
  return { url: url ?? eurl, database: read("odoo.database") ?? "", apiKey: "", source: "none" };
}

/** Languages installed on the connected Odoo (null = not known yet). */
export function getLangs(): string[] | null {
  const v = read("odoo.langs");
  try { return v ? (JSON.parse(v) as string[]) : null; } catch { return null; }
}
export function setLangs(langs: string[]) { write("odoo.langs", JSON.stringify(langs)); }

export function saveConnection(c: { url: string; database: string; apiKey: string; languages?: string[] }) {
  write("odoo.langs", JSON.stringify(c.languages ?? []));
  write("odoo.url", c.url);
  write("odoo.database", c.database);
  write("odoo.api_key", encrypt(c.apiKey));
  // ids of app users in Odoo belong to the previous server: they are looked up again on next use
  db().prepare("UPDATE users SET odoo_ext_id = NULL").run();
}
