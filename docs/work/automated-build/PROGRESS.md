# Automated-build implementation progress

Durable handoff for the AB card sequence in
`docs/work/automated-build-handoff/`. Updated at the close of every card with
observed results only. Nothing here is marked implemented before its gate ran.

- **Current HEAD:** see the card row's commit column
- **Current AB card:** AB-07 (next)
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
| AB-07 | W23-07     | reserved                | Bounded-group security execution                                                  |
| AB-08 | W23-08     | reserved                | Invalidate dependent evidence on retry                                            |
| AB-09 | W23-09     | reserved                | Consolidate findings into one repair batch                                        |
| AB-10 | W23-10     | reserved                | Structured, fresh review decisions                                                |
| AB-11 | W23-11     | reserved                | Bounded automatic repair loop                                                     |
| AB-12 | W23-12     | reserved                | Review/accept between tickets so dependents unlock                                |
| AB-13 | W23-13     | reserved                | Durable run state, stop, resume                                                   |
| AB-14 | W23-14     | reserved                | One approval and a readable build experience                                      |
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

| AB id | Repo ticket | Status | Commit            | Focused checks                                                                                                         | Full gate                                                                                                                            | Evidence / blocker                                                                                                        |
| ----- | ----------- | ------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| AB-00 | W23-00      | done   | (this commit)     | `node scripts/validate-plan.mjs` exit 0                                                                                | lint 0 · typecheck 0 · test 0 (5065 passed / 3 skipped) · e2e 0 (76) · validate 1 then 0                                             | `BASELINE.md`; the single validate failure is the intermittent temp-home leak, filed as W23-19                            |
| AB-06 | W23-06      | done   | `9` (this commit) | `vitest run shared-gateway-pool.test.ts gateway-pool.test.ts run-cmd.test.ts --retry=0` → 25 passed                    | lint 0 · typecheck 0 · test 0 (5177 passed / 2 skipped, 598 files) · e2e 0 (76) · validate 0                                         | one pool across all three roles; W23-20 closed inside this card                                                           |
| AB-05 | W23-05      | done   | `7` (this commit) | `vitest run security-plan.test.ts run-onboard.test.ts validate-exports.test.mjs --retry=0` → 51 passed                 | lint 0 · typecheck 0 · test 0 (5166 passed / 2 skipped, 597 files) · e2e 0 (76) · validate 0                                         | declared edges + 4 red fixtures; UNRESOLVED never satisfies a dependency                                                  |
| AB-04 | W23-04      | done   | `5` (this commit) | `vitest run security-checks.test.ts --retry=0` → 13 passed / 1 skipped; with `DOKIMA_TEST_REAL_SCANNERS=1` → 14 passed | lint 0 · typecheck 0 · test 0 (5150 passed / 2 skipped, 596 files) · e2e 0 (76) · validate 0                                         | the bundled scanner really detects a planted AWS-shaped key; both onboard and review paths call one registry              |
| AB-03 | W23-03      | done   | `4` (this commit) | `vitest run review-evidence.test.ts loop-review.test.ts --retry=0` → 24 passed                                         | lint 0 · typecheck 0 · test 0 (5135 passed / 1 skipped, 595 files) · e2e 0 (76) · validate 0 after clearing a W23-19 leak            | the prompt carries the planted line; verdicts bind head+digest; repo-supplied diff programs cannot run                    |
| AB-02 | W23-02      | done   | `3` (this commit) | `vitest run approved-build.test.ts runs-routes.test.ts run-cmd.test.ts --retry=0` → 36 passed                          | lint 0 · typecheck 0 · test 0 (5121 passed / 1 skipped, 594 files) · e2e 0 (76) · validate 0 after clearing a W23-19 suite-home leak | digest excludes execution status; both entrances refuse; W23-20 filed (run-build.ts at exactly 400 lines)                 |
| AB-01 | W23-01      | done   | `2` (this commit) | `vitest run approved-build-policy.test.ts autonomy.test.ts review-queue-classifier.test.ts --retry=0` → 67 passed      | lint 0 · typecheck 0 · test 0 (5104 passed / 1 skipped, 593 files) · e2e 0 (76) · validate 0                                         | `PAUSE_SITES.md`: `resolvePauseAction` and `askClarification` had ZERO production callers; buried ratchet lowered 45 → 44 |

## Next session

- **Completed behavior:** one process-wide gateway pool shared by the coding,
  review and onboard paths, keyed by a normalized endpoint identity that
  carries no credentials. Only `chat` is queued; a failed request releases its
  slot.
- **Exact unfinished step:** AB-07 — execute the security checks in bounded
  groups against the W23-05 graph, with controlled-promise tests for overlap
  and order (never wall-clock assertions).
- **Next file/symbol:** `apps/server/src/api/pipeline/onboard-executor.ts`
  (serial dispatch today) and `packages/validators/src/run.ts`'s existing
  bounded-concurrency discipline, which the plan says to reuse rather than
  reinvent.
- **Failing command and output summary:** lint caught eleven imports left
  behind by the preflight extraction, plus one unused destructured field. All
  removed; no behaviour change.
- **Actual test totals and skips:** 598 files, 5177 passed, 2 skipped.
- **Production caller verified:** yes — `run-build-spawn.ts`, `review-pass.ts`
  and `onboard-dispatch-port.ts` all import `pooledProvider`/`endpointIdFor`
  from the one module, and the pool test proves two separately constructed
  providers share a limit.
- **New finding and registered ticket:** **W23-20 is closed inside this card**,
  which is precisely the moment it predicted: adding one field to the review
  call took `run-build.ts` from 400 to 401 lines. The preflight sequence became
  `run-build-preflight.ts` (extraction only) rather than another shaved comment.
- **Next AB id:** AB-07.
