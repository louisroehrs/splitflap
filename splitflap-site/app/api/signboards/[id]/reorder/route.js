import { NextResponse } from "next/server";
import { guard } from "../../../../../lib/guard.js";
import { reorderMessages } from "../../../../../lib/store.js";

export const dynamic = "force-dynamic";

export const POST = guard(async (req, { params }) => {
  const { order } = await req.json();
  if (!Array.isArray(order)) return NextResponse.json({ error: "order[] required" }, { status: 400 });
  await reorderMessages(Number(params.id), order.map(Number));
  return NextResponse.json({ ok: true });
});
