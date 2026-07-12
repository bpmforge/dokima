# Shipwright — Tech Stack (Phase 3, pinned)

Traces to: BLUEPRINT.md §8, DECISIONS.md D-003 (Node 22 / TypeScript / Fastify / SQLite
WAL / React + Vite), D-007 (Copilot + Vertex MVP providers), D-008 (standalone — no
build-time dependency on the source systems). Rule: versions below are LAW. Verify every
API against these majors (Context7 / node_modules) before coding. **Any deviation is
recorded in this doc in the same commit that introduces it.**

## Runtime & workspace

| Piece | Pin | Why (one line) |
|---|---|---|
| Node.js | **22.x (LTS)** | D-003; direct lineage from the Jarvis/Foreman runtime — loop/provider *contracts* port cleanly (D-008); native fetch, stable watch mode. |
| TypeScript | **5.x**, `strict: true`, ESM only | D-003; strict mode is the cheapest bug gate for cheap coding agents. |
| pnpm | **11.x** workspaces (11.11.0 installed on build host 2026-07-11; was pinned 10.x pre-install) | Strict node_modules prevents phantom cross-package imports (ARCHITECTURE §4 laws); content-addressed store. |

### Workspace layout (fixed — ARCHITECTURE.md §4 owns the dependency law)

```
apps/server            Fastify core: REST /api/v1 + WS, auth middleware (D-005), session spawner
apps/web               React 19 + Vite Canvas SPA
packages/shared        zod contracts, config, logger, errors, hash utils
packages/events        event log + projections + receipts + migrations (only DB writer)
packages/tickets       ticket contract, lifecycle verbs, lanes/write-scopes, reflow
packages/loop          micro-loop + coverage tracker + anchors + calibration
packages/validators    validator-pack runner (exit 0/1 + JSON gaps)
packages/gateway       provider adapters + role matrix + escalation + budget
packages/harbormaster  out-of-session orchestrator, berths, watchdog, morning queue
packages/pipeline      phases 0–5, interview, slates, research, Challenger, decomposer
packages/git           worktrees, ticket branches, diff scope-check, landing
packages/forge         GitHub/Gitea adapters, issue mirror, tokens (D-004)
packages/mcp           MCP client host + permission matrix
packages/memory        facts FTS5, playbook, consolidation
content/               imported expert + validator packs (data, signed — D-006/D-008)
scripts/               dev/build/release tooling
```

## Backend

| Piece | Pin | Why |
|---|---|---|
| Fastify | **5.x** | D-003; schema-first routes via zod type provider; encapsulated plugins map to route groups. |
| better-sqlite3 | **12.x** | Synchronous API is *correct* for a single-writer event log (no async interleaving between check and append); WAL mode; one file per project (`.shipwright/state.db`, DATABASE.md). |
| zod | **4.x** | One validation library everywhere: routes, event payloads, ticket contracts, LLM/manifest output, config. |
| ws | **8.x** | Server-side WebSocket for projection streaming (decision in traps §SSE-vs-WS below). |
| execa | **9.x** | Agent child-process sessions, validator runs, git — sane subprocess handling over raw child_process. |

Provider SDKs (**allowed in `packages/gateway` only** — ARCHITECTURE law 2):
`@anthropic-ai/sdk`, `openai` (also serves LM Studio/Ollama/OpenAI-compatible via
`baseURL`), `google-auth-library` **10.x** (Vertex ADC — D-007; W2-04, GoogleAuth/ADC
chain — pinned in the root `package.json`, see W2-04 note re: gateway write_scope).
Copilot uses the device-auth token flow over plain fetch (no official SDK; see traps).
Pin exact majors in this table when each adapter's wave starts.

## Frontend

| Piece | Pin | Why |
|---|---|---|
| React | **19.x** | D-003; current major at project start — no legacy codebase to protect. |
| Vite | **6.x** | D-003; SPA build served by apps/server; no build-time server coupling. |
| CodeMirror | **6** (`@codemirror/*`) | Diffs (merge view) + markdown/doc editing in the Artifact Viewer. |
| Mermaid | **11.x** | Client-side rendering of architecture diagrams, ticket DAG, sequence diagrams (FR-C3). |
| Tailwind CSS | **4.x** | Utility styling for the Canvas; CSS-first config (see traps). |
| TanStack Query | **5.x** | REST reads; invalidated by WS projection events. |

## Test & tooling

| Piece | Pin | Why |
|---|---|---|
| vitest | **3.x** | One runner across all packages (workspace projects config). |
| Playwright | **1.x (latest)** | E2E over the Canvas against a seeded project; a11y smoke (UX_SPEC §9). |
| ESLint | **9.x flat config** | Carries the ARCHITECTURE §4 laws: dependency matrix, no provider SDK outside gateway, no DB access outside events. |
| tsx | latest | Dev runner for apps/server and scripts. |

## Decision: WebSocket with SSE fallback (projection streaming)

**Chosen: WS primary, SSE fallback** (`GET /api/v1/events` mirrors the same event feed).
Why WS over SSE-only: the Canvas is genuinely bidirectional — projection *subscriptions*
(board, spend, run:<id>, notifications) are client-selected and re-negotiated as panes
open/close, and chat/verb interactions benefit from one duplex channel; heartbeats both
ways power the "active agents" freshness chips (BLUEPRINT §7.1). SSE remains as fallback
because it survives odd proxy/localhost-forwarding setups and costs one route: every WS
message type has an SSE-event twin, and correctness never depends on either — reads come
from REST, streams are an optimization (resume via `last_seq` on both).

