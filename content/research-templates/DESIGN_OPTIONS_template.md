<!--
  Provenance: adapted from bpm-opencode-experts skills/design-options/SKILL.md, adopted via
  docs/work/IMPROVEMENT_RECOMMENDATIONS.md R-H1 ("Design-options discipline as the
  technical-slate generator"). See VENDORED.md in this directory for the full divergence note.
  Divergence (summary): the source is a chat-driven agent skill that writes
  docs/DESIGN_OPTIONS_[topic].md directly; this is a fill-in-the-blank docs/research/ report
  template carrying the same fixed structure (exactly 3 options — Minimal/Clean/Pragmatic —
  compared on the same 6 dimensions in the same order: time, maintainability, scalability,
  team fit, risk, reversibility), plus FR-P8 per-claim citation tagging and a Challenger-review
  table the source has no equivalent for.
  Author: Dokima W5-05 (research path)
  Created: 2026-07-18
-->

---
description: 'Reference document — read on demand, not an agent.'
disable: true
mode: "all"
---

<!--
DESIGN_OPTIONS template — Phase 3 (Design) research deliverable, FR-P8.
Copy this content into docs/research/RESEARCH_design-options_<topic>_<date>.md and fill in.
Format follows R-H1 (docs/work/IMPROVEMENT_RECOMMENDATIONS.md): exactly 3 options — Minimal /
Clean / Pragmatic — compared on 6 fixed dimensions, recommendation tied to a named constraint,
written BEFORE implementation. Feeds decision slates for technical/architecture forks (FR-P6).
-->

# Design Options — [Contested Decision]

Generated: [YYYY-MM-DD]

## The decision
[One sentence: what is being decided, and why it's contested]

## Options

### Option A — Minimal
[What it is, in 2–3 sentences]

### Option B — Clean
[What it is, in 2–3 sentences]

### Option C — Pragmatic
[What it is, in 2–3 sentences]

## Comparison (6 fixed dimensions)

| Dimension | Minimal | Clean | Pragmatic |
|---|---|---|---|
| Time to ship | | | |
| Maintainability | | | |
| Scalability | | | |
| Team fit | | | |
| Risk | | | |
| Reversibility | | | |

Every cell that states a fact (not an opinion) is a claim — tag it
`[Claim: HIGH/MEDIUM/LOW impact]` and cite it in Sources below (FR-P8).

## Claims requiring Challenger review
| Claim | Impact | Challenger verdict |
|---|---|---|
| [claim text] | HIGH | [CONFIRMED / CONTRADICTED / UNVERIFIABLE / pending] |

## Recommendation
[Which option, tied to a specific named constraint from docs/CONSTRAINTS.md or the decision's own context — never "it depends" alone]

## Sources
| # | URL | Tier | Date | Credibility |
|---|-----|------|------|-------------|
| 1 | [url] | [1–4] | [date] | [H/M/L] |

## Limitations
[What couldn't be verified for any option]
