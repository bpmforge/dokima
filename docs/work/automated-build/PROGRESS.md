# Automated-build implementation progress

Durable handoff for the AB card sequence in
`docs/work/automated-build-handoff/`. Updated at the close of every card with
observed results only. Nothing here is marked implemented before its gate ran.

- **Current HEAD:** see the card row's commit column
- **Current AB card:** AB-04 (next)
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
| AB-04 | W23-04     | reserved                | Run real security tools, preserve results                                         |
| AB-05 | W23-05     | reserved                | Security dependencies and applicability                                           |
| AB-06 | W23-06     | reserved                | Share endpoint limits across roles                                                |
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

| AB id | Repo ticket | Status | Commit            | Focused checks                                                                                                    | Full gate                                                                                                                            | Evidence / blocker                                                                                                        |
| ----- | ----------- | ------ | ----------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| AB-00 | W23-00      | done   | (this commit)     | `node scripts/validate-plan.mjs` exit 0                                                                           | lint 0 · typecheck 0 · test 0 (5065 passed / 3 skipped) · e2e 0 (76) · validate 1 then 0                                             | `BASELINE.md`; the single validate failure is the intermittent temp-home leak, filed as W23-19                            |
| AB-03 | W23-03      | done   | `4` (this commit) | `vitest run review-evidence.test.ts loop-review.test.ts --retry=0` → 24 passed                                    | lint 0 · typecheck 0 · test 0 (5135 passed / 1 skipped, 595 files) · e2e 0 (76) · validate 0 after clearing a W23-19 leak            | the prompt carries the planted line; verdicts bind head+digest; repo-supplied diff programs cannot run                    |
| AB-02 | W23-02      | done   | `3` (this commit) | `vitest run approved-build.test.ts runs-routes.test.ts run-cmd.test.ts --retry=0` → 36 passed                     | lint 0 · typecheck 0 · test 0 (5121 passed / 1 skipped, 594 files) · e2e 0 (76) · validate 0 after clearing a W23-19 suite-home leak | digest excludes execution status; both entrances refuse; W23-20 filed (run-build.ts at exactly 400 lines)                 |
| AB-01 | W23-01      | done   | `2` (this commit) | `vitest run approved-build-policy.test.ts autonomy.test.ts review-queue-classifier.test.ts --retry=0` → 67 passed | lint 0 · typecheck 0 · test 0 (5104 passed / 1 skipped, 593 files) · e2e 0 (76) · validate 0                                         | `PAUSE_SITES.md`: `resolvePauseAction` and `askClarification` had ZERO production callers; buried ratchet lowered 45 → 44 |

## Next session

- **Completed behavior:** the reviewer is shown the actual diff, collected by
  the core from the ticket's worktree with git invoked as an argument array and
  every repository-supplied diff program neutralized. Verdicts record the head,
  base and source digest they were given; incomplete or stale evidence
  downgrades a model CONFIRMED to UNVERIFIABLE, and a failing core re-run still
  out-votes everything.
- **Exact unfinished step:** AB-04 — run real security tools and preserve their
  results. `onboard-dispatch-port.ts` makes one `provider.chat` call with
  `verify: 'true'` and executes no tool at all.
- **Next file/symbol:** `apps/server/src/api/pipeline/onboard-dispatch-port.ts`
  and the bundled validator/scanner scripts' real JSON + exit-code contract
  (inspect it before writing a parser — IMPLEMENTATION_PLAN §9).
- **Failing command and output summary:** `pnpm validate` exited 1 on one
  `dokima-suite-home-*` again — the third time in four gate runs. Cleared, then
  exit 0. W23-19 now carries that frequency as evidence.
- **Actual test totals and skips:** 595 files, 5135 passed, 1 skipped.
- **Production caller verified:** yes — `collectReviewEvidence`,
  `evidenceStillCurrent` and `reviewEvidenceSection` are all called by
  `reviewOne` in `loop-review.ts`, the real review pass, and the planted-line
  test drives `runReviewPass` rather than the helper.
- **New finding and registered ticket:** none new this card beyond the
  frequency evidence added to W23-19.
- **Next AB id:** AB-04.
