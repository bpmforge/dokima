# File-size debt inventory (W10-40)

**Measured 2026-08-03** by running `bash content/validators/validate-file-size.sh .`
repo-wide from the repo root (cap=400, warn=300; 710 source files checked). This
is the inventory the ticket asks for — **no splits happen here** (AC6); each
split belongs to whoever owns that module the next time a ticket touches it.
Concerns and proposed chapters below were drafted by independent readers per
file/cluster, then spot-verified against the actual source (symbol names,
line numbers, and the `mintReceipt` citation below were re-grepped, not
trusted blind).

## The inventory is bigger than the ticket that ordered it

W10-40's own AC1 names **four** files over cap, measured when the ticket was
filed: `receipts.ts`, `gateway-model-port.ts`, `projects.ts`, `server.ts`. An
independent repo-wide validator run for this ticket found **six**: those
four, plus `scripts/conductor.mjs` (715 lines) and `scripts/conductor-lib.mjs`
(590 lines) — the two largest violations in the repo, neither ever named
because no ticket's diff has touched either file recently, so the
diff-scoped gate has never seen them. Both are the conductor's own
orchestration scripts. This is precisely the failure mode the ticket exists
to document — the diff-scoped gate has a blind spot large enough to hide
its own two biggest violations from itself — and is live evidence for the
[recommendation](#recommendation-ac5-diff-scoped-vs-repo-wide) below. Not
correcting AC1's text (that's the historical record of what was measured
when the ticket was filed); documenting the gap here instead.

---

## Over the 400-line hard cap (6 files)

### `packages/events/src/receipts.ts` — 553 lines (highest stakes: C-6 append-only hash chain)

