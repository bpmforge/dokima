-- Field-report intake (DATABASE.md-adjacent, BLUEPRINT §12.6, W7-05
-- FR-M2/G-10c): a structured report a user (or the trace viewer) files when
-- a run goes sideways. Filing is untrusted (any actor); triage is the
-- confirming step — a distinct actor accepts a report into the playbook
-- (verified_by='challenger' at that point, packages/memory/src/lessons/
-- triage.ts) or prepares a validator-fix ticket payload, or rejects it.
-- resulting_playbook_entry_id/resulting_ticket_id are populated by triage,
-- never by the filer.
--
-- Added via the same numbered-migration mechanism as 009_memory.sql/
-- 010_playbook.sql (packages/memory, write_scope
-- packages/memory/src/lessons/**, operates on an already-open handle per
-- ARCHITECTURE §4 law 4 — never opens its own DB connection).
-- packages/events/migrations/** is conductor.config.json alwaysOk shared
-- infra (L-04/W4-06), out of this ticket's declared write_scope but
-- explicitly allowlisted for exactly this class of change.
CREATE TABLE field_reports (
  id INTEGER PRIMARY KEY,
  ticket_id TEXT,
  source TEXT NOT NULL CHECK (source IN ('trace', 'escalation', 'manual')),
  source_ref TEXT,
  what_happened TEXT NOT NULL,
  expected TEXT NOT NULL,
  evidence_links TEXT NOT NULL DEFAULT '[]',
  filed_by TEXT NOT NULL,
  filed_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted_playbook', 'accepted_ticket', 'rejected')),
  triaged_by TEXT,
  triaged_at TEXT,
  triage_note TEXT,
  resulting_playbook_entry_id INTEGER REFERENCES playbook (id),
  resulting_ticket_id TEXT
);

-- Triage queue lookup (BLUEPRINT §12.6 "triaged reports"): pending reports first.
CREATE INDEX idx_field_reports_status ON field_reports (status, filed_at);
