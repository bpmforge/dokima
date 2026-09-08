# Automated-build implementation progress

Durable handoff for the AB card sequence in
`docs/work/automated-build-handoff/`. Updated at the close of every card with
observed results only. Nothing here is marked implemented before its gate ran.

- **Current HEAD:** see the card row's commit column
- **Current AB card:** AB-15 (next)
- **Branch:** `feat/automated-build`, cut from `307ed762` on `main`
- **Policy version enabled for tests only / opted-in users:** `approved-build-v1`
  exists and is recorded/validated, but NO user is opted in: opting in requires
  `--approved-build` or `approved_build: true` per run, and nothing sets either
  by default
- **Baseline:** `BASELINE.md` (this directory)

## AB id → repository ticket mapping

Wave 23 is reserved for this feature. Ids are allocated here so a later
session cannot collide with them; a ticket is **inserted into `plan.json` only
when its card is next**, per AB-00 step 5.

| AB id | Ticket     | Registered in plan.json | Card                                                                              |
| ----- | ---------- | ----------------------- | --------------------------------------------------------------------------------- |
| AB-00 | W23-00     | yes                     | Baseline and registration                                                         |
| AB-01 | W23-01     | yes (todo)              | Approved-run policy and pause rules                                               |
| AB-02 | W23-02     | yes (done)              | Persist approval of the exact build inputs                                        |
| AB-03 | W23-03     | yes (done)              | Give the reviewer the actual source change                                        |
| AB-04 | W23-04     | yes (done)              | Run real security tools, preserve results                                         |
| AB-05 | W23-05     | yes (done)              | Security dependencies and applicability                                           |
| AB-06 | W23-06     | yes (done)              | Share endpoint limits across roles                                                |
| AB-07 | W23-07     | yes (done)              | Bounded-group security execution                                                  |
| AB-08 | W23-08     | yes (done)              | Invalidate dependent evidence on retry                                            |
| AB-09 | W23-09     | yes (done)              | Consolidate findings into one repair batch                                        |
| AB-10 | W23-10     | yes (done)              | Structured, fresh review decisions                                                |
| AB-11 | W23-11     | yes (done)              | Bounded automatic repair loop                                                     |
| AB-12 | W23-12     | yes (done)              | Review/accept between tickets so dependents unlock                                |
| AB-13 | W23-13     | yes (done)              | Durable run state, stop, resume                                                   |
| AB-14 | W23-14     | yes (done)              | One approval and a readable build experience                                      |
| AB-15 | W23-15     | reserved                | Remove duplicate developer gates                                                  |
| AB-16 | W23-16     | reserved                | Prove the workflow through real entry points                                      |
| AB-17 | W23-17     | reserved                | Measure model lift, bounded pilot                                                 |
| AB-18 | W23-18     | reserved                | Port review grouping to Attest (secondary)                                        |
| —     | **W23-19** | yes (todo)              | Finding from AB-00: `dokima-suite-home-*` still leaks intermittently after W22-28 |

**W13-32 is not duplicated.** It stays `blocked` and keeps its own
responsibility (wiring the autonomy dial for existing projects). W23-01 is its
linked child: it builds the versioned `approved-build-v1` decision function
that W13-32's acceptance says must be decided _before_ any dial is wired, and
it changes no default for a project that has not opted in.

## Card evidence

