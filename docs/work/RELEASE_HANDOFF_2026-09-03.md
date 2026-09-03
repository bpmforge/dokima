# Release handoff — 2026-09-03

**Goal (founder, 2026-09-03): get Dokima out the door.** This file is the
resume point. Everything below is disk- or CI-verified today; nothing is
carried from memory.

## Where it stands

| Item                 | State                                                                                                                          | Evidence                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Build                | **495 of 497** tickets done on `plan.json`                                                                                     | W12-44 (plugin loader) and W13-32 (autonomy dial) are deliberately held for founder calls    |
| CI on `main`         | **green, 7/7 jobs** — first green run in the 25-run window                                                                     | [run 33808312531](https://github.com/bpmforge/dokima/actions/runs/33808312531) on `df882a89` |
| Nightly E2E          | **green, 76/76** on the Ubuntu runner                                                                                          | [run 33809438510](https://github.com/bpmforge/dokima/actions/runs/33809438510)               |
| Pre-public checklist | all ✅ except the registry release                                                                                             | `docs/RELEASE_TRACKER.md` §Pre-public                                                        |
| Package              | `@bpmforge/dokima` — name free (registry returns 404), `0.1.0`, `publishConfig.access: public`, `prepublishOnly` builds `dist` | `npm pack --dry-run`: 268 files, 1.3 MB packed, 4.5 MB unpacked                              |
| Milestone gates      | v0.1 … **v1.0.0 all met, none tagged**                                                                                         | `docs/RELEASE_TRACKER.md` §Release milestones                                                |
| README               | "Status — release candidate" (rewritten `56dedc0f`)                                                                            | lists the closed gaps by ticket                                                              |
| CHANGELOG            | `## [Unreleased]` — "Nothing yet"                                                                                              | **needs the first real entry before the tag**                                                |

What made CI green today is one ticket, **P6-21** (`25ca5efd`, `ddd4d5e8`,
`df882a89`, `5f9c70ff`): none of it was product breakage. SC-07 was
correctly refusing every build run on Ubuntu 24.04 (unprivileged user
namespaces are restricted there, so the `unshare` probe fails); `fast-uri`
overrides sat one patch short; hosted runners have no git identity; gate
checkouts were shallow; ripgrep was absent; the coverage step aborted under
`bash -e`; and two tests depended on this laptop (a gitignored capture run,
the macOS keychain). Full notes on the board ticket.

## The three steps left — in order

### 1. Decide the version (founder)

`package.json` says `0.1.0`. The tracker's milestone table records the
**v1.0.0** gate as met (W8 dogfood: Dokima audits itself, receipts in
`docs/dogfood/`). Recommendation: **ship as 1.0.0** — tagging lower
contradicts the project's own tracker. The pre-public checklist applies to
any tag ≥ 0.3, and it is complete.

### 2. Prepare the release commit (agent, once the number is chosen)

On a branch `release/v<version>`:

- bump `version` in the root `package.json`
- write the `## [<version>] — 2026-09-XX` CHANGELOG entry (Keep a Changelog;
  entries name what each change means for the trust boundary — see the
  file's own preamble)
- update `docs/RELEASE_TRACKER.md` §Release milestones (tag column) and the
  README's "Not published yet" callout to the install-from-registry form
- full gate: `pnpm lint && pnpm typecheck && pnpm test`,
  `pnpm --filter @dokima/web e2e`, `pnpm validate`
- push the branch to both remotes; merge is the founder's

### 3. Tag and release (founder, on a machine logged in to npm)

From the repo root on `main` after the merge, **Node 22 on PATH**
(`fnm use 22`):

```sh
git pull --ff-only origin main
git tag -a v<version> -m "Dokima <version>"
git push origin v<version> && git push github v<version>
npm whoami                # must print your npm user
npm pack --dry-run        # 268 files, dist present — sanity, no side effects
npm publish --access public
```

`prepublishOnly` runs `pnpm build` first, so the tarball can never ship
without `apps/server/dist/main.js` and `apps/web/dist`. Then verify from a
clean directory:

```sh
cd "$(mktemp -d)" && npm init -y >/dev/null && npm i @bpmforge/dokima
npx dokima doctor
```

`doctor: OK` from the installed package is the definition of "out the door".
Record the run in `docs/RELEASE_TRACKER.md` (npm row → ✅ with the version and
date) and note it in `docs/STATUS.md`.

## Not release blockers — open, filed, waiting on a call

| Ticket          | What                                                                                                                                                                               | Needs                                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| P6-19           | Manifest-emission wall: local models finish the work, then burn every iteration without returning the Completion Manifest; 5/5 sample tickets needed the human `dokima close` exit | **founder design decision** — may the harness mint a manifest from its own out-of-session verify evidence (C-2)? |
| P6-20           | Literal-`\n` corrupted files are accepted at the write-tool boundary (seen twice)                                                                                                  | build                                                                                                            |
| P6-22           | W13-39 mid-run rejoin e2e flaked twice on the Ubuntu runner, then passed untouched; the nightly now uploads `test-results/` evidence so the next red is diagnosable                | evidence, then a state-driven fix                                                                                |
| W12-44 / W13-32 | plugin loader / autonomy dial                                                                                                                                                      | founder calls, deliberately held                                                                                 |

## Traps for whoever resumes

- **Node 22**, always. Node 24 fakes ~50 server-test failures
  (`NODE_MODULE_VERSION 127 vs 137`). `fnm`'s default is 24.
- The stop hook and any concurrent full `pnpm test` collide on temp dirs and
  ports — one suite at a time.
- `--repeat-each` on the e2e suite is not a valid flake probe: specs start a
  fresh fake gateway per test while the suite shares one server.
- `validate-temp-leaks` will flag your own test runs' leftovers; remove the
  listed `dokima-*` temp dirs before pushing.
- The README's quickstart still says "install from source" — step 2 changes
  it; do not change it before the package exists on the registry.
- `docs/STATUS.md` cannot currently be committed through the hooks (P6-23):
  HEAD fails prettier and the fix re-adds a doc-example key the staged-diff
  scan flags. The 2026-09-03 ledger entry for this handoff is therefore in
  this file and on the board, not in STATUS.md, until P6-23 lands.
