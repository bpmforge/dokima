# Operations — who does the work, and what reaches you (W20, D-028/D-029/D-030)

## The model in one sentence

Everything a machine can check, a machine does — and you never hear about it.
What reaches you is only what a machine **must not** decide: your product
choices, your money, your merges, and your acceptance of finished work.

## The floor runs itself

None of this reaches the manager. Ever.

| The team does this | Enforced by |
|---|---|
| Claim a ready ticket, open a worktree, do the work | lease + write_scope (FR-T3) |
| Check their own work before handing in | session verify (drafting discipline, not a grade) |
| Review someone **else's** work | maker ≠ verifier, mechanical (Law 5 / C-4) |
| Run the phase gate, mint the receipt | runPhaseGate + signed receipts (W19-01) |
| Retry on the same rung; climb a free ladder | escalation policy (D-024) |
| Park with evidence when attempts run out | ladder cap + park comment (T-27) |
| Hand work to the next member | ledgered stage/verb events |
| Learn the right turn budget from real sessions | measured multiplier, shrink-only (FR-L3) |

If a member is stuck on **something other than you** — a dependency, a
missing pack, a busy lease — they stay on the floor. They do *not* come to
your office. Waiting for a peer is not your problem to look at.

## Five things reach the manager — and only five

1. **Founder decisions** — a fork only you can settle (local-only vs synced,
   scope in/out, a tech-stack addition). Never guessed on your behalf.
2. **Approvals with a cost or a blast radius** — escalate to a metered model
   (D-029), merge to main, deploy, a destructive migration, a new dependency.
3. **Blocked-on-you refusals** — a member cannot proceed without something
   only you have (a credential name, an ambiguous requirement made concrete).
4. **Acceptance** — accepting someone else's finished work stays a human verb
   (D-020). The gate proves it *passed*; you decide it's *what you wanted*.
5. **Interview answers** — the describe questions, and follow-ups.

Anything that is not one of these five and still reaches you is a bug in this
document, not a feature.

## The funnel: Otto, chief of staff

Borrowed shape (the "head of desk" pattern, 2026-08-24): one member who
**never does the work** and owns the interface to the human.

Otto's charter:

- **Never does product work.** No tickets, no code, no reviews, no gates.
- **Never answers for you.** Not one of the five classes above is ever
  resolved by Otto.
- **Never removes an item.** Otto orders the queue; he cannot suppress it.
  Queue depth is always the true count.
- **Orders it mechanically** — no model judgement in the ordering, because a
  model deciding what the founder *sees* is the same trust hole as a model
  grading its own work (C-2). The sort key is computable:
  1. blocks the whole run (nothing else can proceed)
  2. unblocks the most tickets (count of blocked dependents in the DAG)
  3. oldest first
  4. cheapest to answer last

- **Presents one at a time, counts honestly.** The panel shows the top item
  with a "next" after you answer; the depth ("3 waiting") is never hidden.
  One-at-a-time is a courtesy; a hidden backlog would be a lie.

## The waiting room

A member with an open ask **walks to your office and waits in a chair**, in
Otto's queue order. This is the queue made physical, and it is deliberately
uncomfortable in the right way: if four people are sitting in your office,
*you* are the bottleneck and you can see it at a glance — no badge required.

- Answer them and they stand, walk back to their desk, and resume.
- Decline is a first-class answer; they walk back just the same, and the
  decline is ledgered.
- Nobody sits in your office for a reason that isn't one of the five classes.
- The chairs are finite on screen; the count in Otto's panel is not.

## What you never have to do

Read a log. Grep for "done". Decide whether a review really happened. Chase
which member has which file. Re-approve something you already approved.
Watch a run to keep it moving.

## Two views, one truth

- **Office** — the pixel floor. A *skin* over the event-derived state
  (D-028). Delightful, shareable, and never the source of truth.
- **List** — a plain, dense, screen-reader-friendly page: every member, their
  state, and the queue of what needs you. This is the **accessible default
  fallback** and the view that must always be able to answer every question
  the office can, in text (WCAG 2.2 AA, UX_SPEC §9).

Neither view may show a state the other cannot. A person who never opens the
office loses nothing but the charm.

## Orphaned claims — a ticket held by nobody (W21-14, design only)

**Observed, 2026-08-25.** A run ended while `PLAN-vault-001` was `in_progress`.
The board went on showing the card in In Progress with *"an agent is working
this"*, and no run existed. Nothing could claim it, because a claimed ticket is
not claimable; and nothing marked the state as abnormal, so the only way out
was knowing to use the card's `Move to… → Release it`. A founder who does not
know that sees a board that has quietly stopped working.

The state is real and will keep happening: a claim is durable (it is a ledger
event) and a run is not (it is a process). Any crash, kill, machine sleep or
power cut between `claimTicket` and the run's end leaves exactly this.

### What could own the reaping

**A. A lease with an expiry.** The claim carries a deadline; the claimer
renews it while it works; an expired lease makes the ticket claimable again.
*Failure mode:* the clock, not the process, decides. A legitimately slow
session — a large local model on a busy machine, exactly what this product
runs on — has its ticket stolen mid-flight, and two workers can then hold the
same ticket. That is worse than the problem, and mitigating it means renewal
heartbeats, which is a second liveness mechanism to get wrong.

**B. A sweep at run end.** When a run finishes, it releases anything it still
holds. *Failure mode:* it only works when the run gets to run its own cleanup.
The case that produced this — a core killed mid-run — is precisely the case
where no cleanup executes. It fixes the tidy exits, which were never the
problem.

**C. The board names the state.** Nothing reaps automatically. A claim whose
run is not among the live runs is rendered as what it is — *held by a run that
is no longer going* — with the release action on the card. *Failure mode:* it
needs a person, so a board left alone stays stuck.

### Recommendation

**C, with B as an optimisation.** The reason is C-2: the trust boundary. A
lease that silently un-claims work is the product making a liveness judgement
on the founder's behalf, and it gets that judgement wrong in exactly the
conditions this product is designed for — slow local models on contended
machines. B is free and correct where it applies, so a clean run end should
release what it holds; but it must not be mistaken for a fix, because the
failure that matters is the unclean one.

C also matches the queue's existing rule (D-030): the founder's attention is a
resource the product must ask for honestly rather than route around. An
orphaned claim is a five-second decision for a person and an unbounded risk
for an algorithm.

Implementation is out of scope for this ticket by founder instruction; what is
in scope is that the recommendation and its reasoning are written down before
anybody builds a lease.
