// Custom Worker entry. OpenNext generates a worker that only exports `fetch`;
// we re-export it and add a `scheduled` handler so Cloudflare Cron Triggers can
// drive the rotation.
//
// The handler calls the existing HTTP cron routes through the `SELF` service
// binding (this same Worker, see wrangler.jsonc). A service-binding fetch is
// delivered straight into our own `fetch` handler — no DNS, no workers.dev
// loopback — so it's reliable and needs no SITE_URL. The hostname below is
// arbitrary; the binding ignores it.
// @ts-ignore - generated at build time by `opennextjs-cloudflare build`
import worker from "./.open-next/worker.js";

export default {
  fetch: worker.fetch,

  async scheduled(event: ScheduledEvent, env: any, ctx: ExecutionContext) {
    console.log("CRON fired:", event.cron);
    const secret = env.CRON_SECRET ? `?secret=${encodeURIComponent(env.CRON_SECRET)}` : "";

    ctx.waitUntil(
      (async () => {
        // Every minute: advance any board whose active message has timed out.
        const r = await env.SELF.fetch(`https://self/api/cron/rotate${secret}`);
        console.log("rotate ->", r.status, await r.text());
        // Top of the hour: also refresh Meetup-backed active messages.
        if (event.cron === "0 * * * *") {
          const s = await env.SELF.fetch(`https://self/api/cron/scrape${secret}`);
          console.log("scrape ->", s.status, await s.text());
        }
      })()
    );
  },
};
