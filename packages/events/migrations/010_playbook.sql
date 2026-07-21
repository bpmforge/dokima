-- Project-scope playbook (DATABASE.md §5, BLUEPRINT §3.8, W7-02 FR-M2/FR-F5):
-- ACE-style entries, delta-edited never replaced. Mirrors global_playbook's
-- columns (packages/events/src/global-db/migrations/001_init.sql) minus the
-- promotion-provenance fields, which only exist once an entry is explicitly
-- promoted (FR-F5) into that separate, Fleet-scope table.
--
-- Added via the same numbered-migration mechanism as 009_memory.sql
-- (packages/memory, write_scope packages/memory/src/playbook/**, operates on
-- an already-open handle per ARCHITECTURE §4 law 4 — never opens its own DB
-- connection). packages/events/migrations/** is conductor.config.json
-- alwaysOk shared infra (L-04/W4-06), out of this ticket's declared
-- write_scope but explicitly allowlisted for exactly this class of change.
--
-- verified_by has no third "unverified" state: FR-M2's "only tool/challenger-
-- confirmed outcomes stored" is enforced both here (CHECK) and at the store
-- layer (packages/memory/src/playbook/playbook.ts) which never gets an input
-- path to insert any other value.
CREATE TABLE playbook (
  id INTEGER PRIMARY KEY,
  task_class TEXT NOT NULL,
  entry TEXT NOT NULL,
  version INTEGER NOT NULL,
  verified_by TEXT NOT NULL CHECK (verified_by IN ('tool', 'challenger')),
  delta_of INTEGER REFERENCES playbook (id),
  created_at TEXT NOT NULL,
  retired_at TEXT
);

-- R0 lookup path (DATABASE.md §5): find the live (non-retired) head for a task_class.
CREATE INDEX idx_playbook_task_class_retired ON playbook (task_class, retired_at);
