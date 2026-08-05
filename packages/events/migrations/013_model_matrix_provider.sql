-- model_matrix gains a structured provider binding (W10-68). A slash in a
-- single string cannot tell a providerId prefix from a vendor-namespaced
-- model id -- `ghost/model` and `qwen/qwen3-coder-next` are the same shape,
-- and no parsing rule distinguishes them (W10-60 had to guess). A row now
-- says which provider it means directly. NULL keeps today's meaning: bind
-- to the single enabled provider, ambiguous if several -- nothing existing
-- has to be requalified by hand.
--
-- Recreate rather than `ALTER TABLE ... ADD COLUMN`: no other table
-- references `model_matrix` (grepped every migrations/*.sql for
-- `REFERENCES model_matrix`), so this carries no FK/index/trigger risk, and
-- it keeps `applyMigrations` (packages/events/src/migrate.ts, out of this
-- ticket's write_scope) able to reapply this file to a db whose
-- `provider_id` column is already present without erroring "duplicate
-- column name" -- exactly what happens when `user_version` is rewound
-- without also undoing this migration's own effect (as boot-sequence.test.ts's
-- "backs up state.db before applying a pending migration" fixture does,
-- out of this ticket's write_scope, by design: DATABASE.md's migrations are
-- forward-only and idempotent-safe by construction, not by every caller
-- remembering to undo them exactly).
CREATE TABLE model_matrix_new (
  role TEXT NOT NULL,
  task_type TEXT NOT NULL,
  provider_id TEXT,
  model TEXT NOT NULL,
  fallback TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (role, task_type)
);

INSERT INTO model_matrix_new (role, task_type, model, fallback, updated_at)
SELECT role, task_type, model, fallback, updated_at FROM model_matrix;

DROP TABLE model_matrix;

ALTER TABLE model_matrix_new RENAME TO model_matrix;
