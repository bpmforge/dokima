# Dokima — Competitive Analysis

Traces to: `docs/BLUEPRINT.md` (§1.3, §11) and founder decisions D-001, D-003, D-004,
D-006, D-007, D-008. **Verification status:** drafted 2026-07-10 from working
knowledge; per BLUEPRINT §3.2 the Phase 0 research lane must re-verify every row
against primary sources before the phase gate — anything marked `UNVERIFIED` is a
claim needing that pass, not an assertion.

## The five stacks we compete with

| # | Stack | What it is | Representative products |
|---|---|---|---|
| 1 | Tracker + forge + AI extension assemblage | Status quo: Jira/Linear for tickets, GitHub for code, Copilot/assistants bolted on | Jira + GitHub + Copilot; Linear (with agent integrations) |
| 2 | Autonomous cloud agents | "Hire an AI engineer" — remote sandboxes, agent plans and executes, you review PRs | Devin (Cognition), Factory |
| 3 | OSS agent platforms | Self-hostable agent runtimes/research harnesses executing coding tasks | OpenHands (ex-OpenDevin), SWE-agent |
| 4 | IDE / terminal agents | Agent lives inside an editor or CLI session, human drives | Cursor, Claude Code, GitHub Copilot coding agent |
| 5 | Provider-agnostic OSS terminal agent | Open-source agentic CLI, bring-your-own model incl. local | opencode |

## Landscape table

| Tool | Full SDLC program (idea→launch) | Trust model | Model economics | Local-first / self-host | Native board |
|---|---|---|---|---|---|
| Jira/Linear + Copilot stack | No — tracking and coding are separate tools, humans glue them | Human process; AI work self-reported | Per-seat SaaS + per-seat AI (`UNVERIFIED` current pricing) | Jira DC self-host exists; Linear SaaS-only (`UNVERIFIED`); Copilot is cloud | Yes (the tracker), but disconnected from execution |
| Devin | No — task/issue-level autonomy, not a guided program | Trust-the-agent: plans + session views, self-reported completion | Frontier-only compute, usage-priced (`UNVERIFIED` current plans) | No — cloud sandbox (`UNVERIFIED` any on-prem offering) | Sessions/tasks list, not a contract board |
| Factory | Partial — enterprise "droids" for dev/review/incident workflows | Enterprise controls; verification depth `UNVERIFIED` | Enterprise sales-gated (`UNVERIFIED`) | `UNVERIFIED` (cloud-first) | Integrates existing trackers rather than owning one |
| OpenHands | No — executes tasks; no PM phases, gates, or program | Sandboxed execution; completion largely agent-asserted | BYO model incl. local endpoints | Yes — OSS, runs locally/Docker | No native ticket engine (`UNVERIFIED` recent additions) |
| SWE-agent | No — research harness for issue→patch | Benchmark-oracle oriented (SWE-bench), not product gates | BYO model | Yes — OSS | No |
| Cursor | No — editing sessions, human-paced | Human reviews in-editor; no receipts | Subscription + frontier usage (`UNVERIFIED` current tiers) | Local editor, cloud models; local-model support `UNVERIFIED` | No |
| Claude Code | No — agentic sessions + subagents, human-driven; SDLC discipline only if user supplies it | Permission prompts + human review; completion self-reported | Anthropic API/subscription pricing | Local CLI, cloud models | No |
| GitHub Copilot coding agent | No — assigned-issue → PR automation | PR review is the gate; in-run claims self-reported | Copilot subscription (`UNVERIFIED` metering) | No — GitHub Actions cloud | GitHub Issues/Projects, no execution invariants |
| opencode | Partial — with expert-pack content it runs SDLC-style flows | Session-level; gates live in content/validators, not a runtime holding them | BYO model incl. LM Studio/Ollama — closest to our economics | Yes — OSS terminal app | No — files/forge issues, no lifecycle-verb engine |
| **Dokima** | **Yes — phases 0–5, PM interview, decision slates, blueprint stage** | **Platform holds gates; receipts; maker≠verifier mechanical (C-2/C-3/C-4)** | **Cheapest-first ladder R0–R4, per-ticket, ledgered; budget breakers** | **Yes — local-first, SQLite, offline vs local models (C-1)** | **Yes — event-sourced board with enforced verbs (D-004)** |

