# Security waivers — human-signed acceptances of known findings

The conductor's wave security pass halts on any CRITICAL. A CRITICAL that
matches an active row below is downgraded to a logged known-risk
(`security.waived`) instead of halting. Waivers are NEVER-AUTO: they must be
signed by a human (agent/model names are rejected by `loadSecurityWaivers`).

Match semantics: a CRITICAL is waived when its `file` contains `file_match`
AND its `issue` contains `issue_match` (case-insensitive). Keep matches
narrow so a genuinely new CRITICAL in the same file still halts.

| id | date | signed_by | file_match | issue_match | reason |
|---|---|---|---|---|---|
| SW-001 | 2026-07-11 | Brad Matthews | plan.json | status | Bootstrap-harness acceptance: the conductor tracks build progress by editing plan.json status without receipts. plan.json here is the conductor's own work-tracker (scaffolding), NOT the product's runtime ticket state — the product uses the events log as source of truth once the ticket engine (W0-05 receipts) + Harbormaster (W3-01) land. Accepted as a documented known risk for the bootstrap build; the proper fix is the plan being built downstream. Tracked in docs/STATUS.md. |
