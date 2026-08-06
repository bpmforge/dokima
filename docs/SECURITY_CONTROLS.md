# Dokima — Security Controls Catalog

Numbered controls mapped to THREAT_MODEL.md T-## IDs. Each: implementation note, landing
wave (BLUEPRINT §9), verification. A control without its check green does not close its
ticket. IDs are stable — new controls append, never renumber.

## Trust boundary (the product's spine)

- **SC-01 Write-scope enforcement via git diff** (T-3, T-4, T-11, T-23). After every agent
  session, the Harbormaster diffs the ticket worktree against its base
  (`git diff --name-only` + status for untracked) and compares every touched path against
  the ticket's `write_scope[]` globs. Out-of-scope paths ⇒ session output refused, ticket
  `blocked-with-evidence` (diff attached), worktree quarantined — never merged. Hard
  exclusions no scope may grant: `.git/**` internals, git hooks, CI/workflow dirs
  (`.github/workflows/**` etc. — grantable only via explicit human approval), `.dokima/**`,
  and any path resolving outside the worktree (symlinks resolved via `realpath` before
  matching; new symlinks pointing outside ⇒ refuse). *Lands:* W0 · packages/git +
  harbormaster. *Verify:* fixture sessions with `../` paths, symlink escapes, hook edits,
  workflow edits — all refused with evidence.
- **SC-02 Out-of-session gate re-execution** (T-1, T-5, T-17). No state derived from
  agent-session claims: on manifest return the Harbormaster independently (a) stats every
  claimed file, (b) re-runs the ticket's `verify` command in the sandbox, (c) confirms
  ≥1 commit on the ticket branch, (d) runs the close validators — then and only then
  fires `close`. Phase gates identically: receipts minted only by real validator runs;
  advancing re-verifies the prior receipt (input-tree hash recompute + validator-set
  currency, FR-P2). *Lands:* W0 (receipt primitive) / W3 (Harbormaster loop).
  *Verify:* conformance suite ports the source systems' gate-integrity fixtures (D-008):
  spoofed manifests, edited docs after receipt, stale validator sets — all refused.
- **SC-03 Per-identity forge tokens; reviewer isolation** (T-9, T-10). Forge connect
  provisions two machine identities with separately scoped tokens: `dokima-maker`
  (push branches, open PRs, comment) and `dokima-reviewer` (review/accept only). The
  reviewer token is held only by the Harbormaster process, is never placed in any agent
  session env, context packet, event payload, or log (D-004). Agent sessions get NO forge
  token — all forge writes go through the core. *Lands:* W6 · packages/forge.
  *Verify:* env snapshot test on spawned sessions (zero token vars); planted-token
  redaction test across logs/events/packets; mirror integration test asserts distinct
  actor identities on maker vs reviewer timeline entries.
- **SC-04 Promise-token ban — receipt-based completion only** (T-1, T-2). No code path
  anywhere greps agent output for success markers; completion signals are foreign keys to
  `receipts` rows minted by SC-02 paths. Lint rule: string-match patterns
  (`/DONE|PASSED|COMPLETE/`-style) over session output are forbidden in
  loop/harbormaster/pipeline. *Lands:* W0 rule, permanent. *Verify:* lint gate in CI +
  a red-team fixture agent that prints every known magic string and completes nothing.
- **SC-05 Waiver & approval human-signature enforcement** (T-5, T-24). Waiver receipts and
  NEVER-AUTO approvals require `signed_by` = an identity with `kind='human'`; machine
  identities (and any name matching the agent-name blocklist: berth ids, role names,
  model names) are rejected at the `events` API — beneath the HTTP layer, so no route can
  bypass it. In `auto` mode, NEVER-AUTO items are never defaulted — they park to the
  morning queue (FR-N3). *Lands:* W0 · packages/events. *Verify:* unit tests minting
  waivers as each seeded machine identity ⇒ reject; ledger validator scans for
  machine-signed rows.

## Secrets & content

- **SC-06 Secrets vault + universal redaction** (T-6, T-9, T-16, T-20). Provider and forge
  credentials live in the OS keychain (macOS Keychain / libsecret), referenced by handle;
  never in `state.db`, config JSON, or the repo. A redaction layer in packages/shared
  applies to every context packet, event payload, log line, and receipt: known credential
  formats (gh tokens, PEM blocks, AWS/GCP key shapes, `sk-`-style keys) + values of
  vault-registered secrets + `.env`-file values from the project dir. A secrets-scanner
  validator runs in every close gate — a diff containing a live-looking secret blocks
  close (BLUEPRINT §12 item 5). *Lands:* **W3-13 per plan.json** (design-review 2026-07-14:
  this control originally claimed W0/W1, which never happened; keychain refs landed W0-07.
  Pulled forward from W8-03 → W3-13 by adopted AM-2 so the redaction window closes before
  the autonomous W3 runs; the W8-01 dogfood re-verifies end-to-end). *Verify:* planted
  fixture secrets pushed through packets/logs/events ⇒ zero plaintext; close-gate test
  with a committed fake key ⇒ blocked.
