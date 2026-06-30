// Custom Worker entry. OpenNext generates a worker that only exports `fetch`;
// we re-export it and add a `scheduled` handler so Cloudflare Cron Triggers can
// drive the rotation. The handler simply calls the existing HTTP cron routes so
// all DB/env access happens in a normal request context.
// @ts-ignore - generated at build time by `opennextjs-cloudflare build`
import worker from "./.open-next/worker.js";

export default {
  fetch: worker.fetch,

  async scheduled(event: ScheduledEvent, env: any, ctx: ExecutionContext) {
    const base = (env.SITE_URL || "").replace(/\/$/, "");
    const secret = env.CRON_SECRET || "";
    const q = secret ? `?secret=${encodeURIComponent(secret)}` : "";

    ctx.waitUntil(
      (async () => {
        // Every minute: advance any board whose active message has timed out.
        await fetch(`${base}/api/cron/rotate${q}`).catch(() => {});
        // Top of the hour: also refresh Meetup-backed active messages.
        if (event.cron === "0 * * * *") {
          await fetch(`${base}/api/cron/scrape${q}`).catch(() => {});
        }
      })()
    );
  },
};
