# Shipwright — Decisions Ledger

Founder decisions, ADR-lite. Stable IDs; downstream docs cite IDs instead of
restating. Do not re-litigate without a new entry superseding the old one.
(This file is itself the dogfood of FR-P6 decision slates.)

| ID | Date | Decision | Options considered | Rationale |
|---|---|---|---|---|
| D-001 | 2026-07-10 | Name: **Shipwright** | AgentForge, Conductor, Foundry, LoopWorks, Cofoundry, Greenlight, ProductForge | Idea→product framing over agent framing (founder). Collision: shipwright.io (CNCF image builds) — different domain; naming pass required before public launch. |
| D-002 | 2026-07-10 | **Blueprint-first delivery**: founding SRS+architecture blueprint reviewed and decision-complete before the SDLC package is cut | Full package immediately; blueprint as chat response only | One review of a 20-page blueprint prevents a hundred mis-aimed tickets. Productized as FR-P7 (Phase 2.5). |
| D-003 | 2026-07-10 | **Local-first web app**: Node 22/TS/Fastify core + React SPA + SQLite, single-machine install | Multi-user server from day one; Electron/Tauri desktop app | "Anyone can use" + offline/local-LLM audience; packaging burden deferred. |
| D-004 | 2026-07-10 | **Native ticket engine + optional forge mirror** (per-identity maker/reviewer machine tokens) | Forge-backed board (issues are the board); native-only no mirror | Works offline with no forge; mirror gives the server-side append-only audit ledger and mechanical maker≠verifier when connected. |
| D-005 | 2026-07-10 | **Multi-user → v2 with SSO** (OIDC/SAML). v1 single-operator; identity table carries `kind`/`auth_provider` from W0; API behind auth middleware in single-user mode | Multi-user at v1; never | v2 is an unlock, not a rewrite. |
| D-006 | 2026-07-10 | **Expert content ships open source** | Licensed content packs over open core | Adoption is the goal; moat = trust runtime + compounding playbook. Signed community packs for supply-chain hygiene. |
| D-007 | 2026-07-10 | **GitHub Copilot + Google Vertex AI are MVP providers** (alongside Anthropic/OpenAI/local) | Post-v1 | Corporate first-users already run opencode on employer Copilot/Vertex; parity is the adoption wedge. First-run onboarding paths, not advanced settings. |
| D-008 | 2026-07-10 | **Standalone product**: one-time content import from bpm-opencode-experts into `content/`; port contracts/algorithms (not code) with source test fixtures as conformance suite; consolidate Jarvis's two SDLC drivers into one Pipeline Engine; two-way PRs between peers, no build-step umbilical | Live canonical→generated build dependency; wholesale code port | Must be clonable by strangers; internal repos stay Brad's lab. |
| D-009 | 2026-07-10 | **Windows via WSL at 1.0; native post-v1** | Native at v1 | Packaging/signing burden vs demand. |
| D-010 | 2026-07-10 | **Berths**: user-selectable build concurrency 1–N per project + autorun (breakpoint `never` × berths N); one berth per lane; landing serialized | Sequential-only v1; unbounded parallelism | Lane/write-scope invariant makes N berths provably collision-free; budget breakers aggregate across berths. |
| D-011 | 2026-07-10 | **Full expert system in the box**: entire expert roster + all validators + shared protocols imported at W1; Shipwright is the go-forward home of the expert-system roadmap (amplifier M26–M30 absorbed as native subsystems) | Curated subset; staged import | The library is the product's content; withholding it serves nothing under D-006. |
| D-012 | 2026-07-10 | **Settings scopes**: run > project > global precedence; credentials only in OS keychain via named refs; project settings committable; settings changes are audited events; presets All-local/Hybrid/All-cloud | Single global config; per-project only | Shareable project policy without leaking keys; explainable "why this model?" resolution. |
| D-013 | 2026-07-10 | **Multi-project Fleet**: per-project DB + Harbormaster (state travels with the repo dir); global gateway pool with fair cross-project scheduling + total-berth governor; aggregated morning queue; two-level playbook with explicit promotion only | One global DB; fully isolated apps per project | Several concurrent programs is the normal case; one LM Studio box must survive three autoruns; one ten-minute review for everything. |

## Pending slates (founder input wanted; working assumptions in force)

Raised during Phase 3 design (2026-07-10). Each ships with a documented
working assumption so the build is not blocked; overriding one later is a
normal DECISIONS entry superseding the assumption.

| ID | Question | Working assumption (in docs) |
|---|---|---|
| P-001 | Chat thread persistence: full verbatim transcript replay, or render-from-events with summarized packets? | Render-from-events; packets summarized, not stored verbatim (API_DESIGN/DATABASE) |
| P-002 | Acceptance authority split: may a machine reviewer identity `accept` tickets, with only merges human-gated? | Machine `accept` allowed (reviewer≠owner); merge to main human-only (NEVER-AUTO) |
| P-003 | Credential storage on headless/WSL where no OS keychain exists? | Encrypted-file fallback behind `SHIPWRIGHT_NO_KEYCHAIN` (DEPLOYMENT) |
| P-004 | Process model for many projects: one core serving N projects, or one process per project? | One core, N projects — **canonicalized as part of D-013** (no longer pending) |
| P-005 | Early version pins (zod 4 vs 3, pnpm 10 vs 9)? | zod 4 + pnpm 10 with trap notes (TECH_STACK); revisit free at W0-01 |

## Constraints bound to decisions

- C1 Local-first, offline-capable (D-003)
- C2 Agent sessions untrusted; platform holds the gates
- C3 Receipts required for every state transition; no promise tokens
- C4 Maker ≠ verifier, mechanical (identities, models, credentials)
- C5 NEVER-AUTO list immutable in-product
- C6 SQLite single-writer event log per project (D-013)
- C7 Open content (D-006)
- C8 No build-step dependency on internal repos (D-008)
