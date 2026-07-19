# Security pass — wave W5 (2026-07-19T03:06:35.239Z)

```json
{
  "critical": [],
  "high": [
    {
      "file": "packages/pipeline/src/interview/depth-policy.ts",
      "issue": "NA-1 (NEVER-AUTO) enforcement relies entirely on `AnswerActor.kind` (types.ts), a plain string field supplied by the caller with no cryptographic or session-backed verification. `assertHumanActor` only checks `actor.kind !== 'human'` — any caller, including an autonomous agent session, can construct `{ id: 'x', kind: 'human' }` and pass every check in session.ts (beginTopic/submitAnswer/skipTopic/resumeTopic). Since this is the sole mechanism preventing an agent from auto-answering/auto-drafting phase 0-2 deliverables (a hard 'no exception' requirement per the code's own comments and CLAUDE.md's C-5), the trust boundary currently has zero teeth until wired to a real identity source.",
      "fix": "Before wiring this to any API route (the deferred W5-15-style follow-up), derive `AnswerActor.kind` from a server-verified session/auth context (e.g., signed session token, mirroring the `EscalationToken` pattern referenced in the comments) rather than trusting a client- or tool-call-supplied field. Add an explicit test proving a request whose transport-level identity is an agent/service token is rejected even if the JSON body claims kind:'human'."
    }
  ],
  "medium": [
    {
      "file": "packages/pipeline/src/plans/expr.ts",
      "issue": "`getPath` resolves arbitrary dot-separated segments against the snapshot object with no denylist, so a catalog `condition`/`verify`/recommendation-template path such as `__proto__.constructor` or `constructor.prototype` will be traversed and returned rather than rejected. Read-only today (no assignment), so no prototype pollution is achievable yet, but `content/plan-catalog/*.json` is explicitly documented as 'untrusted-shaped content' and nothing in `validateEntry` blocks these segment names.",
      "fix": "In `getPath`, reject/skip segments equal to `__proto__`, `constructor`, or `prototype` (or use `Object.hasOwn`/`Object.create(null)`-based snapshots) so the predicate language can't be used to walk prototype internals if the catalog source ever becomes less trusted (e.g. user-submitted improvement plans)."
    }
  ],
  "notes": "Reviewed for: hardcoded secrets (none found), command/path injection via child_process or git shell-out (no process spawning in this diff — all changes are pure TS logic, JSON/markdown content, and tests), unsafe deserialization (only JSON.parse on versioned local content, used correctly), and dependency risk (no package.json/lockfile changes, no new third-party deps introduced). Positive note: `expr.ts` deliberately implements a hand-rolled recursive-descent predicate parser instead of `eval`/`new Function` specifically to avoid turning the versioned catalog content into a code-execution surface — good practice, and the W5-10 gate-fix correctly isolates per-entry evaluation failures (`ExprEvalError`/`TemplateRenderError`) so one malformed catalog entry can't mask other findings. The `plans/lifecycle.ts` and `interview/session.ts` modules are pure reducers with no direct persistence, consistent with the 'receipts required for state mutation' rule — they explicitly defer the real `createTicket`/event-append calls to a separate wiring ticket, which is the correct pattern rather than a violation."
}
```
