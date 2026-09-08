# Automated-build implementation progress

Durable handoff for the AB card sequence in
`docs/work/automated-build-handoff/`. Updated at the close of every card with
observed results only. Nothing here is marked implemented before its gate ran.

- **Current HEAD:** see the card row's commit column
- **Current AB card:** AB-05 (next)
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

| AB id | Repo ticket | Status | Commit            | Focused checks                                                                                                         | Full gate                                                                                                                            | Evidence / blocker                                                                                                        |
| ----- | ----------- | ------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| AB-00 | W23-00      | done   | (this commit)     | `node scripts/validate-plan.mjs` exit 0                                                                                | lint 0 · typecheck 0 · test 0 (5065 passed / 3 skipped) · e2e 0 (76) · validate 1 then 0                                             | `BASELINE.md`; the single validate failure is the intermittent temp-home leak, filed as W23-19                            |
| AB-04 | W23-04      | done   | `5` (this commit) | `vitest run security-checks.test.ts --retry=0` → 13 passed / 1 skipped; with `DOKIMA_TEST_REAL_SCANNERS=1` → 14 passed | lint 0 · typecheck 0 · test 0 (5150 passed / 2 skipped, 596 files) · e2e 0 (76) · validate 0                                         | the bundled scanner really detects a planted AWS-shaped key; both onboard and review paths call one registry              |
| AB-03 | W23-03      | done   | `4` (this commit) | `vitest run review-evidence.test.ts loop-review.test.ts --retry=0` → 24 passed                                         | lint 0 · typecheck 0 · test 0 (5135 passed / 1 skipped, 595 files) · e2e 0 (76) · validate 0 after clearing a W23-19 leak            | the prompt carries the planted line; verdicts bind head+digest; repo-supplied diff programs cannot run                    |
| AB-02 | W23-02      | done   | `3` (this commit) | `vitest run approved-build.test.ts runs-routes.test.ts run-cmd.test.ts --retry=0` → 36 passed                          | lint 0 · typecheck 0 · test 0 (5121 passed / 1 skipped, 594 files) · e2e 0 (76) · validate 0 after clearing a W23-19 suite-home leak | digest excludes execution status; both entrances refuse; W23-20 filed (run-build.ts at exactly 400 lines)                 |
| AB-01 | W23-01      | done   | `2` (this commit) | `vitest run approved-build-policy.test.ts autonomy.test.ts review-queue-classifier.test.ts --retry=0` → 67 passed      | lint 0 · typecheck 0 · test 0 (5104 passed / 1 skipped, 593 files) · e2e 0 (76) · validate 0                                         | `PAUSE_SITES.md`: `resolvePauseAction` and `askClarification` had ZERO production callers; buried ratchet lowered 45 → 44 |

## Next session

- **Completed behavior:** a security tool registry whose adapters own their own
  exit codes, run inside the existing sandbox with constant argument lists, and
  report ERROR / UNAVAILABLE / NOT_APPLICABLE rather than PASSED when they
  cannot look. Both the onboard analysis and the build review path call it, and
  both ledger what the core executed beside what a model said.
- **Exact unfinished step:** AB-05 — declare the security dependencies and
  applicability as a graph (stage A tools → stage B specialists → C synthesis →
  D threat-model refresh), so a specialist cannot run before the tool result it
  interprets.
- **Next file/symbol:** `packages/pipeline`'s security cluster step lists
  (`SECURITY_CLUSTER_STEPS`, `SECURITY_SPECIALIST_ROLES`) and
  `apps/server/src/api/pipeline/onboard-executor.ts`'s serial dispatch.
- **Failing command and output summary:** the SC-04 lint guard rejected a test
  assertion whose regex contained `PASSED`. It cannot tell a prompt-content
  check from a completion-by-string-match and the conservative reading is
  right, so the assertion compares a status list as data instead. No temp leak
  this run.
- **Actual test totals and skips:** 596 files, 5150 passed, 2 skipped (the
  keychain skip plus the opt-in scanner smoke test).
- **Production caller verified:** yes, both. `runOnboardSecurityChecks` is
  called by `runOnboardAnalysis` before any specialist dispatch;
  `collectTicketSecurityChecks` is called by `reviewOne`, and a test asserts
  the verdict event lists all three tool results.
- **New finding and registered ticket:** none new; the smoke path is opt-in by
  design and is not counted as evidence that Semgrep or npm audit work here.
- **Next AB id:** AB-05.
