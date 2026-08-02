# Dokima — Constraints

Traces to: `docs/BLUEPRINT.md` (§0 honesty invariants, §2.2, §6.2, §11) and founder
decisions D-003–D-010. C-1–C-8 are hard constraints: violations block phase gates,
and no ticket may contradict one without a founder decision in the DECISIONS ledger.

## C-1 — Local-first, offline-capable (hard)

- Full functionality with no network: local models (LM Studio/Ollama/OpenAI-compatible),
  no forge, no cloud APIs (D-003, NFR-1). Cloud providers and forges are
  integrations, never prerequisites.
- One-command install (`npx dokima`); state = one SQLite file per project
  (`.dokima/`) + user config (`~/.dokima/`). No external services required.
- Offline-tolerant integrations: forge-mirror verbs queue locally and flush on
  reconnect (SCOPE.md S-23); nothing blocks on a remote being reachable.
- Platform floor: macOS/Linux native, Windows via WSL at 1.0 (D-009, NFR-7).

## C-2 — Agent sessions are untrusted; the platform holds the gates (hard)

- Agents produce work products (files, diffs, Completion Manifests) inside scoped
  workspaces; **every durable state change** (ticket status, phase advance, board
  moves, merges) is performed by the Harbormaster from outside the session after
  independently re-running the gates (BLUEPRINT §2.2).
- No credential ever enters an agent session that would let it act as the platform:
  reviewer identity and forge tokens live only in the Harbormaster; secrets are
  scrubbed from context packets (NFR-4).
- Completion is never a string an agent can type — no promise tokens; only
  verifiable receipts.
- Agent code executes in the sandbox (S-25): no network by default, container
  profile optional.

## C-3 — Receipts required for all state transitions (hard)

- Gates mint receipts only from real runs: validator names, exit codes, gap counts,
  input-tree hash, timestamp. No gate passes on self-attestation.
- Ticket `close` requires manifest + verify exit 0 + attached commits; `accept`
  requires the close receipt embedded verbatim (FR-T2).
- Phase advance re-validates the prior receipt (input hash + validator-set
  currency); the only bypass is a **human-signed waiver receipt** — agent
  identities rejected (FR-P2).
- Skipped/waived work is first-class and permanently visible (DONE/WAIVED/BLOCKED/
  FAILED/SKIPPED — nothing disappears, NFR-6).

## C-4 — Maker ≠ verifier, mechanically (hard)

- Different agent identity, different model, and — when the forge mirror is on
  (D-004) — different scoped API token (`dokima-maker` vs `dokima-reviewer`).
- Enforced in code, not prose: `accept` refuses when reviewer identity == owner
  (FR-T2); the maker's model never reviews its own work by default (FR-G2);
  cross-model review is an integrity feature, not a preference.

## C-5 — NEVER-AUTO list immutable (hard)

- The following always require a human decision and can never be taken by `auto`
  mode, any autonomy dial setting, or any agent: **deploys, merges to main,
  releases, destructive operations, auth/crypto changes, scope-boundary breaks,
  new tech-stack additions, interviews** (FR-N3).
- The list is visible and non-editable in-product; NEVER-AUTO ledger rows require a
  human signature (agent-name blocklist enforced). Risk classes are rule-first; a
  model may raise a risk class, never lower it (FR-N2). See RISKS.md R-9.

## C-6 — SQLite single-writer core (hard)

- All durable state flows through the append-only event log (SQLite, WAL) with the
  core as the **single writer**; board, chat, spend, and notifications are
  projections (BLUEPRINT §2.3). Agents and berths never write the DB directly —
  they act only through lifecycle verbs the core executes.
- Consequences that are architecture requirements: persist-before-execute,
  orphan sweep on boot, idempotent receipt-based resume, hash-chained events,
  projection lag <1s (NFR-2/3). See RISKS.md R-10.

## C-7 — Expert content is open source (D-006, hard)

- The expert/validator library ships open with the platform; content is data
  (markdown + frontmatter, executable validators with the 0/1 + JSON-gaps
  contract), reviewable and forkable (NFR-5).
- The moat is the trust runtime + compounding playbook, not withheld markdown.
  Community packs are a supported surface with a signed-pack mechanism (SCOPE.md
  S-42).

## C-8 — No build-step dependency on internal repos (D-008, hard)

- One-time snapshot import from bpm-opencode-experts into `content/` at W1 with
  provenance headers (S-7); the runtime is re-implemented clean in this repo —
  contracts and algorithms port, code does not.
- Source-system test fixtures are reused as the conformance suite; afterwards,
  lessons flow both directions as ordinary PRs between peers. Anything that
  reintroduces an umbilical (generated files, sync scripts, canonical→generated
  builds against a private repo) violates NON_GOALS.md N-7 and fails review.

## How to use this file

- Requirements (FR-x/NFR-x), design docs, and tickets cite C-x IDs; a Challenger
  pass that finds a design claim contradicting a C-x marks it CONTRADICTED.
- C-x amendments are founder decisions: new D-ID in the DECISIONS ledger + updates
  here + a sweep of citing docs — never a silent edit.
