# Shipwright — Deployment (local-first install & run)

Traces to: BLUEPRINT.md §8 (packaging), NFR-1/NFR-7; DECISIONS.md D-003 (local-first),
D-009 (Windows via WSL at v1). There is no server-side deployment: Shipwright ships as a
tool the user installs and runs on their own machine. "Deployment" = install, upgrade,
backup, and the optional sandbox container profile.

## 1. Install & run

| Path | Command | Notes |
|---|---|---|
| Try it | `npx shipwright` | zero-install; downloads, runs first-run wizard, opens the Canvas |
| Daily driver | `npm i -g shipwright` → `shipwright` | adds the `shipwright` CLI (same verbs as the UI) |
| Packaged binaries | post-v1 | per BLUEPRINT §8; npm is the v1 channel |

First run: generate the API token (SC-08), pick a port (default localhost-only), offer
provider onboarding — Copilot device-auth and Vertex ADC are first-run paths, not
advanced settings (D-007) — and offer the guided sample project (UX_SPEC §8).
`shipwright` in a project directory opens/creates that project; `shipwright run
--breakpoint wave --berths 3` drives the same API the Canvas uses.

Platforms (NFR-7): macOS + Linux first-class; **Windows = WSL2 at v1** (D-009) — the
docs' Windows path installs Node 22 inside WSL; native Windows is post-v1. Apple-Silicon
local inference (LM Studio) is a first-class tested path.

## 2. Where things live

| Location | Contents | In git? |
|---|---|---|
| `~/.shipwright/` | `config.json` (global defaults, provider endpoints — non-secret), `token` (0600), `packs/` (installed content packs + signatures), per-project audit high-water seqs (SC-11), logs | no |
| OS keychain | provider + forge credentials (SC-06) | no |
| `<project>/.shipwright/` | `state.db` (events/projections/receipts — DATABASE.md), `backups/`, `worktrees/`, session scratch | **gitignored** |
| `<project>/docs/`, `gates/`, `DECISIONS.md` | SDLC deliverables, receipts' file twins | **yes — the repo is the durable artifact store** |

The split is deliberate: everything a teammate (or future-you) needs to *read* lands in
the repo; everything operational/replayable lives in `state.db`; everything secret lives
in the keychain.

## 3. Upgrade path

- `npm update -g shipwright` (or a new npx run). On first open of each project DB the
  runtime applies pending schema migrations (DATABASE.md §7): forward-only,
  additive-first, **pre-migration backup copy** written to `.shipwright/backups/` first.
- Event payloads are version-tagged and upcast on read — old logs are never rewritten, so
  any upgrade preserves the full audit history and `shipwright audit verify` still passes
  across versions.
- Downgrade = reinstall old version + restore the backup copy of `state.db` (newer
  `user_version` refuses to open, loudly, rather than corrupting).
- Content packs version independently of the runtime; `shipwright packs update`
  re-verifies signatures (SC-09).

## 4. Backup story

Two things constitute a full backup, both plain files:
1. **The repo** — push it (dual-remote if you like); docs, receipts' file twins, and
   DECISIONS.md are already in it.
2. **`.shipwright/state.db`** — one SQLite file. Safe copy while running:
   `shipwright backup` (uses SQLite online backup API / `VACUUM INTO`); or copy cold.
   Automatic: pre-migration copies (§3) + optional daily copy retention in
   `.shipwright/backups/` (default 7).

Restore = put the file back, run `shipwright audit verify`. Losing `state.db` without a
backup loses run history/ledgers but not the product: docs, code, and receipts' file
twins survive in the repo. Losing the keychain loses credentials only — re-onboard
providers. `shipwright export` bundles board + receipts + ledgers to portable JSON
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

- **Foreground (default):** `shipwright` runs the core + serves the Canvas; Ctrl-C =
  global pause semantics (finish current ticket, checkpoint, stop — never mid-write;
  ARCHITECTURE §6 persist-before-execute makes even SIGKILL safe).
- **Background service (night-shift mode):** `shipwright service install` writes a user
  unit — launchd agent (macOS) or systemd user unit (Linux/WSL) — so autorun survives
  logout of the terminal; `shipwright service status|stop` wraps it. The service runs the
  same binary with the same config; the Canvas reconnects to it on open.
- **Multiple projects:** one core process serves N registered projects (one `state.db`
  each); a second `shipwright` invocation detects the running core (port + healthz) and
  opens the Canvas against it instead of double-binding.

Environment variables (all optional — config file is primary):

| Var | Effect |
|---|---|
| `SHIPWRIGHT_PORT` | override port (still binds 127.0.0.1 only — SC-08) |
| `SHIPWRIGHT_HOME` | relocate `~/.shipwright/` (CI, tests) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Vertex ADC service-account path (D-007) |
| `SHIPWRIGHT_NO_KEYCHAIN` | headless/WSL fallback: encrypted file vault instead of OS keychain, key prompted or from `SHIPWRIGHT_VAULT_KEY` |
| `LOG_LEVEL` | `info` default; `debug` adds per-pass loop telemetry to logs |

## 7. Troubleshooting local model endpoints

| Symptom | Cause | Fix (mostly automatic) |
|---|---|---|
| First call times out | LM Studio cold model load | gateway sends a warm-up ping on provider connect and before first real call; raise warm-up timeout in provider settings for big models |
| Calls queue up / feel serial | local endpoints serve one request at a time | by design: the gateway queues per endpoint rather than thrash (BLUEPRINT §3.3); effective berth parallelism is capped by gateway capacity — add endpoints/hosts to widen |
| "model crashed" errors | LM Studio transient | bounded retry + warm-up between attempts; persistent ⇒ ticket escalates a rung with the failure receipt |
| Truncated/garbled long outputs | advertised max output ≫ real throughput | packets and expected outputs are sized for ~10k real output tokens on local models (TECH_STACK traps); don't raise chunk sizes to "use" headroom |
| Wrong/missing models listed | endpoint discovery stale | `shipwright providers refresh`; Ollama and LM Studio expose different discovery routes — the adapter handles both, but a proxy in between often strips them |
| Vertex 403/404 | ADC missing or wrong region | provider status shows the failing ADC step; set `GOOGLE_APPLICATION_CREDENTIALS` or `gcloud auth application-default login`; models are regional — check `location` |
| Copilot 401 mid-run | short-lived Copilot bearer expired | adapter auto-refreshes from the stored GitHub token; if the device-auth grant was revoked, re-run onboarding |

## 8. Health & diagnostics

- `GET /healthz` (unauthenticated): DB open + WS hub. `shipwright doctor`: port free,
  DB integrity (`PRAGMA integrity_check` + audit tail), keychain reachable, provider
  reachability/warm-up, pack signatures, worktree orphans.
- Boot always runs: migrations (§3) → orphan sweep (ARCHITECTURE §6) → audit tail check
  (SC-11). Any failure surfaces in the Canvas as a blocking banner with the receipt —
  never a silent degrade.
