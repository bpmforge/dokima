# Pipeline Throughput Enhancement — Autonomous Phase 4

**Status:** proposed program plan · **Date:** 2026-08-31 · **Branch:** `feat/pipeline-throughput-enhancement`

**Scope:** `attest` (policy + expert content) → `attest-claude` (generated) → Dokima/Shipwright (executor + conductor).

**Inputs:**
- `~/Documents/02_Work_Notes/LOCAL_EXHAUSTION_INCIDENT_LESSONS.md` — sanitized incident review + measured throughput analysis + OPT-01..OPT-12. **This plan does not restate that document; it is the delta and the landing plan.**
- `~/Documents/02_Work_Notes/cursormeeting.md` — Cursor/SpaceX AI platform session, 2026-08-31.
- <https://github.com/cursor/plugins/blob/main/pstack/skills/interrogate/SKILL.md> — pstack `interrogate` skill (multi-model adversarial review).

---

## 1. The defect, named — and it is two defects, not one

> Corrected 2026-08-31 by the verification pass (`PIPELINE_PLAN_VERIFICATION.md`, C-05). The first draft
> applied one diagnosis to both pipelines. Their own logs disagree.

**Two conductors run boards, and they have different dominant defects** (a third code path, Dokima's product
pipeline, is inventoried in §2). Treating them as one problem mis-orders the work.

| Measure | attest / Marauder conductor | Dokima conductor (this repo) |
|---|---:|---:|
| Unit | 181 coding attempts | 282 ticket starts |
| **Review sessions per unit** | **4.76** | **0.93** |
| Approve rate | 18.7% (25 of 134) | 48.3% |
| Expert-review wall time | 1,900.8 min | — |
| Worst single ticket | 32 expert sessions, 111.8 min, then exhausted | — |
| Median 4-expert sequential pass | ~8.8 min before any fix | n/a (one reviewer) |
| Retries per **start event** | — | 0.72 |
| Deterministic gate failures per **start event** | — | 0.63 |
| Tickets needing ≥1 block/recover cycle | — | **45.4%** (64 of 141 unique) |
| Tickets that ultimately completed | — | **90.8%** (128 of 141 unique) |

Marauder figures: `LOCAL_EXHAUSTION_INCIDENT_LESSONS.md`. Dokima figures: computed from this repo's
`docs/work/conductor-log.jsonl`, 3,610 rows, 2026-07-11 → 2026-08-07.

**Defect A — over-gating (Marauder).** Per-ticket expert fan-out is a **scan-scheduling defect**, not a
quality feature: the expensive assurance runs at the wrong granularity (every candidate), in the wrong shape
(sequentially, one model, full re-run on every fix).

**Defect B — rework cost, not failure rate (Dokima).** *Corrected 2026-08-31 after an independent challenge.
The first version of this section was a measurement defect, and the correction matters more than the original
claim.*

The first draft read event ratios as outcomes: 111 `ticket.blocked` events ÷ 282 `ticket.start` events =
"39.4% block rate." **Per unique ticket the picture inverts:** 141 tickets started, **128 completed (90.8%)**;
64 ever blocked, but **51 of those later completed** — only 13 were still blocked at the window's end. The
board itself reads 495 done / 2 blocked of 497. Dokima's conductor is not failing to land tickets.

Two further limits, both disqualifying for the original claim:

- **The log covers W0–W11 only** — 141 of the board's 497 tickets (28%), through 2026-08-07. W12–W22 left no
  rows. It describes the board's first month, not the board.
- Comparing that to the pilot's "6 of 6 landed" set an **event ratio against an outcome ratio**. Withdrawn.

**What survives, and is still worth fixing:** the cost of reaching 90.8%. Per start event, **0.72 retries and
0.63 deterministic gate failures**, and 45.4% of tickets need at least one block/recover cycle. Of 24
`conductor.fatal` rows, **15 are one bug** (`row.notes.push is not a function`) — 62% of all fatals — with
`ENOSPC` (3), `STOP file present` (3, an operator action, not a defect), `ENOBUFS`, a failed `git merge
--no-ff`, and `testSiblingWarning is not defined` (import wiring; the function exists at
`conductor-lib/lint-rules.mjs:8`). `gates.fail` messages are truncated mid-stream, so the operator often
cannot see the real cause.

**Defect B is therefore rework and noise, not failure**, and does not by itself justify reordering on
throughput grounds. **T2 still precedes T3** for two narrower reasons that hold independently: T2-00
(untrusted verify receipts) is a trust precondition for every gate above it, and one bug fix removes 62% of
observed fatals.

Three compounding causes of Defect A:

1. **Wrong granularity.** Security, performance, and UX experts run per ticket, then again between waves,
   then again at release. The same assurance is bought three times.
2. **Wrong triggers — and they are executable code, not prose.** `attest/scripts/lib/review-triggers.mjs:29-45`
   contains literally `\.map\(|\.filter\(|\.reduce\(` (perf) and `validate|escape|sanitiz` (security), regex-tested
   against the **diff text** — so the word `validate` in a comment recruits a security expert and any `.map(`
   recruits a performance expert. `agents/sdlc/PARALLEL_WAVE_PROTOCOL.md:58-62` and
   `agents/sdlc-init-phase-4.md:129-138` are the prose twins; all three must change together. The file's own
   rationale — *"Biased toward firing: a false positive costs one review session; a false negative ships
   unreviewed auth"* — was sound when the cost was unmeasured. At 4.76 sessions per attempt and 1,900.8
   minutes it is falsified: a false positive costs a session *and* an 8.8-minute serial pass, repeatedly.
3. **Wrong failure accounting.** Formatter defects, provider errors, reviewer-process errors, and a
   pre-existing red baseline all consume the same feature retry budget, so tickets exhaust for reasons no
   coding retry can repair.

The user-visible symptom is exactly the ask: *the coding portion is slow, gets stuck, and the parts are not
integrated at the end.*

## 2. What is actually on this machine

Verified 2026-08-31, not assumed:

| Component | Path | State |
|---|---|---|
| Expert system (canonical) | `~/Code/attest` v3.5.4 | 45 skills, `agents/sdlc-init-phase-4.md` (815 lines) holds the Round 1/2/3 per-module policy |
| Claude target (generated) | `~/Code/attest-claude` | regenerate with `npm run build:claude` from attest; **never hand-edit** |
| Product / factory | `~/Code/shipwright` (**Dokima**) | `scripts/conductor.mjs` + `scripts/conductor/` chapters + `scripts/conductor-lib/` |

**There are THREE conductors, not one** (corrected 2026-08-31, verification C-01):

| Conductor | Path | Role |
|---|---|---|
| attest's M28 reference conductor | `attest/scripts/conductor/conductor.mjs` (1,159 lines) + `resume.mjs` + `supervise.sh` + `scripts/jira/` | The lineage the incident doc describes; ported *from* the Shipwright build 2026-07-11/12, then adapted. Carries the reviewer fan-out. |
| Dokima's dogfood conductor | `shipwright/scripts/conductor*.mjs` | Portable 2-file import surface; one reviewer per ticket |
| Dokima's product pipeline | `shipwright/packages/pipeline`, `packages/loop` | Where `decompose`, `challenger`, the findings ledger and loop policy actually live — **and the dogfood conductor does not import any of it** |

That third row is itself a finding: the seam linter and the findings ledger exist in `packages/`, while the
board the conductor runs comes from a hand-written `plan.json` that carries none of those fields.

**OPT-01..OPT-05 are in NEITHER conductor.** The incident doc records them in executor commit `e73f668`, in
an isolated local JIRA-conductor worktree on the work machine, deliberately not pushed upstream. Checked in
both places:

| | attest's conductor | Dokima's conductor |
|---|---|---|
| Reviewers concurrent (OPT-01) | **No** — `attest/scripts/conductor/conductor.mjs:554-556`, `runReviewRound` is a `for` loop over reviewers | **No** — one reviewer only, `shipwright/scripts/conductor/ticket.mjs:41` |
| Baseline preflight / fingerprints | **No** — only a formatter-clean baseline string at `conductor.mjs:489`; no `blocked_on_*` states | **No** — `grep -n "unchanged\|baseline" shipwright/scripts/conductor/*.mjs` returns unrelated comments only |
| No-change fix-loop abort (OPT-02) | **No** | **No** |
| Mechanical remediation before a new attempt | **No** — and attest has *no* model ladder at all: `CODER_MODEL` is fixed (`conductor.mjs:143`, unchanged at `:606`, `:737`) | **No** — Dokima *is* the one with a ladder (`ticket.mjs:16`), and it regenerates the whole candidate on the next model |
| Partial credit | Re-reviews **only the reviewers that blocked** (`conductor.mjs:607-613`) — a fragment of OPT-10 | Sticky findings across attempts |

