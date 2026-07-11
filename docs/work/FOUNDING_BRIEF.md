# Shipwright — Founding brief (for executors)

One page. Do not re-litigate; the full ledger is docs/DECISIONS.md.

**What this is:** a local-first, human-in-the-loop platform where a person
takes an idea to a secure, shipped product. Shipwright is their product
manager (interview → blueprint → decision slates → gated program) and their
dev team (expert agents working a native ticket board, cheapest-model-first
with evidence-triggered escalation). The platform holds the gates, not the
agents: every state change is an event; every completion is a receipt;
maker ≠ verifier is mechanical.

**Decisions in force:** D-001 name Shipwright · D-003 local web app
(Node 22/TS/Fastify/SQLite/React) · D-004 native board + forge mirror ·
D-005 single-operator v1, SSO v2 · D-006 open content · D-007 Copilot +
Vertex at MVP · D-008 standalone (one-time content import, no umbilical) ·
D-009 WSL at 1.0 · D-010 berths 1–N + autorun · D-011 full expert system in
the box · D-012 settings scopes + keychain · D-013 multi-project Fleet.

**Constraints:** C-1 offline-capable · C-2 agent sessions untrusted ·
C-3 receipts for every transition · C-4 maker≠verifier mechanical ·
C-5 NEVER-AUTO immutable · C-6 append-only single-writer event log ·
C-7 open content · C-8 no internal-repo dependency.

**Provenance:** productizes bpm-opencode-experts (discipline),
bpm-agent-amplifier (integrity + economics), Foreman/Jarvis (runtime).
Studies with citations: docs/research/. Their one-sentence lessons:
receipts not flags; wire memory the day it exists; loops need external
anchors; the conductor holds the gates.

**Where you come in:** MASTER_PROMPT.md → plan.json → PLAYBOOK.md.
W8-01 is the finish line: Shipwright must survive its own audit.
