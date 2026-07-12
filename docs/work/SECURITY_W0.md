# Security pass — wave W0 (2026-07-12T00:10:45.938Z)

```json
{
  "critical": [],
  "high": [
    {
      "file": "plan.json",
      "issue": "The W0-05 blocked-notes entry documents (and this diff persists) an unresolved HIGH finding on branch sw/w0-05: verifyReceipt/findMintEvent in packages/events/src/receipts.ts correlates a receipt to its anchor event by payload.receiptId only, without binding kind, validators, inputTreeHash, or signedBy — and appendEvent (packages/events/src/append.ts) is exported/unguarded, callable by any code holding a log.db handle. That lets any caller with DB access forge a receipts row plus a matching gate.receipt_minted event whose receiptId matches but whose content diverges, defeating the receipt-authenticity guarantee required by CLAUDE.md Law 4 (every durable state change goes through verbs/receipts) and docs/DATABASE.md's 'chain proves when, row holds what' invariant. This diff correctly keeps the ticket in status=blocked rather than merging the vulnerable design, but the gap remains open on the kept branch and must not be closed without re-deriving the anchor binding from full receipt content (e.g. hash the receipt body into the event payload and compare) plus restricting appendEvent to the gateway/writer boundary rather than any log.db holder.",
      "fix": "When W0-05 resumes, make verifyReceipt recompute/compare a content hash of the receipt (kind+validators+inputTreeHash+signedBy) against a hash embedded in the anchoring event payload, not just receiptId equality; and scope appendEvent so only the single designated writer (per DATABASE.md §1 single-writer rule) can invoke it — e.g. keep it internal to packages/events and expose a narrower, permission-checked API to callers, consistent with 'loop/tickets never call providers directly — only via gateway' (CLAUDE.md Law 6)."
    }
  ],
  "medium": [
    {
      "file": "plan.json",
      "issue": "The appended conductor note is truncated mid-sentence ('any ki'), so the full description of the forgery scenario and its resolution criteria is not captured in the durable plan record — future readers/conductors may re-derive an incomplete picture of what 'unblock' requires.",
      "fix": "Complete the truncated note (or reference the full write-up in docs/STATUS.md / a linked issue) so the acceptance bar for unblocking W0-05 is unambiguous and not split across a cut-off JSON string."
    }
  ],
  "notes": "This diff itself only edits plan.json tracking metadata (status todo→blocked, appended note); it introduces no new code, secrets, shell/process invocation, or deserialization paths. No receipts.ts/append.ts changes are included in this diff — those live on the still-blocked branch sw/w0-05 and are not merged to main, so the underlying vulnerability described above is not yet present in mainline code, but the finding is directly quoted in this diff's notes and remains unresolved; it should stay tracked until the anchor-binding and appendEvent-scoping fixes land. No hardcoded secrets, command/path injection, or dependency changes are present in this diff."
}
```
