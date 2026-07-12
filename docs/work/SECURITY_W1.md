# Security pass — wave W1 (2026-07-12T00:51:40.395Z)

```json
{
  "critical": [],
  "high": [
    {
      "file": "plan.json",
      "issue": "Ticket status transitions (todo -> blocked) are committed as a direct hand/agent-edit to plan.json by an automated 'CONDUCTOR' process, with no receipt or verbs-API call evidenced in this diff. Per project law #4, durable ticket/phase state changes must go through the verbs/receipts API so an agent session's output can never unilaterally mutate authoritative state. If plan.json (rather than the append-only events log) is treated as source of truth by any downstream tooling, this is exactly the trust-boundary violation the architecture is meant to prevent — an untrusted agent session directly asserting 'blocked' status with self-authored justification text.",
      "fix": "Route status changes through the tickets/receipts API (emit an append-only event + generated receipt) instead of committing raw edits to plan.json's status/notes fields; treat plan.json as a disposable projection re-rendered from the event log, not as the write target."
    }
  ],
  "medium": [
    {
      "file": "plan.json",
      "issue": "The blocked notes embed raw, free-form diagnostic text (including code fragments and escape-sequence discussion) authored by an agent process directly into a version-controlled JSON file. If any downstream automation later parses/greps these notes fields to drive control flow (e.g., unblocking logic, status re-derivation), untrusted agent-authored text becomes an input to state transitions — a 'never grep for completion strings' anti-pattern risk if such tooling exists elsewhere in the conductor pipeline.",
      "fix": "Keep notes as inert human-readable audit trail only; ensure no script parses these strings to make trust decisions, and validate/sanitize note content length and encoding before commit."
    }
  ],
  "notes": "This diff is limited to plan.json metadata (status + notes fields for tickets W1-01 and W1-03); it contains no application code, so there is nothing here to assess for hardcoded secrets, command/path injection, unsafe deserialization, or dependency risk — those checks came back clean simply because no such code is in scope. The one substantive concern is procedural/architectural: the mechanism by which 'blocked' status got written to plan.json outside this diff's visible tooling. Recommend reviewing the actual conductor script (not shown here) that produced these commits to confirm it writes through the receipts/verbs API rather than committing plan.json directly, and separately auditing the referenced-but-not-included changes to packages/loop/src/micro-loop.ts (flagged in the W1-03 note as containing literal raw NUL/SOH bytes making it a binary file) once that diff is available, since embedding literal control bytes in a TS source file is itself a red flag worth a dedicated pass."
}
```
