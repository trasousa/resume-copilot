// Per-user DDL, executed inside each ResumeAgent's own SQLite storage.
//
// Workers have no filesystem, so this can't be a .sql file the way
// schema.sql is for D1 -- it ships as a module and runs from ensureSchema()
// on every agent wake.
//
// Two rules, both load-bearing:
//   1. NEVER edit a version array that has already shipped. Deployed agents
//      have already applied it and will not re-run it. Add a new array.
//   2. Every statement must be idempotent on its own (IF NOT EXISTS), since
//      an agent whose version marker was lost would replay from zero.
//
// This is also the permanent fix for the ALTER TABLE footgun documented in
// schema.sql: a new column is now a new version entry, not a hand-run
// migration command in the README.
//
// The tables below are the per-user half of schema.sql, copied verbatim.
// geocode_cache stays in D1 deliberately -- it caches public OpenStreetMap
// results, not user data, and one shared cache serves Nominatim's usage
// policy better than one copy per user.

const V1 = [
  `CREATE TABLE IF NOT EXISTS cvs (
    id                TEXT PRIMARY KEY,
    label             TEXT NOT NULL,
    content           TEXT NOT NULL,
    is_master         INTEGER NOT NULL DEFAULT 0,
    parent_id         TEXT REFERENCES cvs(id) ON DELETE SET NULL,
    source_file       TEXT,
    original_key      TEXT,
    original_filename TEXT,
    parsed_json       TEXT,
    created_at        TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS applications (
    id               TEXT PRIMARY KEY,
    company          TEXT NOT NULL,
    role             TEXT NOT NULL,
    location         TEXT NOT NULL DEFAULT '',
    link             TEXT NOT NULL DEFAULT '',
    source           TEXT NOT NULL DEFAULT 'manual',
    job_post_text    TEXT NOT NULL DEFAULT '',
    cv_id            TEXT REFERENCES cvs(id) ON DELETE SET NULL,
    stage            TEXT NOT NULL DEFAULT 'saved',
    stage_entered_at TEXT NOT NULL,
    applied_at       TEXT,
    comp_estimate    TEXT NOT NULL DEFAULT '',
    match_score      INTEGER,
    notes            TEXT NOT NULL DEFAULT '',
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS documents (
    id             TEXT PRIMARY KEY,
    application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    type           TEXT NOT NULL,
    content        TEXT NOT NULL,
    created_at     TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS activity_events (
    id             TEXT PRIMARY KEY,
    application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    type           TEXT NOT NULL,
    title          TEXT NOT NULL,
    detail         TEXT NOT NULL DEFAULT '',
    occurred_at    TEXT NOT NULL,
    created_at     TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS templates (
    id                  TEXT PRIMARY KEY,
    kind                TEXT NOT NULL,
    label               TEXT NOT NULL,
    tone                TEXT NOT NULL DEFAULT 'professional',
    target_role_company TEXT NOT NULL DEFAULT '',
    content             TEXT NOT NULL,
    created_at          TEXT NOT NULL,
    last_used_at        TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS chat_messages (
    id         TEXT PRIMARY KEY,
    cv_id      TEXT NOT NULL REFERENCES cvs(id) ON DELETE CASCADE,
    role       TEXT NOT NULL,
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS profile (
    id         TEXT PRIMARY KEY DEFAULT 'default',
    city       TEXT NOT NULL DEFAULT '',
    region     TEXT NOT NULL DEFAULT '',
    country    TEXT NOT NULL DEFAULT '',
    remote     INTEGER NOT NULL DEFAULT 0,
    min_comp   TEXT NOT NULL DEFAULT '',
    notes      TEXT NOT NULL DEFAULT '',
    target_role TEXT NOT NULL DEFAULT '',
    updated_at TEXT
  )`,

  // Per-user once it lives here: the daily cap stops being a shared budget
  // that one user can exhaust for everyone.
  `CREATE TABLE IF NOT EXISTS token_usage (
    day    TEXT PRIMARY KEY,
    tokens INTEGER NOT NULL DEFAULT 0
  )`,

  `CREATE INDEX IF NOT EXISTS idx_cvs_created      ON cvs(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_apps_updated     ON applications(updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_docs_application ON documents(application_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_cv          ON chat_messages(cv_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_app     ON activity_events(application_id, occurred_at)`,
  `CREATE INDEX IF NOT EXISTS idx_templates_used   ON templates(last_used_at DESC)`,
];

export const USER_SCHEMA_VERSIONS = [V1];

/** Bookkeeping for which versions an instance has applied. A plain table
 * rather than PRAGMA user_version, which isn't guaranteed available in
 * Durable Object SQLite. Named without the cf_agents_ prefix the SDK
 * reserves for its own tables. */
export const SCHEMA_META_DDL = `CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`;
