# Approved direction: automated build, review, and repair

Date: 2026-09-08
Status: Product direction accepted by Bradford Matthews in conversation. Implementation and runtime verification remain outstanding.

## Customer contract

After the user approves the design, user stories, acceptance criteria, model policy, and budget, Dokima decomposes the work, implements it in isolated workspaces, runs applicable tests and security checks in groups, consolidates findings, repairs defects, re-verifies changed work, and presents a working preview with evidence.

Ask the user for material scope changes, additional budget, credentials, unresolved problems after bounded recovery, and actions covered by the existing NEVER-AUTO policy. A model declaring success cannot close the verification gate. Publishing remains a separate approval.

This accepts the workflow, not a claim that every model or task will succeed. Do not silently escalate beyond the chosen model policy. Do not interpret this approval as permission to enable every existing project's previously inert autonomy setting.

## Existing decisions and implementation

D-032 and W13-32 require a per-pause-site defaults review before wiring autonomy. Complete that review as the first implementation slice; retain C-5 and D-020 protections. Existing merge/deploy/destructive-action gates remain effective. The approved workflow does not authorize blanket dismissal of clarification cards or treating arbitrary model-provided defaults as trusted policy.

Relevant source:

- `packages/harbormaster/src/autonomy.ts`: policy exists; inspect production callers before wiring.
- `packages/harbormaster/src/breakpoints-clarifications.ts`: clarification creation, dismissal and ledger paths.
- `apps/server/src/api/pipeline/onboard-executor.ts`: sequential real specialist dispatch and retry cache.
- `packages/pipeline/src/modes/security-cluster.ts`: specialist topology.
- `packages/validators/src/run.ts`: existing bounded validator pool; reuse its approach.
- Attest `scripts/conductor/conductor.mjs`: serial independent review sessions; port proven scheduling improvements after Dokima acceptance.

## Ordered implementation slices

### 1. Resolve pause behavior and connect existing autonomy (W13-32)

Inventory each production pause caller, its consequences, default, and policy source. Routine implementation choices inside the approved design may proceed; scope, budget, credentials, policy exceptions, and unresolved acceptance ambiguity go to the user. Unknown sites fail closed. Inject policy through existing boundaries and ledger automatic decisions. Require explicit activation of the new behavior for existing projects. File narrower linked tickets if W13-32's current write scope cannot reach the production callers.

Acceptance: an opted-in approved build proceeds through routine work without repeated permission requests; every NEVER-AUTO case still pauses; unknown sites and untrusted defaults cannot bypass the gate; existing projects are not silently migrated. Test the production call path with recorded/fake model responses.

### 2. Schedule grouped checks with explicit dependencies

Replace incidental array-order dependencies with declared inputs and predecessors. Execute deterministic scanners together where independent. Execute applicable specialist reviews after their prerequisites. Run attack-chain synthesis and threat-model refresh after their required findings. Freeze each group's source snapshot and isolate result writes; aggregate durable events through the existing writer.

Use separate limits for CPU checks and model endpoints. A constrained local endpoint may require one active model request while independent scanners remain concurrent. Preserve stable result ordering, cancellation, timeouts, and complete failure reporting.

Acceptance: controlled delayed fixtures prove independent steps overlap, dependent steps wait, endpoint limits hold, failures never become passes, and synthesis cannot consume incomplete prerequisites.

### 3. Consolidate, repair, and invalidate stale evidence

Normalize findings to stable identifiers with locations, evidence, severity, and verification methods. Consolidate duplicates before a coordinated repair attempt. Do not run independent writers against the same implementation. Bind reusable check results to relevant source inputs, check configuration, tool/rule versions, and prerequisite artifact hashes.

When upstream evidence changes, invalidate dependent synthesis even if its earlier session exited successfully. Keep bounded attempts, no-progress detection, cost limits, and actionable escalation. Distinguish infrastructure failures, model failures, and verified code defects.

Acceptance: planted defects are repaired and independently rechecked; duplicate findings do not create duplicate repairs; changed upstream evidence reruns dependents; unrelated unchanged evidence can be reused; exhausted loops stop with preserved evidence.

### 4. Deliver the approved-build journey in the UI

Wire the approved plan to the actual build runner. Show progress, preview, consolidated issues, remaining budget, and decisions requiring the user. Allow stop and resume. Machine verification and acceptance remain distinct from maker output. Preserve the existing main-merge approval boundary while preparing a reviewable integrated result.

Acceptance: a fake-provider browser test goes from approved stories to implementation, grouped checks, a failed check, repair, verified preview, and a separate publication decision. Restart/resume must not repeat already-completed side effects or lose the run state.

### 5. Establish release proof

Use a bounded small-web-app task set, including planted defects and a change request. Compare the same model and tasks with and without the guardrails. Record completion rate, false blocks, defect detection, elapsed time, model calls/cost, retries, and human interventions. Keep live evaluation separate from network-free CI. Select supported configurations from observed results; do not label all endpoints equally capable.

Run a small supervised beginner pilot after automated acceptance passes. Record where developer help is required. Release claims must distinguish executed specialist sessions, independently verified checks, and successful customer outcomes.

## Validation and rollout

Follow current repository gates while implementing. Changes to per-ticket gate policy are a separate measured change, not permission to omit today's required checks. Start with a timing baseline; no speedup is claimed in advance. Preserve maker/verifier separation, receipt freshness, append-only history, and sandbox boundaries.

This document records accepted direction and implementation acceptance criteria. It does not mark W13-32 done, enable autonomy, create a scheduled automation, or claim a release is proven.
