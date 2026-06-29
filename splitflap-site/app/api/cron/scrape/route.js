import { NextResponse } from "next/server";
import { cronAuthorized } from "../../../../lib/auth.js";
import { listSignboards, listMessages } from "../../../../lib/store.js";
import { renderMessage } from "../../../../lib/render.js";
import { pushToGist } from "../../../../lib/github.js";

export const dynamic = "force-dynamic";

// Hourly: refresh Meetup-backed messages. Event tables are rendered live from
// Meetup's GraphQL API, so we just re-render and, when a meetup message is the
// one currently shown on its board, re-push so the displayed table stays fresh.
export async function GET(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const boards = await listSignboards();
  const results = [];
  for (const board of boards) {
    if (!board.gist_id) continue;
    const active = (await listMessages(board.id)).find((m) => m.id === board.active_message_id);
    if (active && active.kind === "meetup") {
      try {
        const text = await renderMessage(active, board);
        await pushToGist(board.gist_id, board.gist_filename, text);
        results.push({ board: board.id, status: "refreshed", message_id: active.id });
      } catch (e) {
        results.push({ board: board.id, status: "error", error: String(e.message || e) });
      }
    }
  }
  return NextResponse.json({ ran: Date.now(), results });
}
