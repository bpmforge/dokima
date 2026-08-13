# Dokima — Roadmap & wave exit criteria

Waves map 1:1 to `plan.json` ticket prefixes. Gate rule (PLAYBOOK.md): wave
N+1 starts only when wave-N exit criteria pass and are recorded in
STATUS.md. Points total: **781 across 204 tickets** (recounted from
`plan.json` 2026-08-13 — and this is the second time this line has been
wrong in the same direction, so read the recount, not the prose. The
2026-07-30 pass corrected "329 across 84" to "409 across 114" and fixed
five drifted rows; two weeks later it had drifted further and worse:
**the entire W10 wave — 60 tickets, 268 points, the largest in the
project — was absent from the table**, W9's row said 12 tickets/29pts
against a real 16/46, and W11's said `W11-01…05`/24pts against a real
`W11-01…23`/81. Both were written when the wave was filed and never
updated as it grew. The lesson the 2026-07-30 note already drew is
evidently not enforced by anything: **this table is hand-maintained and
`plan.json` is authoritative** — recount before citing it, and treat a
row's ticket range as the range at filing time unless its wave is closed.) Design-review deltas: P1 +8 tickets (gap register); P3 adoption (W3-13 move, W5-10/11, W3-08 widened); P4/P5 (W3-01a/b/c split per F1, W3-14 FR-T6, stories[] linkage); challenger pass +W3-15 (G-25 resume-prep), +W3-16 (D-018 engine — W2-06 amendment reverted for board honesty), +W4-11 (API mechanics), +W4-12 (palette/drawer/a11y gate). Full trail: DESIGN_REVIEW.md + IMPROVEMENT_RECOMMENDATIONS.md. (design review 2026-07-14: P1 added W0-09, W2-09, W3-10/11/12, W4-09, W6-07, W8-06; P3 adoption added W5-10/11, moved W8-03→W3-13 (AM-2), widened W3-08 to 8pts for D-014 — DESIGN_REVIEW.md + IMPROVEMENT_RECOMMENDATIONS.md).

| Wave | Theme | Tickets | Pts | Exit criteria |
|---|---|---|---|---|
| **W0** | Skeleton & trust core | W0-01…09 | 35 | A board that cannot lie, moved by CLI: verbs enforce WIP=1/lanes/deps; close requires manifest+verify+commits; receipts verify two-way; hash chain checks; crash leaves nothing stuck `running`. Red fixtures: spoofed lock, fabricated receipt, stale hash all FAIL. |
| **W1** | Loop engine + content | W1-01…07 | 29 | Full expert/validator library imported with provenance (D-011); toy-project E2E green end-to-end with a fake model: claim→micro-loop→manifest→out-of-session verify→close→accept-by-second-identity; fabricated manifest and self-accept refused. |
| **W2** | Model gateway | W2-01…09 | 35 | All six provider adapters pass contract suites on recorded fixtures (Copilot + Vertex included, D-007); matrix + ladder + breakers work against the fake endpoint; fitness cards produced for a fake good/bad model pair. |
| **W3** | Harbormaster | W3-01a…17 | 62 | Unattended run over a fixture board completes with breakpoints ticket/wave/never; a simulated provider-limit window parks and auto-resumes the run (FR-G8); berths=3 run produces zero write-scope collisions (property test); watchdog kills a hung session; resume refuses on manufactured state drift; NEVER-AUTO items land in the queue, other lanes continue; planted key in a diff blocks close (W3-13); finding ledger enforces D-014 shadow/suppression semantics with red fixtures (W3-08). |
| **W4** | Canvas & Fleet | W4-01…13 | 55 | Two fixture projects visible on Fleet; board lag <1s; drag-refusals explained; Decide/Review/Record enforced at API level; aggregated morning queue reviewable; dry-run estimate within ±30% of a replayed fixture run. |
| **W5** | Pipeline & PM | W5-01…22 | 78 | Full program runs on the sample idea against a local model in <15 min: interview → blueprint + slates → DECISIONS.md → decomposition → build → morning queue; phase receipts verify; challenger contradicts a planted false claim and forces revision; SKIPPED required units fail the phase gate; a fixture snapshot yields a deterministic ranked improvement plan whose accepted item mints a ticket and whose regression flips on the next snapshot (W5-10/11). |
| **W6** | Integrations | W6-01…08 | 31 | GitHub + Gitea adapters green on fixtures; mirror write-through with two identities; reviewer token unreachable from an agent session (test-proven); reconciliation catches an induced drift; MCP tool call round-trip audited; dual-remote parity validator red on induced divergence. |
| **W7** | Memory & learning | W7-01…06 | 26 | Recall provably fires inside a micro-loop (the anti-Jarvis-gap test); R0 hit skips a model call in a fixture; consolidation runs on schedule; a verified lesson changes run N+1 behavior in a two-run fixture. |
| **W8** | Hardening & dogfood | W8-01/02/04…10 | 29 | **The 1.0 gate:** Dokima onboards itself, runs its own security cluster, publishes receipts under docs/dogfood/; planted key blocks a close; export/import round-trips with chain verification; npx install works on a clean macOS/Linux machine + WSL smoke. |
| **W9** | Post-1.0 quality & harness portability | W9-01…16 | 46 | Filed 2026-07-23 after the 1.0 dogfood gate, so it carries no pre-planned exit criteria: W9-01…05 close UI acceptance findings, W9-06/07 wire the phase gate to real validator runs and receipts, W9-08 fixes the validator output contract, and W9-09…12 make the conductor drivable against a repo other than this one (scripts/ under lint+test, configurable board path, byte-preserving board writes, no undeclared config dependency). **Wave complete.** (Corrected 2026-08-13: this row read "complete except W9-08, blocked on a content re-sign" long after that stopped being true — W10-50 landed the local-override registry that unblocked it and W9-08 is `done` on the board. The ROADMAP has now been caught contradicting `plan.json` twice; check the board before repeating a claim from this table.) |
| **W10** | Product surface & first real runs | W10-01…80 | 268 | **Added to this table 2026-08-13 — it had been missing entirely since the wave opened**, which is how a 60-ticket/268-point wave (the largest in the project, larger than W3+W4 combined) stayed invisible to anyone reading the roadmap instead of the board. Filed incrementally from live use rather than planned up front, so like W9 it carries no pre-planned exit criteria; the honest summary of what it did: the Providers/Settings surfaces and the model-matrix resolver (W10-04/05, W10-62/64/68/70), the content re-import at upstream `attest` v3 with a local-override registry (W10-50/51), the harbormaster engine actually exported and wired so `run start` drives a real loop (W10-77/78/79), paused runs that resume without re-running the blueprint (W10-67/72), the morning queue able to surface and make a waiting decision (W10-73/80), and the creation pipeline moved off a held HTTP request onto a background job (W10-58). Ticket ids run to W10-80 with gaps — filed ids were never contiguous. |
| **W11** | Dokima's own agent | W11-01…23 | 81 | **D-023.** Dokima stops delegating inference to a foreign CLI and runs its own tool-using ticket session through the gateway, so the role→model matrix (FR-G2), the R0–R4 ladder (D-018), the budget breakers (W2-07) and spend metering actually govern the work — none of which a shelled-out agent honours. **Exit criteria:** (1) `ChatRequest` carries a tool schema and the oai-compat adapter round-trips `tool_calls` against a fake gateway AND a real local model; (2) a native `SpawnSession` completes a real ticket end to end on a local model, producing a Completion Manifest the existing close gate accepts, with SC-17 refusing an out-of-scope write BEFORE it happens and SC-01 still catching it independently afterwards; (3) every call is metered — the run's spend ledger is non-zero and attributable per role; (4) T-26 has a red fixture (repo content carrying an injected instruction cannot produce an out-of-scope write). **W11-05 comes first and is already claimable**: a challenge pass found the §4 import matrix, the packages' declared dependencies and a load-bearing comment in `session.ts` all disagreeing about what `loop` may import — and that disagreement is what put the first draft of this design in the wrong module. The external CLI remains as `--agent-command`, demoted to an escape hatch. |
| **W12** | Maintenance & unfiled-finding intake | W12-01…03 | 6 | Opened 2026-08-13. **No pre-planned exit criteria, and that is deliberate rather than an omission** — this wave is an intake lane for defects found outside a planned wave, written the way W9's row was after the fact. Contents so far: W12-01 (a `DEFAULT_PORT` constant declared twice, so changing the port is a two-file edit no gate can see), and W12-02/03, the two `medium[]` findings from `docs/work/SECURITY_W11f.md` that were never carried onto the board when that pass's CRITICAL and HIGH became W11-20. **The intake gap is the wave's real subject:** per-wave security docs are written once and nothing re-reads them, so a finding below the fold expires quietly. W12 closes when its tickets close; if it grows past a handful, that is evidence the intake needs a process step, not a bigger wave. |

## Resume preconditions (RELEASE_TRACKER F3 + review)

**Historical — all three were met and W3 closed long since (W3-01a…17 all
`done`).** Kept for the audit trail; precondition (2) was finally generalized
by W3-15 on 2026-07-28, which moved supervise.sh's Node pin (and its branch
prefix and worktree dir) into `conductor.config.json` rather than hardcoding.

