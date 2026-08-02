# Dokima — Deployment (local-first install & run)

Traces to: BLUEPRINT.md §8 (packaging), NFR-1/NFR-7; DECISIONS.md D-003 (local-first),
D-009 (Windows via WSL at v1). There is no server-side deployment: Dokima ships as a
tool the user installs and runs on their own machine. "Deployment" = install, upgrade,
backup, and the optional sandbox container profile.

## 1. Install & run

| Path | Command | Notes |
|---|---|---|
| Try it | `npx dokima` | zero-install; downloads, runs first-run wizard, opens the Canvas |
| Daily driver | `npm i -g dokima` → `dokima` | adds the `dokima` CLI (same verbs as the UI) |
| Packaged binaries | post-v1 | per BLUEPRINT §8; npm is the v1 channel |

First run: generate the API token (SC-08), pick a port (default localhost-only), offer
provider onboarding — Copilot device-auth and Vertex ADC are first-run paths, not
advanced settings (D-007) — and offer the guided sample project (UX_SPEC §8).
`dokima` in a project directory opens/creates that project; `dokima run
--breakpoint wave --berths 3` drives the same API the Canvas uses.

Platforms (NFR-7): macOS + Linux first-class; **Windows = WSL2 at v1** (D-009) — the
docs' Windows path installs Node 22 inside WSL; native Windows is post-v1. Apple-Silicon
local inference (LM Studio) is a first-class tested path.

`pnpm build` produces what ships: `vite build` for the SPA, then
`apps/server/build.mjs`, which esbuild-bundles the server **and all 12 workspace
packages** into a single plain-JS `apps/server/dist/main.js` (~428 KB). Five real runtime
dependencies stay external and are declared on the root package — `better-sqlite3` (a
native addon, unbundlable by definition), `execa`, `fastify`, `google-auth-library`,
`zod`. One published package, not thirteen: inlining the workspace graph avoids
coordinating lockstep versions across 13 registry names on every release.

The `bin` entry (`apps/server/src/bootstrap/cli-entry.mjs`) is plain JS that prefers the
built bundle and falls back to spawning `tsx` when there isn't one, so a fresh source
checkout still runs with no build step. The packaged branch is checked first on purpose:
a dev machine has both, and silently preferring `tsx` there would mean the bundle was
never exercised by the person most likely to notice it was broken.

**Assets keep their repo-relative layout inside the tarball** — `content/`,
`packages/events/migrations`, `apps/web/dist`, `e2e/fitness-fixtures`. Runtime code finds
them through `resolveAsset()` / `distributionRoot()` in `@dokima/shared`, which
anchors on the root `package.json`'s name rather than counting `../` hops from
`import.meta.url`. That is what makes one path expression correct from a source checkout
*and* from an installed copy; the old depth-counting silently pointed outside the package
once bundled (W9-13).

Verified end-to-end with no network (C-1): `pnpm pack` → extract → run the `bin` entry
under plain `node` with no `tsx` present and no TypeScript source in the tree → server
boots, `/healthz` returns `{"status":"ok","db":true,"ws":true}` (`db:true` is the
load-bearing part — it proves the SQL migrations resolved), the SPA shell serves 200, and
`/api/v1/roster` + `/api/v1/guide/:topic` return 200, proving the content packs resolve.
The tarball carries no `.ts` sources and no `workspace:*` specifiers. What remains
unverifiable here is only the registry round trip itself (no live publish).

## 2. Where things live

| Location | Contents | In git? |
|---|---|---|
| `~/.dokima/` | `config.json` (global defaults, provider endpoints — non-secret), `token` (0600), `packs/` (installed content packs + signatures), per-project audit high-water seqs (SC-11), logs | no |
| OS keychain | provider + forge credentials (SC-06) | no |
| `<project>/.dokima/` | `state.db` (events/projections/receipts — DATABASE.md), `backups/`, `worktrees/`, session scratch | **gitignored** |
| `<project>/docs/`, `gates/`, `DECISIONS.md` | SDLC deliverables, receipts' file twins | **yes — the repo is the durable artifact store** |

The split is deliberate: everything a teammate (or future-you) needs to *read* lands in
the repo; everything operational/replayable lives in `state.db`; everything secret lives
in the keychain.

## 3. Upgrade path

- `npm update -g dokima` (or a new npx run). On first open of each project DB the
  runtime applies pending schema migrations (DATABASE.md §7): forward-only,
  additive-first, **pre-migration backup copy** written to `.dokima/backups/` first.
- Event payloads are version-tagged and upcast on read — old logs are never rewritten, so
  any upgrade preserves the full audit history and `dokima audit verify` still passes
  across versions.
- Downgrade = reinstall old version + restore the backup copy of `state.db` (newer
  `user_version` refuses to open, loudly, rather than corrupting).
