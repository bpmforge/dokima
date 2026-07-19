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
PRE_CODE_API_VERIFICATION template — Phase 4 (Build) research deliverable, FR-P8.
Copy this content into docs/research/RESEARCH_pre-code-api_<package>_<date>.md before writing
any code against a package you have not verified this session. Implements MASTER_PROMPT.md's
"verify before writing" step: check the real exports/signatures via Context7 or node_modules —
never training data — before calling any external package API.
-->

# Pre-Code API Verification — [Package Name]@[Version]

Generated: [YYYY-MM-DD]

## What is being verified
[The specific function/class/export this ticket needs to call, and why training-data
recall isn't trusted for it]

## Verification method (pick at least one, record which)
- [ ] Context7 docs lookup — query: [exact query used]
- [ ] `node --input-type=module -e "import * as pkg from '<lib>'; console.log(Object.keys(pkg))"` — output attached below
- [ ] Direct read of `node_modules/<package>/package.json` `exports` map + the referenced `.d.ts`

## Verified signature
```ts
// Exact signature as found in the real package, not recalled from training data
```

## Version pin
Declared in `docs/TECH_STACK.md`: [version]. Matches installed `node_modules` version: [yes/no — if no, stop and reconcile before writing code].

## Claims requiring Challenger review
An API-shape claim (e.g. "this function accepts an options object with field X") is HIGH
impact when code will be written against it sight-unseen from this doc — tag it
`[Claim: HIGH impact]` and cite the verification method above; it may not be cited by
implementation until CONFIRMED (FR-P8/US-105 AC-2).

| Claim | Impact | Challenger verdict |
|---|---|---|
| [claim text] | HIGH | [CONFIRMED / CONTRADICTED / UNVERIFIABLE / pending] |

## Known traps
[Any documented gotcha for this package — e.g. sync vs async API, ESM/CJS interop quirk]

## Sources
| # | Source | Tier | Date |
|---|--------|------|------|
| 1 | [Context7 / node_modules path / official docs URL] | 1 | [date] |