W3 work may not start until: (1) bpm-opencode-experts resync executed
(`node scripts/import-content.mjs`, SW-R1) against the CURRENT release
(v2.10.0+ — v2.1.0 shipped 2026-07-13; loop-classifier mechanics changed in
v2.4.0), content coverage re-audited + re-signed at W6-07; (2) supervise.sh
Node pin fixed to .nvmrc resolution (G-25 — it hardcodes v24 and ABI-breaks
better-sqlite3); (3) trust-core lane (W3-01a/b/c) human-pair review per F2.

## Sequencing notes

- W0-06 (git), W0-07 (config), W1-01 (content) have no W0-core deps — good
  parallel starters alongside W0-02.
- The lane column in plan.json is the parallelism contract: `core`,
  `engine`, `gateway`, `orchestrator`, `ui`, `pipeline`, `integrations`,
  `memory`, `infra`, `content`, `quality` — one in-progress ticket per lane.
- §12 backlog items 4–8 of the blueprint (trace viewer, secrets vault,
  lessons intake, export) are already ticketed in W7/W8; starter archetypes
  and community pack signing are post-1.0 backlog, tracked in BLUEPRINT §12.

## Post-1.0 horizon (not ticketed)

v2: multi-user + SSO (D-005), Windows-native (D-009), naming/trademark pass
(D-001), starter archetypes, signed community content packs, plugin
marketplace exploration.
