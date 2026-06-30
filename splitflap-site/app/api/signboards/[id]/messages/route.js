import { NextResponse } from "next/server";
import { guard } from "../../../../../lib/guard.js";
import { getSignboard, listMessages, createMessage } from "../../../../../lib/store.js";

export const dynamic = "force-dynamic";

export const GET = guard(async (_req, { params }) => {
  const { id } = await params;
  return NextResponse.json({ messages: await listMessages(Number(id)) });
});

export const POST = guard(async (req, { params }) => {
  const { id: pid } = await params;
  const id = Number(pid);
  const board = await getSignboard(id);
  if (!board) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json();
  // New messages default to the board's geometry, per spec.
  const msg = await createMessage(id, {
    kind: body.kind || "text",
    title: body.title || "",
    content: body.content || "",
    rows: body.rows ?? board.rows,
    cols: body.cols ?? board.cols,
    visible: body.visible ?? 1,
    duration: body.duration ?? 60,
    config: body.config ? JSON.stringify(body.config) : "{}",
  });
  return NextResponse.json({ message: msg });
});
