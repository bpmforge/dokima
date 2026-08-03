# Release tracker — Dokima

**State 2026-08-03:** board **147 / 147 done — nothing claimable, nothing
blocked.** The v1.0 dogfood gate passed. **Not tagged**, and two things still
stand between here and a public tag (§Pre-public checklist): formal trademark
clearance, and the npm publish itself.

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

| Tag | Scope | Gate | Status |
|---|---|---|---|
| **v0.1.0-foundation** | W0–W3 (trust core, loop, gateway, Harbormaster) | full pnpm gate + planted-defect harness green; conductor self-hosts a fixture board | ✅ met, untagged |
| v0.2.0 | + W4 Canvas/Fleet | Playwright E2E over fake-model gateway | ✅ met, untagged |
| v0.3.0 | + W5 Pipeline/PM | sample idea runs <15 min on a local model | ✅ met, untagged |
| v0.9.0 | + W6 integrations, W7 memory | forge-mirror reconciliation + anti-Jarvis-gap recall test | ✅ met, untagged |
| **v1.0.0** | W8 dogfood: Dokima audits itself | own security cluster passes; receipts in `docs/dogfood/` | ✅ **met**, untagged |

Every milestone gate has been met. Nothing has been tagged, because the
pre-public checklist below was never finished.

## Pre-public checklist (required for any tag ≥0.3)

| Item | Status |
|---|---|
| LICENSE file | ✅ **done 2026-08-02** — Apache-2.0 per D-017 (decided 2026-07-14; the file had simply never been written) |
| README quickstart | ✅ **done 2026-08-02** — rewritten from the end-user's POV; every documented command executed and verified |
| History secrets scan | ✅ **done 2026-08-02** — found a CRITICAL leak; see below. **No longer a manual item as of 2026-08-03 (W10-27)**: `node scripts/validate-history-secrets.mjs` runs on every push as CI's `history-secrets` job. Re-running it by hand before a tag is now a confirmation, not the control. |
| npm name `@bpmforge/dokima` | 🟡 **prepared 2026-08-03, not yet published** — name confirmed free; root `package.json` now carries the scoped name, `0.1.0`, `publishConfig.access: public`, license/repo/description metadata, and a `prepublishOnly` build so a tarball can never ship without `apps/server/dist/main.js` or `apps/web/dist`. Packing and installing the tarball into a clean project surfaced a **release blocker** (W10-43) — `distributionRoot()` identified the distribution by the literal package name `dokima`, so scoping it made every asset unreachable and the CLI died on startup. Fixed and re-verified end to end: the installed binary boots, serves the built web dist, materializes `packs/` in `DOKIMA_HOME`, and answers `GET /api/v1/projects` → `200 {"projects":[]}` with a real bearer token. **The publish step itself needs an authenticated operator** — log in to npm, then run the publish command from the repo root. |
| D-001 naming pass | ✅ **done 2026-08-02 — renamed to Dokima (D-021).** The old name had two collisions: `shipwright.io`, CNCF's container-image build framework, whose trademarks were donated to the **Linux Foundation** — an adjacent market, not the "different domain" D-001 assumed; and npm `shipwright`, held since 2015 by `hellofloat/shipwright` ("DigitalOcean CLI control"), declaring the same `bin`. Ships as `@bpmforge/dokima`, home `dokima.sh`. **Formal trademark clearance is still open and needs a lawyer.** |

### The secrets scan found a real one

The Ed25519 content-signing **private** key was in pushed history since
2026-07-20 and derived byte-for-byte the public key the product shipped —
proven forgeable against the real `content/manifest.json`.

**Remediated 2026-08-02**: key rotated (old key proven dead), history purged
across all six branches, force-pushed to both remotes. Full write-up, including
what the rewrite does *not* undo:
[`docs/work/SECURITY_RELEASE_BLOCKER_2026-08-02.md`](work/SECURITY_RELEASE_BLOCKER_2026-08-02.md).

Durable fix **landed 2026-08-03 as W10-27**: `secrets-scan.sh` scans the working
**tree**, so a gitignored, tree-removed key reads clean while history is
compromised — which is exactly how this survived thirteen days. History scanning
is now part of the gate: `scripts/validate-history-secrets.mjs` reads every object
reachable from every ref — file contents *and* commit/tag messages (no external
scanning binary, ~1.3s), CI runs it on every push with `fetch-depth: 0`, and it
exits **2 rather than 0** on a shallow clone so it can never pass vacuously. CI
also fetches every branch explicitly and runs with `--verify-remote-refs`,
because a single-ref checkout is *not* shallow and would silently shrink the
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
- **Cloud provider kinds are still non-constructible.** `anthropic`, `openai`,
  `vertex` and `copilot` throw a *named* refusal (`kind-not-constructible`)
  rather than falling back to localhost or faking a $0 cost:
  `AnthropicConfig.costTable` is required with no default and the adapter needs
  a resolved secret, not the `credentialRef` the registry stores. W10-42 built
  the credential-write route, so half the prerequisite exists; a real price
  table is what remains. Local kinds (ollama, lm-studio, oai-compat) work today.

## Test truth

`pnpm lint && pnpm typecheck && pnpm test` **plus** `pnpm --filter
@dokima/web e2e` per ticket (Law 3; e2e joined the gate 2026-07-27) ·
planted-defect harness — every gate must FAIL when attacked (`docs/TESTING.md`)
· toy-project E2E incl. symlink-escape regression · fitness bench fixtures ·
dogfood receipts at W8.

Last full gate (2026-08-03): lint 0 errors / 1 pre-existing warning ·
typecheck clean across 14 workspace projects · **3131 passed | 3 skipped across
416 files** · **61 e2e passed** · `validate-file-size` clean (0 gaps) ·
history-secrets scan clean.

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
