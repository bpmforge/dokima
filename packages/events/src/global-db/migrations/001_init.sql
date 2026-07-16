-- Fleet-scope registry (DATABASE.md §7, D-013). Fleet index (FR-F1/F2):
-- card *stats* (phase, board counts, spend, pending Decide) are never
-- stored here — always read live from each project's own state.db, so the
-- registry can't lie about a project it hasn't opened.
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  last_opened_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Non-secret provider registry (FR-F3): register once, use everywhere.
-- Credentials are keychain refs only (FR-S2, law #8) — never a literal secret.
CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  base_url TEXT,
  project TEXT,
  location TEXT,
  credential_ref TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Promoted playbook entries (FR-F5): the §5 playbook columns plus
-- provenance. Promotion is human/reviewer-only, never automatic.
CREATE TABLE global_playbook (
  id INTEGER PRIMARY KEY,
  task_class TEXT NOT NULL,
  entry TEXT NOT NULL,
  version INTEGER NOT NULL,
  verified_by TEXT NOT NULL,
  delta_of INTEGER REFERENCES global_playbook (id),
  promoted_from_project TEXT NOT NULL,
  source_entry_id INTEGER NOT NULL,
  promoted_by TEXT NOT NULL,
  promoted_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  retired_at TEXT
);

-- Fitness cards (BLUEPRINT §12.1) are per (model, role), not per project.
CREATE TABLE model_fitness (
  model TEXT NOT NULL,
  role TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('fit', 'unfit', 'marginal')),
  harness_version TEXT NOT NULL,
  receipt_payload TEXT NOT NULL,
  run_at TEXT NOT NULL,
  PRIMARY KEY (model, role, harness_version)
);
