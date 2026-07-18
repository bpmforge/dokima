-- Notification taxonomy (DATABASE.md §3, FR-N4/US-704): "the taxonomy is
-- schema, not convention" — tier and kind are DB-enforced CHECK constraints,
-- not just a TypeScript union honored by callers. A row that cannot be
-- inserted with an invalid tier/kind is the enforcement, not a lint rule.
--
-- `suggestion` extends DATABASE.md §3's documented kind list: this is the
-- migration DATABASE.md itself calls for ("adding a kind is a migration +
-- FR-N4 tier-declaration review, never an inline string") to carry the
-- trust-graduation card (R-A1, US-310, W4-07 acceptance 3).
--
-- Mutable, unlike `events`/`identities`/`receipts` (DATABASE.md §2's
-- append-only anchors): a notification's `status`/`resolved_at` change as
-- the human decides/dismisses it, and Review-tier rows accumulate batched
-- items into one digest (§3 "Review items coalesce ... one notification per
-- batch") — no append-only trigger here, matching §3's "projection tables"
-- framing rather than §2's durable-anchor one.
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  tier TEXT NOT NULL CHECK (tier IN ('decide', 'review', 'record')),
  kind TEXT NOT NULL CHECK (
    kind IN (
      'clarification', 'approval', 'blocked', 'budget', 'pr_ready',
      'gate_passed', 'digest', 'drift_report', 'suggestion'
    )
  ),
  ref_type TEXT,
  ref_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  leverage INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'dismissed')),
  -- Set when a Decide-tier card is promoted to push (FR-N4: only when the
  -- run is idle-blocked and outside quiet hours) — null means still queued.
  pushed_at TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

-- DATABASE.md §3's documented index: the morning queue's leverage sort
-- (merges/approvals/clarifications first, digests last) over open rows.
CREATE INDEX idx_notifications_tier_status_leverage
  ON notifications (tier, status, leverage DESC);
