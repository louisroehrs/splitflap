import { NextResponse } from "next/server";
import { guard } from "../../../../../lib/guard.js";
import { getSignboard } from "../../../../../lib/store.js";
import { rotateSignboard } from "../../../../../lib/rotate.js";

export const dynamic = "force-dynamic";

// Force-advance this board to its next visible message and push immediately.
export const POST = guard(async (_req, { params }) => {
  const { id } = await params;
  const board = await getSignboard(Number(id));
  if (!board) return NextResponse.json({ error: "not found" }, { status: 404 });
  const result = await rotateSignboard(board, { force: true });
  return NextResponse.json(result);
});
