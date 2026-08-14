# Supervised run — W11 exit criteria 2 and 3

**Status: never performed.** This is the one claim the product rests on and the
only thing on the list that cannot be done unattended.

Everything the agent loop is built from has been proven against recorded
fixtures, a fake shell agent and a `node:http` stub. All of that is correct
under CLAUDE.md law 9(a) — tests never make live API calls — and **none of it
is the same as watching a real model finish a real ticket.**

What this run tests, in one sitting:

| Exit | Claim | How you will see it |
|---|---|---|
| **W11-2** | A native `SpawnSession` completes a real ticket end to end, producing a Completion Manifest the close gate accepts | `T-1: landed` on stdout, and the ticket reaches `in_review` |
| **W11-3** | Every call is metered — spend is non-zero and attributable per role | The ledger shows real dollars. Before W12-11 it read `$0` even on a paid API |

---

## 1. Seed a scratch project

```sh
pnpm exec tsx scripts/supervised-run/seed.ts /tmp/dokima-run
```

One ticket, `T-1`: implement `subtract(a, b)` in `src/math.mjs`.

It is **genuinely red before the run** — `node src/check.mjs` prints
`subtract is not implemented` and exits 1 — so nothing can pass without the
agent doing real work, and the close gate re-runs that same command
out-of-session (SC-02) rather than trusting what the agent says.

## 2. Point it at a model

**OpenAI** (recommended for the first run — it removes model capability as a
variable, so a failure is Dokima's fault, not a small model's):

```sh
export DOKIMA_MODEL_BASE_URL=https://api.openai.com/v1
export DOKIMA_MODEL_API_KEY=sk-...
export DOKIMA_MODEL_ID=gpt-5
export DOKIMA_SIGNING_KEY=supervised-run-key
```

**Local (LM Studio)** — the configuration C-1 guarantees, and the one W11-2 is
actually written against. Worth doing second, once the loop is known to work:

```sh
export DOKIMA_MODEL_BASE_URL=http://127.0.0.1:1234/v1
export DOKIMA_MODEL_ID=<whatever LM Studio is serving>
export DOKIMA_SIGNING_KEY=supervised-run-key
```

`DOKIMA_SIGNING_KEY` is not optional: `executeBuildRun` refuses (exit 2) rather
than let the close gate mint receipts that verify against nothing.

## 3. Run it

```sh
cd /tmp/dokima-run
node /Users/bmatthews/Code/shipwright/apps/server/src/bootstrap/cli-entry.mjs \
  run start --mode new_product
```

Watch it. Do not walk away — that is the point of the word *supervised*.

## 4. What to check afterwards

```sh
# Did the agent actually do the work?
node src/check.mjs && git -C /tmp/dokima-run log --oneline

# Where did the ticket land?
node .../cli-entry.mjs board --db /tmp/dokima-run/.dokima/state.db
```

| Check | Pass looks like | If it fails |
|---|---|---|
| **Packed context** (W12-04) | The prompt carried `PROJECT INVARIANTS` and a `REPO MAP`, not just the title | The packer is wired but not reaching this path |
| **Tool anchor** (W12-05) | After a failed `verify`, later turns still carry `External anchor facts` | Ground truth is scrolling out of the window — the thing W12-05 exists to stop |
| **Spend metered** (W11-3) | Ledger cost is **non-zero** on a paid model | Pricing did not resolve; the breakers cannot fire (this was the pre-W12-11 state) |
| **Close gate** (W11-2) | `T-1: landed`, ticket in `in_review` | Read the refusal — it names what was missing |
| **Maker ≠ verifier** (C-4) | The ticket stops at `in_review`, NOT `done` | If it self-accepted, that is a serious finding |

**`in_review` is the correct end state, not a failure.** The loop is the maker
and may not accept its own work; a distinct reviewer identity moves it to
`done`. If it reaches `done` on its own, stop and report that — it means the
maker≠verifier construction has a hole.

## 5. Expect it to fail somewhere, and capture where

Every component this touches had an unwired seam discovered in the last few
days — the packer had no caller, the anchor had no caller, the escalation
policy was read by nothing, three copies of the adapter dispatch disagreed.
Each is fixed, and none has run together against a real model.

**A failure here is the most valuable output available**, so capture it rather
than working around it: the exact stderr, which of the five checks above got
furthest, and whether the ticket moved on the board. That is enough to file a
ticket that a later session can act on without re-deriving anything.

## 6. Cost

A single small ticket on a frontier model is cents. The per-ticket cost cap
(`maxTicketCostUsd`) and W2-07's breakers are live and now read real prices —
but note the ledger is the only thing that will tell you, so **watch the
provider's own dashboard on the first run** as an independent check that
metering matches reality.
