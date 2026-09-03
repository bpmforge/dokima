# Release tracker — Dokima

**State 2026-08-13:** board **208 / 216 done — 8 open, 35 points.** Every
milestone gate through v1.0.0 is met. **Still not tagged**, and what stands
between here and a public tag is now mostly _not code_: the registry
publication itself (needs an authenticated operator), formal trademark
clearance (needs a lawyer), and one supervised run against a real model that
nobody has yet performed (W11 exit 2/3 — see §Unproven). The open board is
quality work and D-024 implementation, not tag blockers.

**Refreshed 2026-08-13 — third refresh, each claim re-verified against the
code rather than assumed.** That check earned its keep again: it caught the
LICENSE row below still naming Apache-2.0 under a decision (D-017) that D-022
had superseded, while the shipped `LICENSE` file is FSL-1.1-ALv2 — a release
document misstating the product's own license.

Board = `plan.json` · progress ledger = `docs/STATUS.md` · next wave proposal =
`docs/work/W10_PLAN.md`.

> **This file was stale from 2026-07-14 to 2026-08-02**, still reporting
> "23/65 tickets, PAUSED" against a reality of 116/118 done. It is how a human
> resumes cold, so that drift was itself a release-readiness defect. The
> historical pause narrative is preserved in §Historical below.
>
> It drifted again within a day — by 2026-08-03 the gap list below still claimed
> four things that were no longer true and one that was. Refreshed 2026-08-03,
> with **each claim re-verified against the code rather than assumed stale**;
> that check is what caught the one that survived (the expert-library drift).

---

## Release milestones

| Tag                   | Scope                                           | Gate                                                                                | Status                                                                                                                    |
| --------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **v0.1.0-foundation** | W0–W3 (trust core, loop, gateway, Harbormaster) | full pnpm gate + planted-defect harness green; conductor self-hosts a fixture board | ✅ met, untagged                                                                                                          |
| v0.2.0                | + W4 Canvas/Fleet                               | Playwright E2E over fake-model gateway                                              | ✅ met, untagged                                                                                                          |
| v0.3.0                | + W5 Pipeline/PM                                | sample idea runs <15 min on a local model                                           | ✅ met, untagged                                                                                                          |
| v0.9.0                | + W6 integrations, W7 memory                    | forge-mirror reconciliation + anti-Jarvis-gap recall test                           | ✅ met, untagged                                                                                                          |
| **v1.0.0**            | W8 dogfood: Dokima audits itself                | own security cluster passes; receipts in `docs/dogfood/`                            | ✅ **met** — **`release/v1.0.0` prepared 2026-09-03** (1.0.0 bump + CHANGELOG entry); tag `v1.0.0` on merge, then publish |

Every milestone gate has been met. Nothing has been tagged, because the
pre-public checklist below was never finished.

## Pre-public checklist (required for any tag ≥0.3)

