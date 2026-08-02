-- Decision slates (FR-P6, DATABASE.md §4 "decisions — the D-ID ledger",
-- API_DESIGN.md "decisions & slates"). DB projection of the same slate
-- lifecycle `docs/DECISIONS.md` records: an agent hitting a founder/
-- technical fork emits a slate (`status = 'open'`), a human chooses an
-- option, and that choice is what assigns the stable D-ID and appends the
-- ledger row (`apps/server/src/api/decisions/store.ts`'s `decideSlate` —
-- assigning the D-ID only at decide time, never at create time, is what
-- keeps the ledger sequential with no gaps for abandoned slates).
--
-- Extends DATABASE.md §4's documented decided-row shape (`id, title,
-- options, chosen, rationale, decided_by, decided_at`) with the columns an
-- open (undecided) slate needs — same precedent as `006_notifications.sql`
-- adding `pushed_at` and `007_plan_items.sql`'s wider row: `id` here is the
-- slate's own stable id (assigned at creation), and `d_id` is the
-- documented `docs/DECISIONS.md` ledger id, nullable until decided, unique
-- once set. `slate` carries the full `Slate` (`@dokima/pipeline`
-- `FounderSlate | TechnicalSlate`) as JSON so the options/recommendation
-- shown to the founder are exactly what `buildFounderSlate`/
-- `buildTechnicalSlate` validated at create time.
--
-- Mutable, not append-only (same category as `notifications`/`plan_items`):
-- a slate's `status`/`chosen`/`rationale`/`d_id`/`decided_*` change in place
-- when it's decided. The audit trail lives in the event log
-- (`decision.slate_created` / `decision.chosen`), not in a no-UPDATE
-- trigger on this row.
CREATE TABLE decisions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('founder', 'technical')),
  title TEXT NOT NULL,
  slate TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'decided')),
  chosen TEXT,
  rationale TEXT,
  d_id TEXT UNIQUE,
  decided_by TEXT REFERENCES identities (id),
  decided_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_decisions_status_created ON decisions (status, created_at);
