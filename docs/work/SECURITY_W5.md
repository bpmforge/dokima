# Security pass — wave W5 (2026-07-19T07:15:11.075Z)

```json
{
  "critical": [
    {
      "file": "apps/server/src/api/plans-routes.ts",
      "issue": "POST /projects/:id/plan/verify accepts a fully caller-supplied PlanEvaluationSnapshot (only shape/number-type checked, never derived from real system state) and feeds it straight into plans-store.ts verifyPlan, which flips plan_items.state from accepted/in_progress straight to 'done' whenever the snapshot claims the verify_criterion is satisfied. Any holder of the shared API bearer token — including an untrusted agent session, per this project's own trust model (CLAUDE.md law 4: agent sessions are untrusted, no code path may flip state without a receipt, no component may verify its own output) — can fabricate e.g. {\"receipts\":{\"staleCount\":0}} to mark a real, unresolved improvement-plan item 'done' with zero correlation to actual receipts/coverage/rule state. This is a textbook self-attested-verification bypass, and it is a second, wider-open copy of the same primitive the real scheduler (apps/server/src/scheduler/plan-scheduler.ts) now safely drives with a server-computed snapshot only — the HTTP route's own header comment admits it was left in only 'so the engine is reachable and testable without that wiring', a rationale that no longer holds now that W5-15 exists.",
      "fix": "Now that runNightlyVerify/pollRunCompletions supply a trusted, server-built snapshot, remove the public plan/evaluate and plan/verify HTTP routes (or gate them behind a distinct operator-only credential/local-dev-only flag, never the general API bearer token used by agent sessions). If a manual-trigger HTTP path is still required, have the route call buildPlanEvaluationSnapshot(projectPath) server-side and reject any client-supplied snapshot fields, so verification can never be driven by attacker-controlled input."
    },
    {
      "file": "apps/server/src/api/plans-routes.ts",
      "issue": "POST /projects/:id/plan-items/:itemId/accept lets the caller supply arbitrary write_scope and depends_on arrays that are passed straight through acceptPlanItem -> pipeline's acceptItem -> createTicket, overriding whatever scope the vetted improvement-plan catalog entry actually recommends. Since this system's core safety guarantee is that tickets carry a narrow, pre-vetted write_scope/lane (CLAUDE.md law 1/6: same-lane tickets never run in parallel, cross-lane write_scope overlap is treated as a schema bug), a caller with only the standard bearer token can mint a board ticket with a self-chosen, unbounded write_scope/depends_on under the guise of 'accepting' a catalog-recommended fix — effectively self-authorizing scope beyond what the deterministic catalog engine ever proposed.",
      "fix": "Derive write_scope (and depends_on, if catalog-defined) from the matched catalog entry / PlanItemRecord server-side rather than accepting them from the request body, or at minimum validate the caller-supplied write_scope is a subset of the catalog entry's declared scope for that catalog_id before passing it to acceptItem/createTicket."
    }
  ],
  "high": [],
  "medium": [
    {
      "file": "apps/server/src/api/plans-routes.ts",
      "issue": "sendPlanStoreError forwards PlanStoreError.message (built from internal ids like plan item ids and ticket ids, e.g. 'ticket \"PLAN-PC-001\" already exists') directly into the application/problem+json response body with no redaction.",
      "fix": "Low sensitivity here (ids are not secrets), but as a general practice return a generic client-facing message and log the detailed err.message server-side only, so internal identifiers/state details aren't routinely echoed back over the API."
    }
  ],
  "notes": "No hardcoded secrets, command/path injection, or unsafe deserialization found in this diff — all SQL access uses parameterized better-sqlite3 statements, the one filesystem read (loadCatalogEntries) uses a fixed repo-relative path with no user input, and all snapshot fields are constrained to finite numbers by isPlanEvaluationSnapshot before use, which limits injection/format-string risk even though it doesn't fix the trust-boundary problem. The nightly scheduler's earlier fake-verification bug (feeding zero-filled fields into verifyItem) and its missing per-project error isolation both appear already fixed within this same diff (LIVE_SNAPSHOT_PATHS/unresolvedSnapshotPaths skip-guard, per-project try/catch in plan-scheduler.ts) — good catches by the prior gate-fix pass, not re-flagged here. The new @shipwright/pipeline dependency is an internal workspace package, not an external/registry dependency, so no slopsquatting/CVE exposure was introduced. NotificationCard.tsx's new digest-item rendering uses plain JSX text interpolation (no dangerouslySetInnerHTML), so no XSS vector despite echoing snapshot-derived evidence into notification bodies."
}
```
