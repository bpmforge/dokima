# Gate duplication and timings (W23-15, AB-15)

Measured on this machine (M2 Max, Node 22.23.1) on 2026-09-08, on a clean
tree at the AB-14 commit. No number here is an estimate; every one is from a
command in this file.

## 1. Where the same work runs twice

Inspected: `conductor.config.json` `gates`, `package.json` `scripts`,
`.github/workflows/ci.yml`, `.github/workflows/nightly.yml`.

| #   | Duplicate execution                                                                                                     | Where                                                | Why it is (or is not) removable                                                                                                                                                                                                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Every `*conformance.test.ts` runs in the `gate` job's `pnpm test` **and** again in the `conformance` job                | ci.yml jobs `gate`, `conformance`                    | NOT removed here. The second run is per-package with `cwd` set to the package, which is a different execution environment from the workspace run — dropping it needs evidence that the two are equivalent, and AB-15 step 4 says not to remove per-ticket checks in this handoff.                                                                                               |
| 2   | The trust-core packages (events, tickets, git, validators, server) run in `pnpm test` **and** again in `gate-integrity` | ci.yml jobs `gate`, `gate-integrity`                 | NOT removed. That job's value is that it re-runs them with the planted-defect fixtures present; it is a different question about the same files.                                                                                                                                                                                                                                |
| 3   | The whole suite runs a third time under coverage                                                                        | ci.yml job `coverage`                                | NOT removed. Coverage instrumentation changes what is measured, not what is asserted.                                                                                                                                                                                                                                                                                           |
| 4   | `validate-plan` + `validate-traceability` run in the `traceability` job **and** in `pnpm validate`                      | ci.yml job `traceability`, `package.json` `validate` | NOT removed, and worth recording the asymmetry: **CI never runs `pnpm validate`.** It runs two of the six validators in that job and `validate-history-secrets` in another, so `validate-ui-copy`, `validate-exports` and `validate-volatile-paths` are gated ONLY by the local Law 3 gate. That is a coverage gap, not a duplication, and it is the finding of this inventory. |
| 5   | The six source validators run serially inside one command                                                               | `scripts/run-validators.mjs`                         | REMOVED — this is what the card asks for. They are independent and read-only, so they now run concurrently under a bound.                                                                                                                                                                                                                                                       |

Dependency constraints found:

- `validate-temp-leaks` must run **after every test process has exited**. It
  inspects the machine's tmpdir, so a live worker's working directory reads as
  a leak (W22-18). It is not in the parallel group and is not in
  `run-validators.mjs`'s list either; `pnpm validate` runs it last, serially.
- Every other validator asks a question about the repo's **source** and writes
  nothing, which is what makes running them at once safe.
- The ratchet arguments must come from `conductor.config.json` and nowhere
  else (W22-06). `gate-plan.mjs` imports `ratchetArgsByValidator` rather than
  re-reading or re-typing them.

## 2. Before and after

Same tree, same six validators, same arguments, back to back:

```
$ for i in 1 2; do /usr/bin/time -p node scripts/run-validators.mjs; done
real 10.85
real 11.05

$ for i in 1 2; do /usr/bin/time -p node scripts/gate-plan.mjs; done
real 6.40
real 6.36
```

**~10.95s → ~6.38s, a 4.6s saving (42%)** on the validator phase. It is not a
saving on the whole gate: `pnpm test` (~30s) and `pnpm --filter @dokima/web
e2e` (~45s) dominate and are untouched by this card.

## 3. Equivalence, demonstrated before the instructions changed

Output is byte-identical apart from the elapsed-time suffix the parallel
runner adds:

```
$ node scripts/run-validators.mjs > ser.out
$ node scripts/gate-plan.mjs | sed 's/ (6\.[0-9]s)//' > par.out
$ diff ser.out par.out && echo IDENTICAL
IDENTICAL
```

Failure detection, with a real planted failure (`process.exit(3)` at the top
of `scripts/validate-ui-copy.mjs`, reverted immediately after):

```
$ node scripts/gate-plan.mjs; echo $?
 FAIL  validate-ui-copy     ... the child's own words, verbatim ...
1 validator(s) failed.
1
$ node scripts/run-validators.mjs; echo $?
1
```

Both fail. The parallel run kept **all six** group lines, in the configured
order, with the failing child's output preserved and `validate-plan`'s REPORT
block still printed.

## 4. What was deliberately NOT done

- **No affected-check selection.** AB-15 step 4 says measure it in shadow mode
  first; nothing in this card decides to skip a check based on what changed,
  and no check was removed.
- **No ratchet was weakened, no test omitted, no timeout raised.** The plan
  passes `--max 46 --max-buried 44` exactly as the serial gate did, asserted in
  `scripts/gate-plan.test.mjs` against the config rather than against a copy.
- **`validate:serial` is kept** as `pnpm validate:serial`. It is the baseline
  the equivalence claim above is made against, and a claim whose baseline has
  been deleted cannot be rechecked.

## 5. The one exclusion, added later (W23-22)

CI used to run `validate-plan` and `validate-traceability` by hand and nothing
else, so `validate-ui-copy`, `validate-exports` (ratchets and all) and
`validate-volatile-paths` were enforced by Law 3 on a laptop and by no machine
at all. CI now runs the same `pnpm validate` this document measures.

That collided with the `history-secrets` job, which runs the same scanner with
`--verify-remote-refs` — the one network call in it, CI-only because a local
gate stays offline (Law 9). Two runs of one check with different arguments is
the shape of drift that made the serial gate enforce 49 against a measured 47,
so the CI validators job names the exclusion instead:

```yaml
env:
  DOKIMA_GATE_SKIP: validate-history-secrets
```

`DOKIMA_GATE_SKIP` is deliberately a poor bypass. It takes validator names, not
patterns; an unknown name **fails** rather than silently running the full set
(the typo `validate-histroy-secrets` exits 1); a skipped check is printed in the
results and counted in the summary line (`all 5 validators clean, 1 skipped`),
so no green run hides which check did not run. Three fixtures in
`scripts/gate-plan.test.mjs` hold those properties, including that the survivors
keep their ratchet arguments — a skip must not quietly become a second,
argument-less configuration of the checks it did not skip.

Timing is unchanged: skipping one of six saves nothing worth reporting, and
speed was never the reason for it.
