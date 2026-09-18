# Autonomy dial — per-pause-site defaults review (the D-032 precondition)

**Status:** review written 2026-09-18; decision pending (slate P-014).
**Unblocks:** W13-32 (wire the autonomy dial). **Founder decision D-032** said
the dial stays unwired until this review exists. This is that review: what
each pause site does today, what "take the documented default" would mean
there, what it costs when it goes wrong, and a recommendation. The decision
itself is Brad's; a ready-to-record decision text is at the end.

## The population the risk was about

D-032's risk: "wiring it turns every non-NEVER-AUTO pause site to auto AT
ONCE, on projects whose owners already selected auto believing it applied."
Measured 2026-09-18 on this machine: **no project has selected auto.** None of
the three fleet projects (recipe-keeper, vault, tally) has an `autonomy` key
in its settings, nor does the global config. The panel itself has said
"Auto — not in effect yet: every gated pause still asks" since W13-26. The
risk is real in principle and empty in fact here; it should still be handled
by construction (a safe-list, below), not by assuming other machines match.

## What is already wired, and what is not

- `resolvePauseAction(mode, site)` exists and is consulted on ONE path
  already: `approved-build-policy.ts` step 3, for a project with no
  approved-build-v1 approval ("legacy-autonomy-default"). So the dial is not
  entirely unread — it is read where W23's approved-build path decides
  whether machine acceptance may proceed.
- `askClarification` does not consult it (W13-32 AC2): a clarification always
  opens a blocking card. W23-28 (2026-09-18) wired the verbs to routes and the
  morning queue, so a dismissal now takes the documented default WITH a human
  behind it. Auto would take it without one.
- `isNeverAutoPauseSite` is intact and vacuous (C-5): consulted by
  `resolvePauseAction`, which nothing on the clarification path calls yet.

## The seven pause sites

| Site            | NEVER-AUTO? | What pauses there today                                                                                         | "Take the documented default" would mean                                                             | If it goes wrong unattended                                                                                                                                                 | Recommendation                                                                                           |
| --------------- | ----------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `deploy`        | yes (C-5)   | staged, parked `in_review`, morning queue                                                                       | — (never)                                                                                            | —                                                                                                                                                                           | unchanged                                                                                                |
| `main-merge`    | yes (C-5)   | PR opened, parked, morning queue                                                                                | — (never)                                                                                            | —                                                                                                                                                                           | unchanged                                                                                                |
| `destructive`   | yes (C-5)   | drafted, parked, morning queue                                                                                  | — (never)                                                                                            | —                                                                                                                                                                           | unchanged                                                                                                |
| `interview`     | yes         | the founder interview waits for a person                                                                        | — (never)                                                                                            | —                                                                                                                                                                           | unchanged                                                                                                |
| `clarification` | no          | a Decide card; only dependent work pauses (UC-03)                                                               | the card's own `default-if-unanswered`, chosen by the agent that asked, ledgered with `auto-default` | the agent answers its own question; a wrong default is one ticket's worth of work, refused by the close gate if the acceptance criteria disagree, and visible in the ledger | **AUTO, with three guards** (below)                                                                      |
| `escalation`    | no          | token-gated mode parks `awaiting_escalation_token` at the named tier boundary (D-018, FR-N2)                    | climb to the next rung without a token                                                               | a metered rung spends the owner's money without the approval D-018 exists to require                                                                                        | **ASK** unless the next rung is `local` (`tierKindFor`), where the cost is only time — then auto is fine |
| `budget`        | no          | breaker levels `warn` → `downshift` → `hard_stop` are already automatic; the human pause is `hard_stop` at 100% | continue past the hard stop                                                                          | spend past the ceiling the owner set, which is the one thing the breaker exists to prevent                                                                                  | **ASK, always.** Auto here would mean "the budget is advisory", and it is not                            |

So the honest safe-list is **`['clarification']`**, plus `escalation` only when
the next rung is local. Everything else keeps asking regardless of the dial.

## The three guards for auto clarifications

1. **The default must be one of the offered options**, or the card asks
   anyway. A free-text default that matches no option is the agent
   improvising; that is what the card exists to stop.
2. **A cap per run** (suggested: 3 auto-defaults per run, then ask). Ten
   auto-answered questions in one run is a ticket that should have been split,
   and a person should see that shape rather than a ledger full of it.
3. **The ledger row carries the checkpoint** (`checkpointRef`) so the answer
   can be revisited: the card's context, the question, the options, the
   default taken and what would have been asked. `appendAutoDefaultRow`
   already writes everything but the checkpoint.

## What W13-32 then implements

- AC2: `askClarification` takes a `pauseSite` kind (always `'clarification'`
  from the loop) and the project mode, injected from apps/server the way every
  other cross-package dependency is; consults `resolvePauseAction`; on
  `take_default` writes the ledger row and resolves the card as dismissed with
  the operator absent (`decidedBy: null`, `decision: 'auto-default'`).
- AC3: `isNeverAutoPauseSite` on the same path — already what
  `resolvePauseAction` does; the fixture proves it stays consulted.
- AC4 red fixture: auto project, `clarification` site → default taken +
  ledgered; same project, `main-merge` site → still asks.
- The safe-list is compiled, like NEVER-AUTO (SC-10): not config, not DB.

## Decision text, ready to record

> **D-033 — The autonomy dial wires `clarification` only, with guards; every
> other non-NEVER-AUTO site keeps asking.** Per the 2026-09-18 review
> (docs/work/AUTONOMY_DEFAULTS_REVIEW.md): `escalation` auto-climbs only to a
> local rung; `budget` never takes a default. Auto clarifications require the
> default to be an offered option, are capped per run, and ledger the
> checkpoint. W13-32 is unblocked with this as its acceptance.

## W12-44, for completeness

Still blocked by design, and correctly: no concrete plugin has appeared. The
one candidate this month, MTPLX, needed a **preset**, not a plugin — it speaks
the OpenAI shape and the gateway already had the adapter. PLUGIN_SEAM.md §7
holds.
