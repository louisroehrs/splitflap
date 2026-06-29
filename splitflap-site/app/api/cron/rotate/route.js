import { NextResponse } from "next/server";
import { cronAuthorized } from "../../../../lib/auth.js";
import { listSignboards } from "../../../../lib/store.js";
import { rotateSignboard } from "../../../../lib/rotate.js";

export const dynamic = "force-dynamic";

// Vercel Cron hits this every minute. For each signboard, advance the rotation
// if the active message's duration has elapsed.
export async function GET(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const boards = await listSignboards();
  const results = [];
  for (const board of boards) {
    try {
      results.push(await rotateSignboard(board));
    } catch (e) {
      results.push({ board: board.id, status: "error", error: String(e.message || e) });
    }
  }
  return NextResponse.json({ ran: Date.now(), results });
}
