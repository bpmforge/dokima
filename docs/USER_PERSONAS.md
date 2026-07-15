# Shipwright — User Personas

Traces to: `docs/BLUEPRINT.md` (§1.2, §3.6, §5) and founder decisions D-005, D-007,
D-010. Personas drive user stories (US-x) and the Canvas/notification design; v1 is
single-operator (D-005), so every persona is one human driving the platform.
Willingness-to-pay entries are **hypotheses for Phase 0/1 validation**, not verified
pricing research (D-006 keeps content open; monetization is a later founder slate).

## P1 — Solo builder / indie hacker

Blueprint: an idea and no team; Shipwright is the PM, architect, security reviewer,
and dev crew.

- **Goals:** ship a real, secure, tested product from a plain-English idea; look like
  a team of six; spend evenings deciding, not typing.
- **Frustrations today:** ChatGPT/Copilot produce code but no product — no scope, no
  threat model, no plan; agent tools demo well then wander off-spec; "it said it's
  done" costs a weekend of debugging; frontier bills spike unpredictably.
- **Berths (D-010):** starts at berths=1, breakpoint=`ticket` while trust builds;
  graduates to berths=2–3 + `wave` once the fitness cards and receipts have earned it.
- **Autonomy dial:** `interactive` through phases 0–3 (the interview and slates are
  the product for P1); `auto` for build waves, leaning on documented defaults.
- **Morning queue:** the daily ritual — merges and clarifications over coffee; the
  "night of autonomous work reviewable in ten minutes" target (BLUEPRINT §5.2) is
  designed for this persona.
- **Willingness to pay (hypothesis):** indie-tool pricing — one-time or low monthly
  comparable to a Cursor-class subscription; extremely sensitive to *model* spend,
  so the dry-run cost estimate (SCOPE.md S-22) and spend ledger are purchase
  criteria, not nice-to-haves.

## P2 — Professional dev

Blueprint: wants the discipline (gates, threat model, coverage) without the
ceremony; agents doing the bulk work under supervision.

- **Goals:** delegate the mechanical 80% and keep engineering judgment; discipline
  artifacts (SRS, threat model, coverage) generated as a by-product of working, not
  as homework; escape hatches everywhere.
- **Frustrations today:** IDE agents need babysitting per prompt; process tools
  (Jira ceremony) cost more than they return on solo/small work; no tool re-runs
  the gates an agent claims to have passed; context evaporates between sessions.
- **Berths:** the power user of parallelism — berths=3+ across lanes, breakpoint
  `wave` daily / `never` overnight; scripts the Harbormaster via CLI
  (`shipwright run --breakpoint wave`) since UI and CLI drive the same verbs.
- **Autonomy dial:** `auto` by default; trusts the ledger over interruptions;
  audits the NEVER-AUTO queue and the receipts, not the chat transcripts.
- **Morning queue:** treats it as a PR review inbox — diff-stat + receipts inline,
  approve/reject in bulk; expects explain-this-refusal when an invariant blocks a
  drag (BLUEPRINT §5.3).
- **Willingness to pay (hypothesis):** already pays for one or two AI dev
  subscriptions; will pay professional-tool rates if Shipwright demonstrably
  replaces the tracker *and* multiplies agent throughput; employer may reimburse
  (see P3, D-007 corporate credentials).

## P3 — Small team lead

Blueprint: replaces Jira + GitHub + scattered AI extensions with one cohesive
surface; agents and humans share the same board.

- **Goals:** one board where human and agent work obey identical rules; audit trail
  that survives "who changed this and why" six months later; predictable spend to
  defend at budget time; corporate AI credentials actually usable (D-007: Copilot
  device-auth, Vertex ADC as first-run paths).
- **Frustrations today:** tracker state is fiction maintained by hand; AI work is
  invisible to the tracker and unaccountable to review; per-seat SaaS pricing plus
  per-seat AI pricing with zero evidence of what the AI spend bought; compliance
  asks "who approved this merge" and the answer is a Slack thread.
- **Berths:** runs the team's shared project at berths=N with the forge mirror on
  (D-004) — the Gitea/GitHub timeline becomes the audit ledger reviewers and
  auditors already know; landing stays serialized through review regardless of N.
- **Autonomy dial:** `auto` with a hard eye on the approvals ledger; the immutable
  NEVER-AUTO list (C-5) is the feature they cite to their boss — merges, releases,
  and destructive ops provably require a human.
- **Morning queue:** triage surface for the team's overnight agent shift; sorted-by-
  leverage ordering (merges first) matches how they already unblock people. Note:
  v1 is single-operator (D-005) — the lead drives; teammates consume the mirrored
  forge state until v2 multi-user/SSO (SCOPE.md S-40). A teammate's channel in v1 is
  the forge itself: they comment on the mirrored issue/PR and the lead acts on it in
  their normal forge review flow — Shipwright does not ingest forge comments in v1
  (design-review G-10b names this dead-end; the real fix is v2/S-40, and comment
  ingestion is a candidate v2 scope item).
- **Willingness to pay (hypothesis):** the strongest revenue candidate — values
  receipts + audit trail at team-tool prices (Jira/Linear per-seat as the anchor);
  v2 SSO/role-rights (D-005) is the unlock for real team licensing.

## P4 — Local-LLM enthusiast

Blueprint: owns hardware; wants maximum work out of local models with frontier
spend only where it matters — with receipts proving the cheap tier is honest.

- **Goals:** saturate owned GPUs/Apple Silicon on real product work, not toy chats;
  a defensible answer to "which tickets actually needed the frontier and what did
  it cost"; run fully offline (C-1) and air-gapped if desired.
- **Frustrations today:** agent products assume frontier APIs and treat local
  models as an afterthought; no tool tells them *which roles* their local model can
  hold (RISKS.md R-1); weak-model failures are silent, so they over-escalate out of
  distrust; token caps and cold-starts are their problem to script around.
- **Berths:** experiments freely — berths=N against LM Studio/Ollama where marginal
  tokens are free; relies on gateway queueing (one-request-at-a-time local
  endpoints queue transparently) and larger iteration budgets for weak models
  (soft-gate policy, FR-G5).
- **Autonomy dial:** `auto` + breakpoint `never` — the overnight-run persona; wants
  every waiver and escalation in the ledger, and reads the coverage report's ⚠
  waived rows before trusting a doc phase.
- **Morning queue:** checks the escalation events first: every R2/R3 rung is either
  a model-fitness signal or a prompt-engineering lesson; files field reports that
  feed the playbook (SCOPE.md S-42).
- **Willingness to pay (hypothesis):** allergic to per-token SaaS but pays for
  software that multiplies owned hardware (LM Studio-adjacent audience); open
  expert content (D-006/C-7) is the trust precondition for this crowd — likely the
  loudest advocates if the fitness-card + receipts story lands.

## Cross-persona notes for designers/builders

- P1 and P4 are the beachhead (RISKS.md R-8): P1 proves the guided program, P4
  proves the economics; P2/P3 convert on evidence the first two generate.
- All four share one spine: board + receipts + morning queue; personas differ in
  dial settings and berth counts, not in separate feature builds — the Settings
  Matrix presets (*All-local*, *Hybrid*, *All-cloud*, BLUEPRINT §3.1.4) map
  roughly to P4 / P1–P2 / P3.
- The notification taxonomy (Decide/Review/Record, FR-N4) is persona-invariant:
  nobody, in any persona, gets popped for a Record-tier event.
- v1 single-operator (D-005) means P3's teammates are *readers* of mirrored forge
  state, not Shipwright users; do not design v1 UI affordances that pretend
  otherwise.
