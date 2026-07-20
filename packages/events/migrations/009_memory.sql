-- Memory & learning (DATABASE.md §5, BLUEPRINT §3.8, W7-01 FR-M1/US-604).
-- Three tables for the working+long-term memory service (packages/memory,
-- write_scope packages/memory/src/store/**): production code there never
-- opens a DB connection itself (ARCHITECTURE §4 law 4 — only packages/events
-- does); it operates on an already-open handle structurally shaped like
-- better-sqlite3/node:sqlite, applied here via the same numbered-migration
-- mechanism every other projection uses (migrate.ts auto-discovers this
-- file by filename, no registration elsewhere needed).
--
-- facts — long-term memory: verified facts, error->solution pairs, decision
-- refs, research notes. Only `verified = 1` rows are eligible for R0/anchor
-- recall (source-system-foreman-jarvis.md §5's "verified-before-stored").
-- `embedding` is a raw float32 BLOB, populated only when a local embed
-- model is configured — NULL is the offline-honest default (US-604 AC-1).
CREATE TABLE facts (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('fact', 'error_solution', 'decision_ref', 'research')),
  content TEXT NOT NULL,
  source TEXT,
  confidence REAL NOT NULL DEFAULT 0,
  verified INTEGER NOT NULL DEFAULT 0,
  ticket_id TEXT,
  phase TEXT,
  embedding BLOB,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  use_count INTEGER NOT NULL DEFAULT 0,
  decayed INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_facts_kind_verified ON facts (kind, verified, decayed);
CREATE INDEX idx_facts_ticket ON facts (ticket_id);

-- facts_fts — external-content FTS5 index (BM25 retrieval baseline,
-- DATABASE.md §5). External-content tables don't self-maintain, so the
-- triggers below keep it in sync with facts on every write; `content_rowid`
-- ties fts rows back to `facts.id` for the join in retrieval.ts.
CREATE VIRTUAL TABLE facts_fts USING fts5(
  content,
  content = 'facts',
  content_rowid = 'id'
);

CREATE TRIGGER facts_fts_ai AFTER INSERT ON facts BEGIN
  INSERT INTO facts_fts (rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER facts_fts_ad AFTER DELETE ON facts BEGIN
  INSERT INTO facts_fts (facts_fts, rowid, content) VALUES ('delete', old.id, old.content);
END;

CREATE TRIGGER facts_fts_au AFTER UPDATE ON facts BEGIN
  INSERT INTO facts_fts (facts_fts, rowid, content) VALUES ('delete', old.id, old.content);
  INSERT INTO facts_fts (rowid, content) VALUES (new.id, new.content);
END;

-- calibration — per-(model, phase) confidence bias (DATABASE.md §5, FR-L3).
-- Pure storage: the rescue-only clamp math lives in packages/loop's
-- calibration.ts (memory may not import loop, ARCHITECTURE §4); this table
-- just persists whatever CalibrationRecord the caller computed. Extends the
-- documented columns with `mean_raw_conf`, the other half of the
-- verified-minus-raw gap `updateCalibration` needs to resume across runs.
CREATE TABLE calibration (
  model TEXT NOT NULL,
  phase TEXT NOT NULL,
  bias REAL NOT NULL DEFAULT 0,
  sample_count INTEGER NOT NULL DEFAULT 0,
  mean_raw_conf REAL NOT NULL DEFAULT 0,
  mean_verified_conf REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (model, phase)
);

-- working_findings — per-project working memory (BLUEPRINT §3.8 "always-on:
-- per-unit findings"): the current run's not-yet-consolidated findings,
-- mutable in place (resolved flips 0->1) rather than append-only, same
-- category as `notifications`/`plan_items` (DATABASE.md §3/§4).
CREATE TABLE working_findings (
  id INTEGER PRIMARY KEY,
  ticket_id TEXT,
  run_id TEXT,
  summary TEXT NOT NULL,
  detail TEXT,
  confirmed_by TEXT,
  created_at TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_working_findings_run ON working_findings (run_id, resolved);
CREATE INDEX idx_working_findings_ticket ON working_findings (ticket_id, resolved);
