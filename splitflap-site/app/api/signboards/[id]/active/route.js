import { getSignboard, listMessages, getMessage } from "../../../../../lib/store.js";
import { renderMessage } from "../../../../../lib/render.js";

export const dynamic = "force-dynamic";

// PUBLIC endpoint for the physical sign-board client (e.g. splitflap_board.py).
// Returns the plain text currently on the board — the active message rendered to
// the board's geometry — so the client can poll this directly instead of a gist.
// The cron rotation advances `active_message_id`, so polling reflects rotation.
//
//   GET /api/signboards/<id>/active   ->   text/plain, one line per board row
export async function GET(_req, { params }) {
  const { id } = await params;
  const board = await getSignboard(Number(id));
  if (!board) return text("board not found", 404);

  // Prefer the active message; fall back to the first visible one.
  let msg = board.active_message_id ? await getMessage(board.active_message_id) : null;
  if (!msg || Number(msg.visible) !== 1) {
    const visible = (await listMessages(board.id)).filter((m) => Number(m.visible) === 1);
    msg = visible[0] || null;
  }

  const body = msg ? await renderMessage(msg, board) : "";
  return text(body, 200);
}

// CORS preflight (harmless for the plain GET the board makes, useful for browsers).
export function OPTIONS() {
  return new Response(null, { status: 204, headers: cors() });
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };
}

function text(body, status) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      ...cors(),
    },
  });
}
