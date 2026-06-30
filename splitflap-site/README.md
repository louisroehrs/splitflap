# Split-Flap Controller

A Next.js web app for managing the messages shown on split-flap ("Solari") sign
boards. Each **sign board** maps to a GitHub **gist**; the physical board (see
`../python/splitflap_board.py`) polls the gist's raw URL and animates whatever
text it finds. This app is the editor + scheduler that decides what goes into
that gist and when.

---

## What it does

- **Sign boards** — one per gist. Each has a name, column/row geometry, and a
  target gist + filename.
- **Messages** — text cards or live **Meetup events** cards. Toggle visibility,
  set a per-message display duration, and reorder with the ↑/↓ buttons. New
  messages default to the board's rows/cols. The text editor shows a column
  ruler and row numbers so you can see exactly where the board boundaries clip.
- **Rotation** — every minute a cron tick checks each board; when the active
  message's duration has elapsed it renders the next visible message and pushes
  it to the gist. "Advance now" forces an immediate flip.
- **Meetup cards** — pull upcoming events from `meetup.com/<urlname>` and format
  them into a fixed-width table with optional header/footer text and a
  configurable number of rows. Characters the board can't display are stripped
  and text is uppercased to match the flaps. An hourly cron re-pushes the table
  when a Meetup card is the one currently on a board.

## Stack

- Next.js 15 (App Router) + React 19
- **Cloudflare Workers** (via `@opennextjs/cloudflare`) + **D1** (SQLite) for the
  recommended free deployment; **Cloudflare Cron Triggers** drive rotation
- GitHub Personal Access Token (scope: `gist`) for reading/writing gists

The data layer (`lib/db.js`) speaks a small libSQL-compatible shim, so the app
can also run on Vercel + Turso (libSQL) — see the alternative section below.

---

## Prerequisites

- **Node.js 18+** (developed on v22)
- A **GitHub account** with at least one gist (or create one — it can start with
  any placeholder text; the app overwrites it)
- A **Cloudflare account** (free tier is enough — Workers, D1, and Cron Triggers
  are all in it)

## 1. Create a GitHub token

The app needs a Personal Access Token so it can read your gist list and write
the message text into a gist.

1. Go to **GitHub → Settings → Developer settings → Personal access tokens**.
2. Either kind works:
   - **Fine-grained token** → Account permissions → **Gists: Read and write**.
   - **Classic token** → check the **`gist`** scope.
3. Generate it and copy the value (starts with `ghp_…` or `github_pat_…`).

You'll paste this into the app's UI later — it is stored in the database, never
in source. Keep it secret.

## 2. Configuration & secrets

Storage is **Cloudflare D1** (a binding named `DB` in `wrangler.jsonc`), not a
connection string. The two app secrets are:

| Secret         | Required           | Purpose                                                                 |
| -------------- | ------------------ | ----------------------------------------------------------------------- |
| `APP_PASSWORD` | prod (recommended) | Shared login password for the UI. Empty = open (fine for local dev).    |
| `CRON_SECRET`  | prod (recommended) | Shared secret protecting the cron endpoints. `openssl rand -hex 32`.    |

Plus one var, `SITE_URL` (in `wrangler.jsonc` `vars`), the public origin the
scheduled handler calls back into (e.g. `https://splitflap.<acct>.workers.dev`).

When `APP_PASSWORD` / `CRON_SECRET` are empty the UI is open and the cron
endpoints need no secret — convenient for local development.

## 3. Run locally

```bash
npm install
wrangler d1 migrations apply splitflap --local   # create the local D1 tables
npm run dev          # http://localhost:3000  (next dev, with local D1 bound)
# or: npm run cf:dev # http://localhost:8787  (full Workers runtime via wrangler)
```

`next dev` picks up the local D1 binding via `initOpenNextCloudflareForDev()` in
`next.config.js`. Then, in the browser:

1. (If `APP_PASSWORD` is set) sign in.
2. Paste your **GitHub token** in the top panel and save — it validates the
   token and shows your login.
3. **+ New sign board** → name it, set columns/rows, pick the gist and filename
   the physical board reads.
4. Open the board, **+ Text message** or **+ Meetup events card**, edit, and use
   **Save & preview** to see the exact text that will be pushed.