## Known traps for cheap coding agents (read before touching each area)

- **better-sqlite3 is synchronous — embrace it, never wrap it.** No `await` on queries;
  do NOT wrap calls in promises or worker threads "for performance". Use prepared
  statements (module-level `db.prepare`) and `db.transaction()` for multi-row appends
  (event + projection update must be one transaction). Open with WAL:
  `db.pragma('journal_mode = WAL')` once at create. One connection in the server process
  is the single writer (C6); CLI/tools open read-only connections
  (`new Database(path, { readonly: true })`). Never run a long CPU job between
  transaction begin and commit — it blocks the event loop AND the DB.
- **Fastify 5 plugin typing/encapsulation.** Decorators/hooks registered in a plugin are
  scoped to it unless wrapped in `fastify-plugin` (`fp()`). The auth middleware
  (`fastify.authenticate`, D-005) must be `fp()`-wrapped; route-group plugins must NOT be,
  so their hooks don't leak. Declare decorator types via `declare module 'fastify'`
  interface merging. Async plugins only — callback-style `done()` mixing hangs avvio.
  zod validation via `fastify-type-provider-zod` with `setValidatorCompiler`/
  `setSerializerCompiler` — not JSON-schema hand-conversion.
- **WS + Fastify:** use `@fastify/websocket` (wraps `ws`); WS handlers bypass Fastify's
  normal reply lifecycle — auth must be checked in the upgrade/connection handler
  explicitly (token in first message or query param, then Origin check — SC-08). Send
  heartbeat pings; drop connections that miss 2.
- **Mermaid client-side + CSP.** Initialize once: `mermaid.initialize({ startOnLoad:
  false, securityLevel: 'strict' })` and render via `mermaid.render()` into sanitized
  containers. `securityLevel: 'strict'` is mandatory — diagram source includes
  repo-derived text (ticket titles) = untrusted input (T-L5). Mermaid needs no
  `unsafe-eval`; keep `script-src 'self'` (SC-08). Diagrams re-render on theme change;
  debounce.
- **Copilot device-auth flow (D-007).** GitHub device flow: POST
  `https://github.com/login/device/code` (client_id) → show `user_code` +
  `verification_uri` in onboarding → poll `login/oauth/access_token` with
  `grant_type=urn:ietf:params:oauth:grant-type:device_code` respecting the returned
  `interval` (slow_down means back off). The GitHub OAuth token is then exchanged for a
  short-lived Copilot API bearer (`/copilot_internal/v2/token`) which EXPIRES (~30 min) —
  the adapter must cache + refresh it, and send the editor-identification headers the
  Copilot chat-completions endpoint requires. Store the GitHub token in the secrets vault
  (SC-06), never in `state.db` or config JSON.
- **Vertex auth = ADC, not API keys (D-007).** Use `google-auth-library`'s
  `GoogleAuth`/ADC chain: `GOOGLE_APPLICATION_CREDENTIALS` service-account JSON, else
  gcloud user ADC. Provider settings require `project` + `location` (region) — model
  endpoints are regional. Tokens auto-refresh via the library; never hand-roll JWT
  signing. Absence of ADC = provider shows "not configured", never a crash at call time.
- **LM Studio realities.** Local endpoints cold-start (warm-up ping before first real
  call), often serve ONE request at a time (gateway queues per endpoint, never fires
  parallel), and advertised max output is headroom, not throughput — real usable output
  ~10k tokens on qwen-class models. "Model crashed" responses get warm-up + bounded retry.
- **Tailwind 4 is CSS-first.** Theme tokens in `@theme { }` in the CSS entry; plugin is
  `@tailwindcss/vite`; import is `@import "tailwindcss";` — not the v3 directive triplet.
- **zod 4:** import from `zod` (not `zod/v4` compat paths); error customization is
  `{ error: ... }` params, not v3's `message`/`errorMap` shapes from old blog posts.

## Repository conventions

- **ESM everywhere**: `"type": "module"` in every package; `tsconfig` base
  `module: NodeNext`, `moduleResolution: NodeNext`, `strict`, `noUncheckedIndexedAccess`.
  Packages export via `exports` maps only — no deep imports across package boundaries
  (the dependency matrix in ARCHITECTURE §4 is checked against import graphs, so deep
  imports would evade it; ESLint forbids them).
- **One zod contract per boundary object** (event payloads, ticket contract, manifest,
  receipt, HANDOFF packet) in `packages/shared` — server routes, event log, and the loop
  all parse with the same schema; drift is a type error, not a runtime surprise.
- **Validators are executables, not imports** (BLUEPRINT §8): exit 0/1 + JSON gaps on
  stdout; the runner treats first-party and content-pack validators identically
  (sandboxed — SC-07).

## Version upgrade policy

1. Majors here are pinned; `package.json` uses `^` within the pinned major; lockfile committed.
2. Upgrading a MAJOR requires: a ticket, this doc updated in the same PR, workspace-wide
   `pnpm lint && pnpm typecheck && pnpm test` green. New-stack additions are NEVER-AUTO.
3. Minors/patches via scheduled dependency tickets only; security advisories override —
   patch immediately, backfill paperwork.
