-- Initial schema for the Split-Flap Controller (D1 / SQLite).
-- Apply with: wrangler d1 migrations apply splitflap [--local|--remote]

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS signboards (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT NOT NULL,
  gist_id             TEXT,
  gist_filename       TEXT NOT NULL DEFAULT 'sign.txt',
  rows                INTEGER NOT NULL DEFAULT 6,
  cols                INTEGER NOT NULL DEFAULT 32,
  active_message_id   INTEGER,
  rotation_started_at INTEGER,
  created_at          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
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
);
