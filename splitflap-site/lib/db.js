import { cfEnv } from "./env.js";

// Data layer backed by Cloudflare D1. We expose a tiny libSQL-compatible shim
// (`execute({sql, args})` returning `{ rows, lastInsertRowid }`) so the rest of
// the app — lib/store.js in particular — stays unchanged across the port.

function d1() {
  const db = cfEnv("DB");
  if (!db) throw new Error("D1 binding 'DB' not available. Check wrangler.jsonc / context.");
  return db;
}

let _ready = null;

export function db() {
  const conn = d1();
  return {
    async execute(stmt) {
      // Accept both execute("SQL") and execute({ sql, args }).
      const sql = typeof stmt === "string" ? stmt : stmt.sql;
      const args = typeof stmt === "string" ? [] : stmt.args || [];
      const r = await conn.prepare(sql).bind(...args).all();
      return { rows: r.results || [], lastInsertRowid: r.meta?.last_row_id };
    },
    // Expose the raw D1 handle for batch() (used by reorderMessages).
    raw: conn,
  };
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS settings (
     key   TEXT PRIMARY KEY,
     value TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS signboards (
     id                  INTEGER PRIMARY KEY AUTOINCREMENT,
     name                TEXT NOT NULL,
     gist_id             TEXT,
     gist_filename       TEXT NOT NULL DEFAULT 'sign.txt',
     rows                INTEGER NOT NULL DEFAULT 6,
     cols                INTEGER NOT NULL DEFAULT 32,
     timezone            TEXT NOT NULL DEFAULT 'America/Los_Angeles',
     active_message_id   INTEGER,
     rotation_started_at INTEGER,
     created_at          INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS messages (
     id           INTEGER PRIMARY KEY AUTOINCREMENT,
     signboard_id INTEGER NOT NULL REFERENCES signboards(id) ON DELETE CASCADE,
     kind         TEXT NOT NULL DEFAULT 'text',
     title        TEXT NOT NULL DEFAULT '',
     content      TEXT NOT NULL DEFAULT '',
     rows         INTEGER NOT NULL DEFAULT 6,
     cols         INTEGER NOT NULL DEFAULT 32,
     visible      INTEGER NOT NULL DEFAULT 1,
     duration     INTEGER NOT NULL DEFAULT 60,
     sort_order   INTEGER NOT NULL DEFAULT 0,
     config       TEXT NOT NULL DEFAULT '{}',
     created_at   INTEGER NOT NULL
   )`,
];

// Safety net: ensure tables exist once per warm isolate. The canonical schema
// lives in migrations/0001_init.sql (applied via `wrangler d1 migrations apply`).
export async function ready() {
  if (!_ready) {
    _ready = (async () => {
      const conn = d1();
      await conn.batch(SCHEMA.map((sql) => conn.prepare(sql)));
    })();
  }
  return _ready;
}

export async function getSetting(key) {
  await ready();
  const r = await db().execute({
    sql: "SELECT value FROM settings WHERE key = ?",
    args: [key],
  });
  return r.rows[0]?.value ?? null;
}

export async function setSetting(key, value) {
  await ready();
  await db().execute({
    sql: `INSERT INTO settings (key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    args: [key, value],
  });
}