- **SC-07 Sandboxed verify execution, no network by default** (T-4, T-21). Verify
  commands, test suites, and tool anchors run in the project worktree under a restricted
  child process: cleaned env (no vault handles, no tokens), network disabled by default
  (opt-in per project; container profile via Podman/Docker when configured —
  DEPLOYMENT §5). Validator-pack executables run under the same sandbox. *Lands:*
  **W6-06 per plan.json** (design-review 2026-07-14 correction from "W1"; W1-02 gave
  validators timeout + sandbox-cwd only — full process isolation is W6-06). *Verify:* verify-run fixture attempts outbound connect + env read ⇒
  both fail; container profile integration test.
- **SC-09 Signed content packs** (T-21, D-006). Expert/validator packs carry a manifest
  (files, hashes, publisher key signature); install verifies signature + hash tree and
  records provenance; unsigned/mismatched packs install only behind an explicit
  `--allow-unsigned` with a permanent warning badge in Settings. First-party imported
  content (D-008) is signed at import. Packs are data + declared executables — the runner
  never `eval`s pack markdown. *Lands:* **W6-07 per plan.json** (design-review 2026-07-14
  correction — the W1-01 import carried provenance headers but was NOT signed; W6-07
  adds the signing mechanism, re-signs first-party content, and ships the community
  install flow). *Verify:* tampered-pack fixture ⇒ refused; unsigned path shows badge;
  provenance headers present on all imported content; first-party content signature
  verifies post-W6-07.

## Local surface

- **SC-08 Localhost binding + origin allowlist + auth token** (T-19, T-20, D-005).
  apps/server binds `127.0.0.1` only (never `0.0.0.0`). Every request passes the auth
  middleware: bearer token (128-bit, generated first-run, `~/.dokima/token`, mode
  0600) + `Host`/`Origin` allowlist (`localhost:<port>` exact) — defeats DNS rebinding and
  cross-site localhost CSRF; no CORS headers served at all. WS upgrades re-check token +
  Origin. `~/.dokima/` and `.dokima/` are created 0700. *Lands:* **W4-01 per
  plan.json** (design-review 2026-07-14 correction from "W0" — apps/server is a /health
  stub until W4; the D-005 "auth middleware from W0" pre-commitment is satisfied at the
  schema level only, identities table W0-02). *Verify:* route-walker (API_DESIGN §4); rebinding simulation (evil Host header ⇒ 403);
  bind-address assertion in boot test; perms test.

## Governance & audit

- **SC-10 NEVER-AUTO single enforcement point** (T-4, T-11, T-14). The immutable list
  (destructive ops, main merges/releases/deploys, auth/crypto changes, new stack
  additions, scope-boundary breaks, interviews) is compiled into
  packages/harbormaster — not config, not DB, no API mutates it (API_DESIGN autonomy
  endpoint is read-only for this list). Every action is risk-classified rule-first before
  dispatch; NEVER-AUTO classes route to the morning queue unconditionally, in every
  autonomy mode, on every berth. Models may raise a risk class, never lower it (FR-N2).
  *Lands:* W3 · harbormaster. *Verify:* per-class tests in `auto` mode with breakpoint
  `never` ⇒ all park to queue; mutation-attempt test on the list ⇒ no pathway exists.
- **SC-11 Audit hash chain + verification command** (T-8, T-23, T-24, T-25). Events are
  hash-chained per DATABASE.md §2 with INSERT-only triggers. `dokima audit verify`
  recomputes the chain, cross-checks receipts referenced by events, and reports the first
  divergent seq; it runs automatically on boot (fast tail check) and before resume.
  High-water seq mirrored to `~/.dokima/` per project; when the forge mirror is
  connected, ticket receipts are also comment-anchored on the forge timeline — an external
  anchor no local writer can rewrite (closes T-25). *Lands:* W0 · packages/events.
  *Verify:* tamper fixtures (row edit, row delete, truncation) each detected; e2e:
  mirror comment hash matches local receipt.
