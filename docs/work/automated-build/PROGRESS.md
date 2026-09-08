# Automated-build implementation progress

Durable handoff for the AB card sequence in
`docs/work/automated-build-handoff/`. Updated at the close of every card with
observed results only. Nothing here is marked implemented before its gate ran.

- **Current HEAD:** see the card row's commit column
- **Current AB card:** AB-02 (next)
- **Branch:** `feat/automated-build`, cut from `307ed762` on `main`
- **Policy version enabled for tests only / opted-in users:** none yet —
  `approved-build-v1` does not exist until AB-01/AB-02 land
- **Baseline:** `BASELINE.md` (this directory)

## AB id → repository ticket mapping

Wave 23 is reserved for this feature. Ids are allocated here so a later
session cannot collide with them; a ticket is **inserted into `plan.json` only
when its card is next**, per AB-00 step 5.

| AB id | Ticket     | Registered in plan.json | Card                                                                              |
| ----- | ---------- | ----------------------- | --------------------------------------------------------------------------------- |
| AB-00 | W23-00     | yes                     | Baseline and registration                                                         |
| AB-01 | W23-01     | yes (todo)              | Approved-run policy and pause rules                                               |
| AB-02 | W23-02     | reserved                | Persist approval of the exact build inputs                                        |
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

| AB id | Repo ticket | Status | Commit            | Focused checks                                                                                                    | Full gate                                                                                    | Evidence / blocker                                                                                                        |
| ----- | ----------- | ------ | ----------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| AB-00 | W23-00      | done   | (this commit)     | `node scripts/validate-plan.mjs` exit 0                                                                           | lint 0 · typecheck 0 · test 0 (5065 passed / 3 skipped) · e2e 0 (76) · validate 1 then 0     | `BASELINE.md`; the single validate failure is the intermittent temp-home leak, filed as W23-19                            |
| AB-01 | W23-01      | done   | `2` (this commit) | `vitest run approved-build-policy.test.ts autonomy.test.ts review-queue-classifier.test.ts --retry=0` → 67 passed | lint 0 · typecheck 0 · test 0 (5104 passed / 1 skipped, 593 files) · e2e 0 (76) · validate 0 | `PAUSE_SITES.md`: `resolvePauseAction` and `askClarification` had ZERO production callers; buried ratchet lowered 45 → 44 |

## Next session

- **Completed behavior:** `decideApprovedBuildAction` — the `approved-build-v1`
  pause decision, pure, table-driven, fails closed, delegating NEVER-AUTO to
  `isNeverAutoPauseSite` and `classifyByRules` rather than re-listing it.
  Machine acceptance refuses each precondition independently (no reviewer,
  maker-is-verifier, same model, unconfirmed verdict, failed required check,
  stale receipt, stale review) with its own rule id.
- **Exact unfinished step:** AB-02 — persist the approval this function reads.
  Nothing writes an `ApprovedBuildPolicy` yet, which is why both barrel exports
  carry an `@unreached` marker naming W23-02.
- **Next file/symbol:** the approval event and its digest —
  `packages/events` append path plus wherever the pipeline records phase
  approvals; trace real receipt/decision accessors rather than inventing a
  boolean (IMPLEMENTATION_PLAN §9).
- **Failing command and output summary:** two reds during the card, both fixed
  before close: `scripts/validate-exports.test.mjs` pinned `buried === 45` in
  two places (the ratchet legitimately dropped to 44), and
  `conductor-lib.test.mjs`'s repo-wide `validate-file-size` check caught
  `approved-build-policy.ts` at 428 lines. One cohesive chapter was extracted —
  `approved-build-accept.ts`, the acceptance branch plus the two decision
  constructors — leaving 341 and 115 lines. No unrelated refactor (START_HERE
  rule 7).
- **Actual test totals and skips:** 593 files, 5104 passed, 1 skipped. The
  baseline's 3 skips were 1 keychain + 2 container-runtime; the container pair
  ran this time because a runtime was up. Compare skip names, not counts.
- **Production caller verified:** none, deliberately — AB-01 is the pure
  decision only, and the two `@unreached` markers name W23-02 as the owed
  caller. `scripts/validate-exports.test.mjs` asserts those markers name
  W23-02, so W23-02 cannot land and leave them behind quietly.
- **New finding and registered ticket:** the autonomy dial has no production
  wiring at all — `resolvePauseAction` and `askClarification` were called only
  by their own tests. Recorded in `PAUSE_SITES.md`; it is W13-32's own
  responsibility and stays there, unduplicated.
- **Next AB id:** AB-02.
