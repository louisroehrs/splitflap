import { cookies } from "next/headers";
import { cfEnv } from "./env.js";

const COOKIE = "sf_session";

// Single shared password gate. If APP_PASSWORD is unset (typical in local dev)
// the app is open. The session cookie just stores the password hash-ish marker.
export function appPassword() {
  return cfEnv("APP_PASSWORD") || "";
}

export function sessionValue() {
  // Not cryptographic — a shared-secret marker so the cookie can't be guessed
  // without knowing APP_PASSWORD. Fine for a single-tenant controller.
  return "ok:" + Buffer.from(appPassword()).toString("base64");
}

export async function isAuthed() {
  if (!appPassword()) return true;
  const jar = await cookies(); // async in Next 15
  return jar.get(COOKIE)?.value === sessionValue();
}

export { COOKIE };

// Cron endpoints accept the shared secret via Bearer header or ?secret=.
export function cronAuthorized(req) {
  const secret = cfEnv("CRON_SECRET");
  if (!secret) return true; // open in dev
  const auth = req.headers.get("authorization") || "";
  if (auth === `Bearer ${secret}`) return true;
  const url = new URL(req.url);
  return url.searchParams.get("secret") === secret;
}
