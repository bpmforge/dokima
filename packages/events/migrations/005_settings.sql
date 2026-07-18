-- Project-scope settings tables (DATABASE.md §6 model_matrix; §5b
-- rule_state/suppressions). Mutable, not append-only, like other
-- HITL/governance rows (§4) — unlike events/identities/receipts, a rule's
-- state or a suppression's status changes in place; the audit trail for
-- those transitions lives in the event log (`rule.state_changed`, etc.),
-- not in a no-UPDATE trigger on these rows.

CREATE TABLE model_matrix (
  role TEXT NOT NULL,
  task_type TEXT NOT NULL,
  model TEXT NOT NULL,
  fallback TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (role, task_type)
);

CREATE TABLE rule_state (
  rule_id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('proposed','shadow','advisory','gate','deprecated')),
  fp_window_findings INTEGER NOT NULL DEFAULT 0,
  fp_window_fps INTEGER NOT NULL DEFAULT 0,
  promoted_at TEXT,
  demotion_flagged INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE suppressions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint TEXT NOT NULL,
  rule_id TEXT,
  justification TEXT NOT NULL CHECK (justification IN
    ('false_positive','not_applicable_scope','accepted_risk','fixed_elsewhere','wont_fix_documented')),
  signed_by TEXT NOT NULL,
  context_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','reopened')),
  created_at TEXT NOT NULL,
  reopened_at TEXT
);
