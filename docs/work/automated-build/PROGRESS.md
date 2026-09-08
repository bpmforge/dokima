# Automated-build implementation progress

Durable handoff for the AB card sequence in
`docs/work/automated-build-handoff/`. Updated at the close of every card with
observed results only. Nothing here is marked implemented before its gate ran.

- **Current HEAD:** see the card row's commit column
- **Current AB card:** none — AB-00…AB-17 are done; AB-18 is out of scope here (see below)
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

| AB id | Ticket     | Registered in plan.json    | Card                                                                                                       |
| ----- | ---------- | -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| AB-00 | W23-00     | yes                        | Baseline and registration                                                                                  |
| AB-01 | W23-01     | yes (todo)                 | Approved-run policy and pause rules                                                                        |
| AB-02 | W23-02     | yes (done)                 | Persist approval of the exact build inputs                                                                 |
| AB-03 | W23-03     | yes (done)                 | Give the reviewer the actual source change                                                                 |
| AB-04 | W23-04     | yes (done)                 | Run real security tools, preserve results                                                                  |
| AB-05 | W23-05     | yes (done)                 | Security dependencies and applicability                                                                    |
| AB-06 | W23-06     | yes (done)                 | Share endpoint limits across roles                                                                         |
| AB-07 | W23-07     | yes (done)                 | Bounded-group security execution                                                                           |
| AB-08 | W23-08     | yes (done)                 | Invalidate dependent evidence on retry                                                                     |
| AB-09 | W23-09     | yes (done)                 | Consolidate findings into one repair batch                                                                 |
| AB-10 | W23-10     | yes (done)                 | Structured, fresh review decisions                                                                         |
| AB-11 | W23-11     | yes (done)                 | Bounded automatic repair loop                                                                              |
| AB-12 | W23-12     | yes (done)                 | Review/accept between tickets so dependents unlock                                                         |
| AB-13 | W23-13     | yes (done)                 | Durable run state, stop, resume                                                                            |
| AB-14 | W23-14     | yes (done)                 | One approval and a readable build experience                                                               |
| AB-15 | W23-15     | yes (done)                 | Remove duplicate developer gates                                                                           |
| AB-16 | W23-16     | yes (done)                 | Prove the workflow through real entry points                                                               |
| AB-17 | W23-17     | yes (done)                 | Measure model lift, bounded pilot                                                                          |
| AB-18 | W23-18     | NOT STARTED — out of scope | Port review grouping to Attest (secondary; a different repository)                                         |
| —     | **W23-23** | yes (todo)                 | Finding from AB-16: validator telemetry is written into the audited project (signed pack, needs a re-sign) |
| —     | **W23-22** | yes (todo)                 | Finding from AB-15: CI never runs `pnpm validate`, so three validators are gated only locally              |
| —     | **W23-19** | yes (todo)                 | Finding from AB-00: `dokima-suite-home-*` still leaks intermittently after W22-28                          |

**W13-32 is not duplicated.** It stays `blocked` and keeps its own
responsibility (wiring the autonomy dial for existing projects). W23-01 is its
linked child: it builds the versioned `approved-build-v1` decision function
that W13-32's acceptance says must be decided _before_ any dial is wired, and
it changes no default for a project that has not opted in.

## Card evidence

