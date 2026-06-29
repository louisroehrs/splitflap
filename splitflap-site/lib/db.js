import { createClient } from "@libsql/client";

// A single libSQL client shared across the (warm) serverless instance.
// Local dev uses a file: URL; production points at Turso (hosted SQLite).
let _client = null;
let _ready = null;

export function db() {
  if (!_client) {
    const url = process.env.DATABASE_URL || "file:local.db";
    _client = createClient({
      url,
      authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
    });
  }
  return _client;
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
     active_message_id   INTEGER,
     rotation_started_at INTEGER,
     created_at          INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS messages (
     id           INTEGER PRIMARY KEY AUTOINCREMENT,
     signboard_id INTEGER NOT NULL REFERENCES signboards(id) ON DELETE CASCADE,
     kind         TEXT NOT NULL DEFAULT 'text',   -- 'text' | 'meetup'
     title        TEXT NOT NULL DEFAULT '',
     content      TEXT NOT NULL DEFAULT '',
     rows         INTEGER NOT NULL DEFAULT 6,
     cols         INTEGER NOT NULL DEFAULT 32,
     visible      INTEGER NOT NULL DEFAULT 1,
     duration     INTEGER NOT NULL DEFAULT 60,    -- seconds of display
     sort_order   INTEGER NOT NULL DEFAULT 0,
     config       TEXT NOT NULL DEFAULT '{}',     -- JSON: meetup urlname/header/footer/event_rows
     created_at   INTEGER NOT NULL
   )`,
];

// Run migrations once per warm instance.
export async function ready() {
  if (!_ready) {
    _ready = (async () => {
      const c = db();
      for (const stmt of SCHEMA) await c.execute(stmt);
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
