# The design-review loop — Dokima reviewing its own surfaces, any model

**Filed 2026-08-20, from the founder's ask:** the end-user comprehension audit
(UX_AUDIT_2026-08-20.md) was powerful — make Dokima able to run it on itself,
and on its users' products, with whatever model the user has (Law 9b).

## Why this is mostly assembly, not invention

The audit's method decomposes into four steps, and three already exist:

| Step of the method | What did it in the audit | What Dokima already has |
|---|---|---|
| Walk every surface, real server, no mocks | a person driving a browser | `apps/web/scripts/capture-tour/` — declared states, both themes, frame diffs (W10-37/W13-07) |
| Judge against a rubric | model judgment | `content/experts/other/end-user-simulator.md`, `ui-verifier.md` — dispatched via the gateway, matrix-routed |
| Verify every claim before it counts | grep before writing a finding | the trust boundary (C-2/C-3): agent output is never trusted, receipts everywhere |
| Findings become work | filing tickets | improve mode: `AuditFinding` → plan items → tickets, `verifyWith` per finding |

The three missing bridges are the tickets below.

## The model-agnostic move: text-first evidence

A local model without vision cannot read a PNG. The audit never actually
needed one: every finding reduced to **strings, labels, roles and geometry**
("this instruction names a tab that does not exist", "these two cards render
identical classes in different columns", "70% of this viewport is empty").

So the tour grows an **evidence pack** per captured state — visible text,
interactive elements (role + accessible name), per-element geometry, and
summary stats — serialized JSON. A text-only model judges the pack; a
vision-capable model may additionally get the PNG as enrichment. Capability
degrades honestly (FR-G5), never silently.

## The three layers

### 1 · Mechanical validators — no model, run in gates (W13-56)

The highest-value findings needed no judgment at all, and a check that needs
no judgment should never spend a model:

- **Instruction ↔ surface cross-check:** every UI/error string of the form
  "Settings → X" (and kin) must name a label that exists. This would have
  caught A-3 — the "Settings → Models" vs "Model Matrix" contradiction —
  **the day W13-34 shipped it**, not five days later in a manual audit.
- **Vocabulary law:** VOCABULARY.md's "Not" column becomes an enforced
  lexicon over user-facing string literals. "routing matrix", "swimlane",
  "program" can no longer reach a user silently.

Repo-side validators (`scripts/validate-*.mjs`, the `validate-exports`
precedent), red-fixture tested, with a **baseline** for the violations W13-51
already owns — the same pattern history-secrets uses: known debt is named and
tracked, new drift gates immediately.

### 2 · Evidence pack — deterministic capture (W13-54)

`capture-tour` emits `evidence.json` beside each frame: visible strings,
interactive elements, geometry stats (content-area occupancy, card class
histograms per column). No model involved; it is the audit's *eyes*,
serialized. This is also what makes the loop usable on a **user's product**
later — the capture side is generic Playwright, not Dokima-specific.

### 3 · The judge — any model, claims re-verified (W13-55)

Dispatch (per the onboard-mode precedent: code reads, model judges):
the harness packs evidence → hands it to `end-user-simulator` through the
gateway (whatever model the matrix routes — local qwen included) → the model
returns `AuditFinding[]` where **every finding carries a citation: an exact
string that must appear in the evidence pack**. The harness re-greps each
citation; a finding whose citation is not present is dropped and logged, not
trusted. Surviving findings enter the improve funnel exactly as a health
scan's do — which is also where the Plan screen's finding vocabulary
(severity/leverage) is honest, closing the loop with W13-50.

C-4 holds by construction: the judging role routes to a different model than
the maker that later fixes the findings, same as every reviewer.

## What this is not

Not a replacement for the human pass. The mechanical layer catches
contradictions; the model layer catches confusion; neither knows what the
product *should feel like* — direction stays a founder decision
(VISUAL_DIRECTION.md), and the loop enforces alignment with it.
