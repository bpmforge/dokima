-- Identities: every event has an actor (D-005). Schema is multi-user-ready
-- from W0; v1 runs single-operator (DATABASE.md §2).
CREATE TABLE identities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('human', 'machine')),
  auth_provider TEXT,
  role TEXT,
  model_hint TEXT,
  created_at TEXT NOT NULL
);

-- Immutable, same as events: an identity's kind/role must not be able to
-- flip retroactively after events were recorded against its actor_id, since
-- the hash chain covers only the actor_id reference, not its attributes at
-- time-of-action (C-4/C-6).
CREATE TRIGGER identities_no_update
BEFORE UPDATE ON identities
BEGIN
  SELECT RAISE(ABORT, 'identities are append-only: UPDATE forbidden');
END;

CREATE TRIGGER identities_no_delete
BEFORE DELETE ON identities
BEGIN
  SELECT RAISE(ABORT, 'identities are append-only: DELETE forbidden');
END;

-- Append-only, hash-chained event log (ARCHITECTURE §3, SC-11).
CREATE TABLE events (
  seq INTEGER PRIMARY KEY,
  event_type TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES identities (id),
  ticket_id TEXT,
  run_id TEXT,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);

CREATE INDEX idx_events_type_seq ON events (event_type, seq);
CREATE INDEX idx_events_ticket_seq ON events (ticket_id, seq);
CREATE INDEX idx_events_run_seq ON events (run_id, seq);

-- INSERT-only: tamper attempts fail at the DB layer (DATABASE.md §2); chain
-- verification (verifyChain) catches file-level edits that bypass SQLite.
CREATE TRIGGER events_no_update
BEFORE UPDATE ON events
BEGIN
  SELECT RAISE(ABORT, 'events are append-only: UPDATE forbidden');
END;

CREATE TRIGGER events_no_delete
BEFORE DELETE ON events
BEGIN
  SELECT RAISE(ABORT, 'events are append-only: DELETE forbidden');
END;