## Per-stack notes

- **Jira/Linear + Copilot** — the incumbent to displace (BLUEPRINT §1.3): three tools,
  no shared state, "the AI said it's done" unverifiable. Linear is adding agent
  delegation to issues (`UNVERIFIED` depth); even so, the tracker records claims, it
  does not re-run gates. Dokima's board *is* the execution state.
- **Devin / Factory** — validated the demand for unattended agent work and the
  price ceiling for it. Their model is trust-the-agent in a cloud sandbox; failure
  mode is plausible-looking wrong work accepted for lack of receipts. Enterprise
  buyers who bounced off the trust question are our audience. Pricing histories are
  volatile — verify before citing in any launch material.
- **OpenHands / SWE-agent** — proof that OSS agent execution is commoditized; that
  is precisely why execution is not our moat (D-006 ships expert content open). They
  have no PM program, no economics layer, no board. Complementary risk: an OSS
  platform could add a trust runtime — see RISKS.md R-8.
- **Cursor / Claude Code / Copilot coding agent** — own the inner loop and the
  developer's hands. Dokima does not compete for the editor (NON_GOALS.md N-1);
  it is the out-of-session layer that conducts many sessions, holds the gates they
  cannot, and survives any one session dying. Claude Code-class tools are also a
  *provider* surface for us (agent sessions are provider-agnostic, BLUEPRINT §8).
- **opencode** — closest relative; the founder's expert system runs on it today.
  Dokima productizes what opencode + content cannot enforce: out-of-session gate
  execution, lifecycle-verb invariants, receipts, budget breakers, morning queue.
  D-008: one-time content import, then standalone — no umbilical.

## The wedge (why Dokima wins its segment)

1. **Evidence-based trust.** Nobody in the table makes "done" a machine-checked
   receipt minted outside the agent session (C-2, C-3), with maker≠verifier enforced
   by identity and token separation (C-4). This is the category-defining feature.
2. **Cheap-first economics.** Only the OSS agents even support local models; none
   route per-role/per-task with an evidence-triggered escalation ladder and a spend
   ledger that shows what the frontier bought. Owned-hardware users (P4) get this
   nowhere else.
3. **PM-guided program.** Interview → vision/scope/SRS → threat model → blueprint →
   decision slates → ticket DAG. Everyone else starts at "here's an issue, go."
   Dokima starts at "here's an idea."
4. **Local-first (C-1).** One install, one SQLite file per project, offline against
   LM Studio/Ollama. Autonomous-agent competitors are cloud sandboxes; corporate and
   privacy-bound users keep everything on their machine.
5. **One canvas.** Chat, board, and artifacts are projections of one event log —
   the Jira+GitHub+extension seams disappear.

## What we deliberately don't compete on

- **The editor** — no IDE, no inline completions (NON_GOALS.md N-1); IDE agents are
  neighbors, and their providers (Copilot, D-007) are our integrations.
- **Model hosting/inference** — we route to LM Studio/Ollama/cloud APIs, never host
  weights (N-5).
- **CI/CD execution** — verify commands run in our sandbox for gate receipts; build
  farms and deploy pipelines stay in CI (N-3).
- **Benchmark leaderboards** — SWE-bench-style scores measure task execution; our
  claim is program-level trust and economics, demonstrated by receipts, not resolve
  rates.
- **Enterprise multi-tenant SaaS at v1** — single-operator local product; SSO/OIDC
  multi-user is the v2 horizon (D-005, SCOPE.md).

## Open verification tasks (Phase 0 research lane)

Before the Phase 0 gate: verify current pricing/plans for Devin, Cursor, Copilot,
Linear agent features; confirm OpenHands' current tracking/GUI capabilities; survey
whether any competitor has shipped receipt-style verification since knowledge
cutoff; confirm dokima.io collision posture and name availability (RISKS.md
R-4). Findings land in `docs/research/` with per-claim citations (BLUEPRINT FR-P8).
