# W10 — attest parity, the scribe guide, and tests that can fail

**Status:** proposal, not yet ticketed into `plan.json`.
**Date:** 2026-08-02. **Author:** planning session.

Three asks, one wave: (1) Dokima should do what the expert system does,
and the expert system has moved; (2) Dokima is a GUI, so it needs a
scribe-grade screenshot tour, not a happy-path slideshow; (3) tests that
demonstrate the functional surface actually works, mutation-gated rather
than green-by-construction. A fourth thread — current Claude Code
integration surface — falls out of (1), because the conductor spawns
`claude -p` sessions.

The wave is written as tickets (lane / write_scope / depends_on) so it can
run under `scripts/conductor.mjs` per Law 1, not as a free-floating doc.

---

## 0. What the drift actually is (measured, not estimated)

The upstream repo was **renamed**: `bpm-opencode-experts` → **`attest`**
(commit `1052241`, shipped in v3.0.0). Nothing in Dokima records this.

| Fact | Value | How measured |
|---|---|---|
| Dokima `content/` import date | 2026-07-12, `sourceRepo: bpm-opencode-experts` | `content/index.json` |
| Upstream version then | v2.1.0–v2.12.0 era | `~/Code/attest/CHANGELOG.md` |
| Upstream version now | **v3.1.24** | `~/Code/attest/package.json` |
| Commits in `v2.12.0..v3.1.24` | **169** (**133** non-merge) | `git rev-list [--no-merges] v2.12.0..v3.1.24` |
| Expert files imported | 88 (+1 orphan) | `find content/experts -name '*.md'` |
| **Expert files whose body drifted** | **71 of 88** | body-hash compare, provenance header stripped |
| Expert files identical | 17 | same |
| Imported files carrying a host-install path (`~/.config/opencode/…`) | **72 today, 95 upstream** | `grep -rl '~/.config/opencode'` |
| Upstream agents never imported | 6 (`qa-vnv-engineer`, `E2E_INFRASTRUCTURE`, `level-designer`, `game-producer`, `game-audio-designer`, `narrative-designer`) | name set difference |
| Imported file gone upstream | 1 (`pm-interviewer.md`) | same |
| Validators with **real** body drift | **8** — `validate-completion-manifest.sh` (144 changed lines), `validate-handoff-discipline.sh` (76), `run-handoff-gates.sh` (45), `validate-tickets.sh` (31), `validate-scope.sh` (20), `validate-phase-gate.sh` (7), `validate-doc-catalog.sh` (3) | normalized diff (shebang + provenance header excluded) |
| Validators removed / added upstream | 3 gone / 2 new | name set difference |
| Content tiers upstream that `content/` carries **none** of | **43 skills, 6 commands** | `ls ~/Code/attest/skills \| wc -l` |

**The 71 was checked for the artifact that fooled the first validator
count.** The importer rewrites `.sh` shebangs, so a naive diff reported
78-of-78 validators "changed" when only 8 really were. The expert numbers
were re-derived after that correction and then spot-confirmed by eye:
`sdlc-lead.md` gained a whole Resume Protocol row, `guide-scribe.md` gained
a 50-line mandatory HANDOFF-intake section, `code-reviewer.md` gained
"Every REJECT names code that exists" (+88 lines). The drift is
substantive. The 17 identical files are corroboration — a systematic
rewrite would have made that number zero, as it did for validators.

**A defect the measurement surfaced, pre-existing and about to get worse.**
72 already-imported files hardcode `~/.config/opencode/agents/shared/…`
and `~/.config/opencode/scripts/validators/…` — a host-install path that
does not exist under Dokima. `scripts/import-content.mjs` does no path
rewriting (verified: its only `.replace` calls strip comments and file
extensions). Upstream has grown that to 95 files, so a naive re-import
makes an existing portability bug 30% worse.

**The signal in that table:** the heavy validator drift is concentrated
in exactly the gate machinery — completion-manifest, handoff-discipline,
scope, tickets, phase-gate. That is the trust core Dokima reimplements
in TypeScript (`packages/tickets`, `packages/loop`, `packages/harbormaster`,
`packages/validators`). So parity is **not** a data refresh. It is a data
refresh *plus* an engine question, and the two must be sized separately.

**Blocker already present:** `scripts/import-content.mjs:26` hardcodes
`sourceRoot = '/Users/bmatthews/Code/bpm-opencode-experts'`, a path that no
longer exists. Re-import is currently broken and would fail — or worse,
silently import nothing. `docs/ROADMAP.md` still names the resync
precondition against "v2.10.0+".

**W9-08 is an ordering hazard, not a free unblock — and the plan initially
had this backwards.** W9-08 (`status: blocked`) must edit
`content/validators/validate-mermaid.sh` + `content/manifest.json`: the
script exits 0 with zero-byte stdout, which `run.ts` normalizes to
`exitCode: 2`, so the validator every phase gate requires can never pass.
Its write_scope is inside imported content, which is why ROADMAP calls it
"blocked on a content re-sign, not on code." **Upstream has not fixed it**
— attest's current `validate-mermaid.sh` still has `validator_exit` only as
a comment (line 329), and diffs clean against our copy. So the fix is
Dokima-local, and a re-import run *after* W9-08 would silently clobber
it. W10-02 must therefore ship a local-override registry (or W9-08 lands
after W10-03 and is re-applied on top). Either way it is an explicit
sequencing decision, not something to discover at merge time.

