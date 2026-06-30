import { NextResponse } from "next/server";
import { guard } from "../../../../../lib/guard.js";
import { getMessage, getSignboard } from "../../../../../lib/store.js";
import { renderMessage } from "../../../../../lib/render.js";

export const dynamic = "force-dynamic";

// Render a message exactly as it would be pushed to the gist (for live preview).
export const GET = guard(async (_req, { params }) => {
  const { id } = await params;
  const m = await getMessage(Number(id));
  if (!m) return NextResponse.json({ error: "not found" }, { status: 404 });
  const board = await getSignboard(m.signboard_id);
  const text = await renderMessage(m, board);
  return NextResponse.json({ text });
});
