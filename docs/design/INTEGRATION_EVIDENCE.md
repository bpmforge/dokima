# Evidence that exercises the product

**Ticket:** W13-28 · **Status:** design. No gate change ships with this
document; §6 says what needs deciding before one can.

## 1. The failure this exists to stop

From field use of a comparable multi-agent setup: a UI feature was rebuilt in
an isolated harness, where it worked, and inside the existing application it did
not. Smaller models repeatedly reported the work finished while the operator
could still see it failing. Each round produced evidence from the isolated path.
Nobody could say what differed between the two builds, so the loop had nothing
to converge on and a larger model was eventually used instead.

**The tempting read is that the small models were bad. That read is wrong**, and
acting on it is expensive: escalating hides the defect at cost and leaves the
gate wrong for every model, including the large one. The model reported what its
evidence showed. The evidence was measuring the wrong thing.

## 2. Dokima has the same defect, for a different reason

This is not a hypothetical borrowed from someone else's system.

`reRunVerify` re-runs the ticket's own verify command out of session (SC-02) so
a manifest cannot substitute a no-op. That control is sound, and it is only ever
as good as the command it drives. Two facts about what it actually drives:

- **The board cannot express a verify command.** `validate-plan.mjs`'s
  `TICKET_KEYS` has no `verify` field, so **0 of 274 tickets** carry one and
  every ticket falls through to `DEFAULT_VERIFY_COMMAND`.
- **That default is `pnpm lint && pnpm typecheck && pnpm test`** — and it omits
  `pnpm --filter @dokima/web e2e`.

So the automated close gate is **strictly weaker than the law the humans
follow**. CLAUDE.md law 3 requires both halves, and records exactly why e2e was
added on 2026-07-27: a spec "sat silently red from W5-16 until the first full
e2e audit days later". The gate was strengthened for humans after a browser
assertion rotted unnoticed; the agent's gate never got the same fix.

**A Dokima ticket that breaks the Canvas can close today on unit tests.** That
is the reported failure, in this repository, reachable now.

## 3. Why the obvious fix is wrong

Add e2e to `DEFAULT_VERIFY_COMMAND` and stop. It fails on three counts:

- **It does not run there.** The close gate executes in the ticket's git
  worktree, which has no `node_modules`. e2e needs installed dependencies, a
  built web bundle and a served core. The command would fail for a reason
  unrelated to the ticket — and W13-27 has just made "failed for an unrelated
  reason" a thing the loop retries, which would turn every ticket into three
  wasted passes.
- **It charges every ticket for one lane's risk.** Most tickets touch neither
  the browser nor the UI. A 30-second browser suite on a `packages/events`
  change buys nothing and is the kind of cost that gets a gate switched off.
- **It still would not have caught the reported case.** e2e against a harness
  route is as blind as a unit test against a harness. The problem is not which
  runner; it is whether the evidence drove the path a user takes.

## 4. What actually distinguishes the two builds

When something works in isolation and fails integrated, the difference is
almost always one of a short list, and none of it is visible from a green test:

| Where it hides | What to capture |
|---|---|
| Dependency drift | the version actually resolved at runtime, not the range in the manifest |
| Initialisation order | when the component mounts relative to the shell's own setup |
| Configuration | flags, env and settings present in the app and absent in the harness |
| Host context | the container the component is mounted into, and its size and layering |
| Styling | rules that exist only in the application shell, including stacking order |

**A session cannot be expected to guess this**, and the reported rounds are what
guessing looks like. It is a mechanical comparison, and it should be produced
for the session rather than requested from it.

## 5. Recommendation

**Two parts, in this order, and the first is worth more than the second.**

**(a) A diagnosis step, triggered by repetition.** W13-29 now feeds each
attempt's gaps forward and stops a ladder whose gaps do not change. That
no-progress signal is exactly the trigger: when the gaps repeat, the loop
should emit the §4 comparison as a fact the next attempt receives, instead of
parking with "it failed twice". Repetition against unchanged symptoms is the
cheapest available detector for "the evidence is measuring the wrong thing",
and the loop already computes it.

**(b) A ticket may declare that its evidence must drive the integrated path.**
An explicit per-ticket declaration, not an inference from paths touched:
inferring it means guessing, and a gate that guesses is one people learn to
distrust. This needs a board field (`verify`, absent today) and a lane-aware
default, and it is the half that changes what closing means — so it is the half
that needs a founder's word.

**Rejected: escalate to a larger model on repeated failure.** It treats a
measurement defect as a capability problem, costs more per ticket, and leaves
the gate wrong for every model. The fitness bench (W2-08) already exists for
choosing a model; this is about what the gate demands of one.

**Rejected: require a screenshot or a recording as evidence.** An artefact
proves a session ran something, not that what it ran was the product. It also
cannot be checked out of session, which is the property SC-02 depends on.

## 6. What must be decided before a gate changes

1. **Does the board grow a `verify` field?** Without one, no ticket can ever
   demand more than the default, and §5(b) is unbuildable.
2. **What runs it?** The close gate's worktree has no installed dependencies.
   Either integration evidence runs somewhere else, or worktrees gain an install
   step — with the cost that implies on every ticket.
3. **What happens when it cannot run?** FR-G5 says degrade honestly. A gate
   that silently skips its integration half is worse than one that never had it,
   because the board would then show a green it did not earn. The same question
   W13-25 asks about the sandbox, and it should get the same answer.
