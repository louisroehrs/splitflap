import { NextResponse } from "next/server";
import { guard } from "../../../lib/guard.js";
import { listGists } from "../../../lib/github.js";

export const dynamic = "force-dynamic";

export const GET = guard(async () => {
  return NextResponse.json({ gists: await listGists() });
});