| AB id | Repo ticket | Status | Commit             | Focused checks                                                                                                            | Full gate                                                                                                                            | Evidence / blocker                                                                                                                |
| ----- | ----------- | ------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| AB-00 | W23-00      | done   | (this commit)      | `node scripts/validate-plan.mjs` exit 0                                                                                   | lint 0 · typecheck 0 · test 0 (5065 passed / 3 skipped) · e2e 0 (76) · validate 1 then 0                                             | `BASELINE.md`; the single validate failure is the intermittent temp-home leak, filed as W23-19                                    |
| AB-14 | W23-14      | done   | `17` (this commit) | `vitest run ApprovedBuildPanel.test.tsx AutonomyBudgetPanel.test.tsx approved-build-routes.test.ts --retry=0` → 22 passed | lint 0 · typecheck 0 · test 0 (5317 passed / 2 skipped, 608 files) · e2e 0 (76) · validate 0                                         | the approval has a door; six phases from durable state; refusals name their policy rule                                           |
| AB-13 | W23-13      | done   | `16` (this commit) | `vitest run approved-build-run-state.test.ts runs-routes.test.ts --retry=0` → 26 passed                                   | lint 0 · typecheck 0 · test 0 (5299 passed / 2 skipped, 606 files) · e2e 0 (76) · validate 1 then 0 (a W23-19 leak)                  | status and stop both survive a restart, proven through the HTTP routes; exit 0 no longer reads as completion                      |
| AB-12 | W23-12      | done   | `15` (this commit) | `vitest run verified-ticket-decision.test.ts loop-land.test.ts loop-land-base.test.ts --retry=0` → 63 passed              | lint 0 · typecheck 0 · test 0 (5285 passed / 2 skipped, 605 files) · e2e 0 (76) · validate 0                                         | three dependents done in ONE run, trunk unchanged, dependent forked from its accepted predecessor; 7 red fixtures block the chain |
| AB-11 | W23-11      | done   | `14` (this commit) | `vitest run build-repair-loop.test.ts build-repair.test.ts reject.test.ts --retry=0` → 22 passed                          | lint 0 · typecheck 0 · test 0 (5271 passed / 2 skipped, 603 files) · e2e 0 (76) · validate 0                                         | reject→remake→re-review with nobody in the room; the round count lives in the ledger, so a restart is granted none                |
| AB-10 | W23-10      | done   | `13` (this commit) | `vitest run review-decision.test.ts loop-review.test.ts --retry=0` → 36 passed                                            | lint 0 · typecheck 0 · test 0 (5259 passed / 2 skipped, 602 files) · e2e 0 (76) · validate 0                                         | machine reviewer identity; eligible computed with per-reason evidence                                                             |
| AB-09 | W23-09      | done   | `12` (this commit) | `vitest run repair-findings.test.ts --retry=0` → 20 passed                                                                | lint 0 · typecheck 0 · test 0 (5240 passed / 2 skipped, 601 files) · e2e 0 (76) · validate 0                                         | dedup by identity both directions; W23-21 filed (validate-exports blind to `export *`)                                            |
| AB-08 | W23-08      | done   | `11` (this commit) | `vitest run check-evidence.test.ts review-status.test.ts onboard-executor.test.ts --retry=0` → 41 passed                  | lint 0 · typecheck 0 · test 0 (5220 passed / 2 skipped, 600 files) · e2e 0 (76) · validate 0                                         | transitive re-run proven through the real onboard path; STALE is its own review state                                             |
| AB-07 | W23-07      | done   | `10` (this commit) | `vitest run check-scheduler.test.ts onboard-executor.test.ts --retry=0` → 18 passed                                       | lint 0 · typecheck 0 · test 0 (5189 passed / 2 skipped, 599 files) · e2e 0 (76) · validate 0                                         | deferred-promise overlap/ordering proofs; real onboard entry point traversed                                                      |
| AB-06 | W23-06      | done   | `9` (this commit)  | `vitest run shared-gateway-pool.test.ts gateway-pool.test.ts run-cmd.test.ts --retry=0` → 25 passed                       | lint 0 · typecheck 0 · test 0 (5177 passed / 2 skipped, 598 files) · e2e 0 (76) · validate 0                                         | one pool across all three roles; W23-20 closed inside this card                                                                   |
| AB-05 | W23-05      | done   | `7` (this commit)  | `vitest run security-plan.test.ts run-onboard.test.ts validate-exports.test.mjs --retry=0` → 51 passed                    | lint 0 · typecheck 0 · test 0 (5166 passed / 2 skipped, 597 files) · e2e 0 (76) · validate 0                                         | declared edges + 4 red fixtures; UNRESOLVED never satisfies a dependency                                                          |
| AB-04 | W23-04      | done   | `5` (this commit)  | `vitest run security-checks.test.ts --retry=0` → 13 passed / 1 skipped; with `DOKIMA_TEST_REAL_SCANNERS=1` → 14 passed    | lint 0 · typecheck 0 · test 0 (5150 passed / 2 skipped, 596 files) · e2e 0 (76) · validate 0                                         | the bundled scanner really detects a planted AWS-shaped key; both onboard and review paths call one registry                      |
| AB-03 | W23-03      | done   | `4` (this commit)  | `vitest run review-evidence.test.ts loop-review.test.ts --retry=0` → 24 passed                                            | lint 0 · typecheck 0 · test 0 (5135 passed / 1 skipped, 595 files) · e2e 0 (76) · validate 0 after clearing a W23-19 leak            | the prompt carries the planted line; verdicts bind head+digest; repo-supplied diff programs cannot run                            |
| AB-02 | W23-02      | done   | `3` (this commit)  | `vitest run approved-build.test.ts runs-routes.test.ts run-cmd.test.ts --retry=0` → 36 passed                             | lint 0 · typecheck 0 · test 0 (5121 passed / 1 skipped, 594 files) · e2e 0 (76) · validate 0 after clearing a W23-19 suite-home leak | digest excludes execution status; both entrances refuse; W23-20 filed (run-build.ts at exactly 400 lines)                         |
| AB-01 | W23-01      | done   | `2` (this commit)  | `vitest run approved-build-policy.test.ts autonomy.test.ts review-queue-classifier.test.ts --retry=0` → 67 passed         | lint 0 · typecheck 0 · test 0 (5104 passed / 1 skipped, 593 files) · e2e 0 (76) · validate 0                                         | `PAUSE_SITES.md`: `resolvePauseAction` and `askClarification` had ZERO production callers; buried ratchet lowered 45 → 44         |

