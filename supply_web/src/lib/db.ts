import "server-only";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { ALL_PERMISSIONS, DEFAULT_ROLES } from "./permissions";

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
  migrate(db);
  return db;
}

/**
 * New permissions reach databases created by an older version once: they are added to the roles that
 * should have them (and to the system administrator, who has everything). Edited roles keep their edits.
 */
function migrate(db: DatabaseSync) {
  const done = (key: string) => db.prepare("SELECT 1 FROM settings WHERE key = ?").get(key) !== undefined;
  const mark = (key: string) => db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, '1')").run(key);
  const grant = (roleName: string, perms: string[]) => {
    const row = db.prepare("SELECT id, permissions FROM roles WHERE name = ?").get(roleName) as { id: number; permissions: string } | undefined;
    if (!row) return;
    const merged = [...new Set([...(JSON.parse(row.permissions) as string[]), ...perms])];
    db.prepare("UPDATE roles SET permissions = ? WHERE id = ?").run(JSON.stringify(merged), row.id);
  };
  if (!done("migrated.warehouse.v1")) {
    const wh = ["warehouse.view", "warehouse.process", "warehouse.validate", "warehouse.return", "warehouse.cancel"];
    grant("مدير النظام", ALL_PERMISSIONS);
    grant("مدير توريد", wh);
    grant("أمين مخزن", wh);
    for (const r of ["مندوب مبيعات", "محاسب"]) grant(r, ["warehouse.view"]);
    mark("migrated.warehouse.v1");
  }
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
