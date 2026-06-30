import { db, ready } from "./db.js";

export async function listSignboards() {
  await ready();
  const r = await db().execute("SELECT * FROM signboards ORDER BY created_at");
  return r.rows;
}

export async function getSignboard(id) {
  await ready();
  const r = await db().execute({
    sql: "SELECT * FROM signboards WHERE id = ?",
    args: [id],
  });
  return r.rows[0] || null;
}

export async function createSignboard({ name, gist_id, gist_filename, rows, cols }) {
  await ready();
  const r = await db().execute({
    sql: `INSERT INTO signboards (name, gist_id, gist_filename, rows, cols, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [name, gist_id || null, gist_filename || "sign.txt", rows || 6, cols || 32, Date.now()],
  });
  return getSignboard(Number(r.lastInsertRowid));
}

export async function updateSignboard(id, fields) {
  await ready();
  const allowed = ["name", "gist_id", "gist_filename", "rows", "cols", "active_message_id", "rotation_started_at"];
  const keys = Object.keys(fields).filter((k) => allowed.includes(k));
  if (!keys.length) return getSignboard(id);
  const set = keys.map((k) => `${k} = ?`).join(", ");
  await db().execute({
    sql: `UPDATE signboards SET ${set} WHERE id = ?`,
    args: [...keys.map((k) => fields[k]), id],
  });
  return getSignboard(id);
}

export async function deleteSignboard(id) {
  await ready();
  await db().execute({ sql: "DELETE FROM messages WHERE signboard_id = ?", args: [id] });
  await db().execute({ sql: "DELETE FROM signboards WHERE id = ?", args: [id] });
}

export async function listMessages(signboardId) {
  await ready();
  const r = await db().execute({
    sql: "SELECT * FROM messages WHERE signboard_id = ? ORDER BY sort_order, id",
    args: [signboardId],
  });
  return r.rows;
}

export async function getMessage(id) {
  await ready();
  const r = await db().execute({ sql: "SELECT * FROM messages WHERE id = ?", args: [id] });
  return r.rows[0] || null;
}

export async function createMessage(signboardId, m) {
  await ready();
  const r0 = await db().execute({
    sql: "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM messages WHERE signboard_id = ?",
    args: [signboardId],
  });
  const order = Number(r0.rows[0].n);
  const r = await db().execute({
    sql: `INSERT INTO messages
            (signboard_id, kind, title, content, rows, cols, visible, duration, sort_order, config, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      signboardId,
      m.kind || "text",
      m.title || "",
      m.content || "",
      m.rows || 6,
      m.cols || 32,
      m.visible ? 1 : 0,
      m.duration || 60,
      order,
      m.config || "{}",
      Date.now(),
    ],
  });
  return getMessage(Number(r.lastInsertRowid));
}

export async function updateMessage(id, fields) {
  await ready();
  const allowed = ["kind", "title", "content", "rows", "cols", "visible", "duration", "sort_order", "config"];
  const keys = Object.keys(fields).filter((k) => allowed.includes(k));
  if (!keys.length) return getMessage(id);
  const set = keys.map((k) => `${k} = ?`).join(", ");
  await db().execute({
    sql: `UPDATE messages SET ${set} WHERE id = ?`,
    args: [...keys.map((k) => fields[k]), id],
  });
  return getMessage(id);
}

export async function deleteMessage(id) {
  await ready();
  await db().execute({ sql: "DELETE FROM messages WHERE id = ?", args: [id] });
}

// Persist a new explicit ordering (array of message ids in display order).
// D1 has no interactive transactions — batch() applies the updates atomically.
export async function reorderMessages(signboardId, orderedIds) {
  await ready();
  const conn = db().raw;
  const stmt = conn.prepare(
    "UPDATE messages SET sort_order = ? WHERE id = ? AND signboard_id = ?"
  );
  await conn.batch(orderedIds.map((id, i) => stmt.bind(i, id, signboardId)));
}
