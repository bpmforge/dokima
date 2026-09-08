# Implementation plan: approved design to verified preview

## 1. Deliverable and scope

Build the following product behavior on the existing Dokima runtime:

1. User approves an exact design/story/acceptance snapshot and chooses model policy and budget.
2. Runtime validates the approval and preflights required capabilities before claiming work.
3. Ready tickets build in isolated workspaces.
4. Runtime executes required objective checks; independent checks run in bounded groups.
5. A separate reviewer sees the actual code diff and runtime evidence.
6. Findings are consolidated, repaired and verified with bounded retries.
7. Eligible work is accepted by the real reviewer identity, unlocking dependent tickets.
8. User gets a verified preview and one consolidated decision for main merge/publication.

First supported proof profile: a small Node web application using the existing local server/browser UI and existing process/container sandbox. This is not a rewrite into a browser-only WebContainer, a hosted multi-tenant SaaS, a new IDE, or a new model host. Retain current provider adapters. Add no framework or model-provider dependency unless the current interfaces demonstrably cannot support the task.

Automated checks improve assurance; they do not prove software has no vulnerabilities. Do not label a review completed merely because a model returned JSON.

## 2. Source findings that determine the work

These are source-review findings, not newly reproduced runtime bugs. Recheck symbols if HEAD has moved.

| Existing code | Observed behavior | Required response |
|---|---|---|
| `apps/server/src/cli/run-build.ts` | Calls `executeReviewPass` after the land loop returns | Move required ticket review into the common post-close path |
| `packages/tickets/src/reflow.ts` | Dependencies require `done` | Preserve this; mechanically accept verified work rather than weakening dependencies |
| `packages/harbormaster/src/loop-land-base.ts` | Composes bases from accepted dependency work | Reuse; do not merge to main to make dependencies work |
| `packages/harbormaster/src/loop-review.ts` | Prompt includes acceptance, filenames, commits and verify output, but no source diff | Supply bounded actual source/diff evidence and freshness |
| `apps/server/src/api/pipeline/onboard-dispatch-port.ts` | One `provider.chat` call; `verify: 'true'`; no tool execution in that dispatch | Run scanners in the runtime and feed their actual outputs to specialists |
| `apps/server/src/api/pipeline/onboard-run.ts` | Supplies bounded repository context before dispatch | Preserve this context; do not claim the model currently sees no code at all |
| `apps/server/src/api/pipeline/onboard-executor.ts` | Serial real dispatch and cached successful step artifacts | Add explicit dependency scheduling and descendant invalidation |
| `packages/validators/src/run.ts` | Bounded concurrent validator execution already exists | Reuse that resource discipline |
| `apps/server/src/cli/run-build-spawn.ts` | Owns a shared model pool for maker sessions | Extend pool ownership to review/onboard, not one pool per role |
| `apps/server/src/api/server/runs-job.ts` | Uses in-memory maps for HTTP job status and stop requests | Make durable run state authoritative |
| `packages/harbormaster/src/review-status.ts` | Reads latest review events without source freshness in that helper | Invalidate on new source/rejection/closure |
| W13-32 / D-032 | Autonomy deliberately blocked pending defaults review | Implement the explicit policy below, not global default dismissal |

Do not rebuild these existing foundations: `acceptTicket`/`rejectTicket`, event log, sandbox, per-ticket engine, berth scheduler, phase receipts, provider adapters, escalation budgets and dependency-base composition.

## 3. Product loop — implement this order

```text
validate approved snapshot + required capabilities
  -> claim ready ticket using existing verbs
  -> run maker attempt under existing budgets and sandbox
  -> run objective checks against a captured source head
  -> existing close gate produces current receipt / in_review
  -> independent source-aware review
     -> confirmed + current complete evidence + opted-in policy:
          acceptTicket(real reviewer identity)
          reflow dependencies and continue
     -> fixable findings within scope and budget:
          rejectTicket(real reviewer identity, structured reason)
          reclaim same ticket and repair
          invalidate old checks/review
          repeat check/close/review
     -> unavailable/inconclusive/protected/exhausted:
          preserve evidence, park, expose decision
  -> compose accepted outputs on an isolated integration branch
  -> verify integrated preview
  -> present result and separate main/deploy decision
```