One defect visible only in attest's conductor: `conductor.mjs:508` commits scope-violation evidence with
`git add -f` from the target checkout. The incident doc lists that exact force-add-and-commit fallback as a
defect it fixed locally, and it can commit runtime evidence into a repo whose policy is PR-only. Tracked as
T2-13.

Two useful seeds already exist and should be generalized rather than rebuilt:

- `scripts/conductor-lib/review.mjs::selectGates` — gates already skip by `write_scope` glob. This is the
  correct shape for OPT-08; it needs a risk classifier on top, not a rewrite.
- `scripts/conductor/security.mjs::waveSecurityPass` — a security pass **already runs at the wave boundary**.
  Level 2 is an extension of this, not a new concept.
- `scripts/conductor-lib/lint-rules.mjs` — the "a new UI page must also hold its route + nav files" rule is a
  hand-written instance of the general seam check that §4 makes systematic.

## 3. What Cursor contributes

Reading past the demo, four things are worth taking:

| Cursor primitive | What it actually solves | Where it lands here |
|---|---|---|
| **rules** (`description` + `glob` + `alwaysApply`, `.mdc`) | Context bloat *and* trigger precision — a rule loads only when its glob/description matches | **Net-new primitive in attest.** Direct mechanism for OPT-08. |
| **multitask** | Each reviewer gets its own context window *and its own model*; orchestrator sees only summaries | Level 2 concurrent fan-out (OPT-01 + model diversity) |
| **loop / goal / orchestrator** | Named, bounded self-driving skills instead of operator babysitting | Map onto existing attest loops; `goal` is the gap |
| **automations** (webhook/PR-triggered cloud agents; bugbot + security reviewer on the **PR diff**) | Assurance attaches to the *diff at a merge boundary*, not to every coding session | Level 3 merge train |

The `interrogate` skill is the concrete worked example and the single most transferable artifact:

> Scope → state intent in one paragraph → **spawn all reviewers simultaneously** (4 distinct models,
> `readonly: true`) → synthesize, where **2+ models agreeing is the highest-signal finding** → lead judgment
> categorizes every finding as **Act On / Consider / Noted / Dismissed** with an agreement map.

The signal is **model diversity, not assigned personas.** That is a direct critique of the current design,
which runs four *personas* (code/security/perf/UX) on one model, sequentially. Level 2 should do the
opposite: fewer passes, more models, concurrent, with an explicit dismissal category — which is also the
answer to 109-of-134 `CHANGES REQUESTED`. Findings that no second model reproduces are `Noted`, not blockers.

**What attest already has here (verification C-09).** v3.5.0 shipped `/gauntlet` + `gauntlet-lead` +
`GAUNTLET_LOOP.md`: builders never grade their own work, and a critic that saw a previous draft never grades
the retry — blind, fresh-context critics against a named real exemplar. So *blindness* and *maker≠verifier*
are solved. `GAUNTLET_LOOP.md:115` draws the boundary explicitly: for "are these claims true," use the
challenger, not the gauntlet. **The genuine gap is narrower than the first draft implied: model diversity and
consensus weighting.** T1-07 adds those to the existing challenger/gauntlet layer; it does not replace them.

Grokbot (standing per-domain agents with their own memory/skills/rules, messaging each other, trigger-driven)
is the end state, not the starting point. It is Phase T5 below.

## 4. The seam model — extend what exists, do not rebuild it

> Corrected 2026-08-31 (verification C-02). The first draft called this "net-new." **It is not.** Dokima
> already has a seam model in code, derived from this repo's own field report §10.

What exists today, verified:

| Layer | State | Citation |
|---|---|---|
| Seam declaration on a ticket | **Implemented** — `providesInterfaces`, `consumesInterfaces`, `importsWorkspacePackages`, `ownPackage` | `packages/pipeline/src/decompose/types.ts:20-56` |
| Plan-time seam lint | **Implemented** — `findUnownedInterfaces`: *"consumes X but no ticket in the DAG owns its public re-export"*, plus cycle and writeScope checks | `packages/pipeline/src/decompose/linter.ts:45-65, 111+` |
| The originating lesson | W0-05 built `mintReceipt`, W1-02 consumed it, neither owned re-exporting it — *"the function existed and was invisible"* | `linter.ts:38-44` |
| Same concept in attest | Interface-contract module pattern specified… **and explicitly unenforced**: *"is a manual check — nothing in `tickets.mjs` enforces it today"* | `attest/agents/task-decomposer.md:137-145, 218` |
| Hand-written instance | "a new UI page must also hold its route + nav files" | `scripts/conductor-lib/lint-rules.mjs` |

So the concept, the schema, and a linter are all present. **The real gap is four narrower things:**

1. **Plan-time only.** `findUnownedInterfaces` checks that *some ticket claims ownership* of a re-export. It
   never checks that the export **actually exists on the built head**. A ticket can declare
   `providesInterfaces` and simply not write the re-export — and the lint stays green. **The missing
   assertion is build-time wiring evidence at Level 2.**
2. **Only one seam kind.** `InterfaceRef` is `{packageName, exportName}`. Routes, DB columns, DI bindings,
   event topics, nav entries, config keys, and feature flags are seams that break the same way and are
   unmodelled.
3. **The dogfood conductor does not use it.** `scripts/conductor*.mjs` reads a hand-written `plan.json` whose
   tickets carry no `providesInterfaces`/`consumesInterfaces` at all. The linter lives in
   `packages/pipeline`, which that code path never imports.
4. **attest declares the same idea and enforces nothing.**

**The work is therefore:** extend `InterfaceRef` to a tagged `Seam` union (kinds above); add a
`wiring_evidence` field naming the deterministic assertion (import resolves, route registered, migration
applied, registry entry present) and an optional `contract_test`; run those assertions against the synthetic
wave head at Level 2; and teach both conductors and attest's `task-decomposer` to emit and consume the same
records. `docs/design/INTERACTION_MAP.md` is the human-readable projection of `packages/pipeline`'s data —
not a second source of truth.

Three consumers make it pay for itself:

1. **Wave composition (OPT-12).** Disjoint write scopes and the dependency DAG fall straight out of the map —
   no heuristic needed. A producer seam and its consumers belong in the same wave or in ordered waves.
2. **Level 2 cross-ticket contract checks.** The wave gate can only detect "these did not get wired up" if it
   knows what the seams were *supposed* to be. Generalize `lint-rules.mjs`: **a seam whose `wiring_evidence`
   is absent on the synthetic wave head is a blocking Level 2 finding, attributed to the consumer ticket.**
3. **Ticket scope reachability.** A consumer whose `write_scope` cannot reach its seam's symbol is a filing
   defect caught at lint time, not at the wall — the failure mode already recorded as the dominant one in the
   Conductor field reports.

## 4b. The unattended-start contract — where humans stop and machines start

The ask is "after the person plans it out and talks through the SDLC and the user stories, the coding portion
should automate its way through and not get stuck." That is a **handoff contract**, and it is the single line
this plan exists to draw. Six conditions must hold at the Phase 3.5 → Phase 4 boundary before the conductor
may run unattended. Each is checked deterministically; failing any one stops the run with a distinct status
and **consumes zero coding attempts**.

| # | Condition | Checked by | Failure status |
|---|---|---|---|
| 1 | **Baseline is green.** The configured verify command exits zero on the exact base commit, in a clean detached worktree; result cached by base SHA + command + lockfile hash + runtime fingerprint | T2-01 | `blocked_on_baseline` |
| 2 | **Remotes agree.** Every configured remote is fetched and local `main` is an ancestor; fast-forward only when all agree | T2-01 | synchronization error |
| 3 | **Seams resolve.** Every ticket's declared inputs and outputs resolve against `seams.json`, and each ticket's `write_scope` can physically reach the symbols its seams name | T1-09 board lint | `blocked_on_scope` (at lint, before claim) |
| 4 | **Verify profile is available.** Browser, E2E, database, and external-service requirements of the ticket's verify command are present and reachable | T3-07 | `blocked_on_infrastructure` |
| 5 | **External evidence is declared.** Work needing a sandbox, production data, owner attestation, or unavailable credentials is marked as external-evidence work *before* coding | T3-08 | `blocked_on_scope` |
| 6 | **Risk tier admits the ticket.** Only bounded, evidence-based work with known acceptance criteria is claimable unattended; ambiguous, large, or judgment-requiring tickets are held for a human pass | T2-09 (M-02) | `held_for_human` |

