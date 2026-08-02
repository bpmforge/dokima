# RELEASE BLOCKER — the content-signing private key is in pushed git history

**Found:** 2026-08-02, during the pre-public "history secrets scan" checklist
item (docs/RELEASE_TRACKER.md).
**Severity:** CRITICAL. **Status: REMEDIATED 2026-08-02** — founder authorized
both rotation and history purge. Outcome in §Remediation performed.

> **Commit hashes in this document are pre-rewrite and no longer resolve.**
> `1039ff0` and every commit after it were rewritten by the purge. They are
> kept as the historical record of what was found; `git show 1039ff0` now
> correctly fails with "invalid object name".

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

## Scope of the trust root — bounded, and smaller than feared

Everything that verifies against this keypair, traced through every non-test
caller of `loadPublicKey` / `verifyManifestSignature`:

- `packages/validators/src/signing/loader.ts` — the content-pack loader
- `apps/server/src/bootstrap/packs-update.ts` — `shipwright packs update` and
  `doctor`'s `pack-signatures` check

**Content packs only.** Export bundles, receipts, the event hash-chain, and the
plan catalog do **not** chain to this key — they have their own integrity
mechanisms. So rotation is one artifact: regenerate the pair, re-sign
`content/manifest.json`, ship the new public key.

Confirmed on the remote, not inferred from a stale fetch:
`git merge-base --is-ancestor 1039ff0 <github/main head 1445da0>` → **yes**.
The leaked commit is in GitHub's published `main`.

Note `49f7861` ("key provisioning compliance — move public key to content/keys,
read private key from env") — a real compliance fix that moved the private key
out of the tree and into an env var. It did not, and could not, purge history.

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

## Remediation performed (2026-08-02)

Founder authorized **rotate + rewrite**. Both executed; a verified
`git bundle --all` of the pre-rewrite repo was taken first.

**1. Key rotated.** New Ed25519 pair; private key at `~/.shipwright/keys/`
(0600, outside the repo). `content/manifest.json` re-signed over 79 validators;
new public key `MCowBQYDK2VwAyEAOXXhyzPZOTboivn24fZ3FJr8fBtqh2jfPGeZX20eAxs=`
shipped. Proven the rotation *killed* the old key rather than merely replacing
it:

```
old key still matches shipped pubkey: false
LEAKED KEY CAN STILL FORGE:          false
```

and the product's own verifiers accept the new signature — `doctor` reports
`[OK] pack-signatures: manifest + all file hashes verified`, `packs update`
reports `79 file(s) verified + installed`.

**The old public key `…R14nxPmYOSZ+z9fwpphGsgTmJbTU0rGSVD9su/1AcSI=` is
permanently distrusted.** Any content still signed by it is untrusted.

**2. History purged.** `git filter-repo --invert-paths --path .keys/`.

A completeness trap worth recording: three branches
(`fix/conductor-migration-collision-lint`, `fix/conductor-node-pin-portability`,
`review/design-review-hardening`) existed **only on the remotes**, with no local
counterpart. A naive rewrite of local branches would have purged `main` while
leaving the key alive on those. All were localized first, so the purge covered
all six branches. Both remotes were confirmed byte-identical per branch
beforehand. No tags existed.

Verification after the purge:

| Check | Result |
|---|---|
| `git log --all -- .keys/` | empty |
| `git rev-list --all --objects \| grep .keys` | no reachable object |
| `git show 1039ff0:.keys/shipwright-private.pem` | `fatal: invalid object name` |
| `gitleaks` full history | 22 → **21**; the only remaining `private-key` finding is `secrets-scan-validator.test.ts`, a fixture |
| `git fsck` | clean |
| commits preserved | 887 (none lost) |
| Gate | lint 0 errors · typecheck clean · **2883 passed / 3 skipped (400 files)** · **58 e2e passed** |

**What the rewrite does not undo:** anyone who cloned, forked, or CI-cached the
repo before 2026-08-02 still holds the old key. That is precisely why rotation —
not the rewrite — is the control that matters. The rewrite removes the artifact;
rotation removes its value.

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
