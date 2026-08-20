# Dokima — screenshot tour

A scribe-style walkthrough of the shipped product, captured against the
real server + real event log with zero mocks (Law 9 local-first: no
network, throwaway `.dokima` home). Two independent passes — light theme
(the main walkthrough below) and dark theme (`img/dark/`, a second fresh
app instance) — plus every Settings tab in both themes. Regenerate any
time with:

```sh
node apps/web/scripts/capture-tour/index.mjs   # always rebuilds dist/ first
```

## Step 1 — Fleet home (first launch)

The entry screen with no projects yet. The header offers the three ways in: **New project**, **Onboard existing repo**, and **Import**.

![Fleet home (first launch)](img/01-fleet-empty.png)

## Step 2 — New project form

Clicking **New project** opens the creation form: a project name, with an escape to choose the folder yourself.

![New project form](img/02-new-product-form.png)

## Step 3 — Project registered on the Fleet

The project appears as a card with a **Not started** phase chip, Ready/Blocked/Done ticket counters, berth status, and today’s spend — plus Open and Archive actions.

![Project registered on the Fleet](img/03-project-created.png)

## Step 4 — Project workspace (three-pane)

Opening a project lands on the split-pane workspace: **Chat** (left, showing the guided sample thread), **Board** (center), **Artifacts** (right). Board and Artifacts state their empty conditions honestly rather than showing fabricated data.

![Project workspace (three-pane)](img/04-workspace-empty.png)

## Step 5 — Board with live tickets

Tickets seeded through the real hash-chained event log (`seed-board-tickets.mjs`): ready, blocked-on-dependency, and accepted tickets across lanes.

![Board with live tickets](img/05-board-seeded.png)

## Step 6 — Ticket drawer

Clicking a card opens the drawer: state, lane, write scope, dependency chips, telemetry, and the **session trace** entry point.

![Ticket drawer](img/06-ticket-drawer.png)

## Step 7 — Session trace replay

The trace view replays a run’s real events — loop passes, gate receipts, escalation rungs — each one feeding the lessons form (BLUEPRINT §12.4).

![Session trace replay](img/07-session-trace.png)

## Step 8 — Improvement Plan view

A snapshot evaluation proposed **PC-001** from the plan catalog, with its provenance, verify criterion, and Accept/Dismiss actions plus the raw-findings funnel.

![Improvement Plan view](img/08-improvement-plan.png)

## Step 9 — Morning queue

The signature screen (UX_SPEC §7): Decide items get inline **Approve/Reject**; Review items batch into a digest. The elapsed timer nudges toward the ten-minute review.

![Morning queue](img/09-morning-queue.png)

## Step 10 — Expert roster

The imported expert library (`content/experts/`) — the specialist roles the pipeline dispatches, with their provenance.

![Expert roster](img/10-roster.png)

## Step 11 — Settings (no project open)

Global Settings is deliberately thin: model matrix, autonomy dial, budgets, and scopes are per-project — this view is just the Setup Wizard entry point.

![Settings (no project open)](img/11-settings-no-project.png)

## Step 12 — Command palette (⌘K)

