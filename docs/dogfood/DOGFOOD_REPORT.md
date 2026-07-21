# Dogfood run report (W8-01)

The 1.0 gate (BLUEPRINT §9 W8): Shipwright's own onboard pipeline —
including the security cluster and threat-model refresh — run against this
repo through the real gateway (LM Studio, `nemotron-cascade-2-30b-a3b`,
local-first per Law 9, no network). Driver: `docs/dogfood/run-dogfood.mjs`,
composing the real `runOnboardExecution` / `onboard-board-lifecycle`
building blocks — never a reimplementation (see that file's header for the
exact seams used and why).

## Run

- Run id: `run-dogfood-1784673609795`
- Started/finished: see `receipts.json` (`startedAt`/`finishedAt`)
- Model: `nemotron-cascade-2-30b-a3b` via `http://127.0.0.1:1234/v1`
- 16 steps executed, every step `exitCode: 0` (`receipts.json`)

| Step | Role |
| --- | --- |
| landscape | landscape-mapper |
| entry-points | entry-point-tracer |
| data-model | db-architect |
| components | component-mapper |
| patterns | sdlc-lead |
| health | health-coordinator |
| architecture | sdlc-lead |
| security-sast | semgrep-runner |
| security-secrets | secrets-scanner |
| security-deps | dependency-auditor |
| security-owasp-web | owasp-web-checker |
| security-owasp-llm | owasp-llm-checker |
| security-cloud | cloud-security-checker |
| security-iac | iac-security-checker |
| security-attack-chains | attack-chainer |
| threat-model-refresh | threat-modeler |

The last nine steps are the security cluster + threat-model refresh
(AC1): `security-*` mirrors `SECURITY_CLUSTER_STEPS`, `threat-model-refresh`
is `THREAT_MODEL_REFRESH_STEP`, always last
(`packages/pipeline/src/modes/security-cluster.ts`). The threat-model
refresh step reports findings against this repo's real trust boundary
(decision-ledger atomicity, export-bundle receipt verification, route auth
coverage) — it does not itself rewrite `docs/THREAT_MODEL.md` (out of this
ticket's `write_scope`); its findings feed the board like any other step's.

## Findings → board

55 findings raised across all 16 steps (severity: 11 CRITICAL, 19 HIGH, 19
MEDIUM, 6 LOW — `run-result.json`), all 55 proposed and all 55 accepted onto
the board as real tickets (`findings-tickets.json`), signed by the operator
identity per `acceptOnboardPlanItems` (never the reporting specialist's
identity — maker ≠ verifier, Law 5). No duplicate `[role] title` pairs
occurred in this run (`findings-tickets.json.note`); the driver's DEDUP
guard (in-batch collapse by `catalogIdFor`, see `run-dogfood.mjs`) ran but
had nothing to collapse this time. On an earlier local run against this
same repo the guard *did* fire, catching a real gap:
`proposePlanItemsFromOnboardFindings` dedupes a new finding against
already-persisted `plan_items` but not against other new findings in the
same batch, so two steps reporting the identical `[role] title` crash the
insert transaction on `plan_items.id`'s unique constraint. That gap is real
and unfixed — it lives in `onboard-board-lifecycle.ts`, outside this
ticket's `write_scope` — so it is reported here rather than patched
silently.

## Coverage manifest (AC2, R-E3)

`buildOnboardCoverageManifest()` (`packages/pipeline/src/modes/
coverage-manifest.ts`) is a pure, deterministic function of the repo's own
already-committed rule/validator tables — not a report of what this
particular run happened to touch — so every onboard run enumerates the full
imported set by construction:

- **30/30 anti-slop rules** (R-01..R-30): 0 proposed, 1 shadow (R-30 — no
  single canonical definition yet, see the module's header), 23 advisory, 6
  gate, 0 deprecated.
- **76/76 imported validators**: 0 proposed, 27 shadow, 25 advisory, 24
  gate, 0 deprecated. AC2's acceptance text says "66" (the W1-01 import
  baseline); the library has grown since via later design tickets
  (data-governance, resilience-patterns, iac, ...) — 76 is the current,
  provably-real count (`coverage-manifest.ts`'s header explains the
  discrepancy; `coverage-manifest.test.ts` asserts the manifest's rule ids
  match `content/protocols/ANTI_SLOP_RULES.md`'s headings exactly and that
  the validator list's provenance split from disk is re-derived at test
  time, so this can't silently drift).

Per D-014: shadow rules ran for real but never blocked this run; gate/
advisory tags are read off already-existing facts (`phases/topology.ts`'s
phase validator sets, `anti-slop-auditor.md`'s blocking-violation list),
never decided by this module or by an LLM. Raw counts above are the full
set — no suppression occurred, so raw == effective for this manifest.

## Artifacts

- `run-result.json` — full `OnboardRunResult` (health assessment, every
  step's artifact, coverage manifest)
- `receipts.json` — per-step audit evidence (session exit code + observed
  write-scope check), each row backed by a real `onboard.step-complete`
  AUDIT event signed by that step's `specialist:<role>` identity, hash
  -chained into `.shipwright/state.db` — not a minted
  `@shipwright/events` receipt, since onboard findings are a specialist's
  self-report with no independent validator run against them (see the
  file's own `note` field and `onboard-executor.ts`'s SELF-ATTEST NOTE —
  minting a gate/coverage receipt for a self-report would be the
  self-attestation antipattern Law 4/5 forbids)
- `findings-tickets.json` — the 55 proposed/accepted plan items
- `coverage-manifest.json` — the full 30 anti-slop rule + 76 validator
  enumeration with D-014 lifecycle states
