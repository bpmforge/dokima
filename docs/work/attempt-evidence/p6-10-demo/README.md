# P6-10 live demo — a complete product, built by the pipeline (2026-08-31)

**Verdict: `PRODUCT PROVEN — every requirement closed, seams resolve, verify green` (exit 0).**

A scratch product ("Answer CLI", 2 user stories) was driven end-to-end by
`node scripts/product-loop.mjs --engine berths --repo <target>`:

1. **GAP** — the loop derived US-1/US-2 from the target's own SRS; board empty.
2. **PROPOSE** — PRD-/PRF-/LT- rows written through the `add-ticket` VERB
   (never a direct DB write); the verb's LANE_SCOPE invariant refused two
   malformed generations loudly (see defects below).
3. **DRIVE** — `run start --berths 1` (executeBuildRun → runBerths →
   GlobalBerthGovernor → landClaimedTicket) claimed each ticket and ran a
   REAL external agent (`claude -p`, Haiku) in a per-ticket worktree.
4. **TRUST BOUNDARY, observed working** — the engine re-ran verify itself
   and refused manifests whose claims it could not reproduce ("manifest
   claimed exit 0 — never trusted"); refused uncommitted manifest files;
   refused stale-base worktrees; parked with evidence after the 2-attempt
   ladder. 8 stories + 6 long-tail tickets landed only when actually green.
5. **HUMAN VERBS** — accept (maker ≠ verifier) and branch integration were
   performed by hand and are recorded as such. The integration step
   exhibited exactly the add/add conflicts and helper-drift that
   feature-grouped landing (P6-02/P6-05/P6-06) exists to remove.
6. **EXIT** — the closing measure: 2 requirements closed by tracked tests
   naming their ids, long-tail wave landed, verify green → PRODUCT PROVEN.

Real defects found BY the runs and fixed in this branch:

- plain-node `.js`-specifier imports in the board bridge (P6-09 class);
- proposals carried THIS repo's verify command instead of the target's;
- `generateLongTailWave` rows had empty write_scope (verb refused), then a
  cross-lane-overlapping lane (FR-T3 refused) — both fixed with the verb as
  the oracle;
- the DB board plane dropped `long_tail` (LT- id prefix is now the mapping).

Known limits, stated: the reviewer model was unrouted (machine review
skipped — external-agent mode); PRF-US-1/2 became redundant once the PRD
work carried its own tests and remain parked-in-Ready; one parked branch
(LT-LT-01, first pass) was merged by the human integrator before its
retry landed — the retry's landed version superseded it.
