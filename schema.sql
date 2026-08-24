-- D1 schema for resume-copilot -- SHARED data only.
--
-- Per-user data (cvs, applications, documents, activity_events, templates,
-- chat_messages, profile, token_usage) does NOT live here any more. Each
-- user's rows live in their own ResumeAgent Durable Object's SQLite, whose
-- DDL is src/agents/schema.js and is applied automatically on first use --
-- there is nothing to run by hand and no ALTER TABLE dance for new columns
-- (add a version entry instead). See
-- docs/superpowers/plans/2026-08-24-agent-data-migration.md.
--
-- What remains below is the data that is deliberately NOT per-user. The
-- previous per-user DDL is preserved in git history.

-- Server-side cache for Nominatim (OpenStreetMap) geocoding results.
-- Nominatim's usage policy requires caching -- see src/lib/geocode.js.
-- One row per distinct location string ever geocoded; permanent (no TTL
-- eviction) since city-level coordinates don't meaningfully change.
CREATE TABLE IF NOT EXISTS geocode_cache (
  query      TEXT PRIMARY KEY, -- the raw location string, lowercased+trimmed
  lat        REAL,
  lng        REAL,
  cached_at  TEXT NOT NULL
);

-- One-row ledger recording which user claimed the pre-multi-tenant data in
-- the tables above, so the legacy import (POST /api/admin/import-legacy ->
-- ResumeAgent#importLegacyD1) can only ever run for one identity. It has to
-- live in D1 rather than in the agent because the whole point is
-- cross-instance mutual exclusion: a marker inside a Durable Object can't
-- stop a *different* Durable Object from importing the same rows.
--
-- The import never DELETEs from D1 -- these tables stay as a read-only
-- archive until the owner drops them by hand (see README).
CREATE TABLE IF NOT EXISTS legacy_claim (
  id             TEXT PRIMARY KEY DEFAULT 'default',
  claimed_by_sub TEXT NOT NULL,
  claimed_at     TEXT NOT NULL
);

