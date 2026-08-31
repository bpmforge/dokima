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

**Two conductors exist, with different dominant defects.** Treating them as one problem mis-orders the work.

| Measure | attest / Marauder conductor | Dokima conductor (this repo) |
|---|---:|---:|
| Unit | 181 coding attempts | 282 ticket starts |
| **Review sessions per unit** | **4.76** | **0.93** |
| Approve rate | 18.7% (25 of 134) | 48.3% |
| Expert-review wall time | 1,900.8 min | — |
| Worst single ticket | 32 expert sessions, 111.8 min, then exhausted | — |
| Median 4-expert sequential pass | ~8.8 min before any fix | n/a (one reviewer) |
| Retries per unit | — | 0.72 |
| Deterministic gate failures per unit | — | 0.63 |
| **Block rate** | — | **39.4%** (done 45.4%) |

Marauder figures: `LOCAL_EXHAUSTION_INCIDENT_LESSONS.md`. Dokima figures: computed from this repo's
`docs/work/conductor-log.jsonl`, 3,610 rows, 2026-07-11 → 2026-08-07.

**Defect A — over-gating (Marauder).** Per-ticket expert fan-out is a **scan-scheduling defect**, not a
quality feature: the expensive assurance runs at the wrong granularity (every candidate), in the wrong shape
(sequentially, one model, full re-run on every fix).

**Defect B — failure mis-routing (Dokima).** Fan-out is not the problem here; **two of every five tickets
block**. Distinct `conductor.fatal` causes in the log: `spawnSync git ENOBUFS`, `ENOSPC: no space left on
device`, `row.notes.push is not a function`, `testSiblingWarning is not defined`, a failed `git merge
--no-ff`. Four of five are infrastructure or executor defects — the exact class the incident doc says must
never consume a feature attempt. `gates.fail` messages are visibly truncated mid-stream
(`"pnpm test failed: eout\"."`), so the operator often cannot see the real cause.

**This reorders the plan: T2 (failure accounting) lands before T3 (the wave gate),** because Defect B is
what costs *this* repo throughput, and Defect A is what costs Marauder's.

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

**OPT-01..OPT-05 are NOT here.** The incident doc records them in executor commit `e73f668`, in an isolated
local JIRA-conductor worktree on the work machine, deliberately not pushed upstream. In this repo's conductor:

- reviewers run **one reviewer, sequentially** (`scripts/conductor/ticket.mjs:41`) — no concurrency, no model diversity;
- there is **no no-change fix-loop abort** and **no baseline preflight** (grep for `unchanged|baseline` in
  `scripts/conductor/*.mjs` returns only unrelated comments);
- the retry ladder **regenerates the whole candidate on the next model** rather than repairing mechanically.

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
this plan exists to draw. Five conditions must hold at the Phase 3.5 → Phase 4 boundary before the conductor
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

When all five hold, the conductor runs the board without supervision: claim → Level 1 → wave admission →
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
> by validator findings.** This plan does not re-open that. Level 2 therefore has two tiers.

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
  calibration), stated as law. The shell conductor and the Marauder pipeline simply do not honour it.
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
| **hooks** (must-run lifecycle) | `plugins/expert-hooks.ts`, validators | Keep; extend to Level 1 enforcement |
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

## 10. Targets

Split by defect, because the two pipelines start from different numbers.

**Defect A — Marauder / attest conductor (over-gating):**

| Measure | Now | Target |
|---|---:|---:|
| Expert review sessions per coding attempt | 4.76 | **≤ 1.5** |
| Median four-expert pass | 8.8 min | **~2.7 min** (concurrency), at per-wave frequency |
| Approve : changes-requested | 25 : 109 | measured post-consensus, with `Dismissed` counted separately |

**Defect B — Dokima conductor (failure mis-routing):**

| Measure | Now | Target |
|---|---:|---:|
| Block rate | 39.4% | **≤ 15%** |
| Done rate | 45.4% | **≥ 75%** |
| Fatals from infrastructure/executor defects | 4 of 5 distinct causes | **0 consuming a feature attempt** |
| Terminal summaries whose reason matches the last failing gate | truncated mid-stream today | **100%** |

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
