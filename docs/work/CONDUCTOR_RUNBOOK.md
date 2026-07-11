# Conductor runbook — unattended weekend build

How to run the Shipwright board (plan.json) hands-off with Claude Code
sessions on Sonnet/Haiku, with the expert-system guardrails and automatic
recovery from session/usage limits. Standing approvals: `APPROVALS.md`.

## What it does per ticket

```
claim (deps done, lane free) → fresh branch → fresh `claude -p` session
(model per scripts/models.json) → gates OUTSIDE the session (plan status,
commits present, write-scope diff check, pnpm lint+typecheck+test) →
independent review session (maker ≠ verifier; CRITICAL/HIGH → one fix
cycle) → merge --no-ff to main → push github + origin → next ticket.
Between waves: a security-audit session over the wave diff (CRITICAL halts).
```

Failure path: 2 maker attempts (gap feedback in the second prompt), optional
`--escalate` third attempt on Opus, then `blocked` with evidence in the
ticket notes — the run moves on to the next claimable lane. This is the
micro-loop + Ralph discipline from bpm-opencode-experts, held by a script
instead of prose.

Limit recovery (the 10:10pm problem): any session that dies with a
session/usage/rate-limit message is retried after sleeping until the reset
time parsed from the message (fallback: exponential backoff capped at 1h,
12 retries). The ticket is NOT lost — the same session prompt re-runs and
is told it may be resuming partial branch work.

## Prerequisites (one-time, before leaving)

```bash
npm i -g pnpm                      # missing on this machine as of 2026-07-10
claude --version                    # logged in; 2.1.207 OK
cd ~/Code/shipwright && git status  # clean tree, on main
node scripts/conductor.mjs --dry-run   # sanity: claims W0-01, no sessions
```

Notes for the weekend: the conductor should be the ONLY heavy Claude
consumer on this account while it runs (limits are account-wide). Keep the
lid open or plugged in; `caffeinate` below prevents sleep.

## Launch (weekend mode)

```bash
cd ~/Code/shipwright
caffeinate -dimsu node scripts/conductor.mjs \
  --waves W0,W1,W2 --breakpoint never --escalate \
  >> docs/work/conductor.out 2>&1 &
echo $! > docs/work/conductor.pid
tail -f docs/work/conductor.out    # watch for a few tickets, then walk away
```

Recommended first weekend scope: `--waves W0,W1,W2` (trust core, loop
engine, gateway — 93 pts). W3+ builds on reviewed foundations; better to
eyeball W0–W2 Monday before releasing the rest.

Conservative variant (park merges for morning review instead of landing):
add `--no-merge` — branches accumulate as `feat/w0-01-auto`… and you merge
Monday. Dependent tickets will NOT unblock in this mode, so use it only
with `--breakpoint wave`.

## Control

| Action | Command |
|---|---|
| Stop gracefully (between sessions) | `touch ~/Code/shipwright/STOP` |
| Resume after stop | `rm STOP` and relaunch — idempotent: board state + branches carry over; a claimed-but-unfinished ticket is retried from its branch |
| Watch | `tail -f docs/work/conductor.out` or `jq . docs/work/conductor-log.jsonl` |
| Board state | `git pull && jq '[.tickets[] | .status] | group_by(.) | map({(.[0]): length}) | add' plan.json` |
| Kill hard | `kill $(cat docs/work/conductor.pid)` (safe: unmerged work sits on its branch; relaunch re-verifies) |

## Monday-morning review checklist

1. `docs/work/conductor.out` tail — how it ended (`conductor.end` line has the board tally).
2. `git log --oneline --merges` — one merge per landed ticket, each citing gates + review.
3. Blocked tickets: `jq '.tickets[] | select(.status=="blocked") | {id, notes}' plan.json` — each has evidence; unblock by fixing the impediment and setting status back to `todo`.
4. `docs/work/SECURITY_W*.md` — per-wave audit results.
5. `docs/STATUS.md` — the per-ticket ledger lines the sessions appended.
6. Spot-check 2–3 merges' diffs (the review sessions' JSON verdicts are in conductor-log.jsonl).

## Known limits (deliberate v0 scope)

- Serial (berths=1): one session at a time — right call while limits are
  account-wide anyway. Parallel lanes arrive with Shipwright W3-04 itself.
- Gates require the toolchain: until W0-01 lands, lint/test gates are
  skipped (bootstrap exception) — W0-01 is exactly the ticket that creates
  them, and its review session still applies.
- The conductor trusts `claude -p` exit behavior for limit detection; if a
  session hangs instead, the per-session watchdog (`--session-minutes`,
  default 45) kills and retries it.
- Shipwright-the-product gets this same capability natively as FR-G8 /
  ticket W3-07 (gateway-level limit detection + run auto-resume).
