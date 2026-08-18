# Visual direction — instrument panel

**Decided 2026-08-18 (W13-03), by the founder, from three options.** This file
exists so the next surface does not re-litigate it.

## Why there was nothing here before

`apps/web` had 42 passing style guards — no hex outside the token block, no raw
px, no off-scale font-size, contrast documented per token — and a UI its own
author called horrible. Those two facts are not in tension: **the guards enforce
consistency and cannot express quality.** They can say *"you used the correct
grey"*. They can never say *"this screen has no composition"*. That is why 42
green tests coexisted with an unusable interface and nobody caught it.

The deeper cause: the SDLC this repo ships defines a Phase 3.5 Design Loop —
`ux-researcher` flows, `design-system-lead` tokens and component inventory,
`ux-engineer` mockups — and Dokima went from architecture straight to
implementation. `docs/design/` held UX_SPEC, VOCABULARY, contracts and policies,
and no `tokens.json`. The tokens in `styles.css` were written as **guardrails**,
never as a **system**.

## The direction

**An instrument panel.** Dense, precise, high-signal — a tool for someone whose
question at any moment is *what needs me?*

This is the right world for the subject rather than a taste preference. Dokima's
screens are overwhelmingly **counts, money, states, receipts and gates**; its own
vernacular is already maritime and instrumental (Fleet, berths, harbormaster,
lanes, landing a branch); and its name means *tested and proven genuine*. A
product whose claim is verified work should read like something that measures.

| | |
|---|---|
| **Ground** | Deep cyan-shifted charcoal, not neutral near-black |
| **Accent** | Exactly one, and it never means "good" |
| **Numbers** | Tabular monospace, always |
| **State** | Encoded in **form** — a stripe, a chip, a weight — never in the digit alone |

### Rejected, and why

**Assay office** — hallmarks and ledgers, warm paper, old-style serif, verdigris
and struck copper. Genuinely distinctive and closest to the name's origin, but it
dresses a dense operational tool as a document. The screens are readings, not
prose.

**Quiet workshop** — calm, generous, low-contrast, space instead of lines. Easiest
to read for long sessions, and it loses exactly what this product needs most:
the ability to make one card among six shout.

### What this direction is NOT

The generic dark-dashboard answer is a neutral `#0a0a0a` with a single acid-green
or vermilion accent. That look is a default, not a choice, and it appears
regardless of subject. Two deliberate departures:

- the ground is **cyan-shifted** (`#0e1417`), not neutral;
- the accent is a **lit-instrument blue-cyan**, not an acid pop, and semantic
  pass/fail/caution keep their own hues so the accent never has to carry
  "good" as a second job.

No webfont (a TECH_STACK decision and a bundle cost, not one to take inside a
token ticket). No motion. No gradient.

## The palette, with measured ratios

Every value below was computed, not asserted.

### Dark — the primary theme, because that is how the product is used

| Token | Value | Measured |
|---|---|---|
| `--sw-bg` | `#0e1417` | ground |
| `--sw-surface` | `#151d21` | raised: cards, panes, readouts |
| `--sw-fg` | `#e3ebea` | **15.33:1** on ground |
| `--sw-fg-muted` | `#8fa0a3` | **6.83:1** |
| `--sw-border` | `#232e33` | decorative hairline |
| `--sw-border-strong` | `#526a71` | **3.23:1** — structural dividers, WCAG 1.4.11 |
| `--sw-accent` | `#46b3c9` | **7.56:1** |
| `--sw-on-accent` | `#0e1417` | **7.56:1** on the accent |

### Light

| Token | Value | Measured |
|---|---|---|
| `--sw-bg` | `#fbfcfc` | ground |
| `--sw-surface` | `#ffffff` | raised |
| `--sw-fg` | `#0e1417` | **18.06:1** |
| `--sw-fg-muted` | `#5a6a6d` | **5.50:1** |
| `--sw-border-strong` | `#7e9093` | **3.24:1** |
| `--sw-accent` | `#0e7c93` | **4.73:1** |
| `--sw-on-accent` | `#ffffff` | **4.86:1** |

**A finding worth keeping:** white on the dark accent measures **2.46:1** and
fails. `--sw-on-accent` is the *ground*, not white. The previous dark accent had
the identical trap and a previous ticket fixed it the same way; it is recorded
in the stylesheet so the next person choosing an accent does not rediscover it.

## Two things the old system lacked entirely

**A raised surface.** There was no `--sw-surface`. Cards and panes had nothing to
sit *on*, so the whole app was one flat sheet with lines drawn on it — the single
largest reason it read as undesigned.

**Range in the type scale.** The old scale ran `0.65rem`–`1.25rem`, so every text
on a Fleet card lived inside about four pixels and nothing could read as more
important than anything else. The scale now runs to `2.5rem`. Hierarchy needs
range to exist in.

## The signature: the readout

Every meaningful number is an instrument reading, not prose: **tabular monospace,
the value carrying at size, the label demoted to a micro cap beneath it.** A
changing digit never reflows its neighbours.

It earns its place because of what this product's screens actually contain. The
Fleet rendered `Ready 0 Blocked 0 Done 0` six times at label-size, and the one
project with work waiting was visually identical to five with none. `.readout`,
`.readout--idle` and `.readout--attention` exist so a zero recedes and a waiting
number takes the accent — the behaviour `UX_SPEC` §2 has specified since before
any of this was built.

## Rules

**Semantic colour is not the accent.** `--sw-danger` / `--sw-warning` /
`--sw-success` mean refused / caution / proven. The accent means *this one, or
this needs you*. If the accent ever has to mean "good", the system has lost the
distinction that makes a gate result readable at a glance.

**State is form, not just value.** A card that needs you is a different shape,
not the same shape with a different digit.

**Tokens are the only source of colour.** The 42 guards stay and now cover the
widened scale. A surface that re-declares a colour locally is a bug the guards
will name.