**Condition 6 is the empirically strongest one.** `CONDUCTOR_PILOT_REPORT_REDACTED_2026-08-03.md:325-333`
(lesson 8) records that using exactly this filter — the same bounded, known-acceptance shape that had already
succeeded repeatedly — produced **6 tickets attempted, 6 landed correctly**. Dokima's unfiltered board lands
45.4% and blocks 39.4%. Admission control, not agent capability, is the difference.

When all six hold, the conductor runs the board without supervision: claim → Level 1 → wave admission →
Level 2 → merge train. When one fails, it stops at a named boundary with the candidate and evidence preserved
— which is the difference between "automated" and "constantly confused." **Getting stuck is not prevented by
making the agent smarter; it is prevented by refusing to start work whose preconditions are unverified.**

## 5. Target architecture — three gate levels

Per-ticket branches and PRs are **retained**. Scope, ownership, rollback, ticket ancestry, and defect
attribution stay exact. What changes is where the expensive assurance runs.

### Level 1 — Fast per-ticket gate (deterministic, minutes, no expert session)

0. **Untrusted verify receipts (M-01, ships first).** A wrapper — *never the agent* — runs the project's
   declared verify commands and writes `docs/work/receipts/<ticket>-<sha>.json`: each command, its exit code,
   captured tail, and the `git rev-parse HEAD` it ran at. The completion manifest **cites** the receipt; the
   validator asserts the receipt's SHA matches the pushed commit and every exit code is zero. The agent cannot
   claim "tsc clean" because it never writes that field. No prose is re-executed, so the injection objection
   in `validate-completion-manifest.sh` does not apply. Source: `field-report-marauder-delegation-2026-07-27.md:52-68`
   — closes the most-repeated failure (false "tests clean" in 4 of 5 named tickets), ranked **P1, ship first
   if only one ships**. Everything below Level 1 is untrustworthy until this exists.
1. Write-scope and forbidden-file enforcement — **scoped to tracked paths only**; scope validation must never
   traverse an untracked tree (`ISSUE12.md`: 120s timeout against 64,540 untracked paths)
2. Acceptance tests + the ticket's configured verify command
3. Formatting, affected-package type check, affected-package build
4. Diff-scoped secret detection and SAST (bpm-rulepacks / Opengrep)
5. Dependency validation when a lockfile or manifest changes
6. Deterministic anti-slop: stubs, phantom imports, newly-unused exports, duplicate blocks, disconnected
   registrations, debug artifacts, unsupported suppressions
7. Completion manifest: each acceptance criterion → code + test evidence
8. **Seam check:** every seam this ticket produces or consumes has its `wiring_evidence` present

**A failed Level 1 never consumes an expert review session.**

**Precondition — red-fixture calibration.** No check is promoted from advisory to gating until it has a red
fixture proving it fails on the defect and passes on clean code. `CONDUCTOR_FIELD_REPORT.md:86` records the
imported grep validators flagging `256` inside "AES-256-GCM" *in a comment*, HTTP `429`, and model-ID strings
as magic numbers, plus 20 bogus "unreachable" hits on passing code. An uncalibrated gate imports the exact
false-block problem Level 1 exists to remove.

An expert runs *before* wave admission only for intrinsic high risk: authn/authz, cryptography, secrets,
unsafe deserialization, DB schema or query shape, public API compatibility, concurrency, or a material
interaction redesign. Ordinary loops, validation helpers, `.tsx` and `.css` do **not** qualify while the
deterministic scanners are green.

### Level 2 — Wave integration gate (the expensive assurance, run once, concurrently)

Synthetic validation branch = fresh `main` + the candidate commits of 4–8 compatible tickets. No feature work
is ever authored on it. Composition budgets: prefer one subsystem, disjoint write scopes, ≤ ~1,000 changed
production lines; 1–3 tickets for auth, persistence, migrations, or parsers.

> **Who holds the gate (corrected 2026-08-31, verification C-06).** `CONDUCTOR_FIELD_REPORT.md:76-88` records
> LLM-review-as-a-hard-gate failing **in both directions in one session**: a false negative (the hash-forgery
> bug merged) and, after stickiness was added, false positives that blocked three *completed* tickets —
> **75% of the last four blocks were false**. The resolution is already adopted and wired in
> `conductor.config.json`: **deterministic validators own the gate; the LLM review is advisory and grounded
> by validator findings.**
>
> **But that principle is only half-wired, and the first draft of this plan wrongly recorded it as done.**
> `conductor.config.json`'s `gate[]`/`advisory[]` split governs **grep validators only** — its own `$note`
> says so. The **LLM reviewer is still authoritative**: `scripts/conductor/ticket.mjs:51-73` turns
> `reviewDecision(verdict).blockers` into `gaps`, and `gaps` drives the retry ladder and `markBlocked`. The
> log shows it operating — 130 `verdict=FIX`, 138 `review.fix`. So the single change the field report says
> matters most for Dokima is **unbuilt**, and this plan now files it as **T2-16**. Level 2's two tiers below
> are the target state, not the current one.

**Tier D — deterministic, and these hold the gate:**

1. Full build, type check, unit + integration tests
2. Full SAST, secret, dependency, license
3. **Cross-ticket seam assertions** against the synthetic head — every declared seam's `wiring_evidence`
   resolves. This is the class a per-ticket branch physically cannot expose, and it is deterministic, so it
   gates.

**Tier A — advisory, run once, concurrently, each reviewer in its own context window on its own model**
(`interrogate` shape): code-health and anti-slop across the aggregate diff; security review when the wave
carries a security surface; performance review and benchmarks when it changes a measured hot path; UX / a11y
when it changes user-visible behavior.

Tier A **cannot block a merge by itself.** Its output is findings, ranked by consensus. What it can do is
open a ticket, demand a Tier-D check be added, or escalate to the human review checkpoint below.

**Synthesis** follows `interrogate`: consensus (2+ models) = highest signal; lone-model findings isolated; the
lead categorizes **Act On / Consider / Noted / Dismissed** with an agreement map. Every finding gets a stable
ID — `packages/loop/src/findings-ledger.ts:100` already mints `F-<ticket>-<n>` with fingerprints and signed
suppressions, so this reuses the ledger rather than inventing IDs — and is attributed to the ticket and lines
that introduced it. **Only the owning ticket reopens.** After its fix, re-run that ticket's Level 1 and only
the *failed* wave checks against the new synthetic head.

**Reviewer-citation gate (M-05, required before any fan-out).** A reviewer finding must cite evidence that
resolves — a file:line that exists, a command whose output is in a receipt. Findings whose citation does not
resolve are discarded before synthesis. This is the direct control on the recorded failure of a reviewer
**fabricating a REJECT** citing a wiring omission independently confirmed present at every commit
(`field-report-marauder-delegation-2026-07-27.md:31, 86-95`).

**Why this is not "more AI review layers."** That same field report explicitly declines that remedy
(`:103-107`). The distinction: this plan **reduces the number of review passes** (per-wave, not per-ticket —
4.76 → ≤1.5 sessions per unit) while **increasing model diversity inside the one remaining pass**, and it
strips those reviewers of gate authority. More models in one advisory pass is the opposite of more blocking
layers.

**Human checkpoint (M-03).** Each passing wave emits a **bounded** review HANDOFF — a curated diff plus that
wave's delegation-log slice, sized for a 2–4 hour session, never "read the repo"
(`AI_PROCESS_REVIEW_2026-07-27.md:227-234`). This is the machine-stop line, the counterpart to §4b's
machine-start line. It is also the reason wave size is capped: §4b of that report frames large per-wave change
as the real reviewability objection.

Expected effect, using the doc's own medians: a four-expert pass drops from ~8.8 min (sum) to ~2.7 min
(slowest) — a **3.3× duration reduction**, which is the defensible half and stands on its own. Moving the pass
from per-ticket to per-wave adds **up to** a 4–8× reduction in the *number* of passes, bounded by the current
trigger rate (861 sessions across 181 attempts is 4.8 experts per attempt, not 4 experts on every ticket).

