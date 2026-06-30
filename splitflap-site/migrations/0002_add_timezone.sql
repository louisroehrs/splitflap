-- Per-sign-board IANA time zone. Meetup event times render in this zone.
-- Apply with: wrangler d1 migrations apply splitflap [--local|--remote]

ALTER TABLE signboards
  ADD COLUMN timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles';