The post-close operation belongs in the shared one-ticket path used by both `runLandLoop` and berths. A separate outer loop that reruns the whole board would duplicate retry/budget semantics; do not add one.

Machine acceptance is allowed by existing D-020 when a distinct reviewer supplies it. It is not a merge to main. Preserve the existing receipt checks inside `acceptTicket`; add freshness checks around them rather than bypassing them.

If a protection classifies a change as requiring a person (including existing auth/crypto/new-stack protections), keep the pause. Batch the explanation. This release does not loosen that policy to promise zero interruptions.

## 4. Exact pause policy for this release

Use this table in AB-01. All auto actions additionally require the validated opted-in approved-build policy. Runtime owns classification.

| Situation | Action |
|---|---|
| Implement an approved ticket inside its scope | Proceed |
| Run configured tests/scanners in allowed sandbox/network policy | Proceed |
| Repair a finding inside the same approved acceptance/scope and remaining budget | Proceed, bounded retries |
| Retry transient provider failure under existing limits | Proceed with existing bounded handling |
| Fresh independent review and required checks confirm current head | Machine accept under reviewer identity |
| Ordinary implementation detail with no material requirement choice | Proceed; do not manufacture a clarification |
| Ambiguous requirement or competing behavior not covered by approved stories | Ask; continue unrelated work |
| New scope, new dependency/stack, auth/crypto or destructive operation under existing classifier | Ask |
| Exceed budget or cross an approval-gated model boundary | Ask; never silently spend/escalate |
| Missing credential/required scanner/independent reviewer | Explain missing capability; do not report complete |
| Same maker and reviewer model | Keep existing refusal; second model or human review required |
| Main/master merge, release/publication/deploy | Ask separately |
| Unknown pause kind or model-supplied “safe default” | Ask/fail closed |
| Existing project with legacy `autonomy=auto` and no new approval | Preserve legacy behavior; require explicit opt-in |

Suggested new policy version identifier: `approved-build-v1`. It is a new implementation contract, not an existing setting. Store it with a runtime-validated approval event. Reuse the event/settings infrastructure. Do not expose an API that accepts arbitrary forged approval evidence.

## 5. Security graph — implement this conservative graph first

Keep the existing general onboarding chain in its current order:

`landscape -> entry-points -> data-model -> components -> patterns -> health -> architecture`

Then run the applicable security portion:

| Stage | Work | Required predecessors |
|---|---|---|
| A: objective tools | SAST, secrets, dependency audit; applicable infrastructure checks | Fixed source snapshot and project profile |
| B: specialist interpretation | Existing `security-sast`, `security-secrets`, `security-deps` report steps | Corresponding actual tool result |
| B: contextual review | `security-owasp-web`, `security-owasp-llm`, `security-cloud`, `security-iac` | Stage A results plus bounded source/project context |
| C: synthesis | `security-attack-chains` | Every applicable B result |
| D: refresh | `threat-model-refresh` | C and its evidence |

The objective tool nodes may use new internal ids (for example `tool-sast`). They must not collide with existing specialist step ids. Keep the public specialist outputs distinguishable from objective scanner evidence.

For a build ticket, use the same checks/scheduler directly against its captured worktree snapshot. Do not rerun seven general onboarding model sessions for every ticket. Reuse approved project context unless its digest changed.

Applicability is explicit: missing cloud/IaC surface may be NOT_APPLICABLE with a runtime-derived reason. Missing Semgrep executable is not NOT_APPLICABLE. No network for an audit with no offline database is UNAVAILABLE, not PASS. “Local-only” must be honest about coverage availability.

### Scheduler algorithm

