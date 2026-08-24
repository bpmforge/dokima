# Vocabulary — one word per concept

**Why this file exists.** On a single captured screen (`docs/acceptance/runs/2026-08-17T20-11-14-317Z/01-A-01.png`)
a first-time user saw the heading **Fleet**, the empty state **"No programs
yet."**, and a button **New Product** — three words for a thing the code calls
a *project*. Elsewhere the nav offers **Describe · Plan · Decisions** and
Settings mentions a **model matrix** and an **autonomy dial**.

None of that is wrong individually. Together it means a person has to learn
four names for one idea before they can do anything, and the next surface
someone builds will invent a fifth. This is a decision to record, not a
preference to hold in one person's head — the same reason `DECISIONS.md`
exists.

**The standard to write to** is the first-run wizard's own copy:

> Nothing spends money or contacts a network until you choose.

Plain, specific, reassuring, and about the reader. It is the best-written text
in the product and it is already in this codebase to copy from.

---

## The words

| Concept | Use | Not |
|---|---|---|
| One thing Dokima builds or works on | **project** | product, program, repo, workspace |
| The collection of projects | **Fleet** | dashboard, home, projects list |
| A unit of work on the board | **ticket** | task, card, issue, story |
| A vertical grouping of tickets | **lane** | swimlane, track, column-group |
| The kanban surface | **board** | pipeline, kanban, tracker |
| One pass of the agent working the board | **run** | session, job, execution |
| The proof a state change actually happened | **receipt** | record, audit entry, log |
| What an agent hands back when it finishes | **Completion Manifest** | report, summary, output |
| A configured model endpoint | **provider** | backend, vendor, service |
| How work is modelled across roles | **Models** (UI) / model matrix (internal) | matrix, routing table |
| How much Dokima may do unattended | **Autonomy** (UI) / autonomy dial (internal) | dial, slider, trust level |
| One step on the ladder of models a run may climb | **rung** | tier, level |
| Flagging a trace event so the improvement loop learns from it | **field report** | feedback, flag |
| A live agent working tickets right now | **agents running** (UI) / berth (internal) | berths |

## Rules

**Internal terms that survive must earn it.** `lane`, `receipt`, `manifest`,
`ticket`, `run`, `rung` and `field report` are load-bearing product concepts
with real, distinct meanings — keep them, and define them where a user first
meets them (W13-60: the trace and the drawer now define `rung` and `field
report` at first encounter; the drawer's `berth` line was replaced with plain
language rather than defined — `berth` remains internal vocabulary; W13-62
renamed the Fleet readings to 'agents running' the same way). `model
matrix` and `autonomy dial` are internal names for user-facing settings; the
setting is called what it does.

**Rename in the UI only.** Wire shapes, event types, settings keys, API paths
and stored data keep their names. A vocabulary pass that rewrites a durable
contract is a migration, and this is not that. `ProviderEntry.kind` stays
`kind`; the label above it is what changes.

**"Project" over "product".** The code, the API, the event log and the registry
all already say `project`. Choosing anything else means the UI disagrees with
every other layer forever, and the layer that loses that argument is always the
one a user cannot see.

**"Fleet" stays.** It is a real named concept (D-013, multi-project Fleet with
per-project state), it is distinctive, and it names a genuinely different thing
from a project. It is only confusing when it sits above the word *programs* —
which was never defined anywhere.

## Status

Decided 2026-08-17 (W12-32). The `programs` clash is fixed. The remaining
`New Product` → `New project` sweep is **41 occurrences across components,
the command palette and six e2e specs** — mechanical but wide enough that
doing it as an afterthought inside another ticket is how a careless rename
breaks a spec nobody reads until CI. Filed as **W12-36**.

## "Team" (W20, decided 2026-08-24)

The surface is the **Team** view; the people on it are **members** (org
members in docs, "your team" in UI copy). Not "office" (that's the W20-08
skin's nickname, never a nav label), not "org chart", not "agents" in
user-facing copy — "agent" stays in operator/trace surfaces where the
mechanism speaks. The nav order is Board · Team · Describe · Plan ·
Decisions · Roster; Roster remains the capability/model catalog (who CAN
work), Team is who IS working now.
