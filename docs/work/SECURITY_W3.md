# Security pass — wave W3 (2026-07-15T13:36:46.823Z)

```json
{
  "critical": [],
  "high": [
    {
      "file": "packages/gateway/src/escalation/policy.ts",
      "issue": "runTokenGatedPolicy() treats any truthy return from tokenHook.checkToken() as a valid grant without checking that token.ticketId, token.boundary, and token.riskClass actually match the request just made (ticketId/boundary passed in) or equal 'escalation'. FR-N2's approval gate is the sole control preventing auto-escalation past a named tier (NEVER-AUTO); if any future hook implementation returns a cached/stale/wrong-scope token object (bug, race, or multi-tenant mixup), this engine will silently accept it and cross the boundary — a broken-access-control / confused-deputy gap in the one place designed to require human approval.",
      "fix": "After tokenHook.checkToken() returns a token, assert token.ticketId === input.ticketId, token.boundary === policy.namedTier, and token.riskClass === 'escalation' before treating it as a grant; throw/park if any field mismatches instead of trusting the hook's return value verbatim."
    },
    {
      "file": "packages/gateway/src/escalation/policy.ts",
      "issue": "The optional `resume` input (TokenGatedResumeState) lets a caller supply priorAttempts/lastFailure — including fabricated rung/receipts — with no validation against a persisted receipts/events source. Because runTokenGatedPolicy() uses lastFailure.rung to decide which rungs to skip and then emits a real escalation.rung_advanced/blocked event carrying that unverified fromRung/receipts into the append-only event sink, a caller that isn't the trusted harbormaster loop (or a buggy future consumer) could inject fabricated evidence into the hash-chained log and/or skip real gate attempts entirely once this engine is wired to a real caller. This is exactly the class CLAUDE.md law 4/7 forbid: durable state (escalation events) must be receipt-backed, and the append-only log must not accept unverified entries.",
      "fix": "Require `resume` to be reconstructed only from the actual persisted event/receipt log (verified by the caller against events.ts's hash chain) rather than accepted as free-form input, or have runEscalationPolicy itself re-derive prior attempts from the sink/event store instead of trusting caller-supplied resume state."
    }
  ],
  "medium": [
    {
      "file": "scripts/conductor.mjs",
      "issue": "markBlocked()'s new `git('branch', '-m', branch, blocked/${t.id.toLowerCase()})` builds a git ref name from ticket-derived data with no validation that t.id/branch match an expected safe pattern (e.g. ^W\\d+-\\d+[a-z]?$). execFileSync avoids shell injection, but an unexpected id/branch value (e.g. containing '/', '..', or ref-breaking characters) could silently rename to an unintended ref or collide with another ticket's evidence branch, and the bare `catch {}` swallows that failure without surfacing it.",
      "fix": "Validate t.id against the plan schema's ticket-id pattern before using it in a ref name, and log (not silently swallow) any failure from the rename so a real error doesn't masquerade as 'branch may not exist'."
    }
  ],
  "notes": "Reviewed conductor.config.json, docs/LESSONS.md, docs/STATUS.md, packages/gateway/src/escalation/{policy-types,policy,policy.test}.ts, plan.json, scripts/conductor.mjs. No hardcoded secrets found. git/child-process calls in this diff use execFileSync with array args (no shell interpolation), so no command-injection vector despite ticket-derived data flowing into branch names. No unsafe deserialization or new dependency additions. The core concern is architectural: policy.ts's token-gated mode is the designated manual-approval checkpoint (FR-N2/NEVER-AUTO) but doesn't cross-validate the token it receives, and its `resume` parameter is an unauthenticated state-injection surface for the append-only escalation event log — both are currently low-exploitability since this engine has no wired consumer yet (HANDOFF notes confirm), but should be locked down before W3-01c/harbormaster wires a real caller, per this project's own C-6/C-2 rules on receipts and log integrity."
}
```
