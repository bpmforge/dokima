# Release tracker — Dokima

**State 2026-08-02:** board complete through W9 — **116 of 118 tickets done**
(1 blocked, 1 todo). The v1.0 dogfood gate passed. **Not tagged**, and three
things still stand between here and a public tag (§Pre-public checklist).

Board = `plan.json` · progress ledger = `docs/STATUS.md` · next wave proposal =
`docs/work/W10_PLAN.md`.

> **This file was stale from 2026-07-14 to 2026-08-02**, still reporting
> "23/65 tickets, PAUSED" against a reality of 116/118 done. It is how a human
> resumes cold, so that drift was itself a release-readiness defect. The
> historical pause narrative is preserved in §Historical below.

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
| History secrets scan | ✅ **done 2026-08-02** — found a CRITICAL leak; see below |
| D-001 naming pass | ✅ **done 2026-08-02 — renamed to Dokima (D-021).** The old name had two collisions: `shipwright.io`, CNCF's container-image build framework, whose trademarks were donated to the **Linux Foundation** — an adjacent market, not the "different domain" D-001 assumed; and npm `shipwright`, held since 2015 by `hellofloat/shipwright` ("DigitalOcean CLI control"), declaring the same `bin`. Ships as `@bpmforge/dokima`, home `dokima.sh`. **Formal trademark clearance is still open and needs a lawyer.** |

### The secrets scan found a real one

The Ed25519 content-signing **private** key was in pushed history since
2026-07-20 and derived byte-for-byte the public key the product shipped —
proven forgeable against the real `content/manifest.json`.

**Remediated 2026-08-02**: key rotated (old key proven dead), history purged
across all six branches, force-pushed to both remotes. Full write-up, including
what the rewrite does *not* undo:
[`docs/work/SECURITY_RELEASE_BLOCKER_2026-08-02.md`](work/SECURITY_RELEASE_BLOCKER_2026-08-02.md).

Durable fix ticketed as W10-27 in `docs/work/W10_PLAN.md`: `secrets-scan.sh`
scans the working **tree**, so a gitignored, tree-removed key reads clean while
history is compromised. History scanning needs to join the release gate.

## Known gaps at time of writing

Not release blockers by themselves, but a reader deserves them stated:

- Provider/model selection is editable in the UI and **not wired** to the
  pipeline's model calls (W10 Phase G — the engine is built and tested, the
  wire is missing)
- Visual design is unfinished — 4 design tokens, 66 hardcoded hexes, clipped
  board columns (W10 Phase H)
- The bundled expert library is ~133 upstream changes behind (W10 Phases A/B)
- `dokima --help`, and any mistyped command, boots the server
- `plan.json`: W9-08 blocked, W9-15 todo

## Test truth

`pnpm lint && pnpm typecheck && pnpm test` **plus** `pnpm --filter
@dokima/web e2e` per ticket (Law 3; e2e joined the gate 2026-07-27) ·
planted-defect harness — every gate must FAIL when attacked (`docs/TESTING.md`)
· toy-project E2E incl. symlink-escape regression · fitness bench fixtures ·
dogfood receipts at W8.

Last full gate (2026-08-02, post-rewrite): lint 0 errors / 1 pre-existing
warning · typecheck clean · **2883 passed | 3 skipped across 400 files** · **58
e2e passed**.

## Automation

`scripts/conductor.mjs` (config-driven, worktree isolation, plan-lint preflight,
diff-scoped validators, sticky-finding review, limit recovery) +
`scripts/supervise.sh` (crash restart), fronted by `pnpm autorun` /
`autorun:status` / `autorun:stop` (W9-16). Overnight runs launch **without**
`--escalate` by design — sonnet-only ladder; frontier spend requires a human
(D-018 by configuration). Control: `touch STOP`. Runbook:
`docs/work/CONDUCTOR_RUNBOOK.md`.

Note: an autorun today claims W9-15 and idle-exits — the board has no other
claimable work. W10 must be filed into `plan.json` before autorun has anything
to do.

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
