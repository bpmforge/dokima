# Approved build — acceptance report (W23-16, AB-16)

What was actually run, what it proved, and what it did not. Every command and
count below is from this machine (M2 Max, Node 22.23.1) on 2026-09-08. Nothing
here is an expected count.

## The command

```
$ pnpm exec vitest run apps/server/src/cli/approved-build-e2e.test.ts --retry=0
 ✓ src/cli/approved-build-e2e.test.ts (8 tests) 8.4s
 Tests  8 passed (8)
```

Retries disabled, as AB-16 step 5 asks, so a flaky first attempt would be
visible. Full gate at close: lint 0 · typecheck 0 · test 0 (610 files, 5326
passed, 2 skipped) · e2e 0 (76) · validate 0.

## What it drives

`executeBuildRun` (the function `dokima run` calls) and `executeBuildRunJob`
(the function the `POST /projects/:id/build-runs` route dispatches), over a
real git repository with real worktrees, the real close gate, the real review
pass, the real security registry and the real acceptance policy.

**Faked, and only this** — exactly what AB-16 step 2 permits:

| Faked                                                                 | Why                                                                                                                                                  | What is still real                                                                         |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| The model endpoint (a local OpenAI-compatible `node:http` fixture)    | Law 9a: tests never make a live API call                                                                                                             | Provider construction, routing, the prompt, the parse, C-4's model comparison              |
| The `semgrep` binary (a shell script on PATH returning empty results) | Not installed on this machine or in CI. Without it the SAST check is `unavailable`, every required check fails, and nothing can be accepted anywhere | The adapter, its arguments, its exit-code interpretation, the sandbox, the evidence record |
| The maker (an external agent shell script)                            | A real coding model is a live call                                                                                                                   | The session boundary, the manifest parse, the close gate, the ladder, the park             |

Nothing mocks the orchestrator into returning done. Every acceptance below is
`acceptTicket` called by `verifyAndAcceptTicket` after `decideMachineAccept`
said it could be.

## Scenarios, and what each one proves

| Scenario                                                                           | Proves                                                                                                                                                                                          | Status |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| A CONTRADICTED review is rejected, repaired by the maker, re-verified and accepted | AB-11 acceptance 1, through a real entrance rather than injected seams; the reject is signed `machine-reviewer`; the ticket ends `done` with no human verb; `main` still has exactly one commit | PASS   |
| Three dependent tickets and one independent one, one run                           | Dependency source inheritance and ordering read from the ledger: each `ticket.accepted` precedes the next `ticket.claimed`; all four end `done`; every acceptance is the machine's              | PASS   |
| The same board through `berths: 2`                                                 | AB-12 acceptance 4 as an OUTCOME, not "by construction": the post-close seam runs inside the berth engine and both tickets are accepted                                                         | PASS   |
| The HTTP entrance                                                                  | The same end through the route's own function, and W23-13's classification: the run records `verified`, not merely exit 0                                                                       | PASS   |
| RED: no scanner on PATH                                                            | An outage is not a defect. Nothing is accepted, the rule is `accept-required-check-failed`, the ticket stays `in_review`, the close receipt is retained                                         | PASS   |
| RED: work still needing a person, HTTP                                             | The run records `awaiting_decision`, not `done`                                                                                                                                                 | PASS   |
| RED: an agent that parks everything                                                | A run that landed nothing is not `verified`. Found while writing this report — the classifier counted only `in_review`, and a parked ticket is released to `ready`                              | PASS   |
| RED: the specification changed after the approval                                  | The run refuses with `approved build inputs changed`, exit 2, and nothing is claimed                                                                                                            | PASS   |

## Four production defects this card found

Every one of them was invisible to the unit tests that own the code, and every
one made the workflow unreachable in production. This is the argument for the
card existing.

1. **`tool-secrets` could never run during a review.** `ReviewPassOptions.secretsValidatorPath` landed with W23-04 and no production caller ever set it, so every review reported "the bundled secrets scanner could not be located in this installation". Fixed: `review-pass.ts` resolves it with the same `bundledSecretsScanner()` the onboard path uses.
2. **No ticket could ever be machine-accepted.** The review path hardcoded `networkPolicy: 'local-only'` with a comment saying it had no settings reader; `tool-sast` requires the network for its ruleset, so SAST was permanently `unavailable`, every required check failed, and `decideMachineAccept` refused every ticket. Fixed: the project's own policy, from the same settings file the onboard path reads. Local-only remains the default.
3. **Every review's evidence was incomplete.** `content/validators/_lib.sh` appends a row to `docs/work/telemetry.jsonl` on every validator run, so the CLOSE GATE dirtied the worktree it had just gated; `collectReviewEvidence` saw a dirty tree, reported incomplete evidence, and capped every verdict at UNVERIFIABLE. Fixed by filtering the status through `agentAuthoredPaths` — the list W21-28/W21-29 already keep for this exact attribution question — and by asking git for untracked FILES (`-uall`) rather than collapsed directories.
4. **`accept-stale-receipt` on unchanged code.** Receipt freshness compared the LAST element of the manifest's commit list against HEAD. A manifest lists commits newest-first across attempts, so the comparison used the oldest commit; and a harness commit after the close moves HEAD without changing the code. Fixed: the receipt is fresh when the current head — or the newest agent-authored head — is among the commits it names.

## What is NOT proven here, and by what instead

- **A real model.** No live provider call is made anywhere in the suite (Law 9a). The reviewer's judgement quality is not under test; its plumbing, refusals and freshness rules are.
- **A real scanner.** Covered separately by W23-04's opt-in smoke test, which runs the bundled secrets scanner against a planted AWS-shaped key: `DOKIMA_TEST_REAL_SCANNERS=1 pnpm exec vitest run packages/harbormaster/src/security-checks.test.ts` → 16 passed, 0 skipped (measured again for this report; it was 14 at W23-04, and the file has grown since).
- **Same-model review, false model approval, exhausted repair, stale review, duplicate start, restart.** Each is proven as a red fixture at the seam that owns the rule, not here: `loop-review.test.ts` (same model refuses honestly), `review-decision.test.ts` (a CONFIRMED over incomplete or moved evidence is recorded UNVERIFIABLE; a failed re-run is CONTRADICTED whatever the model said), `build-repair-loop.test.ts` (the bound, and a restart granted no new rounds), `verified-ticket-decision.test.ts` (stale review, stale receipt, same model, no reviewer), `approved-build-run-state.test.ts` (duplicate start, cross-project isolation, stop across a restart). Driving all of them through a full run would multiply runtime without changing what is proven.
- **The browser.** The approval surface is proven by component tests against a fake server (`ApprovedBuildPanel.test.tsx`) and by the route tests (`approved-build-routes.test.ts`); no Playwright scenario drives a whole build, because a full run inside a browser test would be a slow way to re-prove what the two above already do.
- **Merging to main and publishing.** Deliberately untouched: the happy path asserts `main` is byte-identical after the run. Those remain separate decisions and are not part of any approved build.
