# Shipwright — Status ledger

Append one line per merged ticket; a short gate section per wave
(criteria → evidence). This file is how humans resume the project cold.

## 2026-07-10 — SDLC package cut

- Blueprint v0.4.0 approved and decision-complete (docs/BLUEPRINT.md,
  docs/DECISIONS.md D-001…D-013).
- Full package: 29 docs, plan.json (63 tickets / 261 pts, W0–W8),
  MASTER_PROMPT/PLAYBOOK/CLAUDE.md executor contract, research path
  preserved under docs/research/.
- Board state: W0-01/02/06/07 + W1-01 claimable. Nothing started.

## 2026-07-10 — Conductor shipped (build harness)

- scripts/conductor.mjs + models.json: unattended plan.json executor —
  fresh claude -p session per ticket (Sonnet/Haiku routing), out-of-session
  gates, independent review session, per-wave security audit, merge + dual
  push under APPROVALS A-001/A-002, provider-limit sleep/resume.
- Runbook: docs/work/CONDUCTOR_RUNBOOK.md. Dry-run verified (claims W0-01).
- Product twin: FR-G8 + ticket W3-07 (gateway-native limit resilience).
