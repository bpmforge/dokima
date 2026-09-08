# Automated-build baseline — AB-00

Captured 2026-09-08 on this laptop, before any AB card changed a line of
source. Everything below is an observed exit code or an observed number; where
a run disagreed with a second run, both are recorded rather than the flattering
one.

## Checkout

| Fact           | Value                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------- |
| HEAD at branch | `307ed76288f656cb764cb1dad4dc7bd049c8ec72` (`main`)                                             |
| Working branch | `feat/automated-build`, cut from that commit                                                    |
| `git status`   | clean of tracked changes; two untracked paths, both this handoff (see below)                    |
| Node           | v22.23.1 (`.nvmrc` / `engines.node` = 22.x — `fnm`'s default is 24 and breaks ~50 server tests) |
| pnpm           | 11.11.0 (`packageManager` = pnpm@11.11.0)                                                       |
| Platform       | darwin 25.6.0, arm64                                                                            |

Untracked at capture time: `docs/work/AUTOMATED_BUILD_PLAN_2026-09-08.md` and
`docs/work/automated-build-handoff/`. Both are this work's own inputs and were
preserved, not cleaned.

**`main` is the release tag target.** `v1.0.0` is prepared but not yet tagged or
published (`docs/work/RELEASE_HANDOFF_2026-09-03.md` step 3). AB work therefore
lives on `feat/automated-build` and must not land on `main` until the founder
has cut and published the tag, or has said otherwise — merging it moves the
target the CHANGELOG and tracker evidence point at.

## Full gate, one clean run

Run in the order START_HERE.md prescribes, each command's own exit code
captured directly (not through a pipe, which would report the pipe's status).

| Command                         | Exit  | Wall | Result                                                     |
| ------------------------------- | ----- | ---- | ---------------------------------------------------------- |
| `pnpm lint`                     | 0     | 5s   | eslint clean, no output                                    |
| `pnpm typecheck`                | 0     | 7s   | every package `Done`                                       |
| `pnpm test`                     | 0     | 30s  | **592 files, 5065 passed, 3 skipped** (5068 total)         |
| `pnpm --filter @dokima/web e2e` | 0     | 45s  | **76 passed**; teardown removed 21 temp projects           |
| `pnpm validate`                 | **1** | 11s  | 6 validators clean; **temp-leaks failed with 1 violation** |

CI agrees on the same commit: run
[34255…/34251882161](https://github.com/bpmforge/dokima/actions/runs/34251882161)
was green on `261247f9`, and the run on `307ed762` completed success.

## The one baseline failure: a leaked test home

`pnpm validate` exited 1 on the first run of the day:

```
[temp-leak] /var/folders/.../T/dokima-suite-home-3dXsuZ
FAIL: temp-leaks — 1 temp director(ies) left behind in the last 10m
```

The directory held a single `global.db` and no Dokima run was active
(`pgrep vitest|playwright|conductor.mjs` empty), so it was this baseline's own
`pnpm test` that left it.

**This is not new, and it is not fixed.** `apps/server/vitest.setup.ts` creates
`dokima-suite-home-*` per test file and removes it in `afterAll`. W22-28 —
status `done` on the board — is titled _"a temp home still leaks, and the
teardown never ran"_, and its second acceptance criterion is "a full `pnpm test`
run leaves no `dokima-suite-home-*`, verified across three consecutive runs".
That criterion does not hold today.

Reproduction attempt, recorded honestly: a second full `pnpm test` immediately
afterwards left **zero** such directories, and `pnpm validate` then exited 0.
So the leak is intermittent — roughly one directory out of ~129 homes per run,
not every run — which is exactly the shape W22-28's own notes describe (four at
once on one occasion, none on others, correlated with test-file churn).

Consequence for this work: **a red `pnpm validate` in an AB card is not
automatically that card's fault.** Check whether the only violation is a
`dokima-suite-home-*` from the run that preceded it before treating it as a
regression. Filed as **W23-19** rather than left as a sentence here.

## Pre-existing state a later session must not read as AB damage

- **`validate-plan` P13 reports 26 rows** — "work deferred in a note with no
  ticket to carry it" (W0-02, W3-07, W7-01…, W21-90, W21-95, W21-96, W22-02,
  W22-05, W22-11, W22-15, W22-20, W22-26 and others). P13 is **report-only**;
  `validate-plan` still exits `ok`. This count is the baseline. AB cards must
  not add to it — a deferral names a registered ticket id or it is not a
  deferral (CLAUDE.md Law 1).
- **3 skipped tests** in `pnpm test`, by design (the real-macOS-keychain test
  and its kin are opt-in via `DOKIMA_TEST_REAL_KEYCHAIN=1`).
- **`validate-exports` ratchets** stand at `--max 46 --max-buried 45`. Lowering
  is allowed; raising is a regression.
- **Nightly E2E history**: failed 2026-09-07 (run 34104530858), succeeded
  2026-09-08 (run 34208364280). That red is P6-22's known mid-run-rejoin flake
  on the Ubuntu runner, not a product break.
- **Board**: 497 tickets, 495 `done`, 2 `blocked` — W12-44 (plugin loader) and
  W13-32 (autonomy dial), both deliberately held for a founder call. W13-32 is
  the ticket AB-01 must extend rather than duplicate.

## What this card did not do

No source file was changed. No dependency was installed. The conductor was not
started, and this work is deliberately outside it (START_HERE rule 10, AB-00
step 5). No live model call was made.
