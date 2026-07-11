# Shipwright — Scope

Traces to: `docs/BLUEPRINT.md` (§3, §6, §9, §11, §12) and founder decisions D-003–D-010.
Scope items are numbered **S-x** for traceability; downstream FR-x/NFR-x requirements
and tickets must cite an S-x. Wave mapping follows BLUEPRINT §9.

## In scope — v1

### W0 — Skeleton & trust core

| ID | Item | Trace |
|----|------|-------|
| S-1 | Append-only event log + projections (SQLite WAL, single writer); hash-chained audit trail; actor identity on every event, with `kind: human\|machine` + `auth_provider` columns from day one (v2 pre-commitment). | C-6, D-005, BLUEPRINT §2.3 |
| S-2 | Ticket engine: contract schema (lane, write_scope, depends_on, acceptance, verify), six lifecycle verbs with enforced transition graph, WIP=1, same-lane write-scope disjointness, reflow/claimable recompute. | C-3, C-4, D-004, FR-T1–T4 |
| S-3 | Receipt primitive: gate receipts, close receipts, waiver receipts (human-signed only); receipt re-validation (input hash + validator-set currency). | C-3, FR-P1/P2 |
| S-4 | Git worktree service: per-ticket worktrees + branches, explicit-path staging. *W0 exit: a board that cannot lie, moved by CLI.* | FR-I1 |

### W1 — Loop engine

| ID | Item | Trace |
|----|------|-------|
| S-5 | Per-item micro-loop (criterion → produce → evidence → self-verify → revise → exit), anchors (tool/memory/challenger/adaptive budget), clamped rescue-only calibration. | FR-L1–L3 |
| S-6 | Coverage tracker: DONE/WAIVED/BLOCKED/FAILED/SKIPPED; end-of-phase COVERAGE_REPORT as gate input. | FR-L4 |
| S-7 | Validator runner (executable contract: exit 0/1 + JSON gaps) + one-time snapshot import of expert definitions, validator packs, and protocols into `content/` with provenance headers — no ongoing build-step dependency. | C-7, C-8, D-006, D-008 |

### W2 — Model gateway

| ID | Item | Trace |
|----|------|-------|
| S-8 | Provider adapters: Anthropic, OpenAI, **GitHub Copilot** (device-auth), **Google Vertex AI** (ADC/service-account) as first-run onboarding paths; LM Studio, Ollama, OpenAI-compatible local endpoints. Discovery, warm-up, queueing, usage metering. | D-007, FR-G1 |
| S-9 | Role→model matrix with fallback chains + task-type routing; maker model ≠ reviewer model by default; escalation ladder R0–R4, evidence-triggered, ledgered; soft-gate waivers on phases 0–3 only. | C-4, FR-G2/G3/G5 |
| S-10 | Budget service: per-run/per-project budgets, 70/85/100% breakers, hard stop at ticket boundary, per-model spend history. | FR-G4 |
| S-11 | Model fitness check: planted-defect harness producing a fitness card per (model, role) before matrix assignment. | BLUEPRINT §12.1 |

### W3 — Harbormaster

| ID | Item | Trace |
|----|------|-------|
| S-12 | Unattended ticket loop with out-of-session gate execution; fresh session per ticket; session cap, watchdog, dead-letter escalation. | C-2, FR-H1/H2 |
| S-13 | Breakpoints (ticket/wave/never), global pause, idempotent receipt-based resume refusing on state drift; morning-review queue for NEVER-AUTO actions. | C-5, FR-H3/H4 |
| S-14 | **Berths 1–N** (D-010): per-project concurrency dial, one berth per lane, per-berth worktrees/identities, serialized landing, aggregate budget breakers; autorun = breakpoint `never` × berths N. | D-010, FR-H5 |

### W4 — Canvas

| ID | Item | Trace |
|----|------|-------|
| S-15 | Three-pane React SPA over live projections: chat workspace (structured cards, provenance, cost per turn), Kanban board (verbs fired by drag, refusals explained), artifact viewer (markdown, live diffs, Mermaid, receipt inspector). | D-003, FR-C1–C5 |
| S-16 | Settings matrix (model/role, autonomy dial with immutable NEVER-AUTO list, budget panel) + three-tier notification taxonomy (Decide/Review/Record) enforced at the API level. | C-5, FR-N3/N4 |
| S-17 | Guided first fifteen minutes: built-in sample idea running the full program in miniature on local/cheap models. | BLUEPRINT §12.3 |

