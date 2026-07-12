-- Receipts: durable anchors, never derivable from the event log, so not a
-- projection (DATABASE.md §2 — "the chain proves when, the row holds
-- what"). Every mint also appends a `gate.receipt_minted` / `gate.waived`
-- event carrying the receipt id; verifyReceipt (receipts.ts) requires both
-- to agree.
CREATE TABLE receipts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (
    kind IN ('gate', 'close', 'waiver', 'challenge', 'coverage', 'fitness')
  ),
  project_id TEXT NOT NULL,
  phase INTEGER,
  ticket_id TEXT,
  validators TEXT NOT NULL,
  input_tree_hash TEXT NOT NULL,
  verify_command TEXT,
  verify_exit INTEGER,
  signed_by TEXT REFERENCES identities (id),
  payload TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_receipts_kind ON receipts (kind);
CREATE INDEX idx_receipts_ticket ON receipts (ticket_id);

-- Same tamper-evidence discipline as events/identities (C-4/C-6): a receipt
-- is the durable half of the anchor pair, so it must not be able to drift
-- from what the chained event already attests to.
CREATE TRIGGER receipts_no_update
BEFORE UPDATE ON receipts
BEGIN
  SELECT RAISE(ABORT, 'receipts are append-only: UPDATE forbidden');
END;

CREATE TRIGGER receipts_no_delete
BEFORE DELETE ON receipts
BEGIN
  SELECT RAISE(ABORT, 'receipts are append-only: DELETE forbidden');
END;
