-- Improvement Plans (FR-PLAN1-4, D-016, DATABASE.md §5b, W5-10/11). Mutable,
-- not append-only (same category as rule_state/suppressions, 005_settings.sql):
-- a plan item's state/ticket_id/evidence change in place as it moves through
-- proposed -> accepted -> in_progress -> done -> regressed; the audit trail
-- for those transitions lives in the event log (`plan.item_*` events), not
-- in a no-UPDATE trigger on this row.
--
-- `id` = the matched catalog entry's id (`packages/pipeline/src/plans/
-- lifecycle.ts`'s `proposeFromMatches`: v1 keeps a single active item per
-- catalog entry), so `catalog_id` is redundant with `id` today but kept as
-- its own column to match DATABASE.md §5b's documented row shape and
-- `PlanItemRecord` field-for-field.
--
-- Dismissal (`proposed -> [*]`, docs/design/IMPROVEMENT_PLANS.md §2) is not
-- a `state` value — DATABASE.md §5b's CHECK list has no 'dismissed' entry,
-- and the pipeline engine's own lifecycle.ts comment calls dismissal
-- "out of scope for this ticket's engine surface ... a ledger entry, not a
-- plan_items state". Modeled as a soft delete instead: `dismissed_at` non-
-- null excludes a row from the active list/funnel's "plan items" stage
-- while keeping it in the "raw" count (FR-RL4 "raw never hidden" style) and
-- keeping `catalogId` in the existing-items set a fresh evaluation checks,
-- so a dismissed item is never silently re-proposed.
CREATE TABLE plan_items (
  id TEXT PRIMARY KEY,
  catalog_id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('proposed','accepted','in_progress','done','regressed')),
  ticket_id TEXT,
  verify_criterion TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  severity INTEGER NOT NULL,
  leverage INTEGER NOT NULL,
  last_verified_at TEXT,
  evidence TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  dismissed_at TEXT,
  dismissed_reason TEXT
);

CREATE INDEX idx_plan_items_state ON plan_items (state);