- **SC-12 MCP permission matrix** (T-13, T-14, T-15). Agents request; the core executes.
  Per-role tool allowlists; every tool call is an audited event (args digest + result
  digest); `requiresApproval` flags per tool, dynamic classification for shell; tool
  OUTPUT is untrusted data — schema-validated where structured, never executed, and
  carried into packets with an injection-warning frame. Registration UI warns on
  over-broad scopes (filesystem root). *Lands:* W6 · packages/mcp. *Verify:* allowlist
  tests per role; shell-tool fixture requires approval; audit events present for every call.
- **SC-13 Watchdog, session caps, budget breakers** (T-7, T-18). Per-session wall-clock
  max + heartbeat-stall kill; per-ticket session counter (~2 ⇒ auto-blocked with
  evidence); escalation only on failure receipts (never vibes); budget breakers
  70/85/100% aggregate across berths, hard stop at ticket boundary. *Lands:* W2 (breakers)
  / W3 (watchdog). *Verify:* stall fixture killed + dead-lettered; breaker fixtures at
  each threshold; ladder test asserts no rung skipped without a receipt.
- **SC-14 Branch protection on forge connect** (T-10, T-11). Connect flow configures:
  reviewer≠author required, no force-push, required checks, merge rights on main held by
  the human (or reviewer identity under explicit policy). Verified, not assumed: a
  parity validator re-reads protection settings and flags drift. *Lands:* W6 ·
  packages/forge. *Verify:* integration test against a scratch repo asserts settings;
  drift validator fixture.
- **SC-15 Mirror reconciliation audit** (T-12). Lifecycle verbs write through to the
  forge issue mirror; offline verbs queue in ticket `history[]` and flush with order
  preserved; a reconciliation job produces a two-way drift report (local-not-on-forge /
  forge-not-local) surfaced as a Review notification (FR-T5). *Lands:* W6. *Verify:*
  offline-queue e2e (disconnect, act, reconnect, converge); injected drift ⇒ report row.
- **SC-16 Supply-chain policy for Dokima itself** (T-22). pnpm lockfile +
  `--frozen-lockfile` in CI; `ignore-scripts=true` in `.npmrc` with allowlisted build
  exceptions (better-sqlite3); `pnpm audit --prod` gate (fail high/critical); new deps
  verified against registry + docs before import (anti-slopsquatting). *Lands:* W0 · repo
  root + CI. *Verify:* CI asserts `.npmrc` + audit green.

## Coverage map (threat → control)

| Threats | Controls |
|---|---|
| T-1..T-8 (agent → core) | SC-01, SC-02, SC-04, SC-05, SC-06, SC-07, SC-11, SC-13 |
| T-9..T-12 (core → forge) | SC-03, SC-06, SC-14, SC-15, SC-01 |
| T-13..T-15 (MCP) | SC-12, SC-10 |
| T-16..T-18 (providers) | SC-06, SC-02, SC-13, SC-09* (all-local profile visibility) |
| T-19..T-22 (local surface) | SC-08, SC-06, SC-09, SC-07, SC-16 |
| T-23..T-25 (log integrity) | SC-11, SC-05, SC-01, SC-15 |

