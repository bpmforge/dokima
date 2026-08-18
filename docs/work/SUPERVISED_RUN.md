# Supervised run — W11 exit criteria 2 and 3

**Status: never performed.** This is the one claim the product rests on and the
only thing on the list that cannot be done unattended.

*Document refreshed 2026-08-18. Three things it previously told you were wrong:
two "known gaps" (W12-19's provider list, W12-20's missing run trigger) have
since closed, and the wizard now offers five model-policy choices, not four.
Both gaps are rewritten below rather than deleted, because knowing they were
recently true tells you which paths are newest and therefore least exercised.*

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
cd ~/Code/shipwright
pnpm build          # REQUIRED — cli-entry.mjs prefers apps/server/dist/main.js,
                    # so a stale bundle silently runs old code
pnpm exec tsx scripts/supervised-run/seed.ts /tmp/dokima-run
```

One ticket, `T-1`: implement `subtract(a, b)` in `src/math.mjs`.

It is **genuinely red before the run** — `node src/check.mjs` prints
`subtract is not implemented` and exits 1 — so nothing can pass without the
agent doing real work, and the close gate re-runs that same command
out-of-session (SC-02) rather than trusting what the agent says.

## 2. Configure the model IN THE GUI (not env vars)

**Use the product's own surfaces.** `resolveModelTarget` prefers the registry
over environment variables, so a GUI-registered provider is what a real user
gets — and it is the only path that exercises what W12-11 built: the
first-party `openai`/`anthropic` adapters, `credentialRef` → keychain
resolution, and real per-model pricing. The env vars go through generic
`oai-compat` instead and skip all three.

> **Node 22 is required in every terminal you use.** `fnm`'s default is 24 and
> the `better-sqlite3` binary is built for 22, so a fresh tab fails with a raw
> `NODE_MODULE_VERSION 127 ... requires 137` error that names neither Dokima
> nor the fix. Run `fnm use 22` first; `node -v` must print v22.x. (W12-24
> turns that into a named refusal.)

```sh
fnm use 22
cd /tmp/dokima-run
node ~/Code/shipwright/apps/server/src/bootstrap/cli-entry.mjs
```

That boots the core and opens the Canvas at <http://127.0.0.1:4317>. Then:

1. **Settings → Providers → Add.** Choose kind **OpenAI** (or Anthropic).
   Paste the API key — it is exchanged for a keychain ref through
   `POST /providers/credentials` and the secret itself never touches
   `settings.json` or the event log (Law 8, FR-S2).
2. **Optionally** — Settings → Run Setup Wizard, to pick how work is modelled.
   Five choices (D-024): local only · start cheap and escalate · escalate only
   when I approve · always use my best cloud model · **use one model I pick**.
   Since W12-18 this choice actually governs the run. The fifth arrived with
   W12-16/W12-37 and is the one to use if you want this run pinned to exactly
   one model with no escalation — it also asks for the model id on the provider
   step. **The wizard is not required and never has been** — it only opens when
   you ask for it, and it has a Cancel. Skip it and the run takes the documented
   `ladder` default. (An earlier draft of this document framed it as a mandatory
   step; that was this document's error, not the product's.)
3. Set only the signing key, which has no GUI surface yet:

```sh
export DOKIMA_SIGNING_KEY=supervised-run-key
```

> **Do not set `DOKIMA_MODEL_*`.** They are the documented CI path and they
> lose to the registry anyway; setting them would mean testing the wrong path
> and getting a falsely reassuring result.

Either surface works: **W12-19 closed the gap** that used to make this a
caveat. The wizard's provider step now reads the same `PROVIDER_KINDS` list the
Providers panel does — all seven kinds, Ollama through Copilot — so registering
OpenAI in the wizard and registering it in the panel are the same operation.

## 3. Start the run

**W12-20 closed the gap** this section used to warn about. There are now two
ways in, and the GUI one is what a real user gets:

**From the Canvas (preferred).** Open the project's board and use its
**Start run** control. It posts to `POST /api/v1/projects/:id/build-runs`,
returns a run id, and then polls status so you watch progress in the surface
you configured everything else in. Prefer this path — it is the one that
exercises what a user actually touches.

**From the CLI**, if you want the raw stderr stream in front of you:

```sh
cd /tmp/dokima-run
node ~/Code/shipwright/apps/server/src/bootstrap/cli-entry.mjs run start --mode new_product
```

The CLI is better for capturing a failure verbatim; the Canvas is better for
testing what ships. On a first supervised run, the CLI's unfiltered output is
worth more — take that one, and check the board afterwards.

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
