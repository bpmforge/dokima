# Dokima Playbook — ticket execution discipline

Companion to `MASTER_PROMPT.md`. That file says *what governs you*; this one
says *how a ticket flows*. Ticket board: `plan.json` (schema note at top).

## Wave order and gates

Waves follow `docs/ROADMAP.md` (W0 trust core → W8 dogfood). **Gate rule**:
no ticket from wave N+1 starts until the wave-N exit criteria in ROADMAP.md
pass and are recorded in `docs/STATUS.md`. Exceptions: W0-* infra tickets
are always claimable; W1-01 (content import) may run alongside W0.

## Per-ticket loop (the micro-loop)

```
scope read → claim → read design doc(s) → verify external APIs
     → write failing test(s) → implement → acceptance green
     → full gate green → commit → close
```

- **Scope read comes FIRST, and it is where collisions get answered.** Read
  the acceptance against the `write_scope` before claiming: can these files
  satisfy these criteria? On this board they often cannot — the filed scope
  named a parser that builds nothing (W21-69, W21-73), a file that had been
  dead since W10-74 (W22-01), a surface in `apps/web` from a server-only scope
  (W21-90). Answer it **now**, both ways: widen when the file is unowned and
  this acceptance needs it, or file the ticket when the work is beyond this
  acceptance. Not at close — five deferrals written at close in one session
  were filed nowhere (L-57), and the close note is the moment of least
  remaining attention.

- **Tests first where testable-first**: ticket-lifecycle invariants,
  lane/glob collision, receipt verification, calibration clamp, hash chain,
  projection rebuild-equals-incremental. These are property tests
  (fast-check) per docs/TESTING.md.
- **Red fixtures are acceptance** on every gate-bearing ticket (W0-05,
  W1-02, W3-01, W5-04, W8-03…): the planted-defect harness must show the
  gate FAILING against spoofed input. A gate that can't fail can't be
  trusted to pass.
- **Conformance suite** (D-008): when porting micro-loop / coverage /
  ticket semantics, adapt the source-system fixtures referenced in
  `docs/research/` — behavior parity, not code copying.
- **Recorded fixtures, not live APIs**: CI never hits a provider or forge.
  Every adapter gets contract tests against recorded responses (including
  auth-failure, rate-limit, truncation, and stream-abort cases).
- **Micro-commits**: commit at each stable point. Never leave the tree red
  overnight.
- **Schema changes** (events/projections): migration + rebuild proof
  (projections regenerate from the log) + backup-first note in
  docs/DEPLOYMENT.md if user-visible.

## Testing tiers (from docs/TESTING.md)

| Tier | Runs | Gate |
|---|---|---|
| Unit (vitest) + property/invariant tests | every commit (CI) | must pass |
| Conformance suite (source-system fixtures) | every commit | must pass |
| Adapter contract tests (recorded fixtures) | every commit | must pass |
| API integration (Fastify inject + temp SQLite) | every commit | must pass |
| Planted-defect gate-integrity harness | every commit from W0-05 on | all attacks must FAIL |
| Playwright e2e (fake-model gateway) | pre-merge on web tickets + nightly | must pass |
| Model-fitness bench fixtures | pre-wave-gate from W2 on | regression blocks gate |

## Git

- Branch per ticket: `feat/<ticket-id>-<slug>` off `main`; merge back with
  `--no-ff` after gates pass. Small doc-only fixes may go straight to main.
- Stage explicit paths; never `git add -A`.
- Push after every merged ticket: `git push origin main && git push github main`
  (origin = Gitea, may be offline off-LAN — push github always; sync origin
  when reachable).
- Commit trailer: `Co-Authored-By:` line naming your model.

## Status reporting

After each merged ticket append one line to `docs/STATUS.md`:
`2026-07-12 W0-02 done — <one-line result, test counts>`. At wave gates,
write a short gate section (criteria → evidence). This file is how humans
resume the project cold.

## Wave-gate coverage loop (Ralph Wiggum) + challenger

Pattern: bpm-opencode-experts RALPH_WIGGUM_LOOP / CHALLENGER_PROTOCOL, adapted
for this board. Run at every wave gate before its STATUS.md entry:

1. **INVENTORY** — enumerate the wave's tickets + every FR/NFR/story they cite;
   `node scripts/validate-traceability.mjs` prints the map.
2. **VERIFY (objective, never vibes)** — run ALL validators
   (`validate-plan.mjs`, `validate-traceability.mjs`, full pnpm gate) plus the
   wave's ROADMAP exit criteria plus TESTING.md's rule that every FR acceptance
   sketch in the wave maps to a named test (grep FR ids in test titles).
3. **GAP** — each uncovered row gets ONE focused `HANDOFF:` note in its
   ticket's notes. Fix only flagged rows; never re-run the whole wave.
4. **Repeat, cap 3.** Byte-identical gap set two iterations running =
   no progress → halt and escalate to the user. Never loop past the cap.

**CHALLENGER (before the gate entry lands):** a fresh session/agent — never
one that implemented a ticket in this wave (maker ≠ verifier) — re-derives
each exit criterion from the docs and tries to REFUTE the evidence. Every
accepted criterion records `re-ran independently: <command, counts, exit
code>`. CONTRADICTED evidence reopens the ticket. UNVERIFIABLE criteria are
listed in the gate entry, never waived silently. Only then does the gate
section land in docs/STATUS.md.

## Refusal conditions (stop and ask the user)

- A ticket seems to require weakening the trust boundary (state change
  without receipt, completion by string match, maker==verifier "just for
  tests", secrets in a settings file).
- Acceptance criteria conflict with a founder decision in
  `docs/DECISIONS.md` or a constraint in `docs/CONSTRAINTS.md`.
- You need a dependency not in `docs/TECH_STACK.md` (propose it in notes
  first).
- A change would make CI depend on a live network service.
