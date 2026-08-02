# W4-11 — token-delivery residual evaluation (THREAT_MODEL §5.6)

Ticket W4-11's acceptance criterion 4 asks to "evaluate same-origin-only
injection or WS-handshake token delivery so a loopback-local process cannot
harvest the operator bearer from index.html" (residual T-19, found at the
W4-02 review, 2026-07-15). This is the evaluation; the recommended change
lands as a HANDOFF against `apps/server/src/api/server.ts`, which is outside
this ticket's write_scope (see `plan.json`'s W4-11 notes).

## The residual, precisely

`server.ts`'s `injectToken()` writes `window.__DOKIMA_TOKEN__ = "<token>"`
into every served `index.html` response, unconditionally — static assets are
intentionally unauthenticated (the SPA shell must load before it has a
token). Any process on the operator's machine that can reach
`127.0.0.1:<port>` (including an agent session whose sandbox permits
loopback, per SC-07's residual) can `curl`/`fetch` `/` and read the token
out of the HTML, without ever touching the 0600 `~/.dokima/token` file.
The Host/Origin allowlist (SC-08) does **not** help here: a same-machine
`curl` or `fetch(..., {mode: 'no-cors'})` can omit `Origin` entirely (the
allowlist treats a missing Origin as same-machine-tool-friendly, per
`allowlist.ts`'s documented tradeoff), and `Host: 127.0.0.1:<port>` is
trivial for any local process to set correctly.

## Options considered

### A — Same-origin-only injection (fetch the shell via an authenticated XHR)

Instead of embedding the token in the initially-served `index.html`, serve a
token-free shell and have the SPA's bootstrap script fetch a small
`/api/v1/session` (or similar) endpoint that returns the token, gated behind
the *existing* bearer-token auth hook — which doesn't help, because the
bootstrap script has no token yet to authenticate that call (chicken-and-egg,
same reason the static assets are unauthenticated today).

The actually-workable version of "A": gate the token-bearing response on
`Sec-Fetch-Site` / `Sec-Fetch-Mode` request headers (sent automatically by
browsers on `fetch`/`XHR`/navigation since ~2023, absent from `curl` and most
non-browser HTTP clients) plus the existing Origin check. A same-machine
`curl` can still forge these headers, but doing so requires deliberate,
specific effort — this raises the bar from "any process that shells out to
curl" to "an attacker who specifically read this threat model," which is the
same class of mitigation SC-08's Origin check already relies on (Origin is
also forgeable by a sufficiently motivated local process; the control's
value is against opportunistic/careless local processes, not a
root-capable attacker, which THREAT_MODEL §5's residual risk statement #4
already accepts as out of scope for v1 single-operator). This is cheap
(no new endpoint, no protocol change) but only a partial mitigation.

### B — WS-handshake token delivery

Never embed the token in HTML at all. The SPA's bootstrap makes its **first**
authenticated call over the WS upgrade (or the new SSE fallback's `?token=`
query param, already supported by `extractBearerToken`), which already
requires the token — but the SPA still needs the token from *somewhere* to
open that connection. This doesn't solve the bootstrap problem; it relocates
it. The only way this closes the residual is if the token is provisioned to
the browser through a channel `curl` can't casually replicate — e.g., a
one-time-use short-lived exchange code minted by a local CLI command
(`dokima open`) that launches the browser with the code in the URL
fragment (never sent to the server, per URL-fragment semantics), which the
SPA then exchanges once for the real token over an authenticated call. This
is the strongest mitigation but is a real feature (new CLI command, new
exchange endpoint, fragment-based handoff, token rotation on exchange) —
out of proportion to a "mechanics" ticket and not achievable inside this
ticket's write_scope regardless (touches `server.ts`, the CLI, and likely
`apps/web`'s bootstrap).

### C — Do nothing beyond documenting

Already accepted as the v1 baseline per THREAT_MODEL §5's residual risk
statement #4 ("root-capable local attacker owns everything... is out of
scope; keychain + file perms are the practical bar for v1 single-operator").
The gap here is narrower than root-capable — it's "any unsandboxed local
process," which is exactly why the W4-02 review flagged it as a distinct,
addressable residual rather than folding it into #4.

## Recommendation

Ship **A** (Sec-Fetch-Site/Sec-Fetch-Mode + Origin gating on the token
injection) as the pragmatic W4-4-series follow-up — it's a same-file,
few-line change to `injectToken`'s caller in `server.ts`, raises the bar
against exactly the opportunistic-local-process threat SC-08 already
targets, and requires no new protocol or CLI surface. Track **B** (CLI-driven
one-time exchange code) as a v1.x hardening item if the residual's severity
is later re-rated — it's the complete fix but is a feature, not a
one-ticket patch.

**HANDOFF** (2026-07-18, write_scope now includes `server.ts` — the app-shell
seam fix widened it for the openapi/SSE route registration this ticket also
needed): option A's gate would need `apps/web/e2e/settings.spec.ts` and
`notifications.spec.ts` updated too — both bootstrap their own token via a
bare `request.newContext().get('/')` (Playwright's APIRequestContext, not a
real browser navigation), which sends no `Sec-Fetch-*` headers and would be
rejected by the gate exactly like the curl attacker it's meant to stop. Both
spec files sit outside this ticket's `write_scope`. Implementing option A
here would either silently break that e2e bootstrap pattern or require an
out-of-scope edit to fix it — deferred to a ticket that owns both
`server.ts` and `apps/web/e2e/**` together (or one that first gives the e2e
bootstrap an in-scope, Sec-Fetch-Mode-carrying way to fetch the token).
