-- Run lifecycle (DATABASE.md §3 `runs`, FR-H3/FR-C7): a projection table,
-- but maintained transactionally with its source `run.*` events rather than
-- rebuilt from a full log replay each read (BLUEPRINT §3.6 "board" precedent
-- — recomputed on every event). Mutable in place (status/ended_at change
-- over a run's life), unlike the append-only events/receipts tables: the
-- event log remains the audit trail of *how* it got there, this table is
-- the fast-queryable *current state*.
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (
    mode IN ('new_product', 'onboard', 'feature', 'improve')
  ),
  phase INTEGER,
  status TEXT NOT NULL CHECK (
    status IN ('running', 'paused', 'suspended', 'done', 'stopped')
  ),
  breakpoint TEXT NOT NULL CHECK (breakpoint IN ('ticket', 'wave', 'never')),
  berths INTEGER NOT NULL DEFAULT 1,
  budget_usd REAL,
  budget_tokens INTEGER,
  started_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE INDEX idx_runs_project ON runs (project_id, started_at);
CREATE INDEX idx_runs_status ON runs (status);
