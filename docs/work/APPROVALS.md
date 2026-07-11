# Approvals ledger — standing authorizations for unattended runs

Machine-parseable; one row per approval. NEVER-AUTO items require a human
signature (agent names rejected). Revoke by adding a superseding row.

| id | date | scope | approval | signed_by |
|---|---|---|---|---|
| A-001 | 2026-07-10 | conductor runs on this repo | Ticket branches that pass full gates (lint+typecheck+test) AND an independent review-session APPROVE may be merged to main and pushed to both remotes without per-merge human approval. Blocked tickets are parked with evidence, never force-resolved. Revocable via `--no-merge` or a superseding row. | Brad Matthews (requested unattended weekend build, session 2026-07-10) |
| A-002 | 2026-07-10 | conductor runs on this repo | On provider session/usage limits the conductor sleeps until the stated reset time and resumes automatically, all weekend, without asking. `STOP` file halts everything between sessions. | Brad Matthews (same request) |

Constraints that remain in force regardless of A-001:
- No force-push, no history rewrite, no branch deletion other than merged ticket branches.
- Wave security pass runs between waves; any CRITICAL finding halts the run for human review.
- The conductor never edits code itself; it only claims, spawns sessions, verifies, merges, and books state.
