# Pipeline Throughput Enhancement — Autonomous Phase 4

**Status:** proposed program plan · **Date:** 2026-08-31 · **Branch:** `feat/pipeline-throughput-enhancement`

**Scope:** `attest` (policy + expert content) → `attest-claude` (generated) → Dokima/Shipwright (executor + conductor).

**Inputs:**
- `~/Documents/02_Work_Notes/LOCAL_EXHAUSTION_INCIDENT_LESSONS.md` — sanitized incident review + measured throughput analysis + OPT-01..OPT-12. **This plan does not restate that document; it is the delta and the landing plan.**
- `~/Documents/02_Work_Notes/cursormeeting.md` — Cursor/SpaceX AI platform session, 2026-08-31.
- <https://github.com/cursor/plugins/blob/main/pstack/skills/interrogate/SKILL.md> — pstack `interrogate` skill (multi-model adversarial review).

---

## 1. The defect, named

Per-ticket expert fan-out is a **scan-scheduling defect**, not a quality feature. The pipeline runs the
expensive assurance layer at the wrong granularity (every candidate) and in the wrong shape (sequentially,
one model, full re-run on every fix).

Measured, from the incident doc's durable event log:

| Measure | Observed |
|---|---:|
| Coding attempts | 181 |
| Expert review sessions | 861 (4.8 per coding attempt) |
| Fix sessions | 212 |
| Expert-review wall time | 1,900.8 min |
| Latest window | 134 expert sessions → 109 `CHANGES REQUESTED`, 25 approvals |
| Worst single ticket | 32 expert sessions, 111.8 min, then exhausted |
| Median 4-expert sequential pass | ~8.8 min before any fix or runtime |

Three compounding causes:

1. **Wrong granularity.** Security, performance, and UX experts run per ticket, then again between waves,
   then again at release. The same assurance is bought three times.
