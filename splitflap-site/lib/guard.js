import { NextResponse } from "next/server";
import { isAuthed } from "./auth.js";

// Wrap an API handler so it 401s when the UI session is missing.
export function guard(handler) {
  return async (req, ctx) => {
    if (!isAuthed()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    try {
      return await handler(req, ctx);
    } catch (e) {
      return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
    }
  };
}
