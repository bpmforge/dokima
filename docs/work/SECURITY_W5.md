# Security pass — wave W5 (2026-07-20T02:49:25.149Z)

```json
{
  "critical": [
    {
      "file": "apps/server/src/api/pipeline/pipeline-routes/events.ts",
      "issue": "emitPhaseEvent mints a 'gate' receipt for every pipeline phase with a hardcoded validators array (`[{name: 'pipeline-phase-output', exitCode: 0, gapCount: 0}]`) instead of the result of an actual validator run, and the receipt's actorId is always OPERATOR_ACTOR_ID — the same identity that produced the model-authored content being attested. This is a component self-attesting its own output as a passing gate (violates CLAUDE.md Law 4 'never let a component verify its own output') and collapses maker/verifier into one identity (violates Law 5's mechanical maker≠verifier requirement). Any consumer of these receipts (dashboards, future automated trust decisions, audit trail) is misled into believing an independent validator ran and passed with zero gaps for every phase, when no such validator exists.",
      "fix": "Either (a) run a real validator against each PipelineRunEvent's payload and record its actual exitCode/gapCount in the receipt, or (b) rename/reclassify these as plain audit events (not 'gate' receipts) until a genuine independent verifier exists. Ensure the receipt-minting actor is distinct from the actor that produced the phase content, per the maker≠verifier pattern used elsewhere in the codebase."
    }
  ],
  "high": [
    {
      "file": "apps/web/src/artifacts/revisionSubmission.ts",
      "issue": "`phase` is computed client-side via phaseForDeliverable(path) and sent as part of the JSON body to POST .../artifacts/comments, where — per this file's own comment — it 'activates isGatedDeliverable's previously-dead phase branch server-side.' Since phase is fully derivable from path (a pure lookup, as this very module demonstrates), having the server trust a client-supplied phase value for a gating/authorization decision lets any caller who can reach the endpoint (including a compromised or malicious frontend/agent session) submit an arbitrary phase to bypass or alter server-side gating logic for a given deliverable.",
      "fix": "Do not accept `phase` from the request body. Have the server derive it itself from `path` using the same (or a shared) lookup table, and ignore/reject any client-supplied `phase` field."
    }
  ],
  "medium": [
    {
      "file": "apps/server/src/api/pipeline/gateway-model-port.ts",
      "issue": "loadGatewayModule() bypasses the package manager entirely by dynamically importing @shipwright/gateway's TypeScript source via a hand-constructed file:// URL derived from relative path-walking off import.meta.url, instead of declaring the dependency in apps/server/package.json. This is untracked by pnpm's lockfile/dependency graph (no version pinning, no supply-chain visibility for that package's transitive deps) and is fragile to any change in directory layout or build/bundling strategy (a bundled apps/server would break the relative path assumption, causing the pipeline route to fail in an unreviewed way).",
      "fix": "Add @shipwright/gateway as a proper workspace dependency in apps/server/package.json (even if it requires a follow-up ticket to widen write_scope) rather than working around package boundaries with a dynamic file:// import."
    },
    {
      "file": "apps/server/src/api/decisions/routes.ts",
      "issue": "registerDecisionRoutes registers POST/GET routes that create and decide decision slates, minting real DB rows and ledger writes under the fixed OPERATOR_ACTOR_ID, with no authentication/authorization check performed in this file itself. The module comment notes it isn't wired into server.ts yet, so this is currently unreachable, but nothing here enforces that only an authenticated operator/session can call these routes once wired in.",
      "fix": "Before wiring registerDecisionRoutes into server.ts, confirm (and ideally assert via a route-level pre-handler or shared auth plugin) that these endpoints require the same authentication as other mutating board/pipeline routes, and add a regression test proving unauthenticated requests are rejected."
    },
    {
      "file": "apps/server/src/api/pipeline/pipeline-routes/index.ts",
      "issue": "synthesizeBlueprint concatenates model-authored section 'body' text into the final blueprint markdown unsanitized (acknowledged in this file's own comments as the vector for the self-attest marker). That markdown is persisted and later rendered client-side (ArtifactDocPane/MarkdownView). If MarkdownView does not sanitize/escape HTML before rendering, a prompt-injected or compromised model completion could smuggle a stored XSS payload through the blueprint pipeline.",
      "fix": "Confirm MarkdownView renders via a sanitizing markdown renderer (no dangerouslySetInnerHTML on raw, unsanitized content); if unconfirmed, add an explicit sanitization pass on blueprint markdown before it is persisted or rendered."
    }
  ],
  "notes": "Positive observations: SQL access throughout (decisions/store.ts, plans-store, board-lifecycle) is fully parameterized — no SQL injection found. The self-attest founder-decision fix (ledgerMarkdown sourced only from disk via pipeline-routes/ledger.ts, never from request body) is well-designed and covered by adversarial tests (index.test.ts's forged-payload and planted-marker red fixtures). Model JSON completions in gateway-model-port.ts are structurally validated (requireObject/requireArray/requireString) before use, mitigating unsafe-deserialization concerns from that surface. No child_process/git-shell-out code appears in this diff. No hardcoded production secrets found (SIGNING_KEY in tests is an obvious fixture, not a real credential). Append-only/hash-chain event log invariants (no UPDATE/DELETE) are exercised and enforced by a DB-level test in index.test.ts."
}
```
