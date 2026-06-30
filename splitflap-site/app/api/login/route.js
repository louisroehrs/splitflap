import { NextResponse } from "next/server";
import { appPassword, sessionValue, COOKIE } from "../../../lib/auth.js";

export const dynamic = "force-dynamic";

export async function POST(req) {
  const { password } = await req.json().catch(() => ({}));
  if (!appPassword() || password === appPassword()) {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE, sessionValue(), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return res;
  }
  return NextResponse.json({ error: "wrong password" }, { status: 401 });
}
