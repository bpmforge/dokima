# Approved-build evaluation results (W23-17, AB-17)

**Status: NOT RUN.** No benchmark run in `EVALUATION_PROTOCOL.md` has been
executed, and no number in this file describes model behaviour on that
benchmark. This file exists so that absence is recorded rather than left to be
inferred from a missing document.

Why not run, plainly: the protocol needs a model budget and a pilot
participant, and this handoff supplies neither. START_HERE rule 9 makes live
model evaluation a separate evidence class from the test suite, and step 4 of
AB-17 forbids launching paid models or recruiting users from a coding session.
Running it anyway with a local model and calling the result a benchmark would
produce exactly the kind of number this document is meant to prevent.

## Evidence classes, kept apart

The card asks that results distinguish these, so they are separated here even
though three of the four rows are empty.

| Class               | What it means                                               | What exists today                                                                                                                                                                                                                                                                    |
| ------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **not-run**         | Specified, never executed                                   | The whole of `EVALUATION_PROTOCOL.md`: 5 tasks × 2 arms × 3 repeats = 30 runs, 0 executed. The five task seeds are specified and not yet committed as fixtures.                                                                                                                      |
| **fixture-only**    | Executed against fixtures and fake providers, no live model | The repository gate, and the end-to-end approved-build workflow in `ACCEPTANCE_REPORT.md` (8 scenarios, `--retry=0`). Real git, real gate, real review pass, real security registry, real acceptance policy; faked model endpoint and faked `semgrep` binary.                        |
| **live-model**      | Executed against a real model endpoint                      | `docs/dogfood/DOGFOOD_REPORT.md` — the onboard pipeline over this repository through LM Studio, 16 steps, 55 findings, all local. It is NOT a measurement of the approved build: it predates every card in this wave and exercises the onboard path, not build/review/repair/accept. |
| **novice-observed** | A person who did not build this finishing the journey       | None for the approved build. The nearest is the 2026-08-28 customer-journey walkthrough recorded in the session history, which stopped at the board step on a fixed timeout (W21-96).                                                                                                |

## Private-beta thresholds, measured against what exists

| #   | Threshold                                              | State            | Evidence                                                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Every mechanical red test passing                      | **MET**          | Full gate at the AB-16 commit: lint 0, typecheck 0, test 0 (610 files, 5326 passed, 2 skipped), e2e 0 (76), validate 0. Red fixtures enumerated in `ACCEPTANCE_REPORT.md`.                                                                                                                                                                                         |
| 2   | A reproducible supported configuration                 | **PARTIAL**      | The Dokima side is pinned (Node 22, `.nvmrc`, `engines.node`, one commit). The model side is not: no model is named as supported, and the only measured local model is the dogfood run's.                                                                                                                                                                          |
| 3   | Zero false automatic acceptances in a bounded test set | **NOT MEASURED** | There is no bounded test set with hidden acceptance tests yet — that is the protocol, unexecuted. What IS known: in the fixture workflow no ticket is accepted unless the independent re-run passed, every required check passed, the review confirmed the exact reviewed digest and the receipt names the current head. That is a mechanism, not a measured rate. |
| 4   | One observed novice finishing the journey              | **NOT MET**      | No observation of the approved-build journey by anyone outside this work.                                                                                                                                                                                                                                                                                          |

**Two of four thresholds are unmet, so this is not private-beta evidence.**
That sentence is the result of this card.

## What may and may not be claimed at release

May be claimed, because it was observed:

- The approved build completes end to end with no person acting, on fixtures,
  including reject → repair → re-verify → accept and a three-ticket dependency
  chain finishing in one run (`ACCEPTANCE_REPORT.md`, 8 scenarios).
- Machine acceptance refuses, with a named rule, on a missing scanner, a stale
  review, a stale receipt, a same-model reviewer, an unreviewed ticket and an
  approval whose specification changed.
- The run's status, its stop and its terminal outcome survive a restart.

May **not** be claimed, because nothing measured it:

- Any comparison between guarded and unguarded model work — no lift number of
  any kind exists.
- Any defect-recall or false-positive rate.
- Any statement that the product is secure, certified, or safe to run
  unattended on work that matters. The strongest honest sentence is that
  several specific things it used to do silently, it now refuses to do at all.
- Any cost, token or wall-time figure for an approved build.

## The smallest next action

Commit the five task seeds from the protocol as fixtures, then run the
GUARDED arm three times on task 1 against a local endpoint the operator
supplies. That produces the first row of a real table and costs nothing but
local compute. The UNGUARDED arm needs a plain coding harness to compare
against and is the second step, not the first.
