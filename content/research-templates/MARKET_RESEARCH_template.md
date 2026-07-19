<!--
  Provenance: original Shipwright content. Checked bpm-opencode-experts skills/ and
  agents/templates/ for an equivalent market-research template — none exists (that repo's
  researcher agent treats "market research" as an ad hoc research task, not a fixed-structure
  deliverable). Note: this directory's design-options template IS adapted from that repo —
  see content/research-templates/VENDORED.md.
  Author: Shipwright W5-05 (research path)
  Created: 2026-07-18
-->

---
description: 'Reference document — read on demand, not an agent.'
disable: true
mode: "all"
---

<!--
MARKET_RESEARCH template — Phase 0 (Idea) research deliverable, FR-P8.
Copy this content into docs/research/RESEARCH_market_<topic>_<date>.md and fill in.
Depth: this task is normally COMPARISON or DEEP DIVE (content/experts/phase-specialists/researcher.md).
-->

# Market Research — [Product/Feature Name]

Depth: [quick | standard | deep]
Generated: [YYYY-MM-DD]

## Executive Summary
[2–3 sentences: the market opportunity and the recommendation this research supports]

## Questions Answered
- [DONE] Q1: Who are the direct and adjacent competitors?
- [DONE] Q2: What need is underserved by existing offerings?
- [DONE] Q3: What is the pricing/positioning landscape?

## Findings

### Q1: Competitive landscape
| Competitor | Positioning | Strength | Gap |
|---|---|---|---|
| [Name] | [one line] | [one line] | [one line] |

Each row's Positioning/Strength/Gap cells are claims — every factual one needs a `[Claim: HIGH/MEDIUM/LOW impact]` tag and a citation in Sources below (FR-P8).

### Q2: Underserved need
[Findings, cited]

### Q3: Pricing/positioning
[Findings, cited]

## Claims requiring Challenger review
List every claim tagged `HIGH impact` above. HIGH-impact claims may not be cited by a
decision slate until a Challenger verdict of CONFIRMED is recorded (FR-P8/US-105 AC-2).

| Claim | Impact | Challenger verdict |
|---|---|---|
| [claim text] | HIGH | [CONFIRMED / CONTRADICTED / UNVERIFIABLE / pending] |

## Recommendation
[Actionable next step tied to a named finding]

## Sources
| # | URL | Tier | Date | Credibility |
|---|-----|------|------|-------------|
| 1 | [url] | [1–4] | [date] | [H/M/L] |

## Limitations
[What could not be verified; what data is missing]
