-- D1 schema for resume-copilot.
--
-- Replaces the single lowdb JSON file. Beyond being the only option on
-- Workers, this removes the read-whole-file / write-whole-file race that
-- silently dropped writes made during a long Claude call: every mutation
-- below is a scoped UPDATE, so a slow tailoring request can no longer clobber
-- a stage change saved from another tab.

CREATE TABLE IF NOT EXISTS cvs (
  id                TEXT PRIMARY KEY,
  label             TEXT NOT NULL,
  content           TEXT NOT NULL,
  is_master         INTEGER NOT NULL DEFAULT 0,
  parent_id         TEXT REFERENCES cvs(id) ON DELETE SET NULL,
  source_file       TEXT,
  -- R2 object key + original filename for the as-uploaded file, when one was
  -- uploaded (pasted CVs and generated ones have neither). extractText()
  -- keeps only the plain text, so without this the original layout/tables/
  -- fonts are gone for good the moment a file is uploaded.
  original_key      TEXT,
  original_filename TEXT,
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS applications (
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
  notes            TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id             TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  type           TEXT NOT NULL,
  content        TEXT NOT NULL,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         TEXT PRIMARY KEY,
  cv_id      TEXT NOT NULL REFERENCES cvs(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Single-row settings: id is always 'default'. Job-search preferences
-- captured once (onboarding, or edited from the Job Search page) and
-- reused to prefill every search instead of re-asking every time.
-- updated_at being NULL is the "never saved, still onboarding" signal.
CREATE TABLE IF NOT EXISTS profile (
  id         TEXT PRIMARY KEY DEFAULT 'default',
  city       TEXT NOT NULL DEFAULT '',
  region     TEXT NOT NULL DEFAULT '',
  country    TEXT NOT NULL DEFAULT '',
  remote     INTEGER NOT NULL DEFAULT 0,
  min_comp   TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '',
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_cvs_created      ON cvs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_apps_updated     ON applications(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_docs_application ON documents(application_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_cv          ON chat_messages(cv_id, created_at);
