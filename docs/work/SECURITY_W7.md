# Security pass — wave W7 (2026-07-20T23:46:21.319Z)

```json
{
  "critical": [],
  "high": [
    {
      "file": "packages/harbormaster/src/loop-gates.ts",
      "issue": "DEFAULT_MEMORY_ELIGIBLE_ROLES now defaults to ['coding-agent'], activating the close-gate's memory_written[] check for the production maker role. The manifest.memory_written field it inspects (added in packages/loop/src/session-manifest.ts) is only shape-validated (array of strings) — checkMemoryWritten (loop-gates-secrets.ts) takes no SqliteHandle and never queries the facts/working_findings tables to confirm the claimed ids actually exist or were verified. An untrusted agent session can satisfy the gate by emitting any non-empty string array (e.g. memory_written:['fact:999999']) without ever writing to @shipwright/memory. This is a self-attested completion claim accepted as a receipt, which is exactly what CLAUDE.md Law 4 (trust boundary) forbids: 'never let a component verify its own output' / 'every durable state change goes through the verbs/receipts APIs'. Currently inert in production only because no caller sets CloseGateOptions.role yet (per the ticket's own HANDOFF note) — but the gap is now baked into the default and will fire unmitigated the moment a follow-up ticket wires role passthrough, unless fixed first.",
      "fix": "Before (or as part of) wiring role passthrough, change checkMemoryWritten's contract to accept the SqliteHandle and verify each claimed memory_written id resolves to a real row (facts.verified=1 for fact:N, or a real working_findings row) rather than trusting the manifest's self-reported array. Until that lands, treat DEFAULT_MEMORY_ELIGIBLE_ROLES as not safe to enable by default and document the gap explicitly in loop-gates.ts's docstring, not just in plan.json notes."
    }
  ],
  "medium": [
    {
      "file": "packages/memory/src/store/facts.ts",
      "issue": "markFactVerified(handle, id) has no caller-identity or provenance check — any code with a handle can flip verified=1 on any fact, including one it authored itself. The maker≠verifier separation (Law 5: 'reviewer identities/models/tokens are distinct by construction') is documented in comments as a design intent but is not mechanically enforced anywhere in this module; it depends entirely on future callers remembering to gate this behind a distinct challenger/tool-confirmation identity.",
      "fix": "When the follow-up wiring ticket adds a real caller, have markFactVerified take an explicit verifier identity/token distinct from the fact's source and reject verification attempts where verifier == author, so the separation is structural rather than a convention documented only in comments."
    }
  ],
  "notes": "No hardcoded secrets, command/path injection, or unsafe deserialization found in this diff. FTS5 query construction (retrieval.ts toMatchQuery) is safely parameterized: tokens are individually quoted with doubled-quote escaping and passed as a bound MATCH parameter, not concatenated into SQL — this correctly prevents FTS5 query-syntax injection from untrusted recall queries. All production store functions (facts.ts, calibration.ts, working-memory.ts) use parameterized statements; only test files build SQL via template-literal interpolation of internally-generated numeric ids, which is not attacker-reachable. The 009_memory.sql migration and SqliteHandle duck-typing are consistent with the project's single-writer-via-events law. The main risk is the trust-boundary gap on memory_written[] self-attestation flagged above — worth resolving before the pending wiring ticket makes it live."
}
```