2. **Wrong triggers.** Any loop / `.map` / `.filter` / `.reduce` recruits a performance expert; common
   validation vocabulary recruits security; any `.tsx` or `.css` recruits UX. In `attest`,
   `agents/sdlc-init-phase-4.md:129-138` states these as prose conditions ("if DB queries/loops/caching
   touched", "if any UI file touched"). Broad text patterns are fine for a cheap deterministic scanner and
   far too broad to justify an expensive specialist *process*.
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

Grokbot (standing per-domain agents with their own memory/skills/rules, messaging each other, trigger-driven)
is the end state, not the starting point. It is Phase T5 below.

## 4. Net-new: the Interaction Map

**Nothing in the incident doc addresses this, and it is the user's actual complaint:** every ticket codes its
own slice correctly, and at the end nothing is wired together.

Today the SDLC produces user stories → tickets. The seams *between* tickets are never written down, so no gate
can check them. Insert one artifact between decomposition and the board.

**Artifact:** `docs/design/INTERACTION_MAP.md` (+ machine-readable `docs/design/seams.json`)
**Producer:** `attest` `agents/task-decomposer.md` + `skills/architect`, at Phase 3.5/4 boundary.
**Rule:** a ticket board may not be admitted to the conductor unless every ticket's declared inputs and
outputs resolve against the seam table.

Each seam row declares:

| Field | Meaning |
|---|---|
| `seam_id` | stable ID, e.g. `SEAM-07` |
| `kind` | interface · shared type · route registration · DI/container binding · event topic · DB table/column · config key · nav/menu entry · feature flag |
| `symbol` | the exact importable/addressable thing (`packages/tickets/src/api.ts::claimTicket`, `POST /v1/waves`, `waves.status`) |
| `producer` | the ONE ticket that creates it |
| `consumers` | tickets that must reference it |
| `wiring_evidence` | the deterministic assertion that proves it was wired (import exists, route resolves, migration applied, registry entry present) |
| `contract_test` | the test that must exist and pass at Level 2 |

Three consumers make it pay for itself:

1. **Wave composition (OPT-12).** Disjoint write scopes and the dependency DAG fall straight out of the map —
   no heuristic needed. A producer seam and its consumers belong in the same wave or in ordered waves.
2. **Level 2 cross-ticket contract checks.** The wave gate can only detect "these did not get wired up" if it
   knows what the seams were *supposed* to be. Generalize `lint-rules.mjs`: **a seam whose `wiring_evidence`
   is absent on the synthetic wave head is a blocking Level 2 finding, attributed to the consumer ticket.**
3. **Ticket scope reachability.** A consumer whose `write_scope` cannot reach its seam's symbol is a filing
   defect caught at lint time, not at the wall — the failure mode already recorded as the dominant one in the
   Conductor field reports.

## 5. Target architecture — three gate levels

Per-ticket branches and PRs are **retained**. Scope, ownership, rollback, ticket ancestry, and defect
attribution stay exact. What changes is where the expensive assurance runs.

### Level 1 — Fast per-ticket gate (deterministic, minutes, no expert session)

1. Write-scope and forbidden-file enforcement
2. Acceptance tests + the ticket's configured verify command
3. Formatting, affected-package type check, affected-package build
4. Diff-scoped secret detection and SAST (bpm-rulepacks / Opengrep)
5. Dependency validation when a lockfile or manifest changes
6. Deterministic anti-slop: stubs, phantom imports, newly-unused exports, duplicate blocks, disconnected
   registrations, debug artifacts, unsupported suppressions
7. Completion manifest: each acceptance criterion → code + test evidence
8. **Seam check:** every seam this ticket produces or consumes has its `wiring_evidence` present

**A failed Level 1 never consumes an expert review session.**

An expert runs *before* wave admission only for intrinsic high risk: authn/authz, cryptography, secrets,
unsafe deserialization, DB schema or query shape, public API compatibility, concurrency, or a material
interaction redesign. Ordinary loops, validation helpers, `.tsx` and `.css` do **not** qualify while the
deterministic scanners are green.

### Level 2 — Wave integration gate (the expensive assurance, run once, concurrently)

Synthetic validation branch = fresh `main` + the candidate commits of 4–8 compatible tickets. No feature work
is ever authored on it. Composition budgets: prefer one subsystem, disjoint write scopes, ≤ ~1,000 changed
production lines; 1–3 tickets for auth, persistence, migrations, or parsers.

Run once against the combined diff, **concurrently, each reviewer in its own context window on its own model**
(`interrogate` shape):

1. Full build, type check, unit + integration tests
2. Full SAST, secret, dependency, license
3. Code-health and anti-slop across the aggregate diff
4. Security review — when the wave contains a security surface
5. Performance review + benchmarks — when it changes a measured hot path
6. UX / a11y / browser E2E — when it changes user-visible behavior
7. **Cross-ticket contract + seam checks** — the class a per-ticket branch physically cannot expose

Synthesis follows `interrogate`: consensus (2+ models) = highest signal; lone-model findings are isolated;
the lead categorizes **Act On / Consider / Noted / Dismissed** with an agreement map. Every finding gets a
stable ID and is attributed to the ticket and lines that introduced it. **Only the owning ticket reopens.**
After its fix, re-run that ticket's Level 1 and only the *failed* wave checks against the new synthetic head.

Expected effect, using the doc's own medians: a four-expert pass drops from ~8.8 min (sum) to ~2.7 min
(slowest) *and* from per-ticket to per-wave — a 4–8× reduction in the number of passes on top of the 3.3×
reduction in each pass's duration.

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
| T1-07 | Rewrite `review`/`challenge` synthesis to the `interrogate` shape: concurrent multi-model, consensus weighting, Act On / Consider / Noted / Dismissed, agreement map | attest |
| T1-08 | Structured verdict contract for runtime expert: `PASS` / `FAIL_CANDIDATE` / `BLOCKED_BASELINE_CONFIRMED` / `BLOCKED_BASELINE_SUSPECTED` / `BLOCKED_INFRASTRUCTURE`; a nonzero configured verify **always** produces FAIL | attest |
| T1-09 | `task-decomposer` + `architect` emit `INTERACTION_MAP.md` + `seams.json`; add a validator that fails a board whose tickets do not resolve against the seam table | attest |
| T1-10 | `npm run build:claude`; commit both repos; push both remotes | attest + attest-claude |

### T2 — Executor: failure accounting (unblocks throughput without touching policy)

| ID | Work | Maps to |
|---|---|---|
| T2-01 | Stage 0 cached baseline preflight in a clean detached worktree | doc Stage 0 |
| T2-02 | Structured failure fingerprints + normalization | Stage 1 |
| T2-03 | Deterministic base-vs-candidate differential classifier | Stage 2 |
| T2-04 | Bounded in-scope mechanical remediation before a new coding attempt | Stage 3 / OPT-04 |
| T2-05 | `blocked_on_baseline` + candidate preservation and resume | Stage 4 |
| T2-06 | Six terminal states with separate retry budgets | Stage 5 |
| T2-07 | Terminal report: latest blocker first, no destructive truncation | Stage 5 |
| T2-08 | Port OPT-01..OPT-05 (concurrency, no-change abort, carry exact blocking excerpts, continue after nonzero coder exit with a real diff, parse complete reports despite nonzero exit) — **re-derive here; `e73f668` is not on this machine** | OPT-01..05 |

### T3 — Executor: the wave gate

| ID | Work | Maps to |
|---|---|---|
| T3-01 | Synthetic validation branch builder from N compatible PR heads | OPT-09 |
| T3-02 | Wave composition from `seams.json` + disjoint write scopes + changed-line/risk budgets | OPT-12 |
| T3-03 | Concurrent multi-model reviewer fan-out; each writes a distinct immutable report | OPT-01 + multitask |
| T3-04 | Stable finding IDs, ticket/line attribution, failed-check-only delta re-review | OPT-10 |
| T3-05 | Seam wiring assertions as blocking Level 2 checks (generalize `lint-rules.mjs`) | §4 |
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

## 10. Targets

- Expert review sessions per coding attempt: **4.8 → ≤ 1.5**
- Median four-expert pass: **8.8 min → ~2.7 min** (concurrency), at **per-wave** rather than per-ticket frequency
- Feature attempts consumed by confirmed baseline failures: **→ 0**
- Reviewed candidates lost to a non-candidate gate: **→ 0**
- Approve : changes-requested ratio (post-consensus filtering): **25:109 → measured, with `Dismissed` counted separately**
- Integration defects found after wave merge rather than at Level 2: **tracked from zero baseline**

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
