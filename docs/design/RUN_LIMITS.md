# What can stop a run

**W13-14, 2026-08-19.** Seven limits can end a run or an attempt. Each one is
deliberate; until this file they were only visible in source, so "why did it
stop?" had no answer you could look up.

**None of these are a single clock.** Nothing in Dokima counts total elapsed
time for a run and kills it. What exists is a set of *specific* bounds on
*specific* things — one request, one command, one session's tool turns, one
ticket's attempts — and each says which it was when it fires.

## Find it by what you saw

| The message you got | The limit | Where |
|---|---|---|
| `request timed out after 300000ms` | Request timeout | provider |
| `exceeded the per-session tool-iteration budget` | Tool-turn cap | session |
| `ladder attempt cap (2) reached without a close` | Attempt cap | ticket |
| `provider failure: …` | Any provider error, absorbed (W13-13) | attempt |

## The limits

### One model request

| Provider kind | Timeout | |
|---|---|---|
| `oai-compat`, `lm-studio`, `ollama` | **300s** | local |
| `anthropic`, `openai`, `copilot`, `vertex` | **60s** | hosted |

**The 5× difference is deliberate, not drift.** A 27B model on local hardware
genuinely takes minutes for one call — measured at over 300s in live testing,
which is what W13-13 was filed for. A hosted endpoint that has not answered in
60s is not slow, it is broken, and waiting five minutes to say so helps nobody.

Health checks are **5s** everywhere: a probe that needs longer has answered the
question it was asked.

Configurable per provider entry (`requestTimeoutMs`).

### One command

| | Timeout | |
|---|---|---|
| The ticket's `verify` | **10 minutes** | a real test suite is allowed to be slow |
| One validator | **30s** | a validator that needs longer is doing the wrong job |

### One session

**Tool turns: 12 by default, ceiling 40.** How many times the model may call a
tool before the session ends without a manifest. It exists for T-27 — a session
that iterates forever, spending money and producing nothing. Configurable with
the `maxToolIterations` project setting (W13-11); the ceiling is not, because a
setting that accepts any value re-opens the failure the cap prevents.

*12 is right for a capable model* — a landing run used four. A chattier local
model may need more, and that is what the setting is for.

### One ticket

**Attempts: 2 by default** (`ladder`). After the last one the ticket parks with
evidence naming every attempt. The ceiling depends on the escalation policy
(D-018): `locked` uses the convergence ceiling — **8** on a metered tier, **12**
on local, because retrying on owned hardware costs time and retrying on a
metered one costs money.

## Rules

**Every limit names itself when it fires.** If you ever see a run stop without
knowing which of these did it, that is a bug — the point of having seven bounds
instead of one clock is that each failure tells you what to change.

**A provider failure is an attempt, not a crash** (W13-13). A timeout ends the
attempt the way any other failed attempt ends; it does not kill the run.

**These values are not tuned here.** Each was chosen against a measurement
recorded in its own source comment. Changing one is a behaviour change and
belongs in a ticket that can prove the new value.