| AB id | Repo ticket | Status | Commit             | Focused checks                                                                                                            | Full gate                                                                                                                             | Evidence / blocker                                                                                                                |
| ----- | ----------- | ------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| AB-00 | W23-00      | done   | (this commit)      | `node scripts/validate-plan.mjs` exit 0                                                                                   | lint 0 · typecheck 0 · test 0 (5065 passed / 3 skipped) · e2e 0 (76) · validate 1 then 0                                              | `BASELINE.md`; the single validate failure is the intermittent temp-home leak, filed as W23-19                                    |
| AB-17 | W23-17      | done   | `20` (this commit) | documentation review; no runtime implementation changed                                                                   | lint 0 · typecheck 0 · test 0 (5326 passed / 2 skipped, 610 files) · e2e 0 (76) · validate 0 — identical to AB-16, which is the proof | protocol written before any result; benchmark NOT RUN and recorded as such; 2 of 4 beta thresholds unmet                          |
| AB-16 | W23-16      | done   | `19` (this commit) | `vitest run approved-build-e2e.test.ts --retry=0` → 8 passed                                                              | lint 0 · typecheck 0 · test 0 (5326 passed / 2 skipped, 610 files) · e2e 0 (76) · validate 0                                          | four production defects found and fixed; the workflow runs end to end with nobody in the room (ACCEPTANCE_REPORT.md)              |
| AB-15 | W23-15      | done   | `18` (this commit) | `node --test scripts/gate-plan.test.mjs` → 6 pass 0 fail                                                                  | lint 0 · typecheck 0 · test 0 (5318 passed / 2 skipped, 609 files) · e2e 0 (76) · validate 0                                          | ~10.95s → ~6.38s measured twice each; identical output; a planted failure fails both runners (GATE_TIMINGS.md)                    |
| AB-14 | W23-14      | done   | `17` (this commit) | `vitest run ApprovedBuildPanel.test.tsx AutonomyBudgetPanel.test.tsx approved-build-routes.test.ts --retry=0` → 22 passed | lint 0 · typecheck 0 · test 0 (5317 passed / 2 skipped, 608 files) · e2e 0 (76) · validate 0                                          | the approval has a door; six phases from durable state; refusals name their policy rule                                           |
| AB-13 | W23-13      | done   | `16` (this commit) | `vitest run approved-build-run-state.test.ts runs-routes.test.ts --retry=0` → 26 passed                                   | lint 0 · typecheck 0 · test 0 (5299 passed / 2 skipped, 606 files) · e2e 0 (76) · validate 1 then 0 (a W23-19 leak)                   | status and stop both survive a restart, proven through the HTTP routes; exit 0 no longer reads as completion                      |
| AB-12 | W23-12      | done   | `15` (this commit) | `vitest run verified-ticket-decision.test.ts loop-land.test.ts loop-land-base.test.ts --retry=0` → 63 passed              | lint 0 · typecheck 0 · test 0 (5285 passed / 2 skipped, 605 files) · e2e 0 (76) · validate 0                                          | three dependents done in ONE run, trunk unchanged, dependent forked from its accepted predecessor; 7 red fixtures block the chain |
| AB-11 | W23-11      | done   | `14` (this commit) | `vitest run build-repair-loop.test.ts build-repair.test.ts reject.test.ts --retry=0` → 22 passed                          | lint 0 · typecheck 0 · test 0 (5271 passed / 2 skipped, 603 files) · e2e 0 (76) · validate 0                                          | reject→remake→re-review with nobody in the room; the round count lives in the ledger, so a restart is granted none                |
| AB-10 | W23-10      | done   | `13` (this commit) | `vitest run review-decision.test.ts loop-review.test.ts --retry=0` → 36 passed                                            | lint 0 · typecheck 0 · test 0 (5259 passed / 2 skipped, 602 files) · e2e 0 (76) · validate 0                                          | machine reviewer identity; eligible computed with per-reason evidence                                                             |
| AB-09 | W23-09      | done   | `12` (this commit) | `vitest run repair-findings.test.ts --retry=0` → 20 passed                                                                | lint 0 · typecheck 0 · test 0 (5240 passed / 2 skipped, 601 files) · e2e 0 (76) · validate 0                                          | dedup by identity both directions; W23-21 filed (validate-exports blind to `export *`)                                            |
| AB-08 | W23-08      | done   | `11` (this commit) | `vitest run check-evidence.test.ts review-status.test.ts onboard-executor.test.ts --retry=0` → 41 passed                  | lint 0 · typecheck 0 · test 0 (5220 passed / 2 skipped, 600 files) · e2e 0 (76) · validate 0                                          | transitive re-run proven through the real onboard path; STALE is its own review state                                             |
| AB-07 | W23-07      | done   | `10` (this commit) | `vitest run check-scheduler.test.ts onboard-executor.test.ts --retry=0` → 18 passed                                       | lint 0 · typecheck 0 · test 0 (5189 passed / 2 skipped, 599 files) · e2e 0 (76) · validate 0                                          | deferred-promise overlap/ordering proofs; real onboard entry point traversed                                                      |
| AB-06 | W23-06      | done   | `9` (this commit)  | `vitest run shared-gateway-pool.test.ts gateway-pool.test.ts run-cmd.test.ts --retry=0` → 25 passed                       | lint 0 · typecheck 0 · test 0 (5177 passed / 2 skipped, 598 files) · e2e 0 (76) · validate 0                                          | one pool across all three roles; W23-20 closed inside this card                                                                   |
| AB-05 | W23-05      | done   | `7` (this commit)  | `vitest run security-plan.test.ts run-onboard.test.ts validate-exports.test.mjs --retry=0` → 51 passed                    | lint 0 · typecheck 0 · test 0 (5166 passed / 2 skipped, 597 files) · e2e 0 (76) · validate 0                                          | declared edges + 4 red fixtures; UNRESOLVED never satisfies a dependency                                                          |
| AB-04 | W23-04      | done   | `5` (this commit)  | `vitest run security-checks.test.ts --retry=0` → 13 passed / 1 skipped; with `DOKIMA_TEST_REAL_SCANNERS=1` → 14 passed    | lint 0 · typecheck 0 · test 0 (5150 passed / 2 skipped, 596 files) · e2e 0 (76) · validate 0                                          | the bundled scanner really detects a planted AWS-shaped key; both onboard and review paths call one registry                      |
| AB-03 | W23-03      | done   | `4` (this commit)  | `vitest run review-evidence.test.ts loop-review.test.ts --retry=0` → 24 passed                                            | lint 0 · typecheck 0 · test 0 (5135 passed / 1 skipped, 595 files) · e2e 0 (76) · validate 0 after clearing a W23-19 leak             | the prompt carries the planted line; verdicts bind head+digest; repo-supplied diff programs cannot run                            |
| AB-02 | W23-02      | done   | `3` (this commit)  | `vitest run approved-build.test.ts runs-routes.test.ts run-cmd.test.ts --retry=0` → 36 passed                             | lint 0 · typecheck 0 · test 0 (5121 passed / 1 skipped, 594 files) · e2e 0 (76) · validate 0 after clearing a W23-19 suite-home leak  | digest excludes execution status; both entrances refuse; W23-20 filed (run-build.ts at exactly 400 lines)                         |
| AB-01 | W23-01      | done   | `2` (this commit)  | `vitest run approved-build-policy.test.ts autonomy.test.ts review-queue-classifier.test.ts --retry=0` → 67 passed         | lint 0 · typecheck 0 · test 0 (5104 passed / 1 skipped, 593 files) · e2e 0 (76) · validate 0                                          | `PAUSE_SITES.md`: `resolvePauseAction` and `askClarification` had ZERO production callers; buried ratchet lowered 45 → 44         |

