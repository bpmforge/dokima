# UI acceptance checklist

Judged per run against the frames in `docs/acceptance/runs/<runId>/` (see
`manifest.json` there for which frame belongs to which check). Captured by
`apps/web/scripts/capture-acceptance.mjs`; reviewed per
`ACCEPTANCE_AGENT.md`. Every criterion is visual — the deterministic DOM
contract is already covered by the Playwright e2e suite; this list exists
to catch what DOM assertions cannot (stuck states, clipped text, theme
gaps, dishonest-looking content).

**Known open findings** — mark a match as `KNOWN(<ticket>)`, not FAIL, and
do not re-file it: W9-02 (drawer receipts stuck on "Loading receipts…"),
W9-03 (sample chat content lacks a sample marker), W9-04 (raw native
buttons inconsistent with header pills), W9-05 (board columns clip with no
scroll affordance).

| Id | View / action | PASS criteria |
| --- | --- | --- |
| A-01 | Fleet, empty | "No programs yet." empty state with New Product + Onboard buttons; header shows Roster, bell, Settings, theme toggle; no stray loading text. |
| A-02 | New Product form, filled | Both fields legible (long paths may truncate but must not overflow the card); form has a submit and a Cancel. |
| A-03 | Project card created | Card shows the entered name, a phase chip ("Not started"), Ready/Blocked/Done counters, berth line, spend line, Open/Archive. |
| A-04 | Workspace, unseeded | Three panes labeled Chat/Board/Artifacts; Board and Artifacts show honest empty-state copy, never spinners or blank panels; sample chat content must be recognizable as sample (KNOWN W9-03). |
| A-05 | Artifacts → Receipts tab | Tab switches (Receipts active); an honest empty state for a project with no receipts. |
| A-06 | Board, seeded | Lane sections with state columns; cards show type, id, title, claim state; column headers readable (clipping = KNOWN W9-05); top strips render the in-flight/done tickets. |
| A-07 | Ticket drawer | Title "E2E-1 — Wire the board"; lane/owner/write-scope/depends-on rows; Acceptance, History, Receipts, telemetry, Spend, Session trace, Edit dependencies sections all present; no section stuck loading (receipts = KNOWN W9-02). |
| A-08 | Trace: runs list | "Session trace — E2E-1" heading with a View-session-trace button per run; a Close/back affordance. |
| A-09 | Trace: event replay | Events labeled by kind (Pass / Gate result / Escalation), actor + timestamp each, escalation visually distinct; a "File field report" affordance per event. |
| A-10 | Plan: proposed | Funnel line ("1 raw → 1 plan items → …"); PC-001 card with Proposed chip, description, monospace verify criterion, severity/leverage/rank, Accept + Dismiss. |
| A-11 | Plan: accept form | Accept opens an inline lane input (filled "pipeline") with a Confirm accept action; no navigation occurred. |
| A-12 | Plan: accepted | Chip flips to Accepted; a minted board-ticket reference (PLAN-PC-001) is shown; funnel counts update. |
| A-13 | Morning queue | Decide card (red DECIDE tag, title, diffstat, Approve/Reject) and Review digest ("1 item batched" + item line); project tag on each card; elapsed timer with 10:00 target. |
| A-14 | All notifications tab | Tab switches; both emitted notifications listed with tier tags; no morning-queue-only chrome bleeding through. |
| A-15 | Approve flow | After Approve, the Decide card leaves the queue (only the Review digest remains); no error banner. |
| A-16 | Roster | Grouped expert cards with name, kind, description, configured/benched/cost status lines; statuses are honest (unconfigured shown as such). |
| A-17 | Global settings | Deliberately thin: pointer copy to per-project settings + Run Setup Wizard button; no dead controls. |
| A-18 | First-run wizard | Wizard renders its first step with a clear progression affordance; no blank screen. |
| A-19 | Shortcuts overlay | Centered overlay listing at least ?/Esc with key glyphs; background dimmed or clearly layered. |
| A-20 | Dark theme: Fleet | Background/text/cards all switch (no white flash panels); toggle now offers the way back; contrast stays readable. |
| A-21 | Dark theme: workspace | All three panes + board cards + header render dark-consistently; no light-theme islands. |