- Content packs version independently of the runtime; `dokima packs update`
  re-verifies signatures (SC-09).

## 4. Backup story

Two things constitute a full backup, both plain files:
1. **The repo** — push it (dual-remote if you like); docs, receipts' file twins, and
   DECISIONS.md are already in it.
2. **`.dokima/state.db`** — one SQLite file. Safe copy while running:
   `dokima backup` (uses SQLite online backup API / `VACUUM INTO`); or copy cold.
   Automatic: pre-migration copies (§3) + optional daily copy retention in
   `.dokima/backups/` (default 7).

Restore = put the file back, run `dokima audit verify`. Losing `state.db` without a
backup loses run history/ledgers but not the product: docs, code, and receipts' file
twins survive in the repo. Losing the keychain loses credentials only — re-onboard
providers. `dokima export` bundles board + receipts + ledgers to portable JSON
(BLUEPRINT §12.8, fast-follow).

## 5. Optional container profile (sandbox)

Default sandbox is a restricted process — zero dependencies (SC-07). When Podman/Docker
is available and the project opts in (`sandbox: container` in project settings):
- Verify/test runs execute in a per-run container: project worktree mounted rw at
  `/work`, `--network=none` (opt-in relaxation per project), non-root UID, cleaned env,
  CPU/mem/pids limits, tmpfs scratch.
- Image: `node:22-slim`-based default; projects can pin their own image (recorded in
  project settings; new-image adoption is an ordinary reviewed change).
- The container profile changes *isolation strength only* — receipts note which profile
  attested the run, nothing else differs.

## 6. Run modes & environment

- **Foreground (default):** `dokima` runs the core + serves the Canvas; Ctrl-C =
  global pause semantics (finish current ticket, checkpoint, stop — never mid-write;
  ARCHITECTURE §6 persist-before-execute makes even SIGKILL safe).
- **Background service (night-shift mode):** `dokima service install` writes a user
  unit — launchd agent (macOS) or systemd user unit (Linux/WSL) — so autorun survives
  logout of the terminal; `dokima service status|stop` wraps it. The service runs the
  same binary with the same config; the Canvas reconnects to it on open.
- **Multiple projects:** one core process serves N registered projects (one `state.db`
  each); a second `dokima` invocation detects the running core (port + healthz) and
  opens the Canvas against it instead of double-binding.

Environment variables (all optional — config file is primary):

| Var | Effect |
|---|---|
| `DOKIMA_PORT` | override port (still binds 127.0.0.1 only — SC-08) |
| `DOKIMA_HOME` | relocate `~/.dokima/` (CI, tests) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Vertex ADC service-account path (D-007) |
| `DOKIMA_NO_KEYCHAIN` | headless/WSL fallback: encrypted file vault instead of OS keychain, key prompted or from `DOKIMA_VAULT_KEY` |
| `DOKIMA_LOG_LEVEL` | `info` default; `debug` adds per-pass loop telemetry to logs |

## 7. Troubleshooting local model endpoints

| Symptom | Cause | Fix (mostly automatic) |
|---|---|---|
| First call times out | LM Studio cold model load | gateway sends a warm-up ping on provider connect and before first real call; raise warm-up timeout in provider settings for big models |
| Calls queue up / feel serial | local endpoints serve one request at a time | by design: the gateway queues per endpoint rather than thrash (BLUEPRINT §3.3); effective berth parallelism is capped by gateway capacity — add endpoints/hosts to widen |
| "model crashed" errors | LM Studio transient | bounded retry + warm-up between attempts; persistent ⇒ ticket escalates a rung with the failure receipt |
| Truncated/garbled long outputs | advertised max output ≫ real throughput | packets and expected outputs are sized for ~10k real output tokens on local models (TECH_STACK traps); don't raise chunk sizes to "use" headroom |
| Wrong/missing models listed | endpoint discovery stale | `dokima providers refresh`; Ollama and LM Studio expose different discovery routes — the adapter handles both, but a proxy in between often strips them |
| Vertex 403/404 | ADC missing or wrong region | provider status shows the failing ADC step; set `GOOGLE_APPLICATION_CREDENTIALS` or `gcloud auth application-default login`; models are regional — check `location` |
| Copilot 401 mid-run | short-lived Copilot bearer expired | adapter auto-refreshes from the stored GitHub token; if the device-auth grant was revoked, re-run onboarding |

## 8. Health & diagnostics

- `GET /healthz` (unauthenticated): DB open + WS hub. `dokima doctor`: port free,
  DB integrity (`PRAGMA integrity_check` + audit tail), keychain reachable, provider
  reachability/warm-up, pack signatures, worktree orphans.
- Boot always runs: migrations (§3) → orphan sweep (ARCHITECTURE §6) → audit tail check
  (SC-11). Any failure surfaces in the Canvas as a blocking banner with the receipt —
  never a silent degrade.