1. Validate ids, dependencies, DAG and exclusive output scopes before work starts.
2. Capture source and configuration digests.
3. Select pending nodes whose predecessors have all produced valid results. Only a documented NOT_APPLICABLE predecessor may satisfy an optional dependency.
4. Start nodes up to the worker limit. Every model request additionally acquires the shared endpoint limit.
5. Give each node immutable predecessor artifacts and immutable source context. Never pass the mutable result map itself.
6. Record its outcome through the single writer; release resources in `finally`.
7. On node failure, do not start dependent synthesis. Independent nodes may finish to collect useful evidence.
8. On stop, schedule nothing new. Drain/cancel already-started work according to the existing runner contract, then close the run.
9. Return stable plan-order results and an explicit overall status. Never convert failure/timeout to an empty finding list.

Tests must use controlled promises to assert overlap/order. Avoid assertions such as “must finish in 100ms” on CI.

## 6. Minimal data contracts

These shapes are proposed design requirements. Adapt names to existing types; do not build a parallel ticket or receipt model.

### Check result

```ts
type CheckStatus = 'passed' | 'findings' | 'error' | 'unavailable' | 'not_applicable';
interface CheckEvidence {
  checkId: string;
  sourceDigest: string;
  inputDigest: string;
  toolVersion: string | null;
  ruleDigest: string | null;
  status: CheckStatus;
  exitCode: number | null;
  artifactRef: string | null;
  artifactDigest: string | null;
  durationMs: number;
  reason: string | null;
}
```

A process exit code is interpreted by its adapter. Some scanners exit nonzero when findings exist; some fail before scanning. Preserve both meaning and original exit code. Required check ERROR/UNAVAILABLE makes automatic completion ineligible. NOT_APPLICABLE carries scope/profile evidence. Model-originated review evidence must be identified as such.

### Finding

```ts
interface RepairFinding {
  id: string;
  sourceDigest: string;
  ruleId: string;
  path: string;
  location: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  evidenceRefs: string[];
  originIds: string[];
  confidenceKind: 'tool-confirmed' | 'review-hypothesis';
  verificationCheckIds: string[];
  ownerTicketId: string | null;
}
```

Paths are normalized relative paths inside the worktree; reject traversal/symlink escapes. Stable ids include rule/location/evidence, not just prose titles. Store findings outside source files where possible so writing a report does not invalidate the code snapshot. Retain redacted raw evidence for review. Do not execute a model's suggested verification string without trusted command resolution.

### Approval and completion

Approval records version, project, actor, timestamp and digests of approved design/stories/acceptance/plan scope/model policy/budget. Credentials are refs only. Execution status is excluded from the approval digest.

Completion must refer to the current verified head, current receipt and current independent review. Missing matching provenance means no automated accept. Snapshot changes after review invalidate it. For dirty worktrees, either explicitly capture a complete immutable tree or refuse until the existing commit lifecycle provides one; never hash HEAD and ignore uncommitted code.

## 7. Repair and reuse boundaries

Use the existing ticket reject/reclaim cycle and maker handoff. One maker writes a ticket at a time. Defaults: at most 3 automatic review/repair rounds, never exceeding tighter existing session, wall-time, token, spend or policy limits. Persist counters; restarting the app cannot reset a budget. Two attempts with the same source digest and same unresolved finding ids trigger no-progress handling.

After each repair:

- Recompute the changed source snapshot.
- Invalidate checks depending on it and every descendant synthesis/review.
- Rerun checks whose keys no longer match.
- Keep unrelated exact-match run-scoped evidence.
- Close and review again; do not reuse the prior model verdict.

First release uses conservative whole-source keys and run-scoped reuse. Fine-grained affected-file caching, global caches and skipping full repository gates are later optimizations. This deliberately avoids asking a cheaper agent to infer a perfect dependency graph across arbitrary languages.

Infrastructure failure is not “code still vulnerable.” Park/retry with the correct reason. The user should not get a fictitious fix ticket for a dead endpoint or missing scanner.

## 8. Integration and durable execution

Use accepted dependency branches via `loop-land-base.ts`. Existing per-feature composition can help create an integrated candidate, but inspect its main-merge guard and actual base before use. Never bypass C-5. Preview from an isolated composed branch/worktree and verify that combined tree, because separately passing tickets can fail together.

