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

All commands run from the `splitflap-site/` directory. `wrangler` is installed
locally, so prefix with `npx` (or `npm exec --`) if it isn't on your PATH.

### 4a. Log in

```bash
npx wrangler login          # opens a browser to authorize the CLI
npx wrangler whoami         # confirms the account it will deploy to
```

### 4b. Create the D1 database

```bash
npx wrangler d1 create splitflap
```

This prints a `database_id`. Open **`wrangler.jsonc`** and paste it into the
`d1_databases[0].database_id` field (replacing the local placeholder):

```jsonc
"d1_databases": [
  { "binding": "DB", "database_name": "splitflap",
    "database_id": "PASTE-THE-ID-HERE", "migrations_dir": "migrations" }
]
```

### 4c. Create the tables in the remote database

```bash
npx wrangler d1 migrations apply splitflap --remote
```

### 4d. Set the app secrets

```bash
npx wrangler secret put APP_PASSWORD     # paste a login password when prompted
npx wrangler secret put CRON_SECRET      # paste output of: openssl rand -hex 32
```

### 4e. First deploy

```bash
npm run cf:deploy        # = opennextjs-cloudflare build && opennextjs-cloudflare deploy
```

Wrangler prints the live URL, e.g. `https://splitflap.<your-account>.workers.dev`.

### 4f. Set `SITE_URL`, then redeploy

The scheduled (cron) handler calls the app's own public URL, which you only
learn after the first deploy. Put that URL into **`wrangler.jsonc`**:

```jsonc
"vars": { "SITE_URL": "https://splitflap.<your-account>.workers.dev" }
```

Then redeploy so the cron handler knows where to call:

```bash
npm run cf:deploy
```

### 4g. Done

The `triggers.crons` in `wrangler.jsonc` are registered automatically on deploy:

- `* * * * *` — every minute → `/api/cron/rotate`
- `0 * * * *` — hourly → also `/api/cron/scrape`

Open the URL, log in with `APP_PASSWORD`, paste your **GitHub token**, create a
sign board pointing at a gist, add messages, and the minute Cron Trigger advances
the rotation on its own. D1's free tier (5 GB, generous daily reads/writes) is
far more than this app needs, and Cron Triggers give **true per-minute** rotation
— no rounding.

### Updating, logs, and verifying

```bash
npm run cf:deploy                 # ship a new version after code changes
npx wrangler tail                 # live-stream Worker logs (incl. cron runs)
npx wrangler d1 execute splitflap --remote \
  --command "SELECT id, name FROM signboards"   # peek at the prod DB
```

To force a rotation without waiting for the minute tick, hit the endpoint with
your secret (or click **Advance now** in the UI):

```bash
curl "https://splitflap.<acct>.workers.dev/api/cron/rotate?secret=$CRON_SECRET"
```

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
  alphabet (emoji/accents removed). Event dates/times are converted to the sign
  board's configured **time zone** (Meetup returns an absolute instant; the table
  renders it in that IANA zone). Set the zone in the board settings — important
  because the server runs in UTC, so without it times would display in UTC.

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