- **SC-17 Tool-boundary write-scope enforcement** (T-3, T-4, T-11, T-23, T-24; D-023).
  SC-01 checks `write_scope` **after** a session, by diffing the worktree. Dokima's own
  tool-using session (D-023) can and must do better: every `write`/`edit` tool call
  (the closed tool set's only two pre-commit disk-touching tools, SC-18 — there is no
  `delete`) is checked against the ticket's `write_scope[]` globs **before it executes**,
  with the same hard exclusions SC-01 names (`.git/**`, hooks, `.github/workflows/**`,
  `.dokima/**`, anything resolving outside the worktree after `realpath`). `write_scope`
  itself is read from the ticket record via an authoritative lookup (`getTicket`), never
  parsed out of the rendered prompt: the prompt is reachable by session-influenced
  content (CONTEXT can embed a file the session itself read), and C-2/C-3 put that on the
  wrong side of the boundary this control exists to hold, regardless of whether a given
  parse heuristic happens to resist it today. An unresolvable ticket id fails CLOSED to an
  empty write_scope, never to the prompt's claim. A refused tool call returns an error to
  the model as a normal tool result — the session continues and may correct itself — and
  is recorded on the session trace.
  **SC-01 STILL RUNS AFTERWARDS AND IS STILL AUTHORITATIVE — by TWO independent
  mechanisms, neither gated on a model choice.** The pre-check above is inside the
  session and therefore inside the trust boundary the whole product is built to
  distrust (C-2/C-3), so nothing about it may be treated as sufficient on its own:
  (1) `commit`'s own unmodified `commitWithScopeCheck` (SC-01), which stages and diffs
  the REAL git state rather than trusting anything the session claims — but only fires
  if the model chooses to call `commit` at all; and (2), correcting an earlier draft of
  this paragraph that named only (1) and called it "the out-of-session diff" — a
  mischaracterization a challenge pass caught, because `commitWithScopeCheck` is
  reached by a tool call the untrusted model itself chooses to make, not by anything
  running independently of it — `gateway-session.ts`'s own unconditional re-check
  (`refuseIfSessionExceededScope`), which runs at the ONE point the tool loop can hand
  back a Completion Manifest (the natural-completion return; the loop's other two exits
  already carry no manifest text). It re-diffs the REAL worktree against `HEAD`
  (`computeChangedPaths`, `@dokima/loop`) and re-checks every touched path through
  `checkWriteScope` (`@dokima/git` — the exact function `commitWithScopeCheck` itself
  calls, unmodified) regardless of whether the model ever attempted a write, edit, or
  commit. A violation discards the session's output entirely (no manifest text, non-zero
  exit) — `runSession`'s caller sees `manifest === null`, so `runCloseGate` (SC-02) never
  runs, and the ticket cannot close on that attempt. Neither mechanism is a fully
  separate out-of-process pass the way SC-01's own canonical definition above describes
  (both run inside the same spawn call the tool loop runs in) — the guarantee they give
  is that the check's outcome depends only on real, independently observable git state
  once the model has no more turns left to influence it, never on anything the model
  said or chose to do. A pre-check that made either of these redundant would be the
  self-attestation Law 4 exists to refuse.
  KNOWN RESIDUAL GAP (filed HANDOFF, out of this ticket's write_scope): `runCloseGate`
  (`packages/harbormaster/src/loop-gates.ts`) itself still only checks that
  `manifest.files` is a subset of the real diff/commit set — never the reverse, that the
  real diff/commit set stays inside `ticket.writeScope`. For THIS session type that gap
  is closed by mechanism (2) above (a violating session never reaches `runCloseGate` at
  all), but any other `SpawnSession` implementation that skips an equivalent check — e.g.
  `packages/loop/src/session.ts`'s `createChildProcessSpawn` escape-hatch runner, which
  has no analogous gate — would not inherit this protection from `runCloseGate` either.
  *Lands:* the agent-session wave · `packages/harbormaster/src/agent-session/**` (W11-03;
  corrects an earlier `apps/server` placement recorded before the challenge pass moved
  this scope to harbormaster alongside D-023's session loop). *Verify:* red fixtures for a
  tool call writing `../outside`, `.git/config`, `.github/workflows/ci.yml`,
  `.dokima/state.db`, and a symlink escape — each refused at the boundary; AND, with the
  pre-check bypassed (the file placed on disk directly via `node:fs`, as if the pre-check
  had never run, and no tool call ever attempted or refused), `.github/workflows/ci.yml`,
  `.dokima/state.db`, and the symlink escape are still refused by mechanism (2) above —
  `../outside` and `.git/config` are structurally invisible to any diff-based check
  (git never reports paths outside its own worktree or inside its own `.git` directory),
  so those two shapes are guarded by containment (`fs-containment.ts`) and by git's own
  refusal to track its internals instead, never by a diff. One fixture is wired through
  the full, unmodified `runLandLoop` pipeline end to end, proving the ticket never lands.
  A T-26 prompt-injection fixture — a file the session reads carries an instruction to
  write outside the ticket — confirms the session cannot produce an out-of-scope write
  end to end: refused at the boundary, refused again attempting to commit it, and the
  close gate refuses the resulting dishonest manifest.

- **SC-18 Tool surface is closed and least-privilege** (T-5, T-24; D-023). The session's
  tool set is an explicit allowlist with no arbitrary-shell escape by default: read, list,
  search, write, edit, and the ticket's own declared `verify` command — nothing that can
  run a free-form process, install a dependency, or open a socket. The allowlist, the approval policy and the audited
  tool-call events are `packages/mcp`'s (W6-04: `setRoleAllowlist`, `decideToolCall`,
  `requestToolCall`, `DynamicApprovalPolicy`) — NOT a parallel mechanism built beside it,
  which is what the first draft of this control specified. Shell access, if it is ever
  granted, is a per-role capability with `requiresApproval` there, never an ambient tool. The model chooses tool CALLS; it never chooses the
  tool SET. *Verify:* a session whose model emits a call to an unlisted tool gets a refusal
  result, not an execution, and the attempt lands on the trace.