---

## 1. Phase A — size the engine bucket with evidence (blocks everything)

### W10-01 · lane `quality` · 5 pts · deps: none
**write_scope:** `docs/work/ATTEST_PARITY_MATRIX.md`

**Pinned range: `v2.12.0..v3.1.24`, `--no-merges` — 133 commits.** (The
full range is 169; upstream merges each feature branch, so a per-commit
matrix would double-count every change — e.g. `900cc26 feat: retry budgets…
(C+D, v2.47.0)` and `631b606 merge: retry budgets… (C+D, v2.47.0)` are one
change.) The **row unit is a change, not a commit**: each row carries the
SHA list of the commits that make it up.

Classify every change into exactly one bucket:

- **C — content-only.** A prompt/agent/protocol edit. Fixed by re-import.
- **E — needs Dokima code.** A mechanic Dokima reimplements in TS.
- **N — no analogue.** An attest-internal implementation detail (its own
  build scripts, its `dist/` generation, its opencode packaging).

Each **E** row names a real target path in `packages/*` and a proposed
ticket. Known E-bucket candidates from the changelog, to be confirmed or
demoted by the matrix:

| Upstream | Change | Likely Dokima target |
|---|---|---|
| v2.39.0 | verify-receipt: the agent no longer authors its own pass/fail | `packages/loop`, `packages/tickets` — already C-4 law here; confirm parity |
| v2.42.0 | declared invariants + bounded review packets | `packages/loop` |
| v2.47.0 | retry budgets **by failure class**; evidence outranks the claim | `packages/loop` |
| v2.49.0 | findings must be grounded; a manifest must not ask the user to choose | `packages/validators`, `packages/tickets` |
| v3.1.8–11 | greenfield tickets unpassable; `write_scope` must cover its own tests (`TEST_SIBLING_STRICT`) | `packages/tickets` scope checker + `scripts/validate-plan.mjs` |
| v3.1.14 | G6 — a manifest the session cannot write kills the ticket | `packages/harbormaster` startup gates |
| v3.1.16 | reviewers triggered by the **diff**, not pre-declared | `packages/harbormaster` review dispatch |
| v3.1.21–23 | verdicts must be evidence-based; a CLEAN run reporting FAIL is not evidenced; "missing script" is not a failure | `packages/validators` verdict contract |
| v3.1.19–20 | a failed attempt destroyed the code / the evidence of why it failed | `scripts/conductor.mjs` (twin of the W9-16 work-destruction guard) |