Durable events are authoritative for run state, attempts, stop intent and evidence. In-memory Maps can cache that state only. Idempotent starts are scoped to project + run id; repeated start returns the same job, not another worker. Restart must inspect current branches and approval freshness before resuming. Do not silently replay an external action or reopen an accepted ticket.

Budget fields exposed by the UI must reach enforcement. Trace actual usage through existing ledger/breaker functions; adding a setting with no production consumer does not satisfy the handoff. If a required enforcement path is absent, add a narrow linked sub-ticket under AB-12 before enabling the feature.

## 9. File ownership and exports

Each card lists existing read/change areas and proposed helper files. Before claiming it, add exact necessary exports and production parents to its write scope. Existing closed tickets do not justify inventing reflective imports, mock replays or duplicated modules to avoid a normal caller edit.

For the UI, follow the Start-run call with `rg 'build-runs' apps/web/src`. For phase approvals, trace actual receipt/decision accessors rather than guessing a new boolean. For scanner adapters, inspect the bundled script's JSON/exit contract before writing a parser. Keep imports in the approved package dependency direction.

If an acceptance criterion requires an unlisted file, amend scope using the project's normal process before editing. Do not silently leave the wiring for someone else. A deferral must name a registered ticket.

## 10. Completion evidence and release cut

AB-00 through AB-16 implement and mechanically prove the feature. AB-17 is the live/novice proof step; it may produce an explicitly not-run protocol if no model budget or participant is supplied. It must never manufacture results. AB-18 improves Attest afterward.

Required automated scenarios:

1. Three dependent tickets plus independent work complete under fake providers with no per-ticket human acceptance.
2. A real production path requests a repair after a failed check; second maker response fixes it.
3. Model says CONFIRMED while objective verify fails: no acceptance.
4. Same maker/reviewer, stale receipt, missing scanner, truncated diff: no acceptance.
5. Source changes after review: old approval cannot be used.
6. Retry cap and no-progress stop; restart preserves counters.
7. Shared endpoint limit holds across roles; independent scanners overlap.
8. Duplicate start is idempotent; durable status survives restart.
9. A rejected predecessor blocks its dependents; independent tickets can proceed.
10. Main remains unchanged; preview is verified on the integrated candidate.
11. Protected publication/merge action still waits for a human.
12. Legacy auto setting does not silently activate new behavior.

Report each with actual test name, command, exit code, evidence and scope of proof. Fixture tests prove orchestration; installed-tool smoke tests prove tools execute; live model trials prove those configurations; novice observation proves usability in that sample. Keep these claims separate.

## 11. Work order

- [AB-00: Capture a clean baseline and register this work](AB-00.md)
- [AB-01: Define the approved-run policy and pause rules](AB-01.md)
- [AB-02: Persist approval of the exact build inputs](AB-02.md)
- [AB-03: Give the reviewer the actual source change](AB-03.md)
- [AB-04: Run real security tools and preserve their results](AB-04.md)
- [AB-05: Declare security dependencies and applicability](AB-05.md)
- [AB-06: Share endpoint limits across coding and review](AB-06.md)
- [AB-07: Execute security checks in bounded groups](AB-07.md)
- [AB-08: Invalidate dependent evidence on retry](AB-08.md)
- [AB-09: Consolidate findings into one repair batch](AB-09.md)
- [AB-10: Make review return structured, fresh decisions](AB-10.md)
- [AB-11: Automatically repair a rejected ticket with a bounded loop](AB-11.md)
- [AB-12: Review and accept between tickets so dependents unlock](AB-12.md)
- [AB-13: Persist run state, stop requests and resumable progress](AB-13.md)
- [AB-14: Expose one approval and a readable build experience](AB-14.md)
- [AB-15: Remove duplicate developer gates without dropping coverage](AB-15.md)
- [AB-16: Prove the complete workflow through the real entry points](AB-16.md)
- [AB-17: Measure model lift and conduct a bounded pilot](AB-17.md)
- [AB-18: Port the proven review grouping to Attest](AB-18.md)

Do not mark a card done because the next card is expected to fix it. Close only its own acceptance with observed evidence.
