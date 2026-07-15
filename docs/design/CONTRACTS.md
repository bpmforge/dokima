# Plug-in surface contracts (NFR-5) — provider · forge · validator · expert pack

**Status:** design (design review R-E2, 2026-07-14). One page per surface; each contract is the *entire* coupling — anything not listed here is private and may change without notice. Cited by NFR-5; enforced by the conformance/contract test suites named per section.

## 1. Model provider adapter (packages/gateway)

Implements `Provider`: `chat(req) → ChatResponse` (normalized usage: tokens in/out, cost via price table — missing usage THROWS, local = $0 metered), `chatStream(req)` (W2-09: delta events + final normalized response, identical metering), `listModels()`, `getContextLength(model)`, `health()`, `warmUp()`, `queueStats()`. Errors classify to the typed set (`ProviderAuthError | ProviderRateLimitError(retryAfter?) | ProviderTimeoutError | ProviderUnreachableError | ProviderHttpError`) — the gateway's limit resilience (FR-G8) and ladder depend on the classification, not on message text. Credentials arrive pre-resolved (the adapter never touches a keychain — FR-S2). **Proof:** the recorded-fixture contract suite (auth-failure, rate-limit, truncation, stream-abort, mid-stream error, chunk reassembly) passes; no network in CI.

## 2. Forge adapter (packages/forge)

Capability-declared interface: `capabilities() → {prs, issues, protection, statuses}` (generic-git returns all false and degrades to local merge); `repoOps`, `branchProtection(rules)`, `prLifecycle`, `issueMirror` (verbs → mapped actions under the correct machine identity), `commitStatus`, `identity/token management` (two scoped identities; reviewer token never leaves the Harbormaster — SC-03). Offline behavior is the adapter's contract too: verbs queue (order-preserving) and flush; reconciliation reports two-way drift. **Proof:** one contract suite runs against GitHub + Gitea fixtures; parity validator red on induced divergence.

## 3. Validator executable (content/validators + user packs)

Any executable: exit **0** (pass) / **1** (findings) with a JSON gap list on stdout `[{name?, file?, line?, issue, severity?}]`; anything else (timeout, non-{0,1} exit, unparseable stdout) is a **validator failure, never a silent pass** (W1-02). Runs sandboxed (SC-07): timeout, scoped cwd, cleaned env, no network by default. Metadata (D-014): `{id, class, severity, provenance{source, license — REQUIRED, deny-by-default}, fixtures{trigger[], clean[]}}` — no fixtures, no merge; lifecycle state lives in `rule_state`, never inside the pack. **Proof:** red fixtures fail when they should; the planted-defect harness includes a misbehaving-validator case.

## 4. Expert pack (content/experts + user packs)

Markdown + minimal frontmatter (`description`, `mode: primary|subagent|all`, optional `disable`, `metadata`) — **no model ids** (pin roles, not models: a hardcoded frontier model id fails import, FR-E2), no tools grants (tool access comes from the per-role allowlist matrix — SC-12), no code (`content/` is data; the loader never evals — law 6). Optional instruction-cost metadata (FR-L8) recorded at import. Packs carry a manifest (files, hashes, publisher signature — SC-09/W6-07); unsigned installs only behind `--allow-unsigned` with a permanent badge; license field required, deny-by-default beyond MIT/Apache-2.0/BSD/first-party (R-E1). **Proof:** fixture third-party pack loads without core changes and is dispatchable via HANDOFF; tampered pack refused.
