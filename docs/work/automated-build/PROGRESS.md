# Automated-build implementation progress

Durable handoff for the AB card sequence in
`docs/work/automated-build-handoff/`. Updated at the close of every card with
observed results only. Nothing here is marked implemented before its gate ran.

- **Current HEAD:** see the card row's commit column
- **Current AB card:** AB-01 (next)
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

| AB id | Repo ticket | Status      | Commit        | Focused checks                          | Full gate                                                                                | Evidence / blocker                                                                             |
| ----- | ----------- | ----------- | ------------- | --------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| AB-00 | W23-00      | done        | (this commit) | `node scripts/validate-plan.mjs` exit 0 | lint 0 · typecheck 0 · test 0 (5065 passed / 3 skipped) · e2e 0 (76) · validate 1 then 0 | `BASELINE.md`; the single validate failure is the intermittent temp-home leak, filed as W23-19 |
| AB-01 | W23-01      | not started |               |                                         |                                                                                          |                                                                                                |

## Next session

- **Completed behavior:** none — AB-00 is documentation and board registration
  only. No source file changed.
- **Exact unfinished step:** AB-01 step 1 — inventory the real callers of
  `askClarification` and `resolvePauseAction` with `rg` and record honestly
  which production wiring is missing.
- **Next file/symbol:** `packages/harbormaster/src/autonomy.ts`
  (`resolvePauseAction`, `isNeverAutoPauseSite`) and
  `packages/harbormaster/src/breakpoints-clarifications.ts`
  (`askClarification`).
- **Failing command and output summary:** `pnpm validate` exited 1 once on a
  leaked `dokima-suite-home-*`; a second `pnpm test` + `pnpm validate` exited 0.
  Not caused by this card. W23-19.
- **Actual test totals and skips:** 592 files, 5065 passed, 3 skipped, 76 e2e.
- **Production caller verified:** n/a for a documentation card.
- **New finding and registered ticket:** W22-28's "no `dokima-suite-home-*`
  across three consecutive runs" criterion does not hold → **W23-19**.
- **Next AB id:** AB-01.
