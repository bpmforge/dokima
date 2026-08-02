# Dokima — Vision

Traces to: `docs/BLUEPRINT.md` (§0–§1, §11) and founder decisions D-001, D-003–D-010.
This document restates direction; it does not re-open any locked decision.

## Problem

A person with a product idea — or a team with a backlog — runs today's AI-assisted
development on a stack that cannot be trusted or afforded end-to-end:

1. **The trust gap.** Coding agents report their own success. "The AI said it's done"
   is unverifiable: agents flip their own tickets, grade their own gates, and type
   completion strings nothing checks. Jira/Linear track work, GitHub holds code, and
   AI extensions act — three tools with no shared state and no receipts.
2. **The economics gap.** Frontier-model agents charge frontier prices for every
   keystroke, including the 80% of work a cheap or local model handles fine. Nothing
   routes each task to the cheapest capable model and *proves* the cheap tier was
   honest.
3. **The guidance gap.** Agents write code; nobody runs the program. There is no
   product manager in the loop turning an idea into vision, scope, requirements, a
   threat model, and a dependency-ordered plan before the first ticket executes.

## The Dokima answer

Dokima is a **local-first, human-in-the-loop platform** that takes an idea to a
shipped product (D-003: Node 22/TS/Fastify/SQLite/React, one install, offline-capable
against local models). It acts as your PM and your agentic dev crew: a guided
six-phase SDLC program, expert agents on per-item micro-loops, a native Kanban board
(D-004), cheapest-model-first execution with an evidence-triggered escalation ladder,
and a trust architecture in which **the platform holds the gates, not the agents**
(CONSTRAINTS.md C-2).

It is the productization of three battle-tested internal systems (BLUEPRINT §0):
the bpm-opencode-experts discipline, the agent-amplifier integrity/economics work,
and the Jarvis/Foreman runtime — imported once at W1 and then standalone (D-008).

## The thesis: a board that cannot lie

The board is not a status document anyone updates — it is a **projection of an
append-only event log** (BLUEPRINT §2.3, §7.1). Every claim the UI makes is backed
by an openable artifact:

- Tickets close only on a verified Completion Manifest: files exist, the verify
  command exits 0, commits are attached (C-3). No receipt, no `done`.
- Gates mint **receipts** (validator list, exit codes, input hash) only from real
  runs; the graded entity never grades itself.
- Maker ≠ verifier is mechanical (C-4): different identity, different model, and —
  with the forge mirror (D-004) — different API tokens.
- Skipped or waived work is permanently visible (`SKIPPED`/`WAIVED` are first-class
  coverage states), never silent.

Everything else in the product is downstream of this thesis: if the board cannot
lie, unattended overnight runs, a ten-minute morning queue, and cheap-model
delegation all become safe.

## Who it is for

Expanded in USER_PERSONAS.md; summary from BLUEPRINT §1.2:

| Persona | Need Dokima serves |
|---|---|
| P1 Solo builder / indie hacker | An idea and no team — Dokima is the PM, architect, security reviewer, and dev crew. |
| P2 Professional dev | The discipline (gates, threat model, coverage) without the ceremony; agents do bulk work under supervision. |
| P3 Small team lead | Replaces Jira + GitHub + scattered AI extensions with one surface where agents and humans share the same board. |
| P4 Local-LLM enthusiast | Maximum work from owned hardware, frontier spend only where receipts prove it's needed. |

## Product principles (BLUEPRINT §1.4)

- **Guided, not gated-by-jargon** — newcomers follow the program; experts get escape
  hatches (single-phase runs, direct HANDOFFs, custom validators, CLI).
- **Local-first (C-1)** — one install, SQLite state, works offline; cloud APIs and
  forges are integrations, not prerequisites.
- **Evidence over vibes (C-3)** — receipts, coverage reports, challenge reports,
  spend ledgers behind every UI claim.
- **Cheap-first economics** — escalation ladder R0–R4, per-ticket and
  evidence-triggered; the ledger shows exactly what escalation bought.
- **HITL that respects attention** — interrupts are rare, batched, decision-shaped;
  human attention is budgeted like tokens (BLUEPRINT §5).

## What "done" means for 1.0

1. **W0 exit holds:** a board that cannot lie, moved by CLI — event log, lifecycle
   verbs with invariants, receipts, worktrees (SCOPE.md S-1).
2. **Full program runs:** New Product mode takes an idea through Idea → Plan →
   Define → Design → Build → Launch with gate receipts at every phase and NEVER-AUTO
   approvals (C-5) reserved to the human.
3. **Autorun is real:** berths 1–N (D-010) work the board unattended (breakpoint
   `never`); the human wakes to a morning queue reviewable in ten minutes.
4. **The economics are visible:** role→model matrix with Copilot + Vertex among the
   providers (D-007), escalation events ledgered per ticket, dry-run cost estimate
   before autorun.
5. **Dogfood gate (W8):** Dokima runs its own pipeline on itself — threat model,
   security suite, a11y — and the receipts ship with the release.
6. **Onboarding proves it:** the guided first-fifteen-minutes sample project runs the
   whole lifecycle in miniature on local-or-cheap models.

## Positioning in one line each

Full landscape in COMPETITIVE_ANALYSIS.md.

- vs Jira/Linear + Copilot stacks: they track *or* act; Dokima is one canvas
  where chat, board, and artifacts are projections of one execution state.
- vs Devin/Factory-class autonomous agents: they ask you to trust the agent;
  Dokima assumes agents are untrusted and shows receipts (C-2, C-3).
- vs OpenHands/SWE-agent OSS: they execute tasks; Dokima runs the whole program
  — PM interview, gates, board, budget — around execution.
- vs Cursor/Claude Code-class IDE agents: they live in the editor session;
  Dokima is the out-of-session conductor that survives the session ending.
- vs opencode: shared lineage, different product — opencode is a terminal agent;
  Dokima is the platform (board, receipts, morning queue) an agent runs inside.

## Naming (D-001)

**Dokima**: the master builder who takes a vision from blueprint to launch and
won't let an unseaworthy product ship. Known collision with the CNCF dokima.io
image-build project (distinct domain); a branding pass (`dokima.dev`-style or a
qualifier) is required before public launch — tracked in RISKS.md R-4. Metaphor
budget is capped (BLUEPRINT §10): tickets are tickets, gates are gates, receipts are
receipts.

## Non-goals

Deliberately excluded scope is enumerated with rationale in NON_GOALS.md — headline:
not an IDE, not a general chat assistant, not a CI system, not a cloud SaaS at v1
(D-005), not a model host.
