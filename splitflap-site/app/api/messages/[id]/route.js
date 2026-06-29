import { NextResponse } from "next/server";
import { guard } from "../../../../lib/guard.js";
import { getMessage, updateMessage, deleteMessage } from "../../../../lib/store.js";

export const dynamic = "force-dynamic";

export const GET = guard(async (_req, { params }) => {
  const m = await getMessage(Number(params.id));
  if (!m) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ message: m });
});

export const PATCH = guard(async (req, { params }) => {
  const fields = await req.json();
  if (fields.config && typeof fields.config !== "string") {
    fields.config = JSON.stringify(fields.config);
  }
  if (typeof fields.visible === "boolean") fields.visible = fields.visible ? 1 : 0;
  const m = await updateMessage(Number(params.id), fields);
  return NextResponse.json({ message: m });
});

export const DELETE = guard(async (_req, { params }) => {
  await deleteMessage(Number(params.id));
  return NextResponse.json({ ok: true });
});
