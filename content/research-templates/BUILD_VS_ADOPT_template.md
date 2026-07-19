<!--
  Provenance: original Shipwright content (no bpm-opencode-experts equivalent to import).
  Author: Shipwright W5-05 (research path)
  Created: 2026-07-18
-->

---
description: 'Reference document — read on demand, not an agent.'
disable: true
mode: "all"
---

<!--
BUILD_VS_ADOPT template — Phase 3 (Design) research deliverable, FR-P8.
Copy this content into docs/research/RESEARCH_build-vs-adopt_<topic>_<date>.md and fill in.
One of these per major component (BLUEPRINT §3.2: "build-vs-adopt comparisons for every
major component"). Depth: normally COMPARISON or DEEP DIVE.
-->

# Build vs Adopt — [Component Name]

Generated: [YYYY-MM-DD]

## The component
[What this component does, and why it needs a build-or-adopt call]

## Candidates
| Candidate | Type | Maturity | License |
|---|---|---|---|
| Build in-house | — | — | — |
| [Library/service A] | | | |
| [Library/service B] | | | |

## Comparison
| Criterion | Weight | Build | Candidate A | Candidate B |
|---|---|---|---|---|
| Fit to requirements | | | | |
| Maintenance burden | | | | |
| Security/supply-chain risk | | | | |
| License compatibility | | | | |
| Community/vendor health | | | | |
| **Weighted total** | | | | |

Every factual cell (version claims, license terms, maintenance activity, security advisories)
is a claim — tag it `[Claim: HIGH/MEDIUM/LOW impact]` and cite it in Sources below (FR-P8).
License and security-advisory claims are HIGH impact by default.

## Claims requiring Challenger review
| Claim | Impact | Challenger verdict |
|---|---|---|
| [claim text] | HIGH | [CONFIRMED / CONTRADICTED / UNVERIFIABLE / pending] |

## Recommendation
Build / Adopt [candidate], tied to the specific weighted criterion that decided it.

## Sources
| # | URL | Tier | Date | Credibility |
|---|-----|------|------|-------------|
| 1 | [url] | [1–4] | [date] | [H/M/L] |

## Limitations
[What couldn't be verified — e.g. license text not directly read, maintenance activity from a stale snapshot]