### Level 3 — Merge train + automations

Individual PRs merge in dependency order through the queue. Before each merge, its tested synthetic head must
still be an ancestor-compatible combination of current `main` and the remaining PR heads. After the final
merge: one `main` smoke + contract suite. Only then do tickets transition to Done, on verified `main` ancestry.
If one PR changes after the wave passes, invalidate that PR and downstream synthetic results only.

This is where Cursor's **automations** belong: PR-diff-triggered review (bugbot analogue), scheduled dependency
and CVE sweeps, and post-merge smoke — all attached to a merge boundary rather than to a coding session.

### Assurance floor (non-negotiable)

Wave batching is **not** "audit at the end of the project." A wave is a bounded merge gate; nothing in it
merges until the applicable aggregate reviews are green. Security- and performance-sensitive tickets keep
individual specialist review *in addition to* wave checks. Release still requires the full launch gates and a
final complete security / performance / anti-slop / test / runtime pass on the release candidate.
**The zero-exit close gate is never weakened.**

### Policy is already on this plan's side

Two of the additions the verification pass found missing are **already Dokima law**, just unimplemented in
the executor path — which raises their priority rather than lowering it:

- `CLAUDE.md` Law 4: *"agent sessions are untrusted; every durable state change goes through the
  verbs/receipts APIs… never let a component verify its own output. When a ticket touches gates, its red
  fixtures are part of acceptance."* That is M-01 (untrusted verify receipts) and M-04 (red-fixture
  calibration), stated as law. **Policy support is not implementation:** `docs/work/receipts/` does not
  exist, and no conductor file mentions a receipt outside two prompt strings
  (`scripts/conductor/prompts.mjs:13,25`). T2-00 is greenfield in the executor — budget it as build, not
  as wiring.
- `CLAUDE.md` Law 5: maker ≠ verifier is mechanical — the constraint T1-07's model diversity extends.

A third law is direct evidence for the seam work: Law 1 records that **45 tickets on this board logged a
scope collision**, and that five in one session (2026-08-29) were written down honestly and filed nowhere —
*"a follow-up that names no ticket id is not a deferral, it is a dropped finding."* Seam records with
build-time assertions are how that stops depending on the moment of least remaining attention.

## 6. Getting unstuck: the failure-accounting rebuild

Throughput is lost as much to bad failure routing as to over-scanning. From the incident doc, landed here as
executor work:

- **Stage 0 baseline preflight.** Run the exact configured verify command against the exact base commit in a
  clean detached worktree *before* claiming. Cache by base SHA + normalized command + lockfile hash + runtime
  fingerprint. Red baseline → do not claim, file a repair ticket, consume **zero** feature attempts.
- **Structured failure fingerprints.** Gate output as JSON (suite, test, file, line, errorClass,
  expected/received), with volatile values normalized before comparison.
- **Base-vs-candidate differential.** Deterministic tooling — not model prose — classifies
  regression / baseline blocker / mixed / candidate-also-repairs-baseline.
- **Bounded mechanical remediation.** One formatter/autofix pass, in scope, formatting-only diff, command
  re-run from scratch, scanners see the amended commit — *before* consuming a coding attempt. Never a security
  waiver, test deletion, or assertion weakening.
- **Preserve and resume.** `in_progress → candidate_verified → blocked_on_baseline → candidate_verified → in_review`.
  A reviewed candidate is an asset; preserve the branch and worktree metadata rather than regenerating.
- **Six terminal states** replacing `exhausted`: `code_attempts_exhausted`, `review_fix_iterations_exhausted`,
  `blocked_on_baseline`, `blocked_on_infrastructure`, `provider_attempts_exhausted`, `blocked_on_scope`.
  **Only the first two consume the implementation retry budget.**
- **Terminal reporting** leads with the latest blocking event, then prior attempts chronologically, and never
  truncates away the terminal cause.

## 7. Loop primitives — closing the "babysitting" gap

Cursor's four named skills, mapped onto what attest already has:

| Cursor | attest today | Action |
|---|---|---|
| `multitask` | HANDOFF fan-out, sequential, one model | **Change:** concurrent, per-reviewer model, readonly, summary-only return to orchestrator |
| `loop` | `MICRO_LOOP.md`, `FIX_VERIFY_LOOP.md`, `RALPH_WIGGUM_LOOP.md`, `GAUNTLET_LOOP.md` | Keep. Already stronger than Cursor's (class-driven CLEARED/PROGRESSED/STALLED/OSCILLATING ceilings) |
| `goal` | — | **Net-new:** bounded objective loop with a *measurable* exit condition and a budget, for "get X under Y" work |
| `orchestrator` | `scripts/conductor.mjs` | Keep. This is the conductor; it needs the Level 2 wave stage, not a new name |

Plus the missing layer:

| Primitive | attest today | Action |
|---|---|---|
| **rules** (scoped, glob + description, dynamically loaded) | — (only always-loaded shared protocol `.md`) | **Net-new.** `rules/*.mdc` with `description` / `globs` / `alwaysApply`. This is how OPT-08 replaces prose triggers, and how always-on context stops bloating every session |
| **hooks** (must-run lifecycle) | `plugins/expert-hooks.ts`, validators | Keep for the OpenCode path — but see §16.3: these **cannot reach Dokima's conductor**, which spawns `claude`. Level 1 enforcement there lands in the conductor's gate chain and in git hooks (which do not exist yet in either repo) |
| **skills** (repeatable workflow) | 45 skills | Keep |

The rules/skills/hooks separation is worth adopting verbatim as vocabulary: **skills are workflows, rules are
guiding principles that load conditionally, hooks are things that must happen.** Today attest conflates the
first two, which is why the always-loaded protocol set keeps growing.

## 8. Landing sequence

> **Hard ordering constraint.** The incident doc states it and it governs this plan: the current project rules
> explicitly require per-ticket security and performance review *in addition to* wave review. Changing only the
> executor creates a **policy bypass** even if the resulting technical checks are sound. Therefore:
> **attest policy → validators → Dokima executor.** T2 may not start before T1 merges.

**Where these land.** T0, T2, T3 and T4 are Dokima/Shipwright work and belong in `plan.json` at this repo's
root, the board `scripts/conductor.mjs` claims from. T1 is attest work and belongs alongside the existing
`IMPROVEMENT_BACKLOG.md` / `issues/` there. **None of these are board rows yet** — the IDs below are plan
identifiers, not claimable tickets, and filing them is the first action after this plan is approved.

**Lineage note.** The Marauder JIRA-conductor and its local executor commit `e73f668` stay separate. That work
was deliberately kept project-local and this plan does not attempt to unify the two conductors. T2-08 means
*re-derive these behaviors here*, not *merge that lineage into Dokima*.

### T0 — Instrumentation (no policy change, unblocks measurement)

| ID | Work | Repo |
|---|---|---|
| T0-01 | Emit per-session structured events: kind, model, duration, verdict, finding IDs | shipwright |
| T0-02 | Report from the event log: expert sessions per coding attempt, wall time by expert, approve/changes ratio, terminal-state histogram | shipwright |
| T0-03 | Add the incident doc's metrics list as the report's schema (attempts consumed, mechanical remediations, baseline blockers before/after claim, candidates preserved vs regenerated) | shipwright |

### T1 — Policy + content (attest first, per the constraint)

