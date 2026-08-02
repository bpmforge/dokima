# Research — Dokima's founding research path

This directory is the dogfood of FR-P8 (the research path): every major
design decision in `docs/BLUEPRINT.md` traces to a cited study here.

| Report | Question it answered | Feeds |
|---|---|---|
| [source-system-experts.md](source-system-experts.md) | What is the operational logic of the expert-system SDLC pipeline (agents, gates, loops, tickets, autonomy)? | Pipeline Engine, Ticket Engine, Validator Packs, Expert Registry (D-011) |
| [source-system-amplifier.md](source-system-amplifier.md) | What integrity holes were found in honor-system agent pipelines, and what fixes were designed (receipts, Conductor, forge ledger, advisor economics)? | Trust & Receipts layer, Harbormaster, Forge Mirror (D-004), escalation ladder |
| [source-system-foreman-jarvis.md](source-system-foreman-jarvis.md) | How does a 24/7 autonomous loop runtime actually behave (micro-loops, anchors, coverage honesty, budgets, HITL, memory gaps)? | Loop Engine, Coverage Tracker, Budget Service, HITL services, Memory Service |

Provenance: all three are primary-source studies of Brad Matthews' internal
repos (`bpm-opencode-experts`, `bpm-agent-amplifier`, `ai-assistant-agent`),
conducted 2026-07-10 by independent exploration agents with file:line
citations. Per D-008 these repos are *research inputs*, not dependencies —
the reports are the durable record so Dokima never needs to read them
again.

Standing rule for future entries (from FR-P8): cited claims only, tiered
sources (primary docs > maintainer statements > community posts), and any
HIGH-impact claim must carry a Challenger verdict before a decision cites it.