## Next session

- **Completed behavior:** `recordApprovedBuild` has an entrance. The board
  shows what an approval covers — tickets, write scopes, both models, the
  budget, and the C-5 list that always asks — records it, starts the approved
  run, and then reports Building / Checking / Fixing / Ready to review / Needs
  your decision / Stopped from durable state, with a reload reading the server
  rather than component memory. A ticket the machine would not accept names the
  policy rule that refused it. With one model the surface says before launch
  that the build cannot finish without a person.
- **Exact unfinished step:** AB-15 — remove duplicate developer gates: the
  checks a ticket's close gate already runs must not be re-run by hand or by a
  second path.
- **Next file/symbol:** `packages/harbormaster/src/loop-gates*.ts` and
  `scripts/run-validators.mjs`, plus the security registry in
  `packages/harbormaster/src/security-checks.ts` (AB-04) whose checks the review
  path and the onboard path both run.
- **Failing command and output summary:** one e2e assertion pinned the old
  autonomy hint verbatim (`Unattended defaults are not enforced yet`) and went
  red the moment the copy changed — the guard doing its job; updated with the
  new sentence. Also a pre-existing unhandled rejection in `BoardView`'s start
  handler surfaced as a hard suite error once the new panel changed the timing;
  fixed rather than worked around.
- **Actual test totals and skips:** 608 files, 5317 passed, 2 skipped.
- **Production caller verified:** yes — `ApprovedBuildPanel` is mounted in
  `BoardView`'s runbar, the route that owns Start run, and the four new routes
  are registered in `server.ts`. An unmounted component would not have
  satisfied this card and does not.
- **New finding and registered ticket:** none new; the `BoardView` rejection
  hole is recorded as a widen on W23-14 rather than filed, because it is four
  lines inside a file this card already owns.
- **Next AB id:** AB-15.
