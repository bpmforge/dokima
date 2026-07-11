# Security pass — wave W0 (2026-07-11T22:06:01.980Z)

```json
{
  "critical": [
    {
      "file": "plan.json",
      "issue": "Ticket status is flipped directly in plan.json by agent/conductor-authored notes (\"AGENT 2026-07-11: done...\", \"CONDUCTOR ...: blocked...\") rather than through the new packages/tickets verb/receipt system this same wave built. This is a live instance of the exact anti-pattern the project's trust boundary law forbids: a code path (hand-edited plan.json) flips ticket state to 'done'/'blocked' with no receipt, and the maker (agent) is self-asserting completion of its own work with no distinct verifier.",
      "fix": "Stop hand/agent-editing plan.json's status field. Either (a) generate plan.json status from the @shipwright/events log / ticket projection (source of truth = events, plan.json = read-only render), or (b) require every plan.json status change to reference a real closeTicket/acceptTicket receipt id, and add a CI check that fails if plan.json status disagrees with the projected ticket state."
    }
  ],
  "high": [
    {
      "file": "packages/tickets/src/verbs.ts",
      "issue": "closeTicket() mints a 'close receipt' and transitions to in_review based entirely on maker-supplied files/commits/verify.exitCode, with no independent verification that verify actually ran or that the files/commits exist (comment explicitly defers this to an out-of-session 'Harbormaster gate FR-H1' / receipts table). Per plan.json, W0-05 (the receipts table that would durably anchor this) is currently BLOCKED and unbuilt. acceptTicket() only checks that a closeReceipt object is present, not that its claims are true, so a single compromised/careless maker session can drive a ticket to 'done' on fabricated evidence as long as a second actorId calls accept.",
      "fix": "Do not allow tickets to reach 'done' until the Harbormaster verification gate (independently re-running verify, checking commits/files against the actual repo) is implemented and wired into acceptTicket, or at minimum gate this behind a feature flag until W0-05 lands. Track the self-attestation window explicitly in docs/STATUS.md as a known risk."
    }
  ],
  "medium": [
    {
      "file": "packages/tickets/src/reducer.ts",
      "issue": "Event payloads are trusted via unchecked type assertions (`event.payload as TicketCreatedPayload`, `as TicketClosedPayload`, `as TicketCommentedPayload`) with no runtime schema validation. A malformed or corrupted event row (e.g., DB tampering, migration bug, or a future untrusted writer) folds silently into partially-undefined ticket state instead of failing loudly.",
      "fix": "Validate payload shape with a runtime schema (e.g. zod) at fold time and treat validation failure as a hard error / skip-with-log, consistent with 'never grep for completion strings' spirit — don't trust JSON shape implicitly."
    },
    {
      "file": "packages/tickets/src/verbs.ts",
      "issue": "All verb functions accept `actorId: string` as a bare, unauthenticated parameter and trust it as-is (e.g. assertOwner, self-accept check). Nothing in this package verifies the caller is actually authenticated as that actorId, so correctness of 'maker != verifier' depends entirely on an unspecified upstream layer enforcing identity binding.",
      "fix": "Document (and ideally type-enforce) that callers of this package must pass an already-authenticated identity, not a raw string sourced from request input; consider accepting a verified `Identity`/session object instead of `actorId: string` to make the trust boundary explicit at the type level."
    },
    {
      "file": "packages/tickets/src/lanes.ts",
      "issue": "globOverlaps/segmentTextOverlaps use unbounded recursive DP with a comment asserting write_scope globs are 'not user input' — but plan.json (the source of write_scope values) is shown elsewhere in this diff to be directly agent-editable, weakening that trust assumption. Very long/adversarial glob strings could cause deep recursion (stack exhaustion) or quadratic blowup.",
      "fix": "Convert the recursive DP to an iterative form and/or cap input glob length defensively, especially since the 'trusted input' assumption is only as strong as plan.json's own integrity (see the plan.json finding above)."
    }
  ],
  "notes": "No hardcoded secrets, no child_process/git shell-outs, and no direct SQL construction were introduced in this diff. The fast-check ^4.9.0 devDependency resolves in pnpm-lock.yaml and matches a legitimate, well-known package name (no slopsquatting signal). The most consequential issue is architectural: this wave built a receipt-gated ticket engine specifically to prevent self-asserted completion, but plan.json — the artifact actually driving conductor/agent workflow — is updated by direct, unreceipted status edits in the same commits, and the ticket engine's own close/accept flow currently trusts maker-supplied verify results with no independent re-verification (the planned receipts table, W0-05, is blocked)."
}
```
