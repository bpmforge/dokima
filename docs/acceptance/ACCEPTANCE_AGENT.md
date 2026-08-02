# Acceptance review agent — runbook

A self-contained protocol a small/cheap model (Haiku-class) can execute to
review the canvas visually. The expensive part (navigation, seeding,
capture) is deterministic code; the model only judges frames. You never
need browser tools for this — only Bash + Read + Write.

## Your role

You are the **independent verifier** of the UI (Law 5, maker ≠ verifier).
You judge screenshots against `CHECKLIST.md` and report. You do **not**
fix anything, do **not** edit `plan.json`, do **not** file tickets, and do
**not** change any product code — a human triages your report. Honesty
rules: report what the pixels show; if a frame is missing or ambiguous,
say so rather than guessing; never soften a failure.

## Steps

1. From the repo root, capture a fresh run (~1 min, local only):

   ```sh
   pnpm --filter @dokima/web run build   # only if apps/web/dist is stale
   node apps/web/scripts/capture-acceptance.mjs
   ```

   The script prints the run dir: `docs/acceptance/runs/<runId>/`.

2. Read `docs/acceptance/CHECKLIST.md` (criteria + known-findings list),
   then the run's `manifest.json` (which frame maps to which check).

3. Review every frame with the Read tool, in order. For each check record
   a verdict:
   - `PASS` — every criterion visibly satisfied.
   - `FAIL` — a criterion visibly violated; describe exactly what you see
     and which criterion it breaks.
   - `KNOWN(W9-xx)` — the violation matches a known-findings entry;
     reference the ticket, do not re-describe at length.
   - `UNVERIFIABLE` — the frame is missing/corrupt or the criterion cannot
     be judged from a still (say why).

4. Write `FINDINGS.md` **into the run dir** with:
   - A verdict table: `| Check | Verdict | Note |` for all checks.
   - A `## New findings` section: one entry per FAIL — what is shown,
     which criterion it violates, severity (`visual-polish` /
     `functional` / `honesty` — honesty = the UI implies something untrue,
     the most severe class here), and the frame filename as evidence.
   - A `## Summary` line: `N pass / N known / N fail / N unverifiable`.

5. Print the summary line and the path to `FINDINGS.md` as your final
   output. Stop there — no fixes, no follow-up actions.

## Scheduling cheap recurring runs

The review needs vision but not depth — schedule it on a small model:

```sh
# weekly, from the repo root (cron/launchd):
claude -p --model haiku --permission-mode acceptEdits \
  "Read docs/acceptance/ACCEPTANCE_AGENT.md and execute it exactly."
```

`--permission-mode acceptEdits` matters: without it a headless run may be
unable to write `FINDINGS.md` into the run dir (observed on the first
validation run, 2026-07-23) — if writing still fails, return the full
verdict table as your final text output instead of silently stopping.

Or as a recurring task from inside a Claude Code session: `/schedule` (or
`/loop` for same-session cadence). Escalate to a stronger model
interactively — e.g. a Claude-in-Chrome session actually clicking through
the app — only when a cheap run reports new FAILs that stills can't
explain, or after large UI changes; the checklist doubles as that
session's script.

After triage, a human moves accepted findings into `plan.json` as W9-style
tickets and updates the CHECKLIST known-findings list so future runs mark
them `KNOWN`.