## AB-18 is not attempted here, and this is the reason

AB-18 targets the **Attest** repository. START_HERE says to work in the Dokima
repository, not Attest, and that AB-18 "is secondary; it must not delay a
proven Dokima private beta". Doing it from this handoff would mean editing a
repository this session was told to leave alone, to land a card the handoff
itself ranks below everything above it. It is left for whoever owns Attest,
with the note that the thing worth porting is the finding-consolidation shape
in `packages/harbormaster/src/repair-findings.ts` (identity is rule + path +
location + evidence, never the title) and the reviewer/decision split in
`review-decision.ts`.

## Next session

- **Completed behavior:** the AB sequence is finished through AB-17. The
  approved build works end to end on fixtures through both entrances, its
  evidence is written down in `ACCEPTANCE_REPORT.md`, the benchmark that would
  measure model lift is specified in `EVALUATION_PROTOCOL.md` and has NOT been
  run, and `EVALUATION_RESULTS.md` plus `docs/RELEASE_TRACKER.md` say which
  private-beta thresholds are met (2 of 4) so no release claim can be made from
  the wave merely existing.
- **Exact unfinished step:** nothing in the AB sequence. The next real work is
  the first row of a real benchmark table: commit the five task seeds from the
  protocol and run the GUARDED arm three times on task 1 against a local
  endpoint the operator supplies. That costs local compute and no budget.
- **Open findings filed during this wave:** W23-19 (intermittent
  `dokima-suite-home-*` temp leak), W23-21 (validate-exports does not follow
  `export * from`), W23-22 (CI never runs `pnpm validate`), W23-23 (validator
  telemetry is written into the audited project; needs a re-signed content
  pack). W23-20 was closed inside AB-06.
- **Actual test totals and skips:** 610 files, 5326 passed, 2 skipped.
- **Not merged to `main`.** Everything above is on `feat/automated-build`.
  `main` is the v1.0.0 tag target and the tag is not cut; tagging and
  publishing remain the founder's, and need their npm login.
- **Next AB id:** none.
