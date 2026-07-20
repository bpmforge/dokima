# Security pass — wave W6 (2026-07-20T20:39:29.595Z)

```json
{
  "critical": [
    {
      "file": ".keys/shipwright-private.pem",
      "issue": "This diff's W6-07 notes flag an out-of-scope edit touching .keys/shipwright-private.pem and .keys/shipwright-public.pem. Verified by inspecting git history: commit 6740a60 on branch blocked/w6-07-2026-07-20T2014 ('feat(W6-07): content pack signing + deny-by-default license gating') actually committed a real Ed25519 PEM private key in plaintext to the repository, alongside its public counterpart and a signed content/manifest.json. This is a live signing key checked into version control — the exact class of hardcoded secret CLAUDE.md law 8 ('Secrets never in code, settings files, prompts, or the event log') prohibits. The key material persists in the git object database even though the branch is currently local-only and the ticket is blocked; if the branch is ever merged, rebased into main, or the objects are pushed/gc'd late, the private key becomes part of shared/public history.",
      "fix": "Rotate the Ed25519 keypair immediately (treat the committed key as compromised). Purge the blob from all local branches/reflog with git filter-repo or BFG before any push. Change scripts/sign-content.mjs to read the private key from an external secret store (OS keychain / env var injected at sign-time, consistent with how other credentials in this repo are resolved per law 8) rather than writing key files into the tracked tree. Add .keys/ (or wherever generated keys land) to .gitignore, and add a pre-commit/secrets-scan guard for PEM headers so this can't recur."
    }
  ],
  "high": [
    {
      "file": "content/validators/validate-remote-parity.sh",
      "issue": "Per the 2026-07-20T20:38 CONDUCTOR note (empirically verified in-repo: 2 remotes configured, zero cached refs/remotes tracking refs for the working branch), the parity validator's gap-detection logic treats an uncached/never-fetched remote-tracking ref the same as a genuine SHA divergence. This makes runCloseGate fail unconditionally for every real ticket close in this project's actual dual-remote setup (origin=Gitea + github=GitHub per CLAUDE.md law 10), not just the intended 'diverged remote' red state — i.e., the hygiene check itself becomes a denial-of-service on the legitimate close/receipt workflow once wired into DEFAULT_REQUIRED_VALIDATORS.",
      "fix": "Special-case 'no tracking ref cached for this branch yet' (e.g., first close after a fresh clone/branch, or before a fetch) as a distinct non-blocking state, and only treat an actual local-vs-remote SHA mismatch on an already-tracked ref as the red/blocking condition. Add a fixture that mirrors the real repo shape (2 remotes, untracked branch) to the red-fixture harness so this regression is caught before merge."
    },
    {
      "file": "packages/validators/package.json",
      "issue": "The same W6-07 CONDUCTOR note lists packages/validators/package.json as an out-of-scope edit accompanying the signing/license-gating feature, but its contents are not shown in this diff. A dependency or script change riding along with new Ed25519 signing/verification code (and a key-generation script) is exactly the kind of unreviewed supply-chain change that should be scrutinized before merge.",
      "fix": "Surface the actual package.json diff (new deps added, versions bumped) for review; run pnpm audit and confirm the lockfile matches, per project law 2 (verify external APIs/deps against docs/TECH_STACK.md before use, record upgrades)."
    }
  ],
  "medium": [
    {
      "file": "plan.json",
      "issue": "Ticket status transitions (todo→blocked) and CONDUCTOR/RESET/SCOPE-FIX notes are written directly into plan.json by the conductor/maker tooling, as shown throughout this diff. If this file is the authoritative ticket-state record and its writes are not themselves gated through the verbs/receipts API described in law 4 ('every durable state change goes through the verbs/receipts APIs... never let a component verify its own output'), any process with filesystem write access could flip ticket status without a corresponding receipt.",
      "fix": "Confirm plan.json mutations are produced only by the receipt-issuing conductor path (not directly editable by an agent session) and are mirrored into or derived from the append-only events log per law 7; if there's a direct-write path, gate it behind the same verb/receipt mechanism."
    }
  ],
  "notes": "This diff itself modifies only plan.json (ticket status + notes) — no application source (child_process/git-spawning code, HTTP handlers, deserialization paths) was changed here, so most requested OWASP/injection/deserialization categories have nothing new to review in the diff proper. However, the diff's own note text explicitly names two out-of-scope files (.keys/shipwright-private.pem, .keys/shipwright-public.pem) for ticket W6-07, which warranted checking git history — that check confirmed a real private key was committed in commit 6740a60 (branch blocked/w6-07-2026-07-20T2014), reported above as critical. The W6-05 notes similarly reference a real, empirically-verified close-gate DoS bug in content/validators/validate-remote-parity.sh (not itself in this diff, but described as verified in-worktree), reported above as high. Neither underlying file's actual diff was available for direct line-level review — findings here are based on the plan.json note text plus independent git-history verification; recommend re-auditing once the actual code diffs for W6-05/W6-07 are available."
}
```
