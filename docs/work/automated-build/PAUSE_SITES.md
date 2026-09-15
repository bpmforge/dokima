# Pause sites: what actually calls them — W23-01 (AB-01)

AB-01 step 1 asks for an inventory of **real callers**, not exported helpers,
and warns that in the reviewed checkout `askClarification` and
`resolvePauseAction` "did not have the expected production wiring". Verified on
`feat/automated-build` at `4b05a4db` with `rg` across `apps`, `packages`,
`scripts` and `content`. The warning is accurate, and understates it.

## The inventory

| Symbol                            | Defined in                                                | Production callers                                                 | Test callers                              |
| --------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------- |
| `resolvePauseAction`              | `packages/harbormaster/src/autonomy.ts`                   | **none** before this ticket                                        | `autonomy.test.ts` only                   |
| `askClarification`                | `packages/harbormaster/src/breakpoints-clarifications.ts` | **none** — two re-exports and nothing else                         | `breakpoints-clarifications.test.ts` only |
| `isNeverAutoPauseSite`            | `packages/harbormaster/src/autonomy-types.ts`             | `autonomy.ts`, `autonomy-ledger.ts`, `autonomy-ledger-validate.ts` | 2 files                                   |
| `assertExecutionAllowed`          | `packages/harbormaster/src/review-queue-classifier.ts`    | none outside the package (barrel-published)                        | its own test                              |
| `classifyByRules` / `isNeverAuto` | same file                                                 | `assertExecutionAllowed`, and now `approved-build-policy.ts`       | its own test                              |

The two re-exports of `askClarification` are `breakpoints.ts` (a barrel chapter)
and `index.ts` (the package barrel). A re-export is not a caller: it makes the
symbol reachable and calls nothing.

## What that means, stated plainly

**The autonomy dial is not wired to anything.** `resolvePauseAction` is
described in its own header as "the single enforcement point (SC-10) for what
happens at a gated pause site", and until this ticket no production code
consulted it. The same is true of the clarification verb it would have to work
through: nothing in `apps/server`, `packages/loop`, `packages/pipeline` or the
Harbormaster loop opens a clarification card. `validate-exports` had already
recorded this without anyone reading it as the finding it is — both symbols sat
in its _buried_ list (exported, tested, called by nothing).

This is exactly why W13-32 is `blocked` rather than merely unfinished: wiring
the dial is not a small edit to an existing path, it is **creating** the path.

**C-5 is currently intact and vacuous.** `isNeverAutoPauseSite` is genuinely
consulted — by the ledger and its validator, so a NEVER-AUTO decision cannot be
minted as an auto-default. What no code does is _reach_ a pause site and ask
what to do there. The constraint holds because nothing ever tests it, which is
a fragile way for a constraint to hold and the reason AB-01's acceptance
criterion 4 insists the new path consult the same function rather than a copy.

## What W23-01 changed, and what it deliberately did not

`packages/harbormaster/src/approved-build-policy.ts` implements
`decideApprovedBuildAction`, a pure function over runtime-owned facts. It:

- **delegates** to `isNeverAutoPauseSite` and to `classifyByRules`/`isNeverAuto`
  — no third NEVER-AUTO list exists;
- **calls** `resolvePauseAction` for the legacy path, which is how that symbol
  finally acquired its first non-test caller (`validate-exports`' buried count
  dropped 45 → 44 as a direct result, and the ratchet in
  `conductor.config.json` followed it down);
- **does not touch** `autonomy.ts`, `autonomy.test.ts`,
  `breakpoints-clarifications.ts` or its test — those four files are W13-32's
  write scope and W13-32 stays blocked and unchanged.

`decideApprovedBuildAction` has **no production caller yet**, and says so at its
barrel export with an `@unreached` marker naming **W23-02** — the card that
persists the approval this function reads. That marker is the mechanism this
repo built for exactly this state, and `scripts/validate-exports.test.mjs`
asserts both markers name W23-02, so the day W23-02 lands and forgets to delete
them, the test goes red.

## Pause sites this release enumerates

From `IMPLEMENTATION_PLAN.md` §4. Every row is a `ruleId` in
`approved-build-policy.ts` and a case in its table-driven test.

| Situation                                           | Decision                     | Rule id                                           |
| --------------------------------------------------- | ---------------------------- | ------------------------------------------------- |
| Implement an approved ticket inside its scope       | proceed                      | `implement-inside-scope`                          |
| …outside it, or scope unchecked                     | ask                          | `implement-outside-scope`                         |
| Run configured tests/scanners in policy             | proceed                      | `run-configured-check`                            |
| Ordinary implementation detail                      | proceed                      | `ordinary-detail`                                 |
| Repair inside acceptance, rounds remaining          | proceed, bounded             | `repair-inside-scope`                             |
| Repair rounds exhausted                             | ask                          | `repair-rounds-exhausted`                         |
| Transient provider failure under the limit          | proceed, bounded             | `provider-transient-retry`                        |
| Fresh independent review confirms current head      | machine accept               | `machine-accept`                                  |
| Ambiguous requirement                               | ask                          | `ambiguous-requirement`                           |
| New scope / dependency / stack / auth / destructive | ask                          | `scope-or-stack-change`                           |
| Over budget                                         | ask                          | `budget-exceeded`                                 |
| Approval-gated model boundary                       | ask                          | `escalation-boundary`                             |
| Missing scanner / credential / reviewer             | report missing capability    | `missing-capability`                              |
| Same maker and reviewer model                       | no acceptance                | `accept-same-model`                               |
| Main/master merge, release, publication, deploy     | ask separately               | `protected-action`                                |
| Any NEVER-AUTO pause site or protected action       | ask, before every other rule | `c5-never-auto-pause-site`, `c5-protected-action` |
| Unknown pause kind or unknown situation             | ask, fails closed            | `unknown-situation`                               |
| Legacy `autonomy=auto`, no approval                 | legacy behaviour, unchanged  | `legacy-autonomy-default`                         |
| Legacy interactive, no approval                     | ask                          | `legacy-requires-opt-in`                          |

**D-032's review is completed only for these rows.** Any pause site not in this
table stays human-gated, and the function's default branch returns `ask_human`
rather than falling through. No existing clarification row was blanket-dismissed
by this ticket.
