import { NextResponse } from "next/server";
import { guard } from "../../../../lib/guard.js";
import { getSignboard, updateSignboard, deleteSignboard } from "../../../../lib/store.js";
import { listMessages } from "../../../../lib/store.js";

export const dynamic = "force-dynamic";

export const GET = guard(async (_req, { params }) => {
  const board = await getSignboard(Number(params.id));
  if (!board) return NextResponse.json({ error: "not found" }, { status: 404 });
  const messages = await listMessages(board.id);
  return NextResponse.json({ signboard: board, messages });
});

export const PATCH = guard(async (req, { params }) => {
  const fields = await req.json();
  const board = await updateSignboard(Number(params.id), fields);
  return NextResponse.json({ signboard: board });
});

export const DELETE = guard(async (_req, { params }) => {
  await deleteSignboard(Number(params.id));
  return NextResponse.json({ ok: true });
});