| ID | Work | Repo |
|---|---|---|
| T1-01 | Rewrite `agents/sdlc-init-phase-4.md` Round 2 into the three-level model; state explicitly which experts are per-ticket (high-risk only) and which are per-wave | attest |
| T1-02 | Update Definition-of-Done language so per-ticket + per-wave assurance agree — **this is the gate that legalizes OPT-09/OPT-12** | attest |
| T1-03 | Add the `rules/` primitive (`description`/`globs`/`alwaysApply`) + loader + validator | attest |
| T1-04 | Convert the broad prose triggers to path + semantic-risk classification expressed as rules (OPT-08) | attest |
| T1-05 | New skill `wave` — compose, run, and synthesize a Level 2 integration gate | attest |
| T1-06 | New skill `goal` — bounded objective loop with measurable exit condition | attest |
| T1-07 | **Add model diversity + consensus weighting to the existing challenger/gauntlet layer** (blindness and maker≠verifier already ship in v3.5.0): concurrent multi-model, 2+-model consensus, Act On / Consider / Noted / Dismissed, agreement map. Not a replacement of `/gauntlet` or `/challenge`. | attest |
| T1-07b | State in policy that **LLM review is advisory; deterministic validators own the gate** — aligning attest with what `conductor.config.json` already does (`CONDUCTOR_FIELD_REPORT.md:76-88`) | attest |
| T1-08 | Structured verdict contract for runtime expert: `PASS` / `FAIL_CANDIDATE` / `BLOCKED_BASELINE_CONFIRMED` / `BLOCKED_BASELINE_SUSPECTED` / `BLOCKED_INFRASTRUCTURE`; a nonzero configured verify **always** produces FAIL | attest |
| T1-11 | **Conductor-first Phase 4** — when a board and conductor are present, Phase 4 dispatches through the conductor; HANDOFF prose becomes the interactive fallback (§12) | attest |
| T1-12 | Requirement coverage ledger + assembly tickets + long-tail wave emitted at decomposition (§14) | attest |
| T1-09 | `task-decomposer` emits the seam records `packages/pipeline` already models, and its interface-contract rule stops being "a manual check" (`task-decomposer.md:218`) — add the validator that enforces it | attest |
| T1-10 | `npm run build:claude`; commit both repos; push both remotes | attest + attest-claude |

### T2 — Executor: trust + failure accounting (**now ordered first — this is Defect B**)

| ID | Work | Maps to |
|---|---|---|
| **T2-00** | **Untrusted verify receipts** — `.sdlc/verify.json` declares commands; a wrapper runs them and writes `docs/work/receipts/<ticket>-<sha>.json`; the validator asserts SHA match + all exit codes zero | **M-01 / P1 — highest value, ship first** |
| T2-01 | Stage 0 cached baseline preflight in a clean detached worktree | doc Stage 0 |
| T2-02 | Structured failure fingerprints + normalization | Stage 1 |
| T2-03 | Deterministic base-vs-candidate differential classifier | Stage 2 |
| T2-04 | Bounded in-scope mechanical remediation before a new coding attempt | Stage 3 / OPT-04 |
| T2-05 | `blocked_on_baseline` + candidate preservation and resume | Stage 4 |
| T2-06 | Six terminal states with separate retry budgets | Stage 5 |
| T2-07 | Terminal report: latest blocker first, no destructive truncation | Stage 5 |
| T2-08 | Port OPT-01..OPT-05 (concurrency, no-change abort, carry exact blocking excerpts, continue after nonzero coder exit with a real diff, parse complete reports despite nonzero exit) — **re-derive here; `e73f668` is not on this machine** | OPT-01..05 |
| **T2-09** | **Risk-tier admission filter** — only bounded, known-acceptance work is claimable unattended; `held_for_human` for the rest | M-02, §4b condition 6 |
| **T2-10** | **Scope validation scoped to tracked paths**; never traverse an untracked tree; time-box with a distinct `blocked_on_infrastructure` exit | M-06 |
| **T2-11** | **Red-fixture calibration harness** — no check promoted advisory→gating without a red fixture | M-04 |
| **T2-12** | Fix the four executor/infra fatal classes seen in the log (`ENOBUFS`, `ENOSPC`, `row.notes.push`, `testSiblingWarning`) and route them to `blocked_on_infrastructure` | §1 Defect B |
| **T2-14** | Risk/size-based model routing generalized from `cheapLanes`/`cheapMaxPoints`, exposed as a project setting (§15) | §15.1 |
| **T2-15** | **Wire** the existing `packages/loop` policy engine (`classifyIteration`, budget, convergence, ledger — 0 external callers today) into the conductor/harbormaster land loop; implement rungs 1-8 incl. split-on-stall and `[PARTIAL]` resume (§13) | §13 |
| **T2-16** | **Make the LLM verdict advisory in Dokima** — `scripts/conductor/ticket.mjs:51-73` turns reviewer blockers into `gaps` that drive retry and `markBlocked`. This is the change `CONDUCTOR_FIELD_REPORT.md` §5 says matters most, and it was previously unfiled | C-06 |
| **T2-17** | Fix `row.notes.push is not a function` — **15 of 24 fatals (62%)** — and the `testSiblingWarning` import wiring; route the rest to `blocked_on_infrastructure`. Supersedes the four-equal-causes framing of T2-12 | §1 Defect B |
| **T2-13** | Failure/scope evidence is written **beside** the worktree, outside the target repo; never `git add -f` from the main checkout (`attest/scripts/conductor/conductor.mjs:508`) | M-08 |

### T3 — Executor: the wave gate