5. Click **Advance now** to push the first message immediately.

Drive the scheduler by hand without waiting for cron:

```bash
curl localhost:3000/api/cron/rotate     # advance any boards whose timer is up
curl localhost:3000/api/cron/scrape     # refresh Meetup-backed active messages
# under `npm run cf:dev`, fire the real cron handler:
curl "localhost:8787/cdn-cgi/handler/scheduled?cron=*+*+*+*+*"   # needs --test-scheduled
```

## 4. Deploy to Cloudflare (free)

```bash
npx wrangler login

# 1. Create the D1 database and paste the printed database_id into wrangler.jsonc
wrangler d1 create splitflap

# 2. Create the tables in the remote DB
wrangler d1 migrations apply splitflap --remote

# 3. Set secrets and the public origin
wrangler secret put APP_PASSWORD
wrangler secret put CRON_SECRET
#   edit wrangler.jsonc → vars.SITE_URL = your https://…workers.dev URL

# 4. Build (OpenNext) + deploy
npm run cf:deploy
```

The `triggers.crons` in `wrangler.jsonc` register the schedules automatically:

- `* * * * *` — every minute → `/api/cron/rotate`
- `0 * * * *` — hourly → also `/api/cron/scrape`

Open the deployed URL, log in, paste your GitHub token, create boards, and the
minute Cron Trigger advances rotation on its own. D1's free tier (5 GB, generous
daily reads/writes) is far more than this app needs, and Cron Triggers give
**true per-minute** rotation — no rounding.

## Alternative: Vercel + Turso (libSQL)

`lib/db.js` exposes a libSQL-compatible shim, so the app can also run on Vercel
with **Turso** as the database. Trade-offs: free Vercel Hobby cron only fires
**once per day**, so per-minute rotation needs Vercel Pro or an external pinger
hitting `/api/cron/rotate`. To go this route, swap `lib/db.js`/`lib/env.js` back
to `@libsql/client` + `process.env.DATABASE_URL`/`DATABASE_AUTH_TOKEN`, add a
`vercel.json` with the two cron paths, and deploy. (Cloudflare is the
recommended free path precisely because of that cron limit.)

---

## How a message becomes board text

`lib/render.js` produces the exact plain text pushed to the gist:

- **text** — your content verbatim, each line clipped to `cols`, clipped to
  `rows` total.
- **meetup** — `header` + a generated event table + `footer`, all clipped to the
  board geometry. Event titles are uppercased and filtered to the board's flap
  alphabet (emoji/accents removed).

## Project layout

```
splitflap-site/
  app/
    page.js                 Dashboard: login, GitHub token, board list/create
    board/[id]/page.js      Board editor: messages, reorder, grid text editor
    api/                    Route handlers (signboards, messages, cron, …)
  lib/
    db.js / store.js        D1 access (libSQL-compatible shim) + queries
    env.js                  Read Cloudflare bindings/vars (process.env fallback)
    github.js               Gist list / validate / push
    meetup.js               Meetup GraphQL fetch + table formatting + sanitize
    render.js               Message -> clipped board text
    rotate.js               Per-board rotation logic
    auth.js / guard.js      UI password gate + cron secret
  worker.ts                 Custom Worker entry: wraps OpenNext + scheduled()
  open-next.config.ts       OpenNext Cloudflare adapter config
  wrangler.jsonc            Worker name, D1 binding, cron triggers, vars
  migrations/0001_init.sql  D1 schema
```

## Troubleshooting

- **"No GitHub token configured"** — paste a token with `gist` scope in the
  dashboard's top panel.
- **"D1 binding 'DB' not available"** — run `wrangler d1 migrations apply
  splitflap --local` and start via `npm run dev`/`npm run cf:dev`; for prod make
  sure `database_id` in `wrangler.jsonc` is your real ID.
- **Gist not updating** — confirm the board has a gist selected and a *visible*
  message, then click **Advance now**. Check the token still has `gist` scope.
- **Meetup card shows "FETCH ERROR"** — verify the `urlname` matches
  `meetup.com/<urlname>` exactly; the group must be public.
- **Cron never fires** — confirm `SITE_URL` in `wrangler.jsonc` is your real
  public origin (the scheduled handler fetches it) and `triggers.crons` is set.
