# Dokima — screenshot tour

A scribe-style walkthrough of the shipped product, captured against the
real server + real event log with zero mocks (Law 9 local-first: no
network, throwaway `.dokima` home). Regenerate any time with:

```sh
pnpm --filter @dokima/web run build   # if dist/ is stale
node apps/web/scripts/capture-tour.mjs
```

## Step 1 — Fleet home (first launch)

The entry screen with no projects yet. The header offers the three ways in: **New Product**, **Onboard existing repo**, and **Import**.

![Fleet home (first launch)](img/01-fleet-empty.png)

## Step 2 — New Product form

Clicking **New Product** opens the creation form: a directory path and an optional display name.

![New Product form](img/02-new-product-form.png)

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

## Step 11 — Settings

The global Settings view is deliberately thin: model matrix, autonomy dial, budgets, and scopes are configured per-project (open a project first), with the Setup Wizard as the entry point.

![Settings](img/11-settings.png)

## Step 12 — Keyboard shortcuts overlay

Press **?** anywhere for the shortcut map; Escape closes it.

![Keyboard shortcuts overlay](img/12-shortcuts.png)

## Step 13 — Theme toggle

One click switches light/dark; the choice persists across reloads.

![Theme toggle](img/13-dark-theme.png)
