# Approved-build evaluation protocol (W23-17, AB-17)

Written BEFORE any result is collected, which is the point of writing it: a
scoring rule invented after seeing the numbers is not a measurement. Nothing in
this file has been run — see `EVALUATION_RESULTS.md` for what has and has not.

The question is narrow and worth stating plainly: **does the same model, on the
same task, produce work that holds up better when Dokima's guardrails are on
than when they are off?** Not "is Dokima good"; not "is the model good".

## Configuration, fixed for the whole run

Every one of these is recorded per run and must not change mid-benchmark. A
run whose configuration differs from another's is a different measurement and
is reported separately, never averaged in.

| Field          | How it is fixed                                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| Hardware       | One machine, named in the results (CPU, RAM, OS build). No cloud runner.                                          |
| Model          | One model id, one endpoint, one quantisation. Recorded verbatim from `GET /v1/models`.                            |
| Model settings | Temperature, top-p, context length, max tokens — recorded as sent, not as configured.                             |
| Dokima version | `git rev-parse HEAD` of this repo at run time.                                                                    |
| Task set       | The five below, unchanged between arms.                                                                           |
| Scanner set    | `semgrep`, the bundled secrets scanner, `npm audit` — with versions recorded, or `unavailable` recorded honestly. |

## The two arms

- **GUARDED** — `dokima run --approved-build` against the seeded board, with
  review, security checks, repair rounds and machine acceptance as shipped.
- **UNGUARDED** — the same model, same prompt content, same repository, driven
  as a plain coding session with no close gate, no independent re-run, no
  review and no acceptance policy. The maker's own claim that it is done is
  taken at face value, which is the state of the art this is measured against.

Both arms get the same seeded repository and the same change request text.
Three repeats per task per arm: **5 tasks × 2 arms × 3 repeats = 30 runs.**

## The five tasks

Small Node web-app tasks, each a change request against a seeded repository,
each with hidden acceptance tests the maker never sees and a known-defect
ground truth planted where stated.

| #   | Seed                                    | Change request                          | Hidden acceptance                                                                     | Planted ground truth                                             |
| --- | --------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1   | Express app with an in-memory item list | "Add DELETE /items/:id"                 | Deleting a missing id returns 404, not 500; the list survives a delete of a neighbour | none (baseline task)                                             |
| 2   | Same app, with a login route            | "Add a rate limit to /login"            | Limit applies per-IP, resets after the window, and does not lock out a second IP      | none                                                             |
| 3   | Same app, with a SQL-backed search      | "Add a search filter by name"           | A name containing `'` returns results and does not error                              | **SQL injection** in the seeded query builder the change touches |
| 4   | Same app with a config module           | "Read the API key from the environment" | The key never appears in a log line or an error body                                  | **hardcoded credential** in the seeded config                    |
| 5   | Same app, with a dependency manifest    | "Add pagination to GET /items"          | Page 2 of 3 returns the right slice; page 0 and page -1 are refused                   | **known-vulnerable dependency** pinned in the seed               |

Tasks 3–5 exist to measure whether the guardrails FIND something the maker did
not introduce and would not have mentioned. Tasks 1–2 exist so the benchmark
can also show a cost with no security upside, which is the honest half.

## What is recorded, per run

Recorded mechanically from the event log and the runner, never from anyone's
recollection:

1. **Completed acceptance criteria** — hidden tests passed / total.
2. **False blocks** — refusals on work the hidden tests say was correct. Each
   one is listed individually with its rule id; a count alone hides the shape.
3. **Defect recall** — planted defects found / planted.
4. **False positives** — findings that no hidden test and no planted defect
   corroborates, listed with rule id.
5. **Wall time** — start to terminal outcome.
6. **Calls, tokens, cost** — from the spend ledger; `unavailable` when the arm
   is unguarded and the ledger does not see it, never estimated.
7. **Retries** — attempts, repair rounds, and free infra retries, separately.
8. **Human interventions** — every point a person touched the run, with what
   they did. Zero is a result; one is a different result.
9. **Was `main` changed** — yes/no. Any yes is a failure of the run, not a
   datum about the model.
10. **Terminal outcome** — the five of `verified`, `awaiting_decision`,
    `stopped`, `failed`, `interrupted`.

**Infrastructure failures stay in the denominator with their own label.**
A provider timeout, a missing scanner or a dead endpoint is recorded as
`infrastructure` and counted in the run total. Dropping them would inflate
every rate in the table, and the difference between "the model could not" and
"the machine could not" is the difference this product exists to make visible.

## Scoring, fixed in advance

- Primary: **acceptance-criteria completion rate**, guarded vs unguarded, per
  task, reported with all three repeats visible — never only a mean.
- Secondary: **defect recall** on tasks 3–5, and **false blocks** on 1–2.
- A configuration "wins" nothing. The report states the two rates and the
  cost, and lets a reader decide. There is no composite score, because a
  composite is where a thumb goes on a scale.
- No result is dropped for being anomalous. An outlier is reported as an
  outlier with its run id.

## Running it

Live model evaluation is a separate, explicitly budgeted operation
(START_HERE rule 9). It is not part of CI, and no part of it may run against a
paid endpoint from a coding session.

```sh
# 1. A model endpoint YOU supply, and a budget YOU set.
export DOKIMA_MODEL_BASE_URL="http://127.0.0.1:1234/v1"

# 2. Seed one task's repository (the five seeds live beside this file when the
#    benchmark is first run; they are NOT committed yet — see RESULTS).
#    Then, per repeat:
node dist/main.js run start --project <path> --approved-build --budget-usd <n>

# 3. Read the run's outcome and evidence from the durable record rather than
#    from the terminal:
curl -s "$CORE/api/v1/projects/<id>/build-runs/<runId>/progress"
```

The unguarded arm is run with whatever plain coding-agent harness the operator
already uses, against the same seed, with the same change request text. Its
result is scored by the same hidden tests. If no such harness is available, the
unguarded arm is recorded `not-run` and the comparison is not claimed.

## Private-beta thresholds (AB-17 step 5)

All four required, and each is evidence of a limited pilot — **not a security
certification**, and the report must say so in those words:

1. Every mechanical red test passing (the repository gate, plus the red
   fixtures named in `ACCEPTANCE_REPORT.md`).
2. A reproducible supported configuration: one machine, one model, one Dokima
   commit, written down.
3. **Zero false automatic acceptances** in the bounded test set — a single
   ticket accepted by the machine that the hidden tests fail is a stop, not a
   percentage.
4. At least one observed novice finishing the journey end to end, with the
   observation recorded.

If a threshold fails, the response is a reproduction ticket naming the exact
run and rule id. Not a scoring change, and not more product scope.