### W5 — Pipeline & PM

| ID | Item | Trace |
|----|------|-------|
| S-18 | Six-phase interview-driven program (phases 0–3 human-paced); gate receipts UI; Challenger service (per-claim verdicts, CONTRADICTED forces revision). | FR-P1–P4 |
| S-19 | Decision slates + DECISIONS.md ledger (stable D-00x IDs); Blueprint stage (Phase 2.5) with lock on Phases 3–4 while founder-decision markers remain unresolved. | FR-P6/P7 |
| S-20 | Research path: per-phase cited deliverables in `docs/research/`, quick/standard/deep depth, tiered sources, Challenger verification of HIGH-impact claims, R0 fact bank. | FR-P8 |
| S-21 | Four modes: New Product, Onboard, Feature, Improve. | FR-P5 |
| S-22 | Dry-run cost estimate before autorun (tokens/dollars per wave from ticket sizes + matrix + historical actuals). | BLUEPRINT §12.2 |

### W6 — Integrations

| ID | Item | Trace |
|----|------|-------|
| S-23 | Forge adapters (GitHub, Gitea, generic); optional issue mirror with per-identity maker/reviewer machine tokens (reviewer token never enters an agent session); offline verb queue + flush + reconciliation audit; branch protection on connect; dual-remote sync with parity validator. | C-2, C-4, D-004, FR-T5, FR-I2 |
| S-24 | MCP client host: per-role tool allowlists, requiresApproval flags, audited tool-call events; servers run outside the agent trust boundary. | C-2, FR-I3 |
| S-25 | Execution sandbox: process isolation default, container (Podman/Docker) optional; verify/tests/tool anchors run here. | FR-I4 |

### W7 — Memory & learning

| ID | Item | Trace |
|----|------|-------|
| S-26 | Working + long-term memory in-process (SQLite + FTS5, optional local embeddings, BM25 fallback); token-budgeted assembly. | FR-M1 |
| S-27 | ACE playbook (delta-edits, verified-before-stored) as escalation rung R0; sleep-time consolidation on by default; error-first recall. | FR-M2/M3 |

### W8 — Hardening (the dogfood gate)

| ID | Item | Trace |
|----|------|-------|
| S-28 | Shipwright runs its own pipeline on itself: threat model, security suite, a11y; receipts ship with the 1.0 release. Secrets hygiene lands here at the latest: vault, redaction in packets + event log, secrets-scanner validator on close gates. | NFR-4, BLUEPRINT §9, §12.5 |
| S-29 | Packaging: `npx shipwright` / npm global; config `~/.shipwright/`, project state `.shipwright/`; macOS/Linux first-class, Windows via WSL (D-009). | D-003, D-009, NFR-1/7 |

## Out of scope — v1

Enumerated with rationale in NON_GOALS.md (N-1…N-8). Binding summary: no IDE, no
general chat assistant, no CI/CD system, no cloud SaaS/multi-tenant hosting, no
model hosting, no multi-user auth (D-005), no Windows-native (D-009), no live
build-step dependency on internal repos (D-008).

## v2 horizon (designed-for now, built later)

| ID | Item | Trace |
|----|------|-------|
| S-40 | Multi-user with SSO (OIDC/SAML), per-human identities, role-based rights over the NEVER-AUTO surface (who may merge/deploy). v1 pre-commitments: identity table columns (S-1) and auth middleware running in single-user mode. | D-005 |
| S-41 | Windows-native (no WSL). | D-009 |
| S-42 | Fast-follow candidates from BLUEPRINT §12: session trace viewer (#4), lessons-intake → playbook pipeline (#6), starter archetypes (#7), board export/import (#8). Signed community expert/validator packs (D-006 flywheel). | BLUEPRINT §11.2, §12 |
| S-43 | Public-launch naming pass for the shipwright.io collision (D-001) — pre-launch gate, not a code wave. | D-001, RISKS.md R-4 |

## Change control

Adding an S-x requires updating this file (and NON_GOALS.md if it graduates a
non-goal); no S-x may contradict D-001–D-010 or CONSTRAINTS.md C-1–C-8 without a
founder decision recorded in the DECISIONS ledger.
