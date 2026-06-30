import { NextResponse } from "next/server";
import { guard } from "../../../lib/guard.js";
import { listSignboards, createSignboard } from "../../../lib/store.js";

export const dynamic = "force-dynamic";

export const GET = guard(async () => {
  return NextResponse.json({ signboards: await listSignboards() });
});

export const POST = guard(async (req) => {
  const body = await req.json();
  if (!body.name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const board = await createSignboard(body);
  return NextResponse.json({ signboard: board });
});