| ID | Work | Maps to |
|---|---|---|
| T3-01 | Synthetic validation branch builder from N compatible PR heads | OPT-09 |
| T3-02 | Wave composition from `seams.json` + disjoint write scopes + changed-line/risk budgets | OPT-12 |
| T3-03 | Concurrent multi-model reviewer fan-out (**Tier A, advisory only**); each writes a distinct immutable report | OPT-01 + multitask |
| **T3-03b** | **Reviewer-citation gate** — a finding whose citation does not resolve is discarded before synthesis | M-05 / P4 |
| T3-04 | Ticket/line attribution + failed-check-only delta re-review, **reusing `packages/loop`'s existing finding ledger** (`F-<ticket>-<n>`, fingerprints, signed suppressions) rather than minting new IDs | OPT-10 — *partly already built* |
| **T3-05a** | Extend `InterfaceRef` → a tagged `Seam` union (route, DB column, DI binding, event topic, nav entry, config key, feature flag) with `wiring_evidence` + optional `contract_test` | §4 gap 2 |
| **T3-05b** | **Build-time** seam assertions against the synthetic wave head — Tier D, gating (today's `findUnownedInterfaces` is plan-time only) | §4 gap 1 |
| **T3-05c** | Teach both conductors to read/emit seam records; `plan.json` boards currently carry none | §4 gap 3 |
| T3-06 | Merge train: ancestor-compatibility recheck before each merge, post-merge smoke, Done only on verified `main` ancestry | Level 3 |
| T3-07 | Verify-profile preflight (browser/E2E/DB/external service) before claim | OPT-06 |
| T3-08 | Mark external-evidence work (sandbox, prod data, owner attestation, credentials) before coding | OPT-07 |
| T3-09 | Cache dependency install + affected-package build artifacts by main SHA + lockfile hash | OPT-11 |

### T4 — Automations (trigger-driven, not prompt-driven)

| ID | Work |
|---|---|
| T4-01 | PR-diff-triggered review automation (bugbot analogue) on the merge boundary |
| T4-02 | Scheduled dependency/CVE sweep producing tickets, not prose |
| T4-03 | Post-merge smoke + contract automation with human-in-loop escalation on second failure |
| T4-04 | Risk-tiered auto-merge policy (low-risk auto, medium-risk human) — **explicitly a founder decision, not an agent decision** |

### T5 — Standing agents (Grokbot analogue) — last, and only after T0–T4 measure clean

Persistent per-domain agents with their own memory, skills, and rules, woken by triggers rather than prompts,
reporting to the conductor. This is the "mini managers" goal. It is deliberately last: standing agents multiply
whatever the gate architecture already is, so they are only worth building on top of gates that have been
measured, not on top of the current fan-out.

## 9. Acceptance — process tests, not opinions

The rebuilt conductor is not accepted without automated negative controls proving:

1. A red base prevents a feature claim and consumes zero coding attempts.
2. Identical red base/candidate fingerprints produce `blocked_on_baseline`, not `exhausted`.
3. A candidate-only failure consumes exactly one coding attempt.
4. Mixed base+candidate failures send only the new candidate failures to the coder.
5. A formatter-only failure is autofixed once, rescanned, and does not consume a full retry.
6. An autofix touching an out-of-scope file is rejected.
7. A repaired base resumes the preserved candidate and still requires the close command to exit zero.
8. Terminal output reports the latest blocker first and never truncates away the terminal cause.
9. A runtime expert's unsupported "pre-existing" claim cannot bypass deterministic comparison.
10. Candidate branch and all review/runtime evidence survive every non-success terminal state.

New, for this plan:

11. A ticket whose declared seam has no `wiring_evidence` on the synthetic wave head produces a blocking
    Level 2 finding attributed to that ticket — and to no other ticket in the wave.
12. A Level 2 finding fixed in ticket A re-runs A's Level 1 and only the failed wave checks — unrelated
    experts do not re-run.
13. A board whose ticket `write_scope` cannot reach a seam it consumes fails board lint before any claim.
14. A wave that exceeds the changed-line or risk budget is split, not run.
15. A reviewer finding reproduced by no second model is categorized `Noted`, not a blocker.
16. Level 1 failure consumes zero expert sessions (assert on the event log, not on prose).
17. A completion manifest citing a receipt whose SHA does not match the pushed commit is rejected; an agent
    cannot produce a passing manifest without the wrapper's receipt (M-01).
18. A receipt containing a nonzero exit code fails the gate even when the manifest prose claims success —
    the RDSAD-235 shape, where a genuine-looking report claimed "no TypeScript errors" beside two real ones.
19. A Tier-A (LLM) finding alone never blocks a merge; only Tier-D deterministic checks gate.
20. A reviewer finding whose citation does not resolve is discarded before synthesis and never reaches
    `Act On` (M-05).
21. A check with no red fixture cannot be promoted from advisory to gating (M-04).
22. A ticket outside the admitted risk tier is never claimed unattended; it lands in `held_for_human` (M-02).
23. Scope validation on a worktree with a large untracked tree completes or exits `blocked_on_infrastructure`
    within its time box — it never hangs the ticket (M-06).
24. A seam declared `provides` whose export is absent from the built synthetic head fails Level 2, even
    though plan-time lint passed — the gap `findUnownedInterfaces` cannot see today.
25. Phase 4 with a board and a conductor present dispatches through the conductor; no HANDOFF document is
    emitted asking a human to open a session (§12).
26. A ticket STALLED twice at one tier is **split by the decomposer** and its pieces attempted, before any
    terminal state is reached (§13 rung 6).
27. An infra event (`ENOBUFS`, `ENOSPC`, timeout, provider error) consumes no coding attempt and opens no
    finding row — asserted on the event log (§13 rung 2).
28. A `[PARTIAL]` return resumes from the specialist's phase files; work the ledger shows finished is never
    re-run (§13).
29. A requirement with tickets closed but no passing E2E on `main` is reported as *coded*, not *done*, and
    blocks the assembly gate (§14.1).
30. A seam whose producer and consumers are in different tickets generates an assembly ticket automatically;
    a board missing one fails plan lint (§14.2).
31. The long-tail wave exists at decomposition time, not at the end, and includes the first-run/empty-state
    class explicitly (§14.3).
32. Every lever in §15.1 names a project-level setting that exposes it to a customer project; a lever that
    only speeds our own build fails this check (§15.2).

## 10. Targets

Split by defect, because the two pipelines start from different numbers.

> **Baseline caveat.** The Defect-A figures come from the work machine's event log and are **not verifiable
> from this machine** (verification C-10). Re-measure them there before grading progress against them — do
> not treat 4.76 → ≤1.5 as a settled baseline on this evidence.

**Defect A — Marauder / attest conductor (over-gating):**

| Measure | Now | Target |
|---|---:|---:|
| Expert review sessions per coding attempt | 4.76 | **≤ 1.5** |
| Median four-expert pass | 8.8 min | **~2.7 min** (concurrency), at per-wave frequency |
| Approve : changes-requested | 25 : 109 | measured post-consensus, with `Dismissed` counted separately |

**Defect B — Dokima conductor (failure mis-routing):**

| Measure | Now | Target |
|---|---:|---:|
| Retries per start event | 0.72 | **≤ 0.35** |
| Deterministic gate failures per start event | 0.63 | **≤ 0.30** |
| Tickets needing ≥1 block/recover cycle | 45.4% (64/141) | **≤ 20%** |
| Tickets ultimately completing | 90.8% (128/141) | **hold ≥ 90%** — this is already good; do not regress it |
| `conductor.fatal` rows charged to a ticket | 21 of 24 (excl. operator STOP) | **0** |
| Terminal summaries whose reason matches the last failing gate | truncated mid-stream today | **100%** |

*All Defect-B rates are per unique ticket except where the row says "per start event." Rates keyed to
`ticket.start` events are gameable by emitting fewer of them, so the unique-ticket denominator governs
acceptance; the event ratios are cost indicators only. Baseline window: W0–W11, 141 of 497 tickets — re-derive
against a current window before grading.*

**Both:**

- Feature attempts consumed by confirmed baseline failures: **→ 0**
- Reviewed candidates lost to a non-candidate gate: **→ 0**
- Integration defects found after wave merge rather than at Level 2: tracked from a zero baseline
- **Published reliability metric (M-07).** The 76% / 24% correction rate becomes a running, trending tally
  rather than a per-ticket anecdote — `field-report-marauder-delegation-2026-07-27.md:96-101` (P5) and
  `AI_PROCESS_REVIEW_2026-07-27.md:235-239` (rec 2) both ask for this. Drift becomes visible before it is a
  crisis, and it is the number that answers "do you trust AI-authored code" with evidence.

## 11. Risks

| Risk | Control |
|---|---|
| Wave batching read as "scan later" | §5 assurance floor; nothing merges until aggregate reviews are green; release gates unchanged |
| Policy bypass from executor-first ordering | T1 gates T2/T3; T1-02 is the explicit legalizing ticket |
| Consensus filtering hides a true lone-model finding | `Dismissed` requires a written reason; lone-model HIGH/CRITICAL on a security surface is never auto-dismissed |
| Seam map becomes stale documentation | `seams.json` is machine-read by board lint and Level 2; a stale map fails a gate rather than misleading a human |
| Attribution error reopens the wrong ticket | Findings carry ticket + line attribution; test 11 asserts single-ticket attribution |
| `attest-claude` drift | Generated only; `npm run build:claude` after every attest merge, per `GENERATED_FILES.txt` |

---

**Next decision (founder):** approve the T1 policy rewrite scope, since every downstream wave is gated on it.

---

## 12. Why it gets stuck — the root cause, in the user's own words

From the Cursor session transcript, unprompted, describing this exact system:

> *"Where OpenCode fails still is one agent. If you create a specialized agent and it knows about the
> other specialized agents next in the path that needs to do — it can't call it. It could call it, but the
> timeout is set so low on calling the next skill. It doesn't really do it as a child process, so you can't
> wait for it to come back. So automation fails with OpenCode. You kind of have to babysit OpenCode still."*

That is the defect, and it is architectural, not behavioural. **attest's Phase 4 is human-mediated by
construction.** `agents/shared/HANDOFF_TEMPLATES.md:44` — *"Print a short pointer to the user — which agent
to open, the exact line to paste"*; `:281` — *"tell the user to open the N agents (`/<skill>` each)"*. Every
Round 1 → Round 2 → Round 3 transition requires a human to open a session. The field report names the cost
directly: *"the copy-paste HANDOFF tax is real and compounds over a long engagement"*
(`attest/issues/field-report-mode1-sdlc-run-2026-07.md:114`).

So "the coding portion gets stuck and is constantly confused" is not a prompting problem to be solved with
better agent instructions. **The HANDOFF is a message to a human. A conductor is a child process.**

**Therefore: automating Phase 4 means routing Phase 4 through a conductor, not through HANDOFF prose.** The
mechanism already exists in both repos — it spawns sessions from *outside*, holds the gates itself, and never
asks a human to relay a message. What is missing is that the SDLC's own Phase 4 does not use it; it still
emits HANDOFF documents. Cursor's answer to the same problem is `multitask` — the orchestrator spawns
subagents and blocks on their return. We have the equivalent and do not point Phase 4 at it.

**T1-11 (new, and it belongs in the first wave):** `sdlc-init-phase-4.md` gains a conductor-first execution
mode — when a board and a conductor are present, Phase 4 dispatches through the conductor and HANDOFF prose
becomes the fallback for the interactive case, not the default path.

## 13. Self-healing — what happens when a ticket will not move

> **Corrected 2026-08-31 after an independent mechanism audit — this section was wrong in the direction that
> changes the ticket.** The first draft said the stall ladder is attest doctrine that *"neither executor
> implements."* It is **implemented and tested in TypeScript in `packages/loop`, and wired to nothing.**
> `classifyIteration`, `createFindingBudgetTracker`, `checkConvergence` and `checkProgressCeiling` have
> **zero callers** outside `packages/loop` (verified by grep across `apps/`, `packages/`, `scripts/`);
> `createFindingLedger` has one. `apps/server/src/scheduler/snapshot.ts:18-21` admits it in its own source.
> **The correct ticket is "call it from harbormaster's land loop," not "build the classifier."** This is the
> same built-but-never-mounted family as §2's third-conductor row.

Both conductors respond to a stuck ticket the same way: **retry the same ticket shape on a stronger model,
then block.** That is one move. The richer ladder exists twice over — as attest doctrine, and as shipped
Dokima code — and the executors call neither.

**Stall classification already exists** — `attest/agents/shared/FIX_VERIFY_LOOP.md:153-157`, per-row verdicts
(CLOSED / STILL-OPEN / NEW / REGRESSED) rolled into iteration classes:

| Class | Signature | Doctrine |
|---|---|---|
| **STALLED** | a row is STILL-OPEN after an iteration that explicitly targeted it | 2 targeted iterations at the same tier, never 3 — *"the third identical attempt is the worst spend in the system"* |
| **PROGRESSED** | prior rows CLOSED, NEW rows opened | Healthy. Let it loop while NEW-row count strictly decreases. Ceiling 6 metered / 12 local |
| **OSCILLATING** | a previously-CLOSED row returns | Zero tolerance. First regression escalate, second stop |
| **Infra event** | verify truncated / tooling crashed | *"Consumes no iteration and opens no row. Never charge the fixer for infrastructure"* |

**And it is already TypeScript, with tests** (`packages/loop/src/`):

| Module | What it decides | Constant |
|---|---|---|
| `loop-policy-classify.ts:6` | `CLEARED · STALLED · PROGRESSED · MIXED · OSCILLATING` — and `ReviewSignalAction` has **no FAIL variant**, so by construction it cannot auto-fail a passing gate | — |
| `loop-policy-budget.ts:11-13` | `RETRY_SAME_TIER · ESCALATE · BLOCK · CLEARED`, reasons `stall · regression · post_escalation_stall · second_oscillation` | 2 attempts/tier, +1 post-escalation |
| `loop-policy-convergence.ts:12-14` | `CONTINUE · PARK`; `CONVERGING · DIVERGED` on a sliding window. Its `:39` comment already says *"Hitting the ceiling while still PROGRESSED is a park, not a failure… split it"* | **metered cap 8, local floor 12** |
| `micro-loop.ts:126-127` | `DONE · BLOCKED · PARTIAL` | 3 passes, 4 evidence actions |

⚠ **Constant conflict — do not land the prose over the code.** `FIX_VERIFY_LOOP.md:156` says the metered
PROGRESSED ceiling is **6**; `loop-policy-convergence.ts:12` ships **8**. The shipped, tested constant wins
unless someone deliberately changes it with a reason. Landing the doctrine as written would silently regress
a committed value — exactly the failure this plan exists to prevent.

Two doctrine items are load-bearing and reach no executor:

1. **"Hitting any ceiling while still PROGRESSED is a *decomposition signal* (the change is too big — split
   it), not a fix failure."** (`FIX_VERIFY_LOOP.md:156`, and `loop-policy-convergence.ts:39` already
   implements the PARK.) **Splitting the ticket is the missing self-heal move** — the classifier decides
   PARK, and nothing acts on it. A conductor that stalls twice should hand the ticket to the decomposer and
   try the pieces.