Pressing **⌘K**/**Ctrl+K** anywhere opens the palette: the "What are we doing today?" mode picker, with no results because nothing has been typed yet.

![Command palette (⌘K)](img/12-palette-no-query.png)

## Step 13 — Command palette — query results

Typing **E2E-1** jumps straight to the exact-id match; every result is keyboard-reachable (WCAG 2.2 combobox pattern).

![Command palette — query results](img/13-palette-query.png)

## Step 14 — Settings — Models

The **Models** tab of the Settings surface (UX_SPEC §6/§6a).

![Settings — Models](img/14-settings-model-matrix.png)

## Step 15 — Settings — Autonomy · Budget · Berths

The **Autonomy · Budget · Berths** tab of the Settings surface (UX_SPEC §6/§6a).

![Settings — Autonomy · Budget · Berths](img/15-settings-autonomy-budget.png)

## Step 16 — Settings — Cost Estimate

The **Cost Estimate** tab of the Settings surface (UX_SPEC §6/§6a).

![Settings — Cost Estimate](img/16-settings-estimate.png)

## Step 17 — Settings — Effective Settings

The **Effective Settings** tab of the Settings surface (UX_SPEC §6/§6a).

![Settings — Effective Settings](img/17-settings-effective.png)

## Step 18 — Settings — MCP Servers

The **MCP Servers** tab of the Settings surface (UX_SPEC §6/§6a).

![Settings — MCP Servers](img/18-settings-mcp.png)

## Step 19 — Settings — Validator Packs

The **Validator Packs** tab of the Settings surface (UX_SPEC §6/§6a).

![Settings — Validator Packs](img/19-settings-validators.png)

## Step 20 — Settings — Expert Overrides

The **Expert Overrides** tab of the Settings surface (UX_SPEC §6/§6a).

![Settings — Expert Overrides](img/20-settings-experts.png)

## Step 21 — Settings — Rule Lifecycle

The **Rule Lifecycle** tab of the Settings surface (UX_SPEC §6/§6a).

![Settings — Rule Lifecycle](img/21-settings-rules.png)

## Step 22 — Settings — Suppressions

The **Suppressions** tab of the Settings surface (UX_SPEC §6/§6a).

![Settings — Suppressions](img/22-settings-suppressions.png)

## Step 23 — Settings — Escalation Policy

The **Escalation Policy** tab of the Settings surface (UX_SPEC §6/§6a).

![Settings — Escalation Policy](img/23-settings-escalation.png)

## Step 24 — Settings — Copilot

The **Copilot** tab of the Settings surface (UX_SPEC §6/§6a).

![Settings — Copilot](img/24-settings-copilot.png)

## Step 25 — Keyboard shortcuts overlay

Press **?** anywhere for the shortcut map; Escape closes it.

![Keyboard shortcuts overlay](img/25-shortcuts.png)

## Step 26 — Theme toggle

One click switches light/dark; the choice persists across reloads.

![Theme toggle](img/26-theme-toggle.png)

## Dark theme & Settings sweep

Independently verified in dark theme against a fresh app instance: the
two states above whose emptiness matters (Fleet home, unseeded
workspace) plus every Settings tab.

### Fleet home, dark theme (first launch)

The same first-launch emptiness as the light pass, verified independently in dark theme against its own fresh app instance — never a re-toggle onto an already-populated app.

![Fleet home, dark theme (first launch)](img/dark/01-fleet-empty.png)

### Project workspace, dark theme (unseeded)

The board pane genuinely empty in dark theme — the state that got mis-slugged in the earlier ad-hoc sweep.

![Project workspace, dark theme (unseeded)](img/dark/02-workspace-empty.png)

### Settings — Models

The **Models** tab of the Settings surface (UX_SPEC §6/§6a).

![Settings — Models](img/dark/03-settings-model-matrix.png)

### Settings — Autonomy · Budget · Berths

The **Autonomy · Budget · Berths** tab of the Settings surface (UX_SPEC §6/§6a).

![Settings — Autonomy · Budget · Berths](img/dark/04-settings-autonomy-budget.png)

### Settings — Cost Estimate

The **Cost Estimate** tab of the Settings surface (UX_SPEC §6/§6a).

![Settings — Cost Estimate](img/dark/05-settings-estimate.png)

### Settings — Effective Settings

The **Effective Settings** tab of the Settings surface (UX_SPEC §6/§6a).

![Settings — Effective Settings](img/dark/06-settings-effective.png)

### Settings — MCP Servers

The **MCP Servers** tab of the Settings surface (UX_SPEC §6/§6a).

![Settings — MCP Servers](img/dark/07-settings-mcp.png)

### Settings — Validator Packs

The **Validator Packs** tab of the Settings surface (UX_SPEC §6/§6a).

![Settings — Validator Packs](img/dark/08-settings-validators.png)

### Settings — Expert Overrides

The **Expert Overrides** tab of the Settings surface (UX_SPEC §6/§6a).

![Settings — Expert Overrides](img/dark/09-settings-experts.png)

### Settings — Rule Lifecycle

The **Rule Lifecycle** tab of the Settings surface (UX_SPEC §6/§6a).

![Settings — Rule Lifecycle](img/dark/10-settings-rules.png)

### Settings — Suppressions

The **Suppressions** tab of the Settings surface (UX_SPEC §6/§6a).

![Settings — Suppressions](img/dark/11-settings-suppressions.png)

### Settings — Escalation Policy

The **Escalation Policy** tab of the Settings surface (UX_SPEC §6/§6a).

![Settings — Escalation Policy](img/dark/12-settings-escalation.png)

### Settings — Copilot

The **Copilot** tab of the Settings surface (UX_SPEC §6/§6a).

![Settings — Copilot](img/dark/13-settings-copilot.png)

## Coverage

Every state this sweep declared it would cover, and what happened to it
(W10-37 AC4 — a sweep that cannot report its own coverage cannot sign off
UX_SPEC §2b). `WAIVED` states are real, tested components with no route
that reaches them yet; see the reason column.

| State | Status | Notes |
|---|---|---|
| `01-fleet-empty` | DONE |  |
| `02-new-product-form` | DONE |  |
| `03-project-created` | DONE |  |
| `04-workspace-empty` | DONE |  |
| `05-board-seeded` | DONE |  |
| `06-ticket-drawer` | DONE |  |
| `07-session-trace` | DONE |  |
| `08-improvement-plan` | DONE |  |
| `09-morning-queue` | DONE |  |
| `10-roster` | DONE |  |
| `11-settings-no-project` | DONE |  |
| `12-palette-no-query` | DONE |  |
| `13-palette-query` | DONE |  |
| `14-settings-model-matrix` | DONE |  |
| `15-settings-autonomy-budget` | DONE |  |
| `16-settings-estimate` | DONE |  |
| `17-settings-effective` | DONE |  |
| `18-settings-mcp` | DONE |  |
| `19-settings-validators` | DONE |  |
| `20-settings-experts` | DONE |  |
| `21-settings-rules` | DONE |  |
| `22-settings-suppressions` | DONE |  |
| `23-settings-escalation` | DONE |  |
| `24-settings-copilot` | DONE |  |
| `25-shortcuts` | DONE |  |
| `26-theme-toggle` | DONE |  |
| `dark/01-fleet-empty` | DONE |  |
| `dark/02-workspace-empty` | DONE |  |
| `dark/03-settings-model-matrix` | DONE |  |
| `dark/04-settings-autonomy-budget` | DONE |  |
| `dark/05-settings-estimate` | DONE |  |
| `dark/06-settings-effective` | DONE |  |
| `dark/07-settings-mcp` | DONE |  |
| `dark/08-settings-validators` | DONE |  |
| `dark/09-settings-experts` | DONE |  |
| `dark/10-settings-rules` | DONE |  |
| `dark/11-settings-suppressions` | DONE |  |
| `dark/12-settings-escalation` | DONE |  |
| `dark/13-settings-copilot` | DONE |  |
| `decisions` | WAIVED | DecisionsBoard.tsx is built and unit-tested but never mounted in App.tsx (plan.json W5-14 HANDOFF) — wiring it is out of this write_scope (apps/web/src/** is not in W10-37's write_scope). |
| `lessons` | WAIVED | TriageQueue.tsx is built and unit-tested but never mounted in App.tsx (plan.json W7-05 HANDOFF, "TriageQueue.tsx mount remains the one open HONEST GAP") — same out-of-scope constraint as Decisions. |
