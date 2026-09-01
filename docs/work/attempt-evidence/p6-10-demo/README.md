# P6-10 live demo — a complete product, built by the pipeline (2026-08-31)

A scratch product ("Answer CLI", 2 user stories) driven end-to-end by
`node scripts/product-loop.mjs --engine berths --repo <target>` with the
REAL berths engine and a REAL external agent (`claude -p`, Haiku).

## The two closing measures (exact commands: closing-measures.txt)

- **Measure A** (pre-Challenger code): `PRODUCT PROVEN — every requirement
closed, seams resolve, verify green`, exit 0. The seam clause was VACUOUS
  (no seam model on the DB board plane — now stated by the code itself),
  and the long-tail clause was satisfied by LT-* NAMING.
- **Measure B** (after the wave-2 Challenger fixes): `NOT DONE` with exactly
  one named gap — the long-tail wave must now be DECLARED (`[long-tail:B-1]`
  acceptance tag written by the loop), not name-guessed. The requirement
  closure (US-1, US-2 → tracked tests naming them: proving-tests.txt) and
  the verify clause (`node --test apps/`, 13/13, recorded in the ledger's
  `verify_command`) still hold. **The ratchet got stricter and the verdict
  got honester; both measures are preserved verbatim.**

## What the runs proved (preserved logs: run4/5/7/8.log; DB quotes:

## trust-boundary-refusals.txt; final repo state: final-state.txt)

- 9 landings by the real agent across the preserved runs: PRF-US-2 (run4),
  PRD-US-2 + PRD-US-1 (run5), LT-LT-02..06 (run7), LT-LT-01 (run8). Runs
  1–3 were discarded bootstraps (env/, verify- and permission-probing) and
  carry their own logs in the session scratchpad only.
- The trust boundary refused, with evidence rows in the event log: manifests
  whose verify claims it could not reproduce ("never trusted"), manifest
  files absent from the real diff, stale-base worktrees, and empty or
  cross-lane write_scopes (FR-T3) — each one either fixed a generator or
  parked a ticket with its reason.
- Human verbs stayed human: accepts by a distinct actor; branch integration
  by hand — whose add/add conflicts and helper drift are the measured
  argument for the feature-grouped landing chain (P6-05 + P6-11).

## Defects found BY the runs and fixed on this branch

plain-node `.js`-specifier imports in the board bridge (P6-09 class) ·
proposals carried this repo's verify command (now: the TARGET's, refused
without it) · long-tail rows with empty write_scope, then FR-T3 lane
overlap, then name-guessed classification (now a declared tag) · cross-
plane combos refused (`--repo` without `--verify-cmd`; conductor engine
with `--repo`) · target runs no longer clobber this repo's ledger.

## Known limits, stated

Reviewer model unrouted (external-agent mode skips machine review by
design). PRF-US-1/2 parked-in-Ready, redundant once the PRD work carried
its own tests — retiring a PRF whose requirement closed is P6-12's scope.