2. **"Never charge the fixer for infrastructure."** Dokima's log violates this on four of five distinct
   fatal classes (§1 Defect B).

**The escalation ladder, in order.** Each rung is attempted once; falling off the bottom is the only path to
a terminal state:

| # | Trigger | Action | Consumes a coding attempt? |
|---|---|---|---|
| 1 | Deterministic gate fails, autofixable | Bounded mechanical remediation in scope | No |
| 2 | Infra event (`ENOBUFS`, `ENOSPC`, timeout, provider error) | Re-run; route to `blocked_on_infrastructure` if persistent | No |
| 3 | Candidate fails, base also fails identically | `blocked_on_baseline`; file the repair ticket | No |
| 4 | Candidate-only failure, first time | Retry with exact blocking evidence carried forward | Yes (1) |
| 5 | STALLED twice at one tier | Escalate tier — the current ladder's only move | Yes (1) |
| 6 | Still STALLED, or PROGRESSED into the ceiling | **Decompose: split the ticket, re-plan the pieces, run them** | No — this is a planning act |
| 7 | Scope wall — the fix needs a file outside `write_scope` | Widen with recorded justification if the file is unowned, else **file a linked ticket** (`CLAUDE.md` Law 1) | No |
| 8 | Two consecutive failures of the same class after 6 and 7 | `held_for_human` with the candidate and all evidence preserved | No |

Rung 8 matches the automation pattern Cursor described at Amplitude — *CI fails twice, bring in a human* —
and rung 7 is already Dokima law: *"a follow-up that names no ticket id is not a deferral, it is a dropped
finding."*

**The `[PARTIAL]` contract is the return channel for this** (attest v3.5.4, `BOUNDED_TASK_CONTRACT.md`
Rule 8): a specialist that hits its own cap returns `[PARTIAL]` plus a task ledger and phase files on disk.
A conductor receiving `[PARTIAL]` must **resume from the phase files**, never blind-re-dispatch and never
restart finished work. Neither conductor reads that channel today.

**Stuck must be observable, not inferred.** Every rung emits a typed event; a ticket that changes rung
without changing state twice is itself a signal. The operator's question is *"what is it stuck on"*, and the
answer must come from the event log, not from reading a session transcript.

## 14. The Assembler — so "done" means a working product, not 495 closed tickets

The board says 495 of 497 done. That is a statement about tickets, not about the product. The gap between
those two has a name in the field reports: **"module/task completion silently diverges from requirement
completion"** (`attest/issues/field-report-mode1-sdlc-run-2026-07.md:56`, finding A-1). Every ticket can be
green while the thing does not work, and nothing in the pipeline is responsible for noticing.

Three artifacts close it. None exist today.

### 14.1 Requirement coverage ledger (the real denominator)

Tickets are the wrong denominator. **User stories and acceptance criteria are.** The ledger maps every
requirement → the tickets claiming to implement it → the end-to-end test that proves it on `main`.

- A requirement with tickets but no passing E2E is **not done** — it is *coded*.
- A requirement with no tickets at all is the silent case A-1 describes, and only a re-derivation from the
  SRS catches it. attest already has the discipline (`includes/denominator-discipline.md`: re-derive the
  requirement list from the SRS, *never* from the node list you just wrote) and no artifact carries it into
  Phase 4.
- This is the Ralph Wiggum loop applied to requirements rather than to documents — same inventory / verify /
  gap / repeat, same objective coverage instead of a feeling.

### 14.2 Assembly tickets are first-class

Wiring is work, and it is currently nobody's ticket. Every seam whose producer and consumers sit in
different tickets gets an **assembly ticket** whose acceptance is the wiring evidence itself — the route
registered, the export re-exported, the migration applied, the nav entry present, the flag read. Dokima's own
originating lesson is exactly this shape: *"W0-05 built `mintReceipt`, W1-02 consumed it, but neither ticket
owned re-exporting it — the function existed and was invisible"* (`decompose/linter.ts:38-44`).

The planner emits these automatically from the seam graph. They are the tickets nobody writes by hand
because they are not features.

### 14.3 The long tail is a named, planned wave — not what is left over

The last 10% is not "polish." It is a specific and **recurring, un-hunted** defect class the field report
already names: **first-run / empty-state / bootstrap deadlocks**
(`attest/issues/field-report-mode1-sdlc-run-2026-07.md:252`, finding B-1). The planner emits a long-tail wave
at decomposition time, not at the end, covering:

first run on an empty database · empty states for every list and table · the unauthenticated and
expired-session paths · every error path a happy-path ticket declared but never exercised · migration from
the previous version · uninstall and reset · the first-run bootstrap deadlock class specifically.

Because these are planned tickets with acceptance criteria, they are subject to the same gates. Because they
are planned *up front*, they are budgeted rather than discovered at the point of maximum schedule pressure.

### 14.4 The assembly gate

A release candidate passes only when: every requirement in the ledger has a passing E2E on `main`; every
seam's wiring evidence resolves; the long-tail wave is closed; and the launch gates already in
`CLAUDE.md` Law 3 are green. **Ticket completion is an input to this gate, never a substitute for it.**

## 15. Usage optimization — and the same optimization for the projects we build

Two requirements, and the second is the one that makes this a product rather than a private harness tuning.

### 15.1 Make the pipeline cheaper and faster

