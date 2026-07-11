# Shipwright — UX Specification (the Canvas)

Traces to: BLUEPRINT.md §3.1 (Canvas), §5 (HITL & notifications), §12.3 (guided first
fifteen minutes); FR-C1..C5, FR-N1..N4; DECISIONS.md D-004 (native board), D-010
(berths). API counterpart: docs/API_DESIGN.md — every interaction below is a REST verb
or WS projection; the UI invents no state.

## 1. Design principles

1. **Evidence over vibes.** Every claim on screen ("tests pass", "no critical findings",
   "done") is a link to an openable receipt. No unlinked assertions, ever (NFR-6).
2. **Decision-shaped interrupts.** Anything that asks for the human is a card with the
   question, the context slice, the options (recommended default marked), and the cost of
   each path — answerable in under a minute or it's mis-designed (BLUEPRINT §5.1).
3. **The board cannot lie.** Cards render projections only; agent-internal churn is
   summarized (detail drawer streams loop telemetry for those who want it) — legible at a
   glance during a 200-event hour (§7.1).
4. **Refusals teach.** Every refused action shows the specific rule and the evidence
   behind it (explain-this-refusal) — the platform teaches its own discipline.
5. **Cost transparency.** Every card and chat turn shows token/dollar cost; escalation
   spend is attributed per ticket so cheap-first economics are visible, not asserted.
6. **Calm by taxonomy.** Nothing in the Record tier ever pops (§7). Human attention is
   budgeted like tokens.

## 2. Fleet home — the entry screen (FR-F1, D-013)

The app opens on the portfolio, not a project. One card per project:

- **Card contents**: name + phase chip, board mini-stats (ready / blocked / done),
  running berths with heartbeat freshness dots, pending **Decide** count (the only
  number rendered in the attention color), spend today. Cards sort by "needs you
  first" (pending Decide desc, then stalest heartbeat).
- **Actions**: open, pause/resume run, jump straight to the project's Decide items.
  Header actions: **New Product / Onboard existing repo / Import / Archive** —
  archive closes the folder, never deletes (state travels with the repo dir, FR-F2).
- **The aggregated inbox** lives here too: the cross-project morning queue and
  notification center (FR-F4) — a night of three autorunning programs is still one
  ten-minute review (§7).
- Single-project users skip past this: with one project, the app opens directly in
  it and Fleet is a breadcrumb.

## 2a. Project layout — three panes (FR-C1)

`[ Chat ] [ Board ] [ Artifacts ]` — every pane collapsible; widths and collapsed state
persist per project. Top bar: project switcher (back to Fleet), run status chip (phase ·
breakpoint · berths), spend meter for the day, global pause button, notification bell
(Decide badge count only). Command palette (⌘K): jump to tickets/docs/receipts, fire
verbs, "What are we doing today?" mode picker (New Product / Onboard / Feature / Improve).

## 3. Chat Workspace (left pane — FR-C2)

- **Threads per concern**: one program thread (you ↔ Shipwright-as-PM) pinned on top;
  ephemeral agent threads open when an agent needs you and archive on resolution.
- **Structured cards, not walls of text**:
  - *Question card* (clarification): context, the question, options, default-if-unanswered
    + "answer later" — dismissal takes the documented default and writes a ledger row.
  - *Slate card* (founder decision, FR-P6): 2–4 options with trade-offs, one marked
    Recommended with reasoning; choosing appends to DECISIONS.md and shows the new D-ID.
  - *Finding card*: severity, evidence link, affected ticket.
  - *Manifest card*: files produced, verify result, receipt link, diff-stat.
  - *Gate review card*: validator list with pass/gap counts, receipt, Approve / Edit / Redo.
- **Provenance line on every agent message**: agent name · model · ticket ID · cost of
  the turn — click-through to the receipt/artifact.
- Async by design: answer hours later; the affected loop suspends at its checkpoint and
  resumes exactly there. Slash-commands (`/security --deep`, `/review`, `/perf`) dispatch
  specialists directly — escape hatches are first-class.

## 4. Kanban Board (center pane — FR-C4, D-004)

Swimlanes = **lanes**; columns = `Ready / Claimed / In Progress / In Review / Blocked /
Done`; cards typed Epic / Story / Task / Bug with: id, title, owner chip (human avatar or
agent+model chip), cost-so-far, receipt dot (green = close receipt exists), heartbeat
freshness on active cards ("pass 2/3 · 40s ago").

