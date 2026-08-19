# The provider/auth plugin seam

**Ticket:** W12-27 · **Decides:** the trust model D-026 deferred to this ticket
· **Status:** design + type surface. No loader ships yet, deliberately (§7).

## 1. Why this exists

D-026 decided that subscription sign-in never ships in core. Verified against
live sources rather than memory: **Anthropic banned third-party use of Claude
Free/Pro/Max OAuth in February 2026** and named opencode as no longer
permitted; **OpenAI's "Sign in with ChatGPT"** is for OpenAI's own Codex CLI
under Terms that prohibit programmatic use. Shipping the button would move that
exposure onto this product and onto every user of it.

The architectural lesson taken from opencode is **the seam, not the flow**: its
core does not ship subscription auth either. A hook plus a loader returning a
custom `fetch()` lets a separate package do it, so the exposure sits with
whoever installed one.

## 2. The bill D-026 handed this ticket

D-026 stated the cost plainly, and it cuts against this product's thesis:

> a plugin seam is an arbitrary-code-execution surface with credential access,
> inside a product whose identity is C-2/C-3 — agent sessions are untrusted and
> the platform holds the gates.

**"We hold the gates" must not quietly become "except for plugins."** Shipping
the seam without answering this would trade a legal risk for a security one.

## 3. Decision: capability scoping + ledgered consent, and no signature

Three parts, in the order they bind.

### 3.1 Capability scoping — structural (the load-bearing one)

A plugin declares exactly one `providerId` and receives a `PluginContext`, not
a `CredentialStore`. The context closes over the refs bound to that one entry
and refuses every other by construction.

This is the same shape C-4 uses for maker/verifier distinctness: the boundary
holds because **the plugin is never handed the wider object**, not because it is
asked not to look. `CredentialStore.get(ref)` spans the whole vault, so passing
it would let a plugin installed for Claude read the OpenAI key.

Two details that are decisions, not incidentals:

- **A refusal is identical whether the ref exists or not.** Otherwise a plugin
  enumerates the vault by probing and reading the difference.
- **The store is never consulted on a refused ref.** A refusal that still
  performed the read leaks through timing and through the store's own audit
  trail.

Both are asserted in `plugins/types.test.ts`, not just described here.

### 3.2 Ledgered install-time consent — the D-019 shape

Enabling a plugin requires an explicit acknowledgement recorded as an event,
exactly as Copilot does under D-019, and for the same reason: the user is
accepting a risk that is theirs to accept, and there must be a durable record
that they did. The prompt names the plugin, the provider entry it will act for,
and that it is third-party code with access to that entry's credentials.

Default-off. A plugin that is installed but not consented does not load.

### 3.3 No signature requirement — and this one is a real choice

**Rejected: requiring signed plugins in the `content/` pack shape.** The
machinery exists (`packages/validators/src/signing`) and reusing it was the
obvious move. It is the wrong move here, for a reason specific to what this
seam is for:

A signature answers "did the author I trust produce this?" — which requires
somebody to decide which authors are trusted. That somebody would be Dokima,
via a key it controls. But **the entire purpose of the seam is that the ToS
exposure is NOT Dokima's**. Signing a Claude-subscription plugin is an
endorsement of precisely the use Anthropic prohibits, made by the party that
D-026 exists to keep out of it. It would convert a user's own decision back
into the product's.

Content packs are different and the contrast is the argument: those are
*curated library content this product distributes*, so vouching for them is
honest. A plugin is *the user's own extension of their own install*.

**Reserved, not discarded.** `ProviderAuthPlugin` carries a stable `id`, so if
an ecosystem ever appears where signing means something other than
endorsement-of-a-ToS-violation, a manifest can be added without a breaking
change.

## 4. What a plugin may do

One method: `authorize(ctx, inner) => fetch`. It decorates the call; it never
becomes the provider.

Called **once per provider construction, never per request** — otherwise a
plugin becomes a per-request interceptor of traffic it has no business seeing,
including traffic for turns it did not authenticate.

## 5. Failure modes, and the one rule that matters

`authorize` can throw, hang, or return a non-fetch. All three collapse to
`PluginFailedError`, so a caller has two cases rather than five. A hang is
bounded at 30s: it is the only failure a caller cannot tell apart from work.

**There is no fallback to the un-decorated `fetch`.** This is the rule the
whole seam rests on. Falling back would silently turn a failed subscription
login into an unauthenticated request against the vendor's endpoint — the
account-suspension risk D-019 already gates Copilot for, wearing the costume of
resilience. A failed plugin means the provider is unavailable, and FR-G5's rule
applies: degrade honestly, never silently.

## 6. What this does NOT do

- No loading, discovery, sandboxing or `node_modules` resolution.
- No plugin ships in this repository, and none should.
- Nothing calls this yet. That is intentional, not an oversight — see §7.

## 7. Why no loader, stated plainly

This repository has produced fourteen mechanisms that landed complete, tested,
and with no production caller. Adding a fifteenth on purpose deserves an
explicit reason.

The reason is that the risky, hard-to-reverse half of this feature is the
**loader** — process boundaries, `require` semantics, what happens when a
plugin depends on a different version of a package the core already loaded —
and none of that changes the trust decision above. Deciding the boundary while
there are zero plugins costs a design ticket; discovering it is wrong after a
loader ships costs a breaking change to something users have installed.

**A loader must not be built until there is a concrete plugin to load.** When
there is, the acceptance for that ticket starts here. Filed as **W12-44**.

### 7.1 What the ratchet decided for us

`createPluginContext` and `authorizeWithPlugin` were written and tested during
this ticket, and then withheld. `validate-exports` refused them — buried
73 → 75 — because they had no caller and would not have one until a loader
exists, and the ratchet's own rule is that the baseline is never raised to make
a change pass.

It was right, and the excuse was a good one, which is the point: this
repository has produced fourteen mechanisms that landed complete, tested and
unreachable, and every one of them had a good excuse at the time. Their
specified behaviour is §3.1 and §5 above, which is enough to build them from
on the commit that gives them a caller.