| Item                        | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LICENSE file                | ✅ **done 2026-08-02, CORRECTED 2026-08-13** — **FSL-1.1-ALv2** (Functional Source License, ALv2 future license) per **D-022**, verified against the shipped `LICENSE` file. This row read "Apache-2.0 per D-017" until 2026-08-13; D-017 is marked superseded in DECISIONS.md and the license changed before any public release. `package.json` carries `"license": "SEE LICENSE IN LICENSE"`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| README quickstart           | ✅ **done 2026-08-02** — rewritten from the end-user's POV; every documented command executed and verified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| History secrets scan        | ✅ **done 2026-08-02** — found a CRITICAL leak; see below. **No longer a manual item as of 2026-08-03 (W10-27)**: `node scripts/validate-history-secrets.mjs` runs on every push as CI's `history-secrets` job. Re-running it by hand before a tag is now a confirmation, not the control.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| npm name `@bpmforge/dokima` | 🟡 **prepared 2026-08-03, not yet published** — name confirmed free; root `package.json` now carries the scoped name, `0.1.0`, `publishConfig.access: public`, license/repo/description metadata, and a `prepublishOnly` build so a tarball can never ship without `apps/server/dist/main.js` or `apps/web/dist`. Packing and installing the tarball into a clean project surfaced a **release blocker** (W10-43) — `distributionRoot()` identified the distribution by the literal package name `dokima`, so scoping it made every asset unreachable and the CLI died on startup. Fixed and re-verified end to end: the installed binary boots, serves the built web dist, materializes `packs/` in `DOKIMA_HOME`, and answers `GET /api/v1/projects` → `200 {"projects":[]}` with a real bearer token. **The publish step itself needs an authenticated operator** — log in to npm, then run the publish command from the repo root. |
| CI green on `main`          | ✅ **done 2026-09-03** — run [33808312531](https://github.com/bpmforge/dokima/actions/runs/33808312531) on `df882a89`, all 7 jobs. Before P6-21 no green run existed in the 25-run window: SC-07 refused every build run on Ubuntu 24.04 (unprivileged user namespaces restricted), the `fast-uri` overrides sat one patch short, runners have no git identity, gate checkouts were shallow, ripgrep was absent, the coverage step aborted under `bash -e`, and two tests depended on this laptop (a gitignored capture run; the macOS keychain). Each is named in the P6-21 board notes. The gate of record is CI again, not one machine.                                                                                                                                                                                                                                                                                             |
| D-001 naming pass           | ✅ **done 2026-08-02 — renamed to Dokima (D-021).** The old name had two collisions: `shipwright.io`, CNCF's container-image build framework, whose trademarks were donated to the **Linux Foundation** — an adjacent market, not the "different domain" D-001 assumed; and npm `shipwright`, held since 2015 by `hellofloat/shipwright` ("DigitalOcean CLI control"), declaring the same `bin`. Ships as `@bpmforge/dokima`, home `dokima.sh`. **Formal trademark clearance is still open and needs a lawyer.**                                                                                                                                                                                                                                                                                                                                                                                                                       |

### The secrets scan found a real one

The Ed25519 content-signing **private** key was in pushed history since
2026-07-20 and derived byte-for-byte the public key the product shipped —
proven forgeable against the real `content/manifest.json`.

**Remediated 2026-08-02**: key rotated (old key proven dead), history purged
across all six branches, force-pushed to both remotes. Full write-up, including
what the rewrite does _not_ undo:
[`docs/work/SECURITY_RELEASE_BLOCKER_2026-08-02.md`](work/SECURITY_RELEASE_BLOCKER_2026-08-02.md).

Durable fix **landed 2026-08-03 as W10-27**: `secrets-scan.sh` scans the working
**tree**, so a gitignored, tree-removed key reads clean while history is
compromised — which is exactly how this survived thirteen days. History scanning
is now part of the gate: `scripts/validate-history-secrets.mjs` reads every object
reachable from every ref — file contents _and_ commit/tag messages (no external
scanning binary, ~1.3s), CI runs it on every push with `fetch-depth: 0`, and it
exits **2 rather than 0** on a shallow clone so it can never pass vacuously. CI
also fetches every branch explicitly and runs with `--verify-remote-refs`,
because a single-ref checkout is _not_ shallow and would silently shrink the
scan's denominator. Two stated limits: it covers the same six categories as the
tree scanner, so an unpatterned credential shape is invisible to both; and
`--all` is reachable-only, so a force-pushed, garbage-collected secret reads
clean locally while it may still sit in the forge's dangling objects — the same
caveat this write-up records about what a rewrite does not undo. See
[`TESTING.md` §6a](TESTING.md).

## Known gaps at time of writing

Not release blockers by themselves, but a reader deserves them stated:

- ~~Provider/model selection is editable in the UI and not wired to the
  pipeline's model calls~~ — **fixed.** W10-03 wired `gateway-model-port.ts`
  (registry + role matrix first, env vars as a documented fallback that
  deliberately loses), and W10-45 wired its twin `onboard-dispatch-port.ts`,
  which had been left behind and was still resolving from three env vars — the
  path the W8-01 dogfood actually runs on. Resolution happens **per role**,
  since the matrix is keyed role × task type.
- ~~Visual design is unfinished — 4 design tokens, 66 hardcoded hexes, clipped
  board columns~~ — **fixed 2026-08-03 (W10-06, W10-28, W10-30, W10-32).**
  Verified now: **96** `--sw-*` tokens, and **zero** raw hexes in any feature
  stylesheet (the 34 that remain are the token definitions in `styles.css`,
  which is where literals belong). The board is a CSS grid and no longer clips.
- **The bundled expert library is still ~133 upstream commits behind** — this
  one is real, and re-verified rather than assumed stale. The only import this
  repo has ever done is W1-01 (one-time, by design — D-008, no umbilical). The
  W10_PLAN Phase B refresh tickets were **never filed**: the board's W10-02 and
  W10-03 are the model-catalog and seam-wiring tickets, which took those IDs.
  Upstream also renamed (`bpm-opencode-experts` → `attest`). See
  `docs/work/W10_PLAN.md` §0 for the measured drift.
- ~~`dokima --help`, and any mistyped command, boots the server~~ — **fixed
  2026-08-03 (W10-44).** `--help`/`-h`/`--version`/`-V` print and exit 0; an
  unknown command prints usage to stderr and exits 2; an incomplete `packs` or
  `providers` no longer falls through to a boot. Bare `dokima` is unchanged.
- ~~Cloud provider kinds are still non-constructible~~ — **fixed 2026-08-13
  (W12-11).** `anthropic`, `openai` and `copilot` construct: the
  `credentialRef` is resolved through the keychain at construction time (it was
  being dropped in `targetToConfig`, so the comment beside it described a
  resolution that nothing performed), and prices come from
  `content/model-catalog/pricing.v1.json` — dated, stale-after-90-days, and an
  **unpriced model refuses rather than metering at $0**, because W2-07's
  breakers read the spend ledger and one that always sees $0 can never trip.
  The same pass closed a live hole: pointing `DOKIMA_MODEL_BASE_URL` at
  `api.openai.com` had been routing a real paid account through the generic
  oai-compat adapter with `LOCAL_COST_TABLE` (literally `{}`).
  **`vertex` still refuses**, now for a different and named reason — it needs a
  GCP project and location and `ProviderEntry` has no field for either
  (W12-14); deriving them from a `baseUrl` would be guessing which account
  gets billed.
- **The Providers panel still says cloud kinds are unusable** (W12-15).
  `providers-routes.ts` holds an independent hardcoded copy of the refusal
  W12-11 removed, on the model-_listing_ path, so the UI now contradicts the
  product. Stated because a reader deserves it: the full suite passes with that
  message asserted, since the assertion tests the duplicate.
- **D-024 is recorded but not fully implemented.** Model policy is the user's
  choice (local-only · one pinned model · cheapest-first · approval-gated), and
  local-only remains a hard guarantee. Two halves are missing: a user cannot
  pin a single MODEL (`locked` pins a rung — W12-12), and the setup wizard does
  not ask, so a fresh install silently adopts `ladder` (W12-13) — the exact
  silent default D-024 forbids.
- **The bundled expert library is four minor versions behind** (W12-07):
  `content/index.json` records upstream `attest` **3.1.24**, imported
  2026-07-12; upstream is **3.5.1**. Re-signing is a hard precondition and the
  signing key lives outside the repo.

## Proven, and still unproven, at time of writing

**W11 exit criterion 2 is DEMONSTRATED (2026-08-18).** A native `SpawnSession`
completed a real ticket end to end on a real model: manifest returned and
parsed, close gate accepted it, receipt minted with `secrets-scan` and
`validate-remote-parity` both at exit 0, the work committed on its own branch
with the project's own verify command printing OK — and the ticket stopped at
**`in_review`**, not `done`, which is maker≠verifier holding by construction.
`main` was untouched, as C-5 requires.

**It failed the first time, and that failure was the point.** Everything
fixture-tested worked; the run broke on the one thing no fixture could catch —
the model was asked for a Completion Manifest in a line of prose and judged
against a strict JSON schema it was never shown (**W13-09**). Two further
defects came out of the same session: an OpenAI-compatible endpoint could not be
sent per-model options at all (**W13-10**), and the tool-turn cap was a session
option nothing ever set (**W13-11**).

**W11 exit criterion 3 is still unproven.** Every call metered, ledger non-zero
and attributable per role, became genuinely testable only with W12-11 — but both
models tested so far are local, so a `$0` ledger is _correct_ rather than the
old defect. It needs one ticket on a paid provider: minutes, and cents.

**A first model-fitness result, worth recording:** `qwen/qwen3-coder-next`
landed the ticket in one attempt and four tool calls. `prism-ml/bonsai-27b`
could not close it under any configuration tried — with reasoning on it
overwrote a file and destroyed an unrelated function; with reasoning off it
produced correct code and still never emitted a manifest, at 12 turns or 30.
The gates refused all of it: no receipt, nothing merged, the ticket parked with
evidence.

## Test truth

`pnpm lint && pnpm typecheck && pnpm test` **plus** `pnpm --filter
@dokima/web e2e` per ticket (Law 3; e2e joined the gate 2026-07-27) ·
planted-defect harness — every gate must FAIL when attacked (`docs/TESTING.md`)
· toy-project E2E incl. symlink-escape regression · fitness bench fixtures ·
dogfood receipts at W8.

Last full gate (2026-08-13, W12-11): lint 0 errors / 1 pre-existing warning ·
typecheck clean across 14 workspace projects · **3479 passed | 1 skipped across
440 files** · **69 e2e passed** · `validate-plan` + `validate-traceability` OK ·
`validate-file-size` clean (0 gaps) · **`validate-exports` at baseline 43** —
new this wave (W12-10): it reports exported symbols that tests reference and
production code never does, as a ratchet rather than a clean-zero gate, because
the measured debt was 48 and failing every ticket for debt it did not create is
the mistake `conductor.config.json`'s own `repoWide` note warns about.

Two gates joined the release surface on 2026-08-03. **History secrets**
(W10-27): the tree scanner passes `--exclude-dir=.git` and so could never see a
credential that was committed then deleted — which is how the signing key
survived thirteen days. **Repo-wide file size** (W10-49): findings used to be
filtered to the ticket's own diff, so a file drifting over 400 lines only
surfaced when someone happened to edit it. Both now run on every push.

## Automation

`scripts/conductor.mjs` (config-driven, worktree isolation, plan-lint preflight,
diff-scoped validators, sticky-finding review, limit recovery) +
`scripts/supervise.sh` (crash restart), fronted by `pnpm autorun` /
`autorun:status` / `autorun:stop` (W9-16). Overnight runs launch **without**
`--escalate` by design — sonnet-only ladder; frontier spend requires a human
(D-018 by configuration). Control: `touch STOP`. Runbook:
`docs/work/CONDUCTOR_RUNBOOK.md`.

Note: the board is fully drained (147/147), so an autorun today idle-exits
immediately. More work requires filing tickets first —
`docs/work/W10_PLAN.md` still carries the unfiled Phase B (content refresh)
and Phase D (guide/scribe pipeline) queues.

`validators.repoWide` (W10-49) makes `validate-file-size` answer for the whole
repo rather than the ticket's diff. That is only honest while its count is
**zero**; if it ever goes non-zero, every ticket fails for debt it did not
create, so remove the entry rather than waive it. A test asserts the
precondition so it fails there rather than on a stranger's ticket.

---

## Historical — the 2026-07-12 pause (kept for the audit trail)

The build was deliberately paused at 23/65 tickets pending an upstream content
release. Four causes were recorded, none of them "the models can't code":
W3-01 hit the hardest-primitive pattern and was a dependency chokepoint; it
violated the project's own decomposition policy (5 pts, bundled three concerns);
account-level limit contention between two concurrent conductors; and upstream
content drift while the canonical library was moving.

The fix plan (F1 split W3-01 into a/b/c, F2 human-pair the trust-core lane, F3
resume after the upstream release + resync, F4 pull W3-08/09 early) was executed
— W3-01a/b/c and the whole W3 wave closed long since. **The durable lesson,
still true:** trust-core primitives reliably need human hands or pairing; the
straightforward 80% lands autonomously. Budget for it rather than treating it as
failure.

## Status log

- 2026-07-12 — paused pending upstream v2.1.0; process issue + fix plan recorded.
- 2026-07-14 — upstream precondition satisfied; design-review pass folded in.
- **2026-08-02** — tracker refreshed after 3 weeks of drift. Board 116/118, all
  milestone gates met, nothing tagged. LICENSE + README landed. History secrets
  scan found and remediated a CRITICAL signing-key leak (rotate + purge, both
  remotes force-pushed). **D-001 naming is now the single remaining pre-public
  blocker**, and it is a founder decision.
