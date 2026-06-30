import { getCloudflareContext } from "@opennextjs/cloudflare";

// Read a Cloudflare binding/var, falling back to process.env (local node / tests).
// Works for both request and scheduled contexts.
export function cfEnv(key) {
  try {
    const v = getCloudflareContext()?.env?.[key];
    if (v !== undefined && v !== null) return v;
  } catch {
    // No CF context (e.g. plain `node` smoke test) — fall through.
  }
  return process.env[key];
}
