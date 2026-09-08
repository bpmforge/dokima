# Automated-build implementation progress

Durable handoff for the AB card sequence in
`docs/work/automated-build-handoff/`. Updated at the close of every card with
observed results only. Nothing here is marked implemented before its gate ran.

- **Current HEAD:** see the card row's commit column
- **Current AB card:** AB-03 (next)
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
| AB-03 | W23-03     | reserved                | Give the reviewer the actual source change                                        |
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
| AB-02 | W23-02      | done   | `3` (this commit) | `vitest run approved-build.test.ts runs-routes.test.ts run-cmd.test.ts --retry=0` → 36 passed                     | lint 0 · typecheck 0 · test 0 (5121 passed / 1 skipped, 594 files) · e2e 0 (76) · validate 0 after clearing a W23-19 suite-home leak | digest excludes execution status; both entrances refuse; W23-20 filed (run-build.ts at exactly 400 lines)                 |
| AB-01 | W23-01      | done   | `2` (this commit) | `vitest run approved-build-policy.test.ts autonomy.test.ts review-queue-classifier.test.ts --retry=0` → 67 passed | lint 0 · typecheck 0 · test 0 (5104 passed / 1 skipped, 593 files) · e2e 0 (76) · validate 0                                         | `PAUSE_SITES.md`: `resolvePauseAction` and `askClarification` had ZERO production callers; buried ratchet lowered 45 → 44 |

## Next session

- **Completed behavior:** an approval of the exact build inputs is recorded as
  a versioned event and validated in one shared preflight inside
  `executeBuildRun`, so the HTTP route and `dokima run start` cannot disagree.
  An opted-in run with no approval, or one whose specification moved, exits 2
  before any ticket is claimed.
- **Exact unfinished step:** AB-03 — give the reviewer the actual source
  change. `packages/harbormaster/src/loop-review.ts` builds a prompt from
  acceptance, filenames, commits and verify output, with no source diff in it.
- **Next file/symbol:** `packages/harbormaster/src/loop-review.ts` (the prompt
  builder) and `packages/harbormaster/src/review-status.ts` (freshness).
- **Failing command and output summary:** `pnpm validate` exited 1 on a single
  `dokima-suite-home-*` left by the preceding `pnpm test` — the W23-19 leak,
  not this card. Removing it and re-running gave exit 0. This is the second
  time in three cards; treat a lone suite-home violation as W23-19 until that
  ticket lands.
- **Actual test totals and skips:** 594 files, 5121 passed, 1 skipped.
- **Production caller verified:** yes. `approvedBuildPreflight` is called by
  `executeBuildRun` (the shared path), reached by `runs-job.ts` for HTTP and
  `run-cmd.ts` for the CLI; both entrances are proven by tests that assert the
  refusal text and that the ticket stays unclaimed.
- **New finding and registered ticket:** `run-build.ts` is now at EXACTLY 400
  lines, the repo-wide cap. Adding one preflight took it from 398 to 402 and
  reddened `validate-file-size`. Filed as **W23-20**; deliberately not
  refactored inside this card (START_HERE rule 7).
- **Next AB id:** AB-03.
