# Component inventory

**W13-04, 2026-08-18.** Companion to [VISUAL_DIRECTION.md](VISUAL_DIRECTION.md).
Inventoried from the real stylesheets and the running app, not designed as an
idealised set — the point is to name what exists before deciding what it should
be.

## What the measurement found

| | |
|---|---|
| Stylesheets | **15** |
| Places declaring the same card border themselves | **51** |
| Distinct empty-state classes | **8**, across 7 files |
| Files using semantic state tokens | **15 of 15**, 53 usages |
| Shared components before this ticket | effectively **0** |

The 51 is the number the guard counts, and it is not the number a first pass
produced: counting with `apps/web/src/*/*.css` returned 49, because that glob
never reaches `board/drawer/drawer.css` two levels down. The measurement is the
deliverable here, so the guard counts the same way the inventory does.

There *was* an `.empty-state` in `styles.css`. Seven surfaces ignored it and
wrote their own — `.artifact-empty-state`, `.trace-view__empty`,
`.chat__empty`, `.board-empty`, `.board-column--empty`,
`.ticket-drawer__empty`, `.plan-view__empty`. That is the shape of the
problem: a shared thing existed, nothing made it the path of least resistance,
and every surface reinvented it slightly differently.

## The inventory

| Component | What it is | Today | Status |
|---|---|---|---|
| **surface** | The raised ground everything sits on | 51 local re-declarations | **shared** (`.surface`) |
| **state** | needs-you · running · blocked · refused · idle | 53 ad-hoc token uses | **shared** (`.state--*`) |
| **readout** | A number as an instrument reading | prose at label size | **shared** (W13-03) |
| **button** | primary · secondary · quiet | shared already | ✅ W12-29 |
| **empty state** | A screen with nothing in it yet | 8 competing classes | shared exists, **adoption pending** |
| **pane** | A column of the workspace | `board.css` + `styles.css` | W13-06 |
| **lane column** | One board lifecycle state | `board.css` | W13-06 |
| **ticket** | The product's atom | `board.css` | W13-06 |
| **chip / badge** | A short labelled value | 4 files, 12 classes | **not yet shared** |
| **form field** | Label + control | `styles.css` element selectors | ✅ W12-33 |
| **tab** | Switch between sibling views | `settings.css`, `artifacts.css` | **not yet shared** |

## The state decision

Each token keeps exactly **one** meaning, so a Fleet card and a board lane say
the same thing the same way:

| State | Token | Means |
|---|---|---|
| `--attention` | `--sw-accent` | a person is needed |
| `--running` | `--sw-success` | healthy activity |
| `--blocked` | `--sw-warning` | stuck, not wrong |
| `--refused` | `--sw-danger` | a gate said no |
| `--idle` | `--sw-fg-muted` | nothing happening — should recede |

**State is carried in form, not only in a value.** `.state` is a dot and a
label; `.surface--attention` gives a card an accent stripe. A project that
needs you is a different *shape*, not the same shape with a different digit —
which is exactly what six identical Fleet cards could not express.

Note the two axes are separate: **work status** (the table above) and **gate
outcome** (proven / refused). The accent never means "good", so a gate result
stays readable at a glance.

## Rules

**The shared thing has to be the easy thing.** `.empty-state` proves that
merely existing is not enough. When W13-05 and W13-06 adopt these, the local
copies go — a primitive with three surviving competitors is not shared, it is
a fourth option.

**Nothing here is applied yet.** W13-04 lands primitives only. Reviewing a
system and its first three interpretations in one diff is how both get waved
through.

**The duplication count is a ratchet, not a report.** 51 is today's measured
number and is guarded; W13-05 and W13-06 drive it down. It may not rise.