**Verb-driven drag.** Dragging a card fires the corresponding lifecycle verb — the same
verb an agent would fire, same invariants (FR-T4). An invalid drop animates back and
shows the refusal popover: the rule ("close requires a Completion Manifest + verify exit
0"), the evidence link, and — where actionable — the fixing affordance ("run verify now").
No drag ever bypasses a gate; there is no "just move it" mode.

**Board header strips:**
- *Claim-now strip*: smallest ready ticket per lane — one-click claim for a human, or
  "hand to agent" (dispatches via Harbormaster).
- *Active agents strip*: who works on what, per berth, heartbeat-fresh; stalls turn amber
  then flip the card to `blocked-with-evidence` within seconds (§7.1).
- *Shipped ticker*: commits landed since midnight, linked to their tickets.

**Badges:** `STALE — claimable?` on blocked cards whose named blockers are all done;
⚠ on waived items (permanently visible in coverage history, NFR-6); 🔒 lease badge in any
file tree for paths held by an active ticket (§7.3 conflict prevention).

**Detail drawer** (card click): full contract (write-scope, deps, acceptance, verify),
history timeline, evidence, live loop telemetry, spend by rung, session trace link.
Humans edit the DAG here pre-build (split/merge/reprioritize) — schema invariants refuse
bad edits with the same explain pattern.

## 5. Artifact Viewer + Receipt Inspector (right pane — FR-C3/C5)

- Renders the SDLC doc tree (markdown), live per-ticket branch diffs (CodeMirror merge
  view, updating as the agent commits), and Mermaid diagrams client-side — including the
  live ticket dependency DAG.
- Every deliverable is versioned: each save is an event; version history with inline
  diffs. Docs live on disk in the repo — the viewer is a window onto files git sees,
  never a silo.
- **Receipt inspector**: any gate receipt, coverage report, challenge report, or ledger
  row opens as a structured view (validator table with exit codes and gap counts, input
  hash, timestamps, signer) — raw JSON one toggle away. Coverage reports render the
  DONE/WAIVED/BLOCKED/FAILED/SKIPPED grid; SKIPPED rows are loud (FR-L4).

## 6. Settings Matrix (BLUEPRINT §3.1.4)

- **Model matrix**: rows = agent roles, columns = task types, cells = model + fallback
  chain. Presets: All-local / Hybrid / All-cloud. Each (model, role) cell shows its
  **fitness card** (fit / marginal / unfit from the planted-defect harness, §12.1) — an
  unfit assignment warns before it wastes a run. Provider onboarding (Copilot device
  code, Vertex project/region, local endpoints with warm-up state) lives here (D-007).
- **Autonomy dial**: `interactive` ↔ `auto`, per project. Directly below, always visible
  and visibly non-editable: the **NEVER-AUTO list** (destructive ops, main
  merges/releases/deploys, auth/crypto changes, new stack additions, scope breaks,
  interviews). Rendered as static text with a lock glyph — no control exists that edits
  it (SC-10).
- **Budget panel**: per-project and per-run budgets, breaker thresholds 70/85/100% with
  current position, per-model spend history, dry-run estimate before autorun ("this
  board ≈ $4.10 on your matrix; $0.60 if review drops a tier", §12.2).
- **Berths slider (D-010)**: 1–N with live annotation "N lanes available → effective
  parallelism ≤ min(berths, lanes, gateway capacity)". Autorun = breakpoint `never` ×
  berths N — one toggle + this slider, with a confirm card summarizing what will run
  unattended and what will park to the morning queue.
- **Scopes & "why this value" (FR-S1, D-012)**: every setting shows its effective value
  with the winning scope chip (`run` / `project` / `global`) and, on hover, the
  overridden values beneath it (`GET /settings/effective`). A scope switcher at the top
  of the panel edits global defaults vs this project's overrides; run-scope values are
  set at launch time and shown read-only here. Credentials render as keychain-ref names
  with a "test connection" action — never the secret itself (FR-S2).

## 7. Notifications — Decide / Review / Record (FR-N4)

| Tier | Meaning | Delivery |
|---|---|---|
| **Decide** | the run waits on YOU (or soon will) | badge + optional desktop push |
| **Review** | work ready; no urgency | morning queue + badge count only |
| **Record** | FYI; the ledger has it | silent — activity feed only |

Enforced at the API: emitters declare a tier; the rules are code. Nothing in Record may
ever pop. Review items coalesce (per-wave digests when breakpoint=wave; one notification
per batch). A Decide card that blocks other lanes is promoted to push only when the
Harbormaster runs out of unblocked work — interrupt-when-idle-blocked. Quiet hours
respected for push; the run continues under `auto` policy and queues Decide items.

### The morning queue (signature screen)

One screen, sorted by **leverage**: merges first (they unblock lanes), then approvals,
then clarifications, then FYI digests. Each card: one-line summary, diff-stat or artifact
link, receipts inline, cost, Approve / Reject / Ask-follow-up — no navigation required to
decide. Header shows: night's spend, tickets closed, what's blocked on you. **Design
target: a night of autonomous work reviewable in ten minutes** — the queue shows its own
elapsed review time as a nudge to keep cards decision-shaped.

## 8. First fifteen minutes (guided sample — §12.3)

First run offers a built-in sample idea ("a link-shortener with auth") that runs the full
program in miniature on local-or-cheap models. Guided beats: watch the interview → see a
slate card and decide it → watch Gate A mint a receipt (open it) → watch the board build
2–3 tickets with live heartbeats → get one clarification card → wake a simulated "morning
queue" with one PR to merge. Each beat has a one-line coach mark explaining the
discipline it demonstrates. Skippable, resumable, deletable; ends by asking for the
user's real idea.

## 9. Accessibility baseline (WCAG 2.2 AA)

- **Keyboard-complete**: every drag has a verb equivalent (card menu → claim/start/…;
  the palette fires verbs); panes and strips are landmark regions; roving tabindex in the
  board grid; visible focus ring everywhere.
- Cards/columns expose list semantics with ARIA labels ("Ticket W2-04, In Progress, lane
  gateway, owned by berth-2"); live regions announce column moves and new Decide cards
  (polite; assertive only for run-stopped).
- Color is never the only carrier: status pairs icon + text (receipt dot has a label;
  waived ⚠ has text); AA contrast in both themes (dark-first, light-complete);
  `prefers-reduced-motion` removes heartbeat pulses and drag animations.
- Diagrams and charts have text alternatives: the Mermaid DAG offers a "view as list"
  (dependency table) toggle; spend charts have data-table twins.
- Playwright a11y smoke (axe) on: board, morning queue, settings matrix, receipt
  inspector — CI gate from W4.
