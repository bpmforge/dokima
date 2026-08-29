# Dokima — project rules (read first, every session)

Entry point for coding agents: `MASTER_PROMPT.md` → `plan.json` → `PLAYBOOK.md`.

## Laws

1. **One ticket at a time** from `plan.json`; respect `write_scope`, `lane`,
   and `depends_on`. Claim = set `in_progress` + commit. Same-lane tickets
   never run in parallel; cross-lane write-scope overlap is a schema bug —
   report it, don't work around it.
2. **Verify every external API** against real docs/node_modules before use
   (Context7 or `node -e "import ..."` export checks). Versions live in
   `docs/TECH_STACK.md`; upgrade only in lockstep and record it there.
3. **Full gate before closing any ticket**:
   `pnpm lint && pnpm typecheck && pnpm test` (workspace-wide), **`pnpm
   --filter @dokima/web e2e`**, and **`pnpm validate`** (the six repo
   validators), plus the ticket's own acceptance criteria. Report test counts
   in commit bodies.
   *`pnpm validate` joined the gate 2026-08-28. The six validators — plan,
   traceability, ui-copy, exports, volatile-paths, history-secrets — existed
   and gated nothing, so `validate-plan` sat RED for a whole session at 53
   violations: acceptance criteria written into `notes`, where no mechanical
   check and no close gate could see them. Same shape as the capture tour
   (W21-92) and the SAST runner (W21-98) — a real check nobody runs decays
   into a check nobody can trust.*
   **Run everything on Node 22** (`.nvmrc`, `engines.node`): the
   `better-sqlite3` native binary is built for it, and Node 24 fails ~50
   `apps/server` tests with a `NODE_MODULE_VERSION 127 vs 137` mismatch
   that looks exactly like real breakage. `fnm`'s default is 24, so put
   v22 on PATH first.
   *e2e joined the gate 2026-07-27: it was previously excluded, and a
   plans.spec.ts assertion consequently sat silently red from W5-16 until
   the first full e2e audit days later. It runs last (~30s) so the fast
   gates still fail cheap.*
4. **The trust boundary is the product** (CONSTRAINTS C-2/C-3): agent
   sessions are untrusted; every durable state change goes through the
   verbs/receipts APIs. Never add a code path that flips ticket/phase state
   without a receipt, never grep for completion strings, never let a
   component verify its own output. When a ticket touches gates, its red
   fixtures (docs/TESTING.md planted-defect harness) are part of acceptance.
5. **Maker ≠ verifier is mechanical** (C-4): reviewer identities/models/
   tokens are distinct by construction. Don't "simplify" this away in tests.
6. **Module boundaries** (docs/ARCHITECTURE.md): packages never import
   `apps/*`; `loop`/`tickets` never call providers directly — only via
   `gateway`; `content/` is data, imported by loaders, never by code imports.
7. **Events are append-only, hash-chained** (C-6): no UPDATE/DELETE on the
   events table, single writer per project DB. Projections are disposable;
   the log is not.
8. **Secrets never in code, settings files, prompts, or the event log**
   (FR-S2, W8-03): credential refs only; keychain resolves them.
9. **Two rules that were one, and must not be re-merged** (C-1, D-024):
   (a) **Testing discipline, hard and unconditional:** tests and CI use
   recorded fixtures and the fake-model gateway — **never live API calls**,
   whatever a user's model policy says.
   (b) **Product guarantee, not a default:** a user who *chooses* local-only
   gets a fully working product (a feature silently needing a cloud model is
   a bug; FR-G5 degrades honestly, never silently). But which model does the
   work is the **user's choice** — local-only, one pinned model, cheapest-
   first escalation, or approval-gated escalation — asked at setup, never
   defaulted silently. Do not write "local-first" as though it were a law.
10. Push `main` to both remotes after merged work: `git push origin main &&
    git push github main` (origin = Gitea, may be offline off-LAN — GitHub
    always; note unsynced state in docs/STATUS.md when it happens).

## Map

- Founding blueprint (canonical design): `docs/BLUEPRINT.md`
- Founder decisions (do not re-litigate): `docs/DECISIONS.md` (D-001…D-013)
- Requirements: `docs/SRS.md` · stories `docs/USER_STORIES.md` · flows `docs/USE_CASES.md`
- Architecture: `docs/ARCHITECTURE.md` · DB `docs/DATABASE.md` · API `docs/API_DESIGN.md`
- Security: `docs/THREAT_MODEL.md` · controls `docs/SECURITY_CONTROLS.md`
- Tests & gates: `docs/TESTING.md` · roadmap/exit criteria `docs/ROADMAP.md`
- Research (source-system studies, cited): `docs/research/`
- Progress ledger: `docs/STATUS.md`

## Build

pnpm monorepo: `apps/server` (Fastify core + CLI), `apps/web` (React/Vite
canvas), `packages/*` (shared, events, tickets, loop, validators, gateway,
harbormaster, pipeline, git, forge, mcp, memory), `content/` (imported
expert + validator library — data, provenance-headed, never hand-restyled).
Node 22, TypeScript ESM. `pnpm test` = vitest; `pnpm e2e` = Playwright with
the fake-model gateway. No external services required for dev (SQLite only).