**Acceptance:** every one of the 133 non-merge SHAs appears in exactly one
row's SHA list — asserted by a script against `git rev-list --no-merges
v2.12.0..v3.1.24`, not by eye; every E row names a `packages/*` path that
exists; the matrix's E-count is what sizes Phase C. Red fixture: a
deliberately dropped SHA, and a SHA duplicated across two rows, must each
red the completeness check.

> Why this is ticket 1 and not a paragraph: without it, Phase C is
> guesswork. 133 changes is the number where intuition is wrong.

---

## 2. Phase B — content refresh (lane `content`, serialized)

### W10-02 · 5 pts · deps: none
**write_scope:** `scripts/import-content.mjs`, `scripts/sign-content.mjs`,
`scripts/import-content*.test.mjs`, `scripts/sign-content*.test.mjs`
*(narrow, not `scripts/*.test.mjs` — that glob would collide with W10-16's
`scripts/conductor*.test.mjs` across lanes, which is a schema bug under
Law 1, not something to work around)*

Un-break the importer, four changes:

1. **Configurable source root** (same pattern W9-10 used for `boardPath`),
   with the upstream version **pinned and recorded**.
2. **Rename** the provenance string to `attest`, keeping
   `bpm-opencode-experts` as a documented alias so existing headers stay
   explicable.
3. **Host-path portability** — rewrite `~/.config/opencode/…` references to
   Dokima's content-relative form at import time (§0: 72 files today,
   95 upstream).
4. **Local-override registry** — files Dokima has patched locally
   (`validate-mermaid.sh` per W9-08) are re-applied after import, or the
   import refuses and names them. Silent clobber is the failure mode.

Add `--dry-run` producing a change report (added / removed / drifted).

**Acceptance:** dry-run against `~/Code/attest` @ v3.1.24 reproduces the
counts in §0. Red fixtures: (a) a missing/wrong `sourceRoot` **exits
non-zero with a named error** — today's failure mode is a silent empty
import, which is exactly how a "successful" resync deletes the library;
(b) an import that would overwrite a registered local override fails loudly.

### W10-03 · 8 pts · deps: W10-02
**write_scope:** `content/**`, `docs/STATUS.md`

Execute the re-import + re-sign at the pinned version.

**Acceptance:** the 71 drifted experts and 8 drifted validators are updated;
the 6 new agents land; `pm-interviewer.md`'s removal and the 3 removed
validators are **recorded in STATUS.md, not silently dropped**;
`content/index.json` + `content/manifest.json` regenerate; signature verify
green; no `~/.config/opencode/` path survives the import. **W9-08's
sequencing decision is executed and recorded here** (see §0 — this is a
clobber hazard, not a free unblock).

### W10-04 · 3 pts · deps: W10-03
**write_scope:** `apps/server/src/api/roster-*.ts` and their tests

The roster API parses agent frontmatter (`roster-content.ts`,
`roster-frontmatter.ts`, `roster-resolve.ts`). v3.x agents carry a different
shape — `mode: "subagent"`, the mandatory HANDOFF-intake block, per-agent
WRITE-SCOPE/PRODUCE tables. A refresh that changes frontmatter and leaves
the parser alone breaks the roster **while `pnpm test` stays green on the
old fixtures**.

**Acceptance:** roster golden tests re-baselined against real v3.1.24 files;
red fixture — a v3-shaped frontmatter file the *old* parser mis-reads must
red the new test. Verified by reverting the parser, not by reading it.

### W10-05 · 5 pts · deps: W10-01
**write_scope:** `content/skills/**`, `content/index.json`, loader tests

Upstream ships **43 skills + 6 commands**; `content/` carries no skills
tier at all. W10-01's matrix decides whether that is a gap or a non-goal
(Dokima's pipeline phases may already subsume them). Either outcome is
acceptable — but it gets **written down** in `docs/NON_GOALS.md` if it is a
non-goal, rather than remaining an unexamined absence.

---

## 3. Phase C — engine parity (lane `engine`, sized by W10-01)

Ticket list is **deliberately not fixed here** — W10-01 produces it. Reserve
`W10-06 … W10-09`, ~8 pts each, write_scopes confined to one package apiece
so the lane serializes cleanly:

- `packages/loop/**` — retry budgets by failure class; evidence-over-claim
- `packages/tickets/**` — write_scope-covers-its-own-tests; greenfield class
- `packages/harbormaster/**` — G6 manifest gate; diff-triggered reviewers
- `packages/validators/**` — evidence-based verdict contract

**Every one ships its red fixture** (Law 4, `docs/TESTING.md` §6). Any
ticket touching gates is not closeable on a green suite alone.

---

## 4. Phase D — the scribe tour (lane `ui`)

### What exists vs. what "scribe level" means

`apps/web/scripts/capture-tour.mjs` is 232 lines of **13 hand-written
linear steps**. It is honest work — real server, real event log, zero mocks,
Law 9 clean — but it has no state inventory, no coverage denominator, no
quality gates, no annotation, and no error triage. It cannot answer "what
fraction of the app is documented?" because nothing defines the whole.

The current upstream contract (`~/Code/attest/agents/app-cartographer.md`,
`guide-scribe.md`, `manual-writer.md`, `agents/shared/GUIDE_CAPTURE.md` —
all newer than the copies in `content/`) defines a three-stage pipeline
whose first stage is the missing piece: **a page-graph state inventory plus
a per-state interactive-element inventory — the double denominator every
later artifact is graded against.**

Upstream tooling status, checked: `skills/user-guide/scripts/img-gate.mjs`
and `annotate.mjs` **exist and are tested** (T21.2 — portable, deps `sharp`
+ `pixelmatch`). The spec-replay runner (T21.3) and
`validate-guide-coverage.sh` (T21.4) **do not exist upstream** — Dokima
would build them first.

### W10-10 · 8 pts · deps: none (parallel with Phase B)
**write_scope:** `docs/guide/APP_MAP.md`, `docs/guide/STORIES.md`

Cartography of `apps/web` against the real running app. `APP_MAP.md`: every
reachable state (Fleet, workspace three-pane, board + drawer, trace,
artifacts + diff/mermaid, plans/improvement, morning queue, roster, lessons,
estimate, settings, decisions, notifications, onboarding, palette,
shortcuts, both themes) with its edges, plus the destructive-edge firewall
list. `STORIES.md`: the element claim table — every `E-*` ID claimed by a
goal-titled story or explicitly `SKIPPED: <reason>`.

**Acceptance is a number, not "the file exists":** every `E-*` in
`APP_MAP.md` appears in `STORIES.md`'s claim table exactly once, claimed or
skipped-with-reason. That's a deterministic check.

### W10-11 · 8 pts · deps: none
**write_scope:** `apps/web/scripts/guide/**`

Capture tooling. Port `img-gate.mjs` + `annotate.mjs` under Dokima's own
provenance discipline, then build what upstream lacks: the **replayable spec
runner** — `docs/guide/specs/<task>.json`, one action per step, re-runnable
with `--refresh`. Gates per `GUIDE_CAPTURE.md` §3:

- **Gate A** blank/near-blank — pixel stddev, dominant-color ratio vs a
  calibrated per-app baseline, file-size floor
- **Gate B** error state — console `error`/`pageerror`, any 4xx/5xx,
  `role=alert`, error-text regex, against a per-route whitelist
- **Gate C** premature capture — no loader/skeleton, expected element
  visible, **two-shot stability diff**

Retry ×3 → `BLOCKED` with gate evidence attached. Never ship a gate-failed
image; never drop a failed step silently.

**Red fixtures (this is the whole point):** a deliberately blank page must
trip Gate A; a seeded 500 must trip Gate B; a capture taken mid-skeleton
must trip Gate C. A gate that cannot be made to fail is not a gate.

### W10-12 · 8 pts · deps: W10-10, W10-11
**write_scope:** `docs/guide/specs/**`, `docs/guide/screenshots/**`,
`docs/guide/BUG_LOG.md`

Execute the capture over every story. Triage every Gate-B trip **before
proceeding**: bug (→ `BUG_LOG.md` row + excluded from the manual + a real
Dokima ticket) / documented error state (→ Troubleshooting chapter) /
suspect (→ documented **and** `⚠ suspect` row). Never resolve ambiguity
silently.

**This ticket is expected to find real bugs.** A run that finds zero is
itself a finding — it means the gates aren't gating, and gets investigated
rather than celebrated.

### W10-13 · 5 pts · deps: W10-12
**write_scope:** `scripts/validate-guide-coverage.mjs` + test

Coverage validator (net-new; upstream's T21.4 is unbuilt). Fails if
`STORIES.md` drifts from `APP_MAP.md`, if the manual cites a figure whose
gate manifest is not all-PASS, or if a spec step has no corresponding
screenshot.

**Staleness contract — the reason this ticket exists at all.** Specs and
screenshots rot the moment the UI moves, and this repo has already lived
that: e2e sat outside the gate and a `plans.spec.ts` assertion stayed
silently red from W5-16 until an audit days later (CLAUDE.md Law 3).
So: the **validator** runs in the workspace gate for every ticket — it is a
file/manifest cross-check with no browser, milliseconds, and it catches the
drift that matters (a spec citing an element `APP_MAP.md` no longer has).
The **capture run** does not — it is minutes, and belongs to (a) any ticket
whose write_scope touches `apps/web/src/**`, via `--refresh` on the affected
specs, and (b) a full re-capture at wave close.

### W10-14 · 5 pts · deps: W10-12, W10-13
**write_scope:** `docs/guide/**` (manual chapters)

The Diátaxis manual — tutorial / how-to / reference / troubleshooting —
assembled from `APP_MAP.md`'s skeleton, the specs, and the gated
screenshots. **No step exists without a spec and a passing screenshot
behind it.** `docs/tour/TOUR.md` becomes the 13-shot marketing tour derived
from the guide, or is retired in its favor.

---

## 5. Phase E — Claude Code integration (lanes `gateway`, `orchestrator`)

**Design constraint stated up front (Law 9 / C-1):** every item here is a
**gateway adapter plus recorded fixtures**. No test makes a live model call;
no Dokima component becomes model-agentic. "Make it agentic" framings
are out of scope by construction.

Current surface, verified against the official changelog (see §7):

| Capability | Version | Why Dokima cares |
|---|---|---|
| `--forward-subagent-text` / `CLAUDE_CODE_FORWARD_SUBAGENT_TEXT` | v2.1.211 | subagent text + thinking in stream-json — the **session-trace viewer** currently sees nothing from nested work |
| `mcp_server_errors` in the stream-json init event | v2.1.219 | a skipped `--mcp-config` entry is currently a silent capability loss mid-run |
| `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION` (default 200) | v2.1.212 | an unattended conductor run can hit a cap it never declared |
| `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` (default 3, was 1) | v2.1.217 | nesting depth changed under us |
| MCP calls >2 min auto-background, `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` | v2.1.218 | changes what "hung" means to the watchdog |
| `--dangerously-skip-permissions` now applies to spawned agents | v2.1.200 | trust-boundary relevant — C-2/C-3 |
| `sandbox.*` settings (`credentials`, `filesystem.disabled`, `network.strictAllowlist`) | v2.1.183/216/219 | overlaps W6-06's own sandbox; do not double-implement |

### W10-15 · gateway · 5 pts
**write_scope:** `packages/gateway/src/adapters/claude-code/**` + fixtures
Adapter + **recorded** stream-json fixtures covering the init event,
subagent-text frames, and `mcp_server_errors`. Red fixture: a fixture with a
non-empty `mcp_server_errors` must surface as a run-level warning, not be
parsed and discarded.

### W10-16 · orchestrator · 3 pts
**write_scope:** `scripts/conductor.mjs`, `models.json`, `conductor.config.json`
Align the conductor's own `claude -p` invocation with the current contract
and **assert the resolved model**. Upstream v3.1.1 was literally *"the model
it asks for is not the model that runs"* — the twin has already been bitten.
Red fixture: a config asking for model X while the session reports Y must
fail the run, not proceed.

---

## 6. Phase F — tests that can actually fail

### The honest starting position

The existing `apps/web/e2e` suite is **not** smoke tests. Reading
`board.spec.ts`: real Fastify server, real per-project `state.db`, tickets
seeded through the real hash-chained event log, real pointer-based drag, no
mocked browser APIs. Depth is fine.

**Breadth and mutation-resistance are the gap.** ~51 tests across 13 spec
files for an app with ~86 components, against **no denominator at all** —
and this repo has already been burned twice by tests that were green for the
wrong reason:

- **W9-09** — a round-trip test stayed green when `serializePlan`'s indent
  broke, because `JSON.parse` ignores whitespace.
- **W9-11** — breaking `serializePlan` redded 4 tests, but reverting only
  the **production call site** left all 28 green: *"a correct function that
  never reached production."*

The house rule from those: **break the subject, confirm red — never verify
by reading the test.**

### W10-17 · quality · 8 pts · deps: W10-10
**write_scope:** `apps/web/e2e/**`, `docs/TESTING.md`

Mutation audit against W10-10's denominator. For each state and each
functional claim in `APP_MAP.md`/`STORIES.md`:

1. Is there a test that asserts it?
2. **Break the production path and confirm the test reds.** A test that
   stays green when its subject is broken is a defect, and it gets fixed or
   deleted in this ticket.

Output: a coverage table in `docs/TESTING.md` — states covered / total,
functional claims mutation-verified / total — plus new tests for the gaps.
Whatever is deliberately left uncovered gets a written reason, so the number
is honest rather than flattering.

**Not a separate "write tests" phase for the rest of the wave.** Every W10
ticket above carries its own red fixture as acceptance. A test bucket at the
end is exactly the shape that never gets mutation-gated.

---

## 6a. Phase G — "pick any provider and model, including local" (lane `gateway`)

### What is already built, and it is a lot

The adapters are real and contract-tested on recorded fixtures (W2-01…09,
all `done`): `anthropic`, `openai`, `copilot`, `vertex`, and `oai-compat`
with `createOllamaProvider` / `createLmStudioProvider` factories. The
`Provider` contract already carries **`listModels()`** and `warmUp()`, and
`oai-compat.ts`'s module doc documents `/v1/models` + `/v1/chat/completions`
against LM Studio (`:1234/v1`) and Ollama (`:11434/v1`). The role matrix
(`routing/`) resolves `(role, taskType)` → `[primary, ...fallbackChain]`
across run > project > global, with `guardMakerVerifierDistinct` refusing a
verifier landing on the maker's model **structurally** (W2-05). Presets
All-local / Hybrid / All-cloud ship. `model_matrix` is a real table with
GET/PUT routes, a GUI panel, and a `settings.changed` audit event.

**So the primitives are done.** The gap is not the engine.

### The gap: the settings→gateway seam is unwired, in three places

The only production model-call path in the product is
`apps/server/src/api/pipeline/gateway-model-port.ts` (and its twin
`onboard-dispatch-port.ts`). Both do this:

```ts
export function resolveGatewayConfigFromEnv(env = process.env): GatewayConfig {
  return {
    baseUrl: env.DOKIMA_MODEL_BASE_URL ?? 'http://127.0.0.1:1234/v1',
    apiKey:  env.DOKIMA_MODEL_API_KEY,
    model:   env.DOKIMA_MODEL_ID ?? 'local-model',
  };
}
```

Three environment variables and a hardcoded `createOaiCompatProvider`.
**Neither call site imports the router, `resolveModelChain`, the matrix, or
the provider registry.** Anthropic, OpenAI-native, Copilot and Vertex
adapters are never constructed on any production path — only by their own
tests. The matrix *is* read by `roster-resolve.ts`, but for **display**
("which model would this role use?"), not for **dispatch**.

The same shape appears twice more:

| Surface | Stored | Consumed at runtime |
|---|---|---|
| Role→model matrix | `model_matrix` table + GUI + audit event | display only (`roster-resolve.ts`); **not by either call site** |
| Escalation policy (D-018 ladder/locked/token-gated) | `settings-types.ts` + `EscalationPolicyPanel.tsx` | `loop-land-policy.ts` **reimplements it locally** and says so |
| Provider config | a `providers` key read by the CLI | `doctor` + `providers refresh` only — **no REST, no GUI** |

And the recurring stated cause is structural, not a design choice.
`providers-core.ts` says verbatim: *"There is no persisted provider registry
yet anywhere in the codebase."* `loop-land-policy.ts` says it deliberately
does not delegate to gateway's `resolveEscalationPolicy` because
*"the map only publishes `src/index.ts`"*. W2-05 reimplemented three-scope
precedence locally because `packages/gateway/package.json` was out of its
write_scope. **Ticket-scoped honesty compounded into an unwired seam** — the
same class this repo already named twice (W9-09, W9-11: *"a correct function
that never reached production"*), and the reason this belongs in the "does
it really work?" answer rather than in a feature backlog.

**One consequence worth stating plainly:** today a user can register a
provider only by hand-editing a settings JSON file, can type any model
string into the matrix, and the pipeline will call `localhost:1234` with
`local-model` regardless.

### What opencode does, verified against its docs

`@ai-sdk/openai-compatible` per provider, `options.baseURL` for the
endpoint, a `models` map of model-id → display config, the **models.dev**
registry supplying metadata for 75+ providers, and a `/models` runtime
picker. Ollama and LM Studio are the same config shape with different
`baseURL`s. Dokima already has the adapter equivalent of all of this;
what it lacks is the registry, the picker, and the wire.

### Design forks to settle before ticketing (not deferrable)

- **Law 9 / C-1 — local-first honesty.** opencode's 75-provider list comes
  from a remote registry. First run must work with **zero network**. So:
  a **bundled static catalog** (versioned like `content/`, refreshable, never
  required) + **live `/v1/models` discovery** for any configured endpoint.
  A picker that needs the network to render is out of bounds.
- **Law 8 / FR-S2 / D-012 — credentials.** An API-key field writes to the
  keychain and persists a **ref**. The settings layer already refuses
  secret-shaped values (`SettingsFileSecretError`) — that refusal must stay
  true of the new registry, and the write emits `settings.changed`.
- **Law 5 / C-4 — maker ≠ verifier.** Free model selection must not let a
  user put `code-reviewer` on the maker's model without hitting
  `guardMakerVerifierDistinct`. The guard is structural today; a picker that
  bypasses it is a regression, not a convenience.
- **D-019 — Copilot** cannot appear as a peer entry in an "any provider"
  list; it stays behind the existing consent gate.

### Tickets

**W10-18 · gateway · 8 pts** — Persisted provider registry.
`write_scope: packages/gateway/src/registry/**`, `apps/server/src/api/server/providers-*.ts`
Promote the CLI-only `providers` settings key to a real registry with REST
GET/PUT, keychain-ref credentials, and `settings.changed` events. Reuses
`buildProvider`'s existing kind→adapter switch. Red fixture: a POST carrying
a literal API key is **refused**, not stored.

**W10-19 · gateway · 5 pts** — Model catalog + discovery surface.
`write_scope: packages/gateway/src/catalog/**`, `content/model-catalog/**`
`listModels()` already exists and `providers refresh` already calls it —
today it keeps the **count and discards the list**. Persist the list, add
the bundled offline catalog, expose `GET /api/v1/providers/{id}/models`.
Red fixture: with the network down and no endpoint reachable, the catalog
still renders and the UI says *why* a provider is unreachable.

**W10-20 · gateway · 8 pts — the load-bearing one.** Wire the seam.
`write_scope: apps/server/src/api/pipeline/gateway-model-port.ts`, `onboard-dispatch-port.ts`
Both call sites resolve provider + model through the registry and the role
matrix instead of three env vars; env vars survive as a documented override
for CI/fixtures. **Red fixture is the whole acceptance:** set the matrix to
provider B, assert the call goes to B — then revert only the resolution call
and confirm the test reds. That is exactly the W9-11 mutation, applied to
the bug it would have caught.

**W10-21 · ui · 8 pts** — Providers & Models panel. `write_scope: apps/web/src/settings/ProvidersPanel.tsx`, `ModelMatrixPanel.tsx`
Register/edit/test an endpoint (Ollama, LM Studio, any OpenAI-compatible,
plus the cloud adapters), see discovered models, and pick per role × task
type from a **list** rather than a free-text box. Keeps the Copilot consent
gate and surfaces the maker≠verifier refusal inline with its reason (FR-C
"drag-refusals explained" precedent). Also folds in `settings/types.ts`'s
duplicated `MODEL_MATRIX_PRESETS`, which shadows gateway's `routing/presets.ts`.

**Prerequisite for all four:** `packages/gateway/package.json`'s export map
publishes only `src/index.ts`, which is the stated reason two packages
reimplemented gateway logic locally. Widening it is a one-line change that
must land inside W10-18's scope, or the seam gets reimplemented a fourth time.

---

## 6b. Phase H — GUI/front-end design (the hole in this plan's first draft)

This plan's first draft asserted a Providers panel (W10-21) with **no design
phase behind it**. That is a real gap, and the numbers say so.

### Measured state of the design system

| | Value |
|---|---|
| Design tokens defined (`styles.css` `:root`) | **4 colors + 1 duration** (`--sw-bg`, `--sw-fg`, `--sw-border`, `--sw-accent`, `--sw-transition-duration`) |
| Spacing / type / radius scale | **none** — 13 distinct ad-hoc `px` values across the CSS |
| `var(--sw-*)` uses across all CSS | 164 |
| **Hardcoded hex colors** | **66**, of which **54 sit in feature CSS** (`plans` 7, `chat` 7, `settings` 6, `roster` 5, `notifications` 5, …) — outside `styles.css`, so they cannot respond to the `data-theme` flip |
| Design tests | one (`styles.test.ts`), which asserts `border-radius: 6px` as a **literal** — the repo's only design test pins a magic number rather than a token |

Two clarifications, both checked rather than assumed:

- **`docs/work/W4-11-token-delivery-evaluation.md` is about auth-token
  delivery (THREAT_MODEL T-19), not design tokens.** There is no prior
  founder decision on the token set, so Phase H is not re-litigating one.
- **a11y is already an enforced gate.** `apps/web/e2e/a11y/` (6 specs +
  `known-violation.html` as a red fixture) matches `testMatch:
  '**/*.spec.ts'`, and Law 3 put the e2e suite in the ticket gate on
  2026-07-27. So Phase H **extends an enforced gate** rather than building
  one — a materially smaller job.

