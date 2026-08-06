# Security pass — wave 11 segment W11c (2026-08-06T23:09:57.453Z)

Range `e553be4..aaee64f` · 128403 chars · W11-03 SC-17, W11-07 consolidation, W11-08 filing lints

Windowed because the full W11 diff is 540,697 chars and the conductor's own pass slices at 180000.

```json
{
  "critical": [],
  "high": [
    {
      "file": "packages/harbormaster/src/loop-gates.ts",
      "issue": "runCloseGate only verifies manifest.files is a SUBSET of the real diff/commit set; it never checks the reverse (that the real diff/commit set stays inside ticket.writeScope). This wave's new gateway-session.ts check (refuseIfSessionExceededScope) closes the gap only for the gateway-backed SpawnSession. packages/loop/src/session.ts's createChildProcessSpawn (the external-agent CLI escape hatch, D-023) has no equivalent guard, so a session run through that spawner can leave out-of-scope files on real disk and still close, as long as it reports an honest-looking (subset) manifest — a live self-attestation gap on precisely the runner most likely to invoke a less-trusted external agent. Already disclosed as a HANDOFF and filed as ticket W11-13, but unmitigated in the code as of this diff.",
      "fix": "Land W11-13 before enabling any external-agent (non-gateway) SpawnSession in production: add a symmetric check in runCloseGate itself — real changedPaths/committedFiles checked against ticket.writeScope via the existing checkWriteScope/HARD_EXCLUSIONS — so the guarantee holds for every SpawnSession implementation, not just the gateway one."
    }
  ],
  "medium": [
    {
      "file": "packages/harbormaster/src/agent-session/gateway-session.ts",
      "issue": "refuseIfSessionExceededScope (the out-of-session SC-01 recheck) only runs on the natural-completion return path (response.toolCalls empty). Its correctness relies on an unverified-in-this-diff invariant that the loop's other two exits (iteration-cap, cost-cap) never carry manifest text — if a future change attached manifest text to either of those exits, a scope violation on that path would bypass the recheck entirely.",
      "fix": "Add an explicit regression test asserting the iteration-cap and cost-cap exit paths never return non-empty stdout/manifest text, or move the scope recheck to a single chokepoint that all three exits funnel through so the invariant is enforced structurally rather than by convention."
    },
    {
      "file": "packages/harbormaster/src/agent-session/gateway-session.ts",
      "issue": "SC-17's provenance fix moves write_scope to an authoritative getTicket() lookup, but ticketId itself is still derived via parseHandoffFields(input.prompt) — a string parse of the rendered prompt. This is currently safe only because input.prompt is harness-rendered once at session start and not shown to be reassigned from model output anywhere in this diff's code path; the trust anchor has moved from 'write_scope in prompt' to 'ticket id in prompt' rather than being eliminated.",
      "fix": "Document (or better, enforce via SpawnSessionInput's type) that prompt is immutable harness-authored text for the lifetime of a session, or pass ticketId as a separate out-of-band construction parameter (mirroring how role/runId/berthId are already fixed options) so the trust boundary doesn't depend on prompt-parsing at all."
    }
  ],
  "notes": "Reviewed W11-03 (SC-17 write_scope pre-check + SC-01 out-of-session recheck), W11-07 (gateway tool-helper dedup), W11-08 (conductor board lint rule), and supporting test/config changes. No hardcoded secrets found. All git invocations use array-based argv with '--' separators (no shell string interpolation) — no command injection observed. JSON.parse usage in normalizeToolCalls is ordinary safe deserialization, not unsafe (no eval/pickle/YAML-tag-style deserialization). The new refuseIfOutsideScope check in fs-tools.ts runs in the correct order (hard-exclude → containment/symlink → outside-scope) and fails closed (getTicket()?.writeScope ?? [] refuses everything when a ticket id can't be resolved), matching the documented threat model in SECURITY_CONTROLS.md and verified against the accompanying red-fixture tests including a T-26 prompt-injection scenario. The migrationScope trigger regex in conductor.config.json uses only bounded {0,60} quantifiers over [\\s\\S] with no nested quantifiers — no ReDoS risk. No dependency/package.json changes in this diff. The one substantive gap found (runCloseGate's missing symmetric check for the createChildProcessSpawn escape hatch) is already self-disclosed and ticketed as W11-13 by the team itself; flagged here as HIGH because it remains live in the current codebase state, not because it was missed by the authors."
}
```
