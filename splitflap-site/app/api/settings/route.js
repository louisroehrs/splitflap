import { NextResponse } from "next/server";
import { guard } from "../../../lib/guard.js";
import { getSetting, setSetting } from "../../../lib/db.js";
import { whoAmI } from "../../../lib/github.js";

export const dynamic = "force-dynamic";

// Report whether a token is set + which GitHub login it belongs to (never the
// token itself).
export const GET = guard(async () => {
  const token = await getSetting("github_token");
  let login = null;
  if (token) {
    try {
      login = await whoAmI(token);
    } catch {
      login = null;
    }
  }
  return NextResponse.json({ hasToken: !!token, login });
});

export const POST = guard(async (req) => {
  const { token } = await req.json();
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });
  let login;
  try {
    login = await whoAmI(token); // validates; throws on bad token
  } catch (e) {
    // Token problems are the client's, not a server error — surface as 4xx.
    return NextResponse.json({ error: String(e.message || e) }, { status: 400 });
  }
  await setSetting("github_token", token);
  return NextResponse.json({ ok: true, login });
});
