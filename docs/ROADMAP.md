# Shipwright — Roadmap & wave exit criteria

Waves map 1:1 to `plan.json` ticket prefixes. Gate rule (PLAYBOOK.md): wave
N+1 starts only when wave-N exit criteria pass and are recorded in
STATUS.md. Points total: 258 across 62 tickets.

| Wave | Theme | Tickets | Pts | Exit criteria |
|---|---|---|---|---|
| **W0** | Skeleton & trust core | W0-01…08 | 32 | A board that cannot lie, moved by CLI: verbs enforce WIP=1/lanes/deps; close requires manifest+verify+commits; receipts verify two-way; hash chain checks; crash leaves nothing stuck `running`. Red fixtures: spoofed lock, fabricated receipt, stale hash all FAIL. |
| **W1** | Loop engine + content | W1-01…07 | 29 | Full expert/validator library imported with provenance (D-011); toy-project E2E green end-to-end with a fake model: claim→micro-loop→manifest→out-of-session verify→close→accept-by-second-identity; fabricated manifest and self-accept refused. |
| **W2** | Model gateway | W2-01…08 | 32 | All six provider adapters pass contract suites on recorded fixtures (Copilot + Vertex included, D-007); matrix + ladder + breakers work against the fake endpoint; fitness cards produced for a fake good/bad model pair. |
| **W3** | Harbormaster | W3-01…06 | 24 | Unattended run over a fixture board completes with breakpoints ticket/wave/never; berths=3 run produces zero write-scope collisions (property test); watchdog kills a hung session; resume refuses on manufactured state drift; NEVER-AUTO items land in the queue, other lanes continue. |
| **W4** | Canvas & Fleet | W4-01…08 | 36 | Two fixture projects visible on Fleet; board lag <1s; drag-refusals explained; Decide/Review/Record enforced at API level; aggregated morning queue reviewable; dry-run estimate within ±30% of a replayed fixture run. |
| **W5** | Pipeline & PM | W5-01…09 | 41 | Full program runs on the sample idea against a local model in <15 min: interview → blueprint + slates → DECISIONS.md → decomposition → build → morning queue; phase receipts verify; challenger contradicts a planted false claim and forces revision; SKIPPED required units fail the phase gate. |
| **W6** | Integrations | W6-01…06 | 25 | GitHub + Gitea adapters green on fixtures; mirror write-through with two identities; reviewer token unreachable from an agent session (test-proven); reconciliation catches an induced drift; MCP tool call round-trip audited; dual-remote parity validator red on induced divergence. |
| **W7** | Memory & learning | W7-01…05 | 21 | Recall provably fires inside a micro-loop (the anti-Jarvis-gap test); R0 hit skips a model call in a fixture; consolidation runs on schedule; a verified lesson changes run N+1 behavior in a two-run fixture. |
| **W8** | Hardening & dogfood | W8-01…05 | 18 | **The 1.0 gate:** Shipwright onboards itself, runs its own security cluster, publishes receipts under docs/dogfood/; planted key blocks a close; export/import round-trips with chain verification; npx install works on a clean macOS/Linux machine + WSL smoke. |

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
