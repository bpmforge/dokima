# RELEASE BLOCKER — the content-signing private key is in pushed git history

**Found:** 2026-08-02, during the pre-public "history secrets scan" checklist
item (docs/RELEASE_TRACKER.md).
**Severity:** CRITICAL. **Status:** unremediated — remediation is a founder
decision (it touches two pushed remotes).

---

## The finding

`.keys/shipwright-private.pem` — the Ed25519 **private** key for first-party
content-pack signing — was committed in `1039ff0` ("feat(W6-07): content pack
signing + deny-by-default license gating", 2026-07-20) and is fully
extractable from history today.

It is not in the current working tree, and `.gitignore:19` now excludes
`.keys/`. **Both of those happened after the commit, and neither removes it
from history.**

## Why it matters — proven, not asserted

The shipped public key `content/keys/shipwright-public.pem` is
`MCowBQYDK2VwAyEAR14nxPmYOSZ+z9fwpphGsgTmJbTU0rGSVD9su/1AcSI=`.

Verified in a scratch dir (key material deleted immediately after):

```
derived public key matches SHIPPED public key: true
forged signature over real manifest verifies against shipped pubkey: true
```

That is, the leaked private key derives *exactly* the public key the product
ships, and a signature minted with it over the real `content/manifest.json`
verifies against that shipped public key.

**Consequence:** anyone who has cloned this repo can sign an arbitrary content
pack — arbitrary expert prompts and arbitrary validator shell scripts — and
`packages/validators`' loader will accept it as verified first-party content.
W6-07's entire deny-by-default signing model (R-E1) is defeated, and validators
are shell scripts the product executes.

This also violates CLAUDE.md Law 8 ("Secrets never in code, settings files,
prompts, or the event log").

## Blast radius

`git branch -a --contains 1039ff0` reports the commit on:

- `main`
- `remotes/github/main` — **GitHub**
- `remotes/origin/*` — Gitea

Treat the key as **public**. It has been pushed to a hosted remote; whether
that remote is private is not a control you can rely on retroactively (forks,
clones, CI caches, local copies).

## Remediation — founder decision required

Two independent actions. **(1) is mandatory and sufficient for future safety;
(2) is about the historical artifact and is destructive.**

**1. Rotate the signing key (do this regardless).**
   - Generate a new Ed25519 pair with `scripts/sign-content.mjs`, writing the
     private key somewhere that is not the repo.
   - Re-sign `content/manifest.json`; ship the new
     `content/keys/shipwright-public.pem`.
   - The old public key must be permanently distrusted — not merely replaced.
     Anything still signed by it is untrusted.
   - **Sequencing note:** this collides with W10-02/03 (the content re-import,
     which also re-signs) and with W9-08 (whose write_scope includes
     `content/manifest.json`). Rotating first and re-importing second means one
     re-sign, not three.

**2. Purge from history — optional, destructive, and NOT to be done unilaterally.**
   `git filter-repo` / BFG over both remotes rewrites every commit hash from
   `1039ff0` forward, breaks every clone and open branch, and does not recall
   copies anyone already has. Given (1) makes the key worthless, the honest
   default is: **rotate, do not rewrite**, and record the leak here rather than
   pretend it did not happen. Rewrite only if a policy requires it.

## Why the existing controls did not catch this

`content/validators/secrets-scan.sh` (W3-13, SC-06) is a **close-gate scanner
over the project tree** — it scans the working tree, not git history. The key
was gitignored and removed from the tree, so a tree scan is clean while history
is not. That is a real gap in the control, not an operator error.

**Follow-up ticket worth filing:** add a history-scanning pass (gitleaks is
already on this machine and took 591ms over 759 commits) to the release gate,
so "clean tree" can never again be mistaken for "clean repo."

## The other 21 gitleaks findings — triaged, all benign

| Count | File | Verdict |
|---|---|---|
| 4 | `packages/shared/src/secrets/redact.test.ts` | test fixtures for the redactor |
| 3 | `packages/gateway/src/providers/copilot-fixtures.ts` | recorded provider fixtures |
| 3 | `packages/shared/src/secrets/secrets-scan-validator.test.ts` | fixtures for the scanner's own tests |
| 4 | `packages/shared/src/config/settings-files.test.ts` | proves the settings layer *refuses* secret-shaped values |
| 3 | `apps/server/src/api/pipeline/**` tests | fixtures |
| 4 | loop/validators tests, `copilot-types.ts`, `OWASP_LLM_METHODOLOGY.md` | fixtures + documentation |

A secrets scanner needs fake secrets to test against; these are that. **One
finding of 22 was real, and it was the one that mattered.**