Concerns (grep-verified): core types/schema (~12-39, 122-255, 399-449) —
`ReceiptKind`, `ReceiptRecord`, `ReceiptContent`, `MintReceiptInput`; waiver
human-signer policy FR-P2 (41-73) — blocklist, `WaiverSignatureRequiredError`,
`AgentWaiverRejectedError`; signing-key/MAC crypto primitives (75-211) —
`assertSigningKey`, `computeInputTreeHash`, `computeReceiptMac`, `macEqual`;
DB row↔record mapping (242-272); mint orchestration (274-390) — `mintReceipt`
(confirmed still the sole appender of `gate.receipt_minted`/`gate.waived`,
`appendEvent` call at line 363, matching STATUS.md's W10-35 citation); read
queries (392-428) — `getReceipt`, `getReceiptActor`; verification (430-553)
— `verifyReceipt`.

Proposed split — `packages/events/src/receipts/`:
- `types.ts` (~55) — shared shapes only
- `waiver-policy.ts` (~40) — blocklist + waiver errors
- `mac.ts` (~125) — hash-chain crypto (`computeInputTreeHash`, `computeReceiptMac`, `macEqual`, `assertSigningKey`)
- `mint.ts` (~156) — `mintReceipt`, the sole appender
- `query.ts` (~72) — `getReceipt`, `getReceiptActor`, `findAnchorEvent`
- `verify.ts` (~127) — `verifyReceipt`
- `index.ts` barrel (~22) — re-exports only, no new logic

Tree-shaped deps (`mint`/`verify` → `mac`/`waiver-policy` → `types`;
`query` → `types`), no cycles, depth ≤2.

**Risk**: `computeReceiptMac`/`computeInputTreeHash` rely on field-order-dependent
length-prefixing for injectivity. A split that reorders imports/evaluation or
subtly changes serialization would silently break `verifyReceipt` against
every already-minted receipt in the hash-chained log — those MACs can never
be recomputed or migrated after the fact. Whoever executes this split must
diff serialization byte-for-byte before/after, not just run the test suite.

### `scripts/conductor.mjs` — 715 lines, and `scripts/conductor-lib.mjs` — 590 lines

Tooling scripts, not workspace packages/apps — not subject to CLAUDE.md law 6
(package/app import boundaries), but chapters still must not import each
other cyclically.

`conductor.mjs` concerns: bootstrap/config (1-103); CLI args (105-119);
runtime helpers (121-145: `log`, `sh`, `git`, `loadPlan`); claim eligibility
(147-204: `ALWAYS_OK`, `claimable`, `pickModel`); board linter (206-264:
`lintPlan`); provider-limit session runner (266-303: `runSession`); gate
checks (305-373: `runValidators`, `runGates`); LLM prompts (375-398);
worktree lifecycle (400-440); per-ticket attempt loop (442-524:
`executeTicket`); land/push/block (526-601); security waiver pass (603-641);
run loop/`main` (643-716).

Proposed split — `scripts/conductor/`: `config.mjs`(~118), `runtime.mjs`(~25),
`claim.mjs`(~58), `lint.mjs`(~59), `session.mjs`(~38), `gates.mjs`(~68),
`prompts.mjs`(~24), `worktree.mjs`(~41), `ticket.mjs`(~83), `land.mjs`(~76),
`security.mjs`(~39), `index.mjs` barrel(~89) — sums to ~718 ≈ 715.

`conductor-lib.mjs` concerns: default config + model check (25-102); claim
filter (116-129); lint rules — test-sibling/migration-collision/page-mount
(146-176, 210-240, 544-570); node-pin check (250-255); config merge/load
(258-286); allowlist (296-299); board I/O (303-387: `loadPlanFrom`,
`writePlan`); coding prompt (397-413); parsing primitives (416-441:
`globToRegex`); review policy + gate selection (463-522).

Proposed split — `scripts/conductor-lib/`: `config.mjs`(~143),
`parsing.mjs`(~27), `claim.mjs`(~26), `lint-rules.mjs`(~156), `board.mjs`(~106),
`prompts.mjs`(~25), `review.mjs`(~79), `index.mjs` barrel (~30, re-exports
only — 25 public names; `isAsciiOnly`/`asciiEscapeNonAscii` stay private,
do not add to the barrel) — sums to ~592 ≈ 590.

**Blocking gotcha for whoever executes this split**: `conductor.mjs`'s
`ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')` (line 62)
assumes the file sits directly in `scripts/`. Moving it to
`scripts/conductor/index.mjs` breaks this *silently* — `'..'` then resolves
to `scripts/`, not repo root, so `LOG`, `STOPFILE`, `WT_BASE`, and board-path
resolution all point at the wrong directory without erroring loudly. Must
become `'../..'`. Also required, not optional: `scripts/supervise.sh:139`
invokes `node scripts/conductor.mjs`; `scripts/conductor-lib.test.mjs:35`
and `scripts/conductor.integration.test.mjs` import/copy both files by
their literal current names — ESM has no directory-index auto-resolution,
so the split must update all three call sites or leave a re-export shim at
the old filename.

### `apps/server/src/api/pipeline/gateway-model-port.ts` — 450 lines

Concerns: config resolution (49-115: `resolveGatewayConfigFromEnv`,
`resolveGatewayConfigForProject`); provider construction (117-153:
`providerForConfig`, refuses cloud providers by design); generic model-call
helper (155-181: `chatJson`); three prompt-driven phases — blueprint
(183-247), technical-slate (249-304), ticket-drafts (306-388); port assembly
(390-450: `RealGatewayPort`, `createRealGatewayPort`).

Proposed split — `.../gateway-model-port/`: `index.ts` barrel (~75, holds
`createRealGatewayPort` orchestration), `config.ts`(~70), `provider.ts`(~45),
`chat-json.ts`(~30), `blueprint-phase.ts`(~70), `technical-slate-phase.ts`(~60),
`ticket-drafts-phase.ts`(~90). Confirmed compliant with law 6 (imports
`@dokima/gateway` from an app; no package calls a provider directly).

### `apps/server/src/api/projects.ts` — 433 lines

Concerns: types/errors (40-77); registry file I/O (79-118: `loadRegistry`,
`saveRegistry`); registry verbs (120-205: `registerProject`, `archiveProject`,
`removeProject` — these mutate the fleet registry file, not ticket/phase
event-log state, so law 4's receipt boundary doesn't apply here); stats
(207-268: `computeProjectStats`); card assembly (270-304); routes (306-433:
`registerProjectRoutes`, 4 routes).

Proposed split — `.../projects/`: `index.ts` barrel(~35), `types.ts`(~50),
`registry-store.ts`(~55), `registry-verbs.ts`(~95), `stats.ts`(~65),
`cards.ts`(~40), `routes.ts`(~120).

### `apps/server/src/api/server.ts` — 408 lines

Confirmed by read: this is the Fastify composition root — `buildApiServer`
(90-144) calls ~18 imported `register*` functions plus the upgrade hook;
legitimate wiring, keeps this in the barrel. Three unrelated feature bodies
are inlined alongside it: a 143-line **hardcoded chat fixture** + its route
(146-288), **WS upgrade dispatch** (290-327: `handleUpgrade`), and **static
asset serving** (329-408: `contentTypeFor`, `resolveStaticPath`,
`injectToken`, `registerStatic`).

Proposed split — `.../bootstrap/` (name must differ from the existing
`./server/` subdirectory `server.ts` already imports from at line 42 —
collision risk flagged): `index.ts` barrel(~140 — options/types +
`buildApiServer` + `listenLocalhost`), `chat-fixture.ts`(~148),
`ws-upgrade.ts`(~48), `static-assets.ts`(~85).

---

## Near-cap set (AC4) — "the next App.tsx"

### `packages/harbormaster/src/loop-land.ts` — 399 lines

Concerns: public type surface + re-exports (82-165); ticket selection/worktree
resume (167-212: `pickNextTicket`, `resolveWorktree`); single-attempt
execution (214-256: `attemptOnce`, `ceilingFor`); park reporting (258-286);
per-ticket orchestration (288-373: `processTicket` — alone mixes claim/start,
policy+ceiling resolution, the attempt loop, escalation check, push-on-land,
park/release); outer claim loop (376-399: `runLandLoop`).

Proposed split (flat `loop-*.ts` siblings — matches the package's existing
`loop-claim.ts`/`loop-gates.ts`/`loop-land-policy.ts`/`land-push.ts`
convention; a subdirectory would orphan those already-flat siblings):
`loop-land-types.ts`(~65), `loop-land-selection.ts`(~55),
`loop-land-attempt.ts`(~55), `loop-land-report.ts`(~35),
`loop-land-process.ts`(~95), `loop-land.ts` barrel(~90) — sums to ~395 ≈ 399.

### `packages/mcp/src/tool-call.ts` — 379 lines

Concerns: executor contract types (20-39); state-lookup guards (41-98:
`requireTool`, `requireAllowed`, `requirePendingApproval`); request path
(100-214: `requestToolCall`); decide path (216-379: `decideToolCall`,
`appendApprovalDecided`).

Proposed split (flat siblings, matching the package's `approval-policy.ts`/
`digest.ts`/`errors.ts`/`reducer.ts` convention): `tool-call-types.ts`(~75),
`tool-call-guards.ts`(~65), `tool-call-request.ts`(~100),
`tool-call-decide.ts`(~150), `tool-call.ts` barrel(~30).

### `packages/gateway/src/providers/anthropic.ts` — 379 lines

This file is **already a barrel that regrew**: its own header (lines 33-41,
self-documented) records a prior split into `anthropic-types.ts`/
`anthropic-helpers.ts`; the regrowth happened because the barrel kept the
whole `AnthropicProvider` class body instead of just the public surface +
wiring. Concerns: HTTP transport (`fetchRaw`, `throwForStatus`, `buildBody`);
non-streaming chat (`chat`, `chatOnce`); streaming chat (`chatStreaming`,
`streamEvents`); model discovery/health (`listModels`, `health`, `warmUp`).
The fixture/recorded-response path is **not** in this file — already
isolated in sibling `anthropic-fixtures.ts` (137 lines), reached via the
same `fetchImpl` injection seam.

Proposed split (flat `anthropic-*.ts` siblings, matching the file's own
stated precedent and `copilot.ts`, so every chapter stays inside a ticket's
`anthropic*` write_scope glob): `anthropic-transport.ts`(~70),
`anthropic-chat.ts`(~65), `anthropic-streaming.ts`(~100),
`anthropic-models.ts`(~80), `anthropic.ts` barrel(~65 — class fields,
constructor, delegating methods, factory).

---

## Remaining WARN-tier files (306-378 lines, 16 files)

Compact rows — concern + split axis, not full chapter designs (these
violate nothing yet; a full directory design now would be speculative work
against a target that keeps moving as the files evolve).

| path | lines | main concerns | proposed split axis |
|---|---|---|---|
| `packages/gateway/src/providers/oai-compat.ts` | 378 | `OaiCompatProvider` class (chat/stream/models/health/warmup), factory fns; already split into sibling `oai-compat-types.ts`/`oai-compat-helpers.ts` | request/chat vs streaming vs health/warmup, keeping factories + class shell as barrel |
| `packages/loop/src/findings-ledger.ts` | 375 | `createFindingLedger` factory (`reportPass`, `recheck`, `suppress`, `reopenIfContextChanged`), standalone `computeFindingFunnel` | ingestion vs recheck/suppression lifecycle vs funnel computation |
| `apps/server/src/api/lessons/routes.ts` | 373 | `registerLessonsRoutes` (3 routes), `eventSinkFor` bridge, filedBy/triagedBy resolution | file/list routes vs the triage route (dominant, branches on playbook/ticket/reject) |
| `packages/gateway/src/escalation/policy.ts` | 369 | `resolveEscalationPolicy`, dispatcher `runEscalationPolicy`, `runLockedPolicy`, `runTokenGatedPolicy` | `locked` vs `token-gated` as sibling chapters, dispatcher+helpers stay in barrel |
| `apps/web/src/palette/CommandPalette.tsx` | 362 | open/close key handling, data-fetch effects (tickets/docs/receipts/codeIndex), `selectResult`/`fireVerb`, JSX render | data-fetching/state into a hook vs presentational render as child components |
| `packages/forge/src/types.ts` | 357 | capability/identity types, `ForgeHttpError` + 6 subclasses, domain interfaces (repo/PR/issue/status), `ForgeAdapter` contract | errors.ts vs domain shapes vs `ForgeAdapter` contract as barrel |
| `packages/pipeline/src/plans/expr.ts` | 355 | tokenizer, recursive-descent `Parser` class, evaluator (`evalNode`/`compare`), path resolution | tokenizer+parser (syntax) vs evaluator+path-resolution (semantics) |
| `apps/server/src/api/plans-store.ts` | 338 | `computeFunnel`, `listPlanItems`, `evaluatePlan`, `acceptPlanItem`, `dismissPlanItem`, `verifyPlan` | evaluate/propose vs accept/dismiss vs verify, mirroring existing `plans-store-rows.ts` split |
| `packages/harbormaster/src/loop-gates.ts` | 342 | `runCloseGate` barrel: manifest/symlink checks, `reRunVerify`, diff-scope checks, validator-pack run, `mintReceipt`+`closeTicket` | split `runCloseGate`'s phases alongside existing `loop-gates-verify.ts`/`loop-gates-secrets.ts` siblings |
| `packages/harbormaster/src/resume.ts` | 326 | `checkClaimedTicket`/`resumeProject` two-phase resume, receipt lookup helpers, TOCTOU checks, transactional `closeTicket` batch | check-only verification vs transactional commit vs receipt-accessor helpers |
| `packages/loop/src/coverage.ts` | 325 | `createCoverageTracker` state machine (start/complete/waive/finalize), `buildReport`, JSON/Markdown serializers | tracker state machine vs report construction + renderers |
| `apps/server/src/api/server/estimate-routes.ts` | 322 | `DEFAULT_ROLE_MATRIX`/`estimateForTicketCount` calc engine, 4 route registrars, honest-empty assumption notes | calc engine vs route handlers; estimate/what-if vs spend/digest routes |
| `packages/harbormaster/src/berths.ts` | 319 | `runBerths`/`runOneBerth` claim-start-run-land loop, `resolveBerthWorktree`, `checkBreakpointAfterLanding`, re-exports from 3 siblings | single-berth loop vs worktree/breakpoint helpers vs the re-export barrel |
| `apps/server/src/api/decisions/routes.ts` | 309 | `registerDecisionRoutes` (4 routes), `requireAuth` preHandler, `parseCreateInput`/`toWire` mappers | slate-creation/listing vs decide/decisions-ledger routes, with auth+mapper helpers split out |
| `docs/dogfood/run-dogfood.mjs` | 309 | dynamic repo-module imports, `retryingDispatch`/`jitteredFetch` retry logic, onboard-execution dedup, 4 `writeFile` artifact writers | driver/dispatch-retry vs artifact-writer functions (one per output JSON file) |
| `packages/gateway/src/providers/openai.ts` | 306 | `OpenAiProvider` composing `OaiCompatProvider`, SSE `streamEvents`/`chatStream` path, `parseRetryAfterMs`/`throwForStatus` | non-streaming delegation/error-mapping vs SSE streaming implementation |

---

## Recommendation (AC5): diff-scoped vs repo-wide

**How diff-scoping actually works today** (`scripts/conductor.mjs:305-328`,
`runValidators`): every ticket run already invokes
`validate-file-size.sh .` **repo-wide** — the shell script itself has no
diff awareness and scans all 710 source files every time. "Diff-scoped"
describes what happens *after*: line 322 keeps only the findings whose
`detail` string matches a path in `changed` (`git diff --name-only
main...branch`), so an untouched over-cap file's finding is computed, then
thrown away before it can become a gap. This matters for the recommendation:
going repo-wide is not a new, expensive scan — it is deleting or relaxing
one filter. The same mechanism and the same filter apply to
`validate-circular-deps`, the only other `gate[]`-tier validator.

**The trade-off, stated plainly.** Diff-scoping is defensible: a ticket
answers for what it changed, not the repo's accumulated debt, and W10-33's
own notes make the case — bundling a 553-line mandatory split into a
"wire two controls" diff would make that diff unreviewable. That fairness
property is real. Its cost is what this ticket exists to name: the 400-line
cap stops being a standard anyone can rely on and becomes a lottery — whoever's
ticket first happens to touch `receipts.ts` inherits a mandatory unplanned
split, at whatever size it has drifted to by then, with a write_scope that
was never budgeted to cover it. A rule that only sometimes applies, invisibly,
is worse than either a rule that always applies or no rule — it looks
enforced (the gate is "on") while quietly not being.

**Why flipping it on today would self-DoS.** This ticket's own discovery is
the evidence: `scripts/conductor.mjs` (715) and `scripts/conductor-lib.mjs`
(590) are the two largest violations in the repo, and they are the mechanism
that runs the gate. If repo-wide were switched on as a hard gate this week,
every ticket's gate would fail immediately on files it never touched,
including the conductor's own source — before anyone could land a fix,
because landing the fix is itself a ticket that would fail the same gate.

**Recommended sequencing** (not applied here — AC6, no config change in this
ticket):
1. Land this inventory (this ticket).
2. Burn down the 6 over-cap files as their own tickets, owned by whoever
   owns that module. Prioritize `conductor.mjs`/`conductor-lib.mjs` first —
   they gate every other ticket, so their debt is the one actively blocking
   the rest of this plan, not just a landmine for a future ticket.
3. Once repo-wide shows zero files over cap, flip `validate-file-size` from
   diff-scoped to repo-wide in the `gate[]` pass (drop the `changed.some(...)`
   filter for this validator specifically) — at that point it costs nothing
   to enforce, because there is nothing left for it to catch by surprise.
4. Optionally, before step 3 is even reachable: add a repo-wide **advisory**
   report (no gate change, no blocking) that surfaces the full over-cap/
   over-warn list on every run or at each wave gate, the way this document
   does by hand. That would have caught the conductor's own two violations
   automatically instead of requiring a dedicated inventory ticket to notice
   them, without changing what blocks anyone's merge.

Net recommendation: **move toward repo-wide, but only after the burn-down in
step 2** — repo-wide-as-gate today is unimplementable, not just risky,
because the gate's own implementation is currently in violation of the rule
it would enforce.
