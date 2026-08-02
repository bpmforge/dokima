# Dokima — Non-Goals

Traces to: `docs/BLUEPRINT.md` (§1.3, §10, §11) and founder decisions D-001, D-005,
D-008, D-009. Each non-goal is binding for v1 unless a founder decision amends it.
IDs N-x are citable from SCOPE.md, RISKS.md, and requirements docs.

| ID | Non-goal | Rationale (one line) |
|----|----------|----------------------|
| N-1 | **Not an IDE.** No editor, no inline completions, no language server. | The inner loop belongs to Cursor/VS Code/Claude Code-class tools; Dokima is the out-of-session conductor and board (COMPETITIVE_ANALYSIS.md) — the artifact viewer renders docs/diffs, it does not edit code. |
| N-2 | **Not a general chat assistant.** Chat exists only as the program thread and ticket-scoped agent threads. | Every conversation is bound to a project, phase, or ticket with provenance and cost (BLUEPRINT §3.1.1); free-floating "ask me anything" chat dilutes the trust model and the attention budget. |
| N-3 | **Not a CI/CD system.** No build farm, no deploy pipelines, no runners. | The sandbox runs verify commands and test suites to mint receipts (SCOPE.md S-25); building/deploying at scale is CI's job — Dokima observes and gates, deploys stay NEVER-AUTO human actions (C-5). |
| N-4 | **Not a cloud SaaS at v1.** No hosted tenant, no accounts service, no telemetry-by-default. | D-003/C-1: local-first single-operator product with one SQLite file per project; multi-user with SSO is the explicit v2 horizon (D-005, SCOPE.md S-40), pre-committed in schema only. |
| N-5 | **Not a model host.** No bundled weights, no inference serving. | The Model Gateway routes to LM Studio/Ollama/OpenAI-compatible local endpoints and cloud APIs (D-007); hosting inference is a different product with different hardware economics. |
| N-6 | **Not a forge.** No git hosting, no PR implementation of our own. | Git service + forge adapters (GitHub/Gitea) integrate what exists (S-23); the native board mirrors to forge issues (D-004), it does not replace the forge. |
| N-7 | **No live umbilical to internal repos.** No build-step dependency on bpm-opencode-experts. | D-008: one-time snapshot import into `content/` with provenance headers (S-7); afterwards two-way ordinary PRs between peers — a product clonable by strangers cannot depend on a private lab. |
| N-8 | **No Windows-native support at v1.** | D-009: WSL is the supported Windows path at 1.0 (NFR-7); native is post-v1 (SCOPE.md S-41). |

## How to use this file

- A requirement or ticket that implements an N-x item is invalid — reject at review.
- Graduating a non-goal (e.g. N-4 → hosted offering) requires a founder decision in
  the DECISIONS ledger plus updates here and in SCOPE.md, not a silent ticket.
- N-x boundaries are also Challenger inputs: a design claim that quietly crosses one
  should be CONTRADICTED at the phase gate.
