import { listMessages, updateSignboard } from "./store.js";
import { renderMessage } from "./render.js";
import { pushToGist } from "./github.js";

// Advance a single signboard's rotation if the current message's display
// duration has elapsed. Returns a short status string describing what happened.
//
// Called every minute by the cron tick (and on-demand from the UI). Idempotent:
// if not enough time has passed it does nothing.
export async function rotateSignboard(board, { force = false } = {}) {
  const all = await listMessages(board.id);
  const visible = all.filter((m) => Number(m.visible) === 1);

  if (!visible.length) return { board: board.id, status: "no visible messages" };
  if (!board.gist_id) return { board: board.id, status: "no gist configured" };

  const now = Date.now();
  const activeId = board.active_message_id;
  const active = visible.find((m) => m.id === activeId);

  // Decide whether to advance.
  let next;
  if (!active) {
    next = visible[0];
  } else {
    const elapsed = (now - (board.rotation_started_at || 0)) / 1000;
    if (!force && elapsed < Number(active.duration)) {
      return { board: board.id, status: `holding (${Math.round(elapsed)}s/${active.duration}s)` };
    }
    const idx = visible.findIndex((m) => m.id === active.id);
    next = visible[(idx + 1) % visible.length];
  }

  const text = await renderMessage(next, board);
  await pushToGist(board.gist_id, board.gist_filename, text);
  await updateSignboard(board.id, {
    active_message_id: next.id,
    rotation_started_at: now,
  });
  return { board: board.id, status: "pushed", message_id: next.id, title: next.title };
}