### The ordering problem

`docs/design/UX_SPEC.md` is 209 lines and its sections stop at the W4
surfaces: Fleet, three-pane, board, artifacts, settings matrix,
notifications, first-fifteen-minutes, a11y baseline. **There is no section
for a provider/model picker and none for the guide.** W10-21 as written
would invent its UI while building it — precisely what attest's Phase 3.5
Design Loop (`ux-researcher` → `design-system-lead` → `content-designer` →
`ux-engineer` → `frontend-design` → `a11y-compliance`) exists to prevent.

### Tickets

**W10-22 · ui · 5 pts** — UX_SPEC §10: Providers & Models.
`write_scope: docs/design/UX_SPEC.md`
Flows and screen inventory for provider registration, model discovery, and
per-role selection, in UX_SPEC's existing voice. Covers the empty state
(§2b's rule: every screen has one, written not improvised), the unreachable
-endpoint state, the maker≠verifier refusal explanation, and the Copilot
consent path. **W10-21 gains `depends_on: [W10-22]`** — the panel gets built
against a spec, not alongside one.

**W10-23 · ui · 8 pts** — Token scale + de-hardcoding.
`write_scope: apps/web/src/styles.css`, `apps/web/src/**/*.css`, `apps/web/src/styles.test.ts`
Extend the 5 tokens to a real scale (spacing, type, radius, plus semantic
color roles for the state chips the board and queue already improvise), then
migrate the 54 feature-CSS hexes onto it. **Red fixture, and it is the whole
point:** a lint/test rule that fails on a raw hex or a raw `px` in feature
CSS — verified by adding one and confirming red. Replaces `styles.test.ts`'s
literal `6px` assertion with a token reference.

**W10-24 · ui · 5 pts** — Spec-conformance verification (`ui-verifier`).
`write_scope: apps/web/e2e/conformance/**`
Nothing today checks the built UI against UX_SPEC. Add conformance specs per
UX_SPEC section, joining the existing e2e gate. Distinct from a11y (WCAG
compliance) and from cartography (breadth): this asks *does it match what we
said it would be*.

---

## 6c. Phase F, extended — the two testing layers still missing

W10-17's mutation audit answers "does the test fail when the code breaks?"
Cartography answers "was every element visited?" **Neither answers "can a
person accomplish a goal?"** — and that is the question the user asked.
attest separates these agents for exactly this reason.

**W10-25 · quality · 8 pts** — Persona-driven UAT (`end-user-simulator`).
`write_scope: docs/uat/**`, `apps/web/e2e/journeys/**`
Goal-completion journeys, not element coverage. Minimum set:

1. *"Point Dokima at my local LM Studio and run a ticket through it."*
2. *"Onboard an existing repo and get to a board I can claim from."*
3. *"Review overnight work and accept one ticket."*
4. *"Understand why a ticket was refused and fix it."*

Each records where the persona got stuck, with the friction written down
rather than smoothed over. **Journey 1 is the one that would have surfaced
§6a from the outside** — a person following the docs would have discovered
that the model picker does not reach the model call. That is the argument
for this ticket in one line.

Confirms a plan-level assumption too: `playwright.config.ts`'s own comment
says the fake-model gateway *"stands in when a future ticket wires provider
calls into the UI"* — a second in-repo acknowledgement, independent of
§6a's, that the provider wiring is unbuilt.

---

## 6d. Phase S — the release blocker found on 2026-08-02 (lane `quality`)

Full finding: [`SECURITY_RELEASE_BLOCKER_2026-08-02.md`](SECURITY_RELEASE_BLOCKER_2026-08-02.md).
The Ed25519 content-signing **private** key is in pushed git history
(`1039ff0`, confirmed an ancestor of GitHub's published `main`), and it derives
byte-for-byte the public key the product ships. Proven forgeable against the
real `content/manifest.json`.

**W10-26 · quality · 3 pts — rotate the signing key.**
`write_scope: content/keys/**`, `content/manifest.json`, `scripts/sign-content.mjs`
New Ed25519 pair, private key outside the repo, re-sign, ship the new public
key, permanently distrust the old one. Scope is bounded to content packs (see
the finding's trust-root trace). **Sequence before W10-02/03** — the content
re-import re-signs too, and W9-08's write_scope also includes
`content/manifest.json`. Rotating first means one re-sign, not three.

**W10-27 · quality · 3 pts — history scanning joins the release gate.**
**FILED AND LANDED 2026-08-03 at 5 pts** (board `plan.json`, merged as `c2a62f7`).
Resized after measuring: git plumbing + Node scans this repo in ~1.3s, so the
assumed gitleaks dependency below bought nothing and was dropped (Law 9); the
extra points cover the CI wiring plus the fail-closed rungs. Baseline came out at
24 fingerprints, not the 21 estimated. Full record in `docs/STATUS.md`.
`write_scope: scripts/validate-history-secrets.mjs`, `docs/TESTING.md`
`content/validators/secrets-scan.sh` (W3-13, SC-06) scans the working **tree**.
A gitignored, tree-removed key reads clean while history is compromised —
that is exactly how this survived from 2026-07-20 to 2026-08-02. Add a history
pass (gitleaks did 759 commits in 591ms) with the 21 known-benign fixture
findings baselined so the signal isn't buried. **Red fixture:** commit a
throwaway key on a scratch branch and confirm the gate reds.

> Recorded here and not only in the dated finding file on purpose — a lesson
> that lives in a work note is a lesson that gets re-learned.

---

## 7. Sources for §5

- [Claude Code CHANGELOG (official)](https://raw.githubusercontent.com/anthropics/claude-code/refs/heads/main/CHANGELOG.md)
- [Claude Code release notes](https://platform.claude.com/docs/en/release-notes/claude-code)
- [opencode — Providers](https://opencode.ai/docs/providers) (§6a comparison)

Every flag and env var in §5 is quoted from the official changelog with its
landing version. Per Law 2, each is re-verified against docs at ticket time
before it becomes code.

---

## 8. Sizing and sequencing

| Phase | Tickets | Pts | Lane | Runs |
|---|---|---|---|---|
| A — parity matrix | W10-01 | 5 | quality | first, alone |
| B — content refresh | W10-02…05 | 21 | content | after A (05 gated on A) |
| C — engine parity | W10-06…09 (TBD by A) | ~30 | engine | after A |
| D — scribe guide | W10-10…14 | 34 | ui + quality | 10/11 parallel with B |
| E — Claude Code | W10-15/16 | 8 | gateway, orchestrator | after G (same lane) |
| F — mutation audit | W10-17 | 8 | quality | after D-10 |
| **G — provider/model selection** | W10-18…21 | **29** | gateway + ui | **G-20 is the highest-value single ticket in the wave** |
| H — GUI/front-end design | W10-22…24 | 18 | ui | H-22 before G-21 |
| F+ — persona UAT | W10-25 | 8 | quality | after G-20 |

**~25 tickets, ~161 pts.** Phase C's number is the one that moves — that is
what W10-01 exists to pin down.

**What Phases H and F+ cost, stated rather than discovered:** they add ~26
pts to a wave that was already ~135. They were absent from this document's
first draft, which asserted a Providers panel with no spec behind it and no
goal-completion testing at all. The measurements in §6b/§6c are the case for
including them.

**Lane contention (Law 1, distinct from write_scope overlap):** Phases E and
G both sit in the `gateway` lane, and same-lane tickets never run in
parallel. G runs first — E's Claude Code adapter should register through the
provider registry G builds, not alongside it.

**Recommended cut if the wave is too big to commit at once — revised:**
**A + H-22 + G-18/19/20/21 + D-10/11 + F+-25** (~73 pts). `H-22` (the
UX_SPEC section) enters because `G-21` is in the cut and must not invent its
own UI; `F+-25` enters because journey 1 is what proves G-20 actually
reaches a user's chosen model. `H-23`/`H-24` (token scale, conformance
specs) and the rest of B/C/E/F follow. Phase G moved into the first cut
because §6a is the part where the honest answer to *"does it really work?"*
is currently **no**: the engine is built and contract-tested, and the wire
from the user's choice to the model call is missing. W10-20 alone converts
five finished adapters and a finished routing matrix from shelf-ware into
the product. A + D-10/11 still produce the two artifacts every later
decision depends on. Phases B, C, E, F then get scoped against real numbers.

### Gate impact
`validate-guide-coverage.mjs` joins the workspace gate (W10-13) — cheap,
no browser. The guide **capture** run does not; it triggers on
`apps/web/src/**` changes via `--refresh`, and fully at wave close. The
existing gate (`lint && typecheck && test` + `--filter @dokima/web e2e`,
~30s for e2e) is otherwise unchanged.

### Cross-lane write_scope check (Law 1)
`content/**` + `scripts/{import,sign}-content*` (B) ·
`packages/{loop,tickets,harbormaster,validators}/**` (C) ·
`docs/guide/**` + `apps/web/scripts/guide/**` + `scripts/validate-guide-coverage*` (D) ·
`scripts/conductor*` (E) · `apps/web/e2e/**` (F) ·
`packages/gateway/**` + `apps/server/src/api/{pipeline,server}/providers-*` + `apps/web/src/settings/{Providers,ModelMatrix}Panel.tsx` (G)
— no overlap after narrowing W10-02 off the `scripts/*.test.mjs` glob that
collided with W10-16. **E's adapter write_scope moved under G's
`packages/gateway/**` umbrella** — same lane, sequenced, so this is
serialization rather than overlap. `docs/STATUS.md` is touched by W10-03
only; `docs/TESTING.md` by W10-17 only.
