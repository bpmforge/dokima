-- Clarification cards (DATABASE.md §4, FR-N1, UC-03): a question checkpoints
-- only the ticket it names (`ticket_id`), never the whole run — other lanes
-- read straight past an open row for a different ticket. `checkpoint_ref` is
-- the caller-supplied resume point (opaque to this table) a dependent loop
-- passes back in unchanged so it can resume exactly where it paused.
CREATE TABLE clarifications (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs (id),
  ticket_id TEXT,
  asked_by TEXT NOT NULL REFERENCES identities (id),
  question TEXT NOT NULL,
  context TEXT,
  options TEXT,
  default_action TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'answered', 'dismissed')),
  answer TEXT,
  checkpoint_ref TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX idx_clarifications_run ON clarifications (run_id, status);
CREATE INDEX idx_clarifications_ticket ON clarifications (ticket_id, status);
