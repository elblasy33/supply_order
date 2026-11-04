import "server-only";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DEFAULT_ROLES } from "./permissions";

/** The app's own small database (users, roles, audit). Everything about orders stays in Odoo. */
type DatabaseSync = DatabaseSyncType;
// Loaded at run time: the bundler must not try to resolve a Node built-in.
const { DatabaseSync: Sqlite } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
const g = globalThis as unknown as { __supplyDb?: DatabaseSync };

function open(): DatabaseSync {
  const dir = path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR ?? "./data");
  mkdirSync(dir, { recursive: true });
  const db = new Sqlite(path.join(dir, "app.db"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      permissions TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role_id INTEGER NOT NULL REFERENCES roles(id),
      active INTEGER NOT NULL DEFAULT 1,
      odoo_ext_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      user_id INTEGER,
      action TEXT NOT NULL,
      detail TEXT
    );
  `);
  const count = db.prepare("SELECT COUNT(*) AS n FROM roles").get() as { n: number };
  if (count.n === 0) {
    const ins = db.prepare("INSERT INTO roles (name, permissions) VALUES (?, ?)");
    for (const r of DEFAULT_ROLES) ins.run(r.name, JSON.stringify(r.permissions));
  }
  return db;
}

export function db(): DatabaseSync {
  return (g.__supplyDb ??= open());
}

export type RoleRow = { id: number; name: string; permissions: string[] };
export type UserRow = {
  id: number;
  username: string;
  name: string;
  password_hash: string;
  role_id: number;
  active: number;
  odoo_ext_id: number | null;
  created_at: string;
};

export function listRoles(): RoleRow[] {
  const rows = db().prepare("SELECT id, name, permissions FROM roles ORDER BY id").all() as {
    id: number; name: string; permissions: string;
  }[];
  return rows.map((r) => ({ ...r, permissions: JSON.parse(r.permissions) as string[] }));
}

export function audit(userId: number | null, action: string, detail?: unknown) {
  db()
    .prepare("INSERT INTO audit (user_id, action, detail) VALUES (?, ?, ?)")
    .run(userId, action, detail === undefined ? null : JSON.stringify(detail));
}
