# Shipwright — Roadmap & wave exit criteria

Waves map 1:1 to `plan.json` ticket prefixes. Gate rule (PLAYBOOK.md): wave
N+1 starts only when wave-N exit criteria pass and are recorded in
STATUS.md. Points total: 301 across 75 tickets (design review 2026-07-14: P1 added W0-09, W2-09, W3-10/11/12, W4-09, W6-07, W8-06; P3 adoption added W5-10/11, moved W8-03→W3-13 (AM-2), widened W3-08 to 8pts for D-014 — DESIGN_REVIEW.md + IMPROVEMENT_RECOMMENDATIONS.md).

| Wave | Theme | Tickets | Pts | Exit criteria |
|---|---|---|---|---|
| **W0** | Skeleton & trust core | W0-01…09 | 35 | A board that cannot lie, moved by CLI: verbs enforce WIP=1/lanes/deps; close requires manifest+verify+commits; receipts verify two-way; hash chain checks; crash leaves nothing stuck `running`. Red fixtures: spoofed lock, fabricated receipt, stale hash all FAIL. |
| **W1** | Loop engine + content | W1-01…07 | 29 | Full expert/validator library imported with provenance (D-011); toy-project E2E green end-to-end with a fake model: claim→micro-loop→manifest→out-of-session verify→close→accept-by-second-identity; fabricated manifest and self-accept refused. |
| **W2** | Model gateway | W2-01…09 | 35 | All six provider adapters pass contract suites on recorded fixtures (Copilot + Vertex included, D-007); matrix + ladder + breakers work against the fake endpoint; fitness cards produced for a fake good/bad model pair. |
| **W3** | Harbormaster | W3-01…13 | 49 | Unattended run over a fixture board completes with breakpoints ticket/wave/never; a simulated provider-limit window parks and auto-resumes the run (FR-G8); berths=3 run produces zero write-scope collisions (property test); watchdog kills a hung session; resume refuses on manufactured state drift; NEVER-AUTO items land in the queue, other lanes continue; planted key in a diff blocks close (W3-13); finding ledger enforces D-014 shadow/suppression semantics with red fixtures (W3-08). |
| **W4** | Canvas & Fleet | W4-01…09 | 39 | Two fixture projects visible on Fleet; board lag <1s; drag-refusals explained; Decide/Review/Record enforced at API level; aggregated morning queue reviewable; dry-run estimate within ±30% of a replayed fixture run. |
| **W5** | Pipeline & PM | W5-01…11 | 49 | Full program runs on the sample idea against a local model in <15 min: interview → blueprint + slates → DECISIONS.md → decomposition → build → morning queue; phase receipts verify; challenger contradicts a planted false claim and forces revision; SKIPPED required units fail the phase gate; a fixture snapshot yields a deterministic ranked improvement plan whose accepted item mints a ticket and whose regression flips on the next snapshot (W5-10/11). |
| **W6** | Integrations | W6-01…07 | 28 | GitHub + Gitea adapters green on fixtures; mirror write-through with two identities; reviewer token unreachable from an agent session (test-proven); reconciliation catches an induced drift; MCP tool call round-trip audited; dual-remote parity validator red on induced divergence. |
| **W7** | Memory & learning | W7-01…05 | 21 | Recall provably fires inside a micro-loop (the anti-Jarvis-gap test); R0 hit skips a model call in a fixture; consolidation runs on schedule; a verified lesson changes run N+1 behavior in a two-run fixture. |
| **W8** | Hardening & dogfood | W8-01/02/04/05/06 | 16 | **The 1.0 gate:** Shipwright onboards itself, runs its own security cluster, publishes receipts under docs/dogfood/; planted key blocks a close; export/import round-trips with chain verification; npx install works on a clean macOS/Linux machine + WSL smoke. |

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
