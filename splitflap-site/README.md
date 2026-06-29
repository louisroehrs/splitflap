# Split-Flap Controller

A small Next.js web app for managing the messages shown on split-flap ("Solari")
sign boards. Each **sign board** maps to a GitHub **gist**; the physical board
(see `../python/splitflap_board.py`) polls the gist's raw URL and animates
whatever text it finds. This app is the editor + scheduler that decides what
goes into that gist and when.

## What it does

- **Sign boards** — one per gist. Each has a name, column/row geometry, and a
  target gist + filename.
- **Messages** — text cards or live **Meetup events** cards. Toggle visibility,
  set a per-message display duration, and drag the order with the ↑/↓ buttons.
  New messages default to the board's rows/cols.
- **Rotation** — every minute a cron tick checks each board; when the active
  message's duration has elapsed it renders the next visible message and pushes
  it to the gist. "Advance now" forces an immediate flip.
- **Meetup cards** — pull upcoming events from `meetup.com/<urlname>` via
  Meetup's GraphQL API and format them into a fixed-width table with optional
  header/footer text and a configurable number of event rows. An hourly cron
  re-pushes the table if a Meetup card is the one currently on a board.

## Stack

- Next.js 14 (App Router) + React
- libSQL / SQLite for storage — a local file in dev, **Turso** in production
- GitHub Personal Access Token (scope: `gist`) for reading/writing gists
- Vercel Cron for the rotation tick + hourly Meetup refresh

## Local development

```bash
cp .env.example .env       # DATABASE_URL=file:local.db is fine for dev
npm install
npm run dev                # http://localhost:3000
```

Leave `APP_PASSWORD` and `CRON_SECRET` empty in dev — the UI is then open and
the cron endpoints require no secret. Add a GitHub token in the UI (top panel),
create a sign board pointing at one of your gists, add messages, and click
**Advance now** to push.

You can drive the scheduler manually without waiting for cron:

```bash
curl localhost:3000/api/cron/rotate     # advance any boards whose timer is up
curl localhost:3000/api/cron/scrape     # refresh Meetup-backed active messages
```

## Deploying to Vercel

1. Create a **Turso** database and set, in the Vercel project env:
   - `DATABASE_URL=libsql://<your-db>.turso.io`
   - `DATABASE_AUTH_TOKEN=<turso token>`
   - `CRON_SECRET=<openssl rand -hex 32>` (Vercel sends this as the cron Bearer)
   - `APP_PASSWORD=<shared login password>`
2. Deploy. `vercel.json` registers the two cron jobs:
   - `/api/cron/rotate` — every minute
   - `/api/cron/scrape` — hourly
3. Open the site, log in, paste your GitHub token, and create your boards.

### Note on timing granularity

The rotation tick runs **once a minute**, so a message's effective on-screen
time is rounded up to the next whole minute. (Vercel's Hobby tier also limits
cron to coarser schedules — use Pro for true per-minute ticks, or run this app
as a long-lived process elsewhere and call `/api/cron/rotate` on your own
timer.) Durations are still stored in seconds.

## How a message becomes board text

`lib/render.js` turns a message into the exact plain text pushed to the gist:

- **text** — your content verbatim, each line clipped to `cols`, clipped to
  `rows` total.
- **meetup** — `header` + a generated event table + `footer`, all clipped to the
  board geometry. The board's alphabet is uppercase ASCII, so emoji and accents
  render as blanks on the physical display (handled by the board, not here).

Use **Save & preview** in the message editor to see the rendered output before
it ships.