| Lever | Mechanism | Status |
|---|---|---|
| Run reviewers concurrently | Slowest-reviewer cost instead of the sum: 8.8 → ~2.7 min | OPT-01, T3-03 |
| Stop re-reviewing an unchanged patch | Abort the fix loop when the coder produced no diff | OPT-02, T2-08 |
| Cache the baseline | Keyed by base SHA + command + lockfile + runtime fingerprint; one suite run serves every ticket on that base | T2-01 |
| Cache dependency install + build | Keyed by main SHA + lockfile hash | OPT-11, T3-09 |
| Route by risk and size, not by habit | Cheap tier for mechanical work, escalate only on evidence — `cheapLanes` / `cheapMaxPoints` already exist in `conductor.config.json` and are the seed | T2-14 (new) |
| Summaries, not transcripts | A subagent returns its finding set; the orchestrator never ingests the subagent's context. Cursor's framing, and Brad's in the meeting: *"the main agent doesn't need to know about all the things it did — it just needs that finalized report"* | T1-05 |
| Load rules by glob, not always | Cursor: *"don't have too many always-apply, that brings context bloat to every chat."* attest's shared protocol set is always-on and growing | T1-03 |
| Stop paying for false triggers | `.map(` and the word `validate` currently recruit specialists (§1) | OPT-08, T1-04 |

### 15.2 Dogfood symmetry — every lever above ships as a project-level capability

**Rule: no optimization lands as a private tuning of our own harness.** Each one is configured per project
and applied by Dokima to the codebases it builds, because the customer's project has the same economics —
that is the product. Concretely, each lever gets a project-level configuration surface and a default:

- Gate levels, wave budgets, and risk tiers are declared per project, not compiled in.
- The baseline and build caches are keyed per project.
- Model routing policy is a project setting — and per `CLAUDE.md` Law 9(b) it is **the user's choice**,
  asked at setup, never silently defaulted, with local-only remaining fully functional.
- The requirement ledger, seam graph, assembly tickets, and long-tail wave are generated for the customer's
  project the same way they are for ours.
- The self-healing ladder (§13) is the conductor's behaviour on any board it runs.

**The test of this section is mechanical:** every lever in 15.1 must name the project-level setting that
exposes it. A lever that only makes *our* build faster is an incomplete ticket.

## 16. The mechanism inventory — what already runs, and what genuinely does not

An independent mechanism audit (2026-08-31) enumerated the deterministic-check and automation surface of both
repos against this plan. **The plan's recurring error is proposing to build things that exist and are
unwired.** Four times now: the seam model (§4), the findings ledger (§5), the loop-policy engine (§13), and
the automation layer below. The default assumption for any new ticket should be *find the existing
implementation first*.

### 16.1 Already built — extend or wire, do not rebuild

| Surface | Evidence | Consequence for this plan |
|---|---|---|
| Loop policy engine | `packages/loop/src/loop-policy-{classify,budget,convergence}.ts`, `micro-loop.ts` — tested, **0 external callers** | §13 is a wiring ticket (T2-15) |
| Trigger-driven automation | `apps/server/src/scheduler/plan-scheduler.ts` (`pollRunCompletions`, `runNightlyVerify`), `api/server/board-watcher.ts`, `packages/forge/src/mirror/queue.ts`, `packages/gateway/src/providers/request-queue.ts` | **T4 is an extension, not a new layer.** Its header records a deliberate constraint worth keeping: *zero Decide-tier auto-actions* |
| Loop safety rails | `packages/harbormaster`: `loop-killswitch.ts` (kill/pause file, effective at the next ticket boundary, never mid-session), `limit-pause.ts` (12 attempts, 5-min backoff → 60-min cap), `watchdog-process.ts`, `berths-scheduler.ts`, `conflict-watcher.ts`, `loop-claim.ts` (2 sessions/ticket, 30-min stale claim) | §13's ladder plugs into these; the STOP-at-boundary semantics are already right |
| Reviewer-citation gate (M-05) | `attest/scripts/delegation-gate.mjs --citations` — **already written** | Wire it, do not design it |
| Red-fixture harness | `attest/scripts/check-validator-fixtures.mjs`, enforced in `npm test` Pass 7 | Port to Dokima (T2-11) rather than inventing |
| Supervision / until-done | `attest/scripts/{conductor/supervise.sh,run-until-done.sh,soak-monitor.mjs}`; `shipwright/scripts/{autorun.sh,supervise.sh}` | §12's conductor-first Phase 4 has a runner already |

### 16.2 Genuinely absent — and three are load-bearing

| # | Gap | Evidence |
|---|---|---|
| 1 | **No git hooks in either repo.** `core.hooksPath` empty, no tracked `hooks/`, no `hooks:install`. `attest/plugins/expert-hooks.ts:38` explicitly punts commit validation to *"a git pre-commit hook in the user's repo"* — nobody wrote one | Level 1's "must-run" enforcement has **no pre-commit/pre-push surface**; every deterministic check is opt-in, run only when a human types a command or a conductor spawns a gate |
| 2 | **Dokima red fixtures: 0 of 78.** The vendored `content/validators` pack came without its fixtures, and `check-validator-fixtures.mjs` was not vendored either. attest itself is 22 of 57 chained validators fixtured, 35 grandfathered | M-04/T2-11 is **building the harness from zero** on the Dokima side, not a calibration pass |
| 3 | **Dokima's gate is two checks wide.** `conductor.config.json` `gate[]` = `validate-file-size`, `validate-circular-deps`; `advisory[]` = 3; **73 of 78 vendored validators are inert** | §5's "deterministic validators own the gate" is aspirational today. Level 1 needs the promotion pipeline (`$note` in that file already states the rule: *promote once red-fixture-calibrated*) |
| 4 | **The only scheduled job in either repo has never run its payload.** `nightly.yml` gates on root `package.json` `scripts.e2e`, which is `undefined` — the real command is `pnpm --filter @dokima/web e2e` (Law 3). Green-skipping since W4 | Any §10 target assuming a nightly signal is unfounded until fixed. Same shape as this repo's own lesson: *a check nobody runs decays into a check nobody can trust* |
| 5 | **`TESTING.md` §6's named planted-defect suite does not exist as a suite.** It tabulates 5 attack fixtures; `ci.yml`'s `gate-integrity` job instead re-runs five whole packages | `CLAUDE.md` Law 4 makes those fixtures acceptance for any gate-touching ticket, and nothing enumerates them or fails when one goes missing |
| 6 | **`validate-scope.sh` and `validate-tracker-fresh.sh` gate every HANDOFF with no red fixture and no grandfather entry** — `check-validator-fixtures.mjs:29` parses only `validate-phase-gate.sh`, missing `run-handoff-gates.sh` | The scope gate M-06 is about is one of the two unproven ones |
| 7 | **attest CI runs no validator and has no scheduled job** — 4 steps: `npm ci`, `npm test`, `agents:check`, `build:claude:check` | The policy repo's own gates are local-only |

### 16.3 The plugin-reach asymmetry — a real constraint on §7

`attest/plugins/expert-hooks.ts` intercepts `tool.execute.before` (blocks dangerous bash and writes to
credential paths) and `tool.execute.after` (format + lint + typecheck + secret-scan on every edited file).
It is an `@opencode-ai/plugin`. **attest's conductor spawns `OPENCODE_BIN run`, so the hooks fire. Dokima's
conductor spawns `claude -p … --dangerously-skip-permissions` (`scripts/conductor/session.mjs:31`), so they
never fire — not once, for any Dokima conductor session.**

So §7's "extend hooks to Level 1 enforcement" is unimplementable on the executor where Defect B lives.
**Corrected direction:** Level 1 enforcement on the Dokima side belongs in the conductor's own gate chain and
in git hooks (16.2 #1), not in the OpenCode plugin. Any constraint that must bind both executors travels as a
**verify command in the packet**, per attest's own v3.5.2 doctrine — *"if the executor loaded nothing but
this packet, would this still bind?"*

**New tickets from this audit:** T2-18 install tracked git hooks in both repos · T2-19 port
`check-validator-fixtures.mjs` and build Dokima red fixtures · T2-20 validator promotion pipeline
(advisory → gate, gated on a red fixture) · T2-21 fix `nightly.yml`'s payload · T2-22 enumerate
`TESTING.md` §6's five planted-defect fixtures as a real suite · T3-10 wire `delegation-gate.mjs --citations`
as the reviewer-citation gate · T4-05 extend `plan-scheduler`/`board-watcher` rather than building a new
automation layer, preserving its zero-Decide-tier-auto-action constraint.
