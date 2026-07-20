# Security pass — wave W7 (2026-07-20T22:00:33.253Z)

```json
{
  "critical": [],
  "high": [],
  "medium": [
    {
      "file": "plan.json",
      "issue": "W6-07 acceptance/scope now includes content/keys/shipwright-public.pem and packages/validators/package.json, but this diff contains only the plan.json ticket metadata — the actual .pem file contents and the new dependency are not shown, so it cannot be verified here that only a public key was committed (no private key) or that the new signing dependency is legitimate/pinned.",
      "fix": "When the follow-up implementation commit for W6-07 lands, diff-review content/keys/shipwright-public.pem to confirm it is PEM public-key material only, confirm .gitignore actually excludes .keys/**/*private*, and run a dependency audit on whatever package packages/validators/package.json adds before merge."
    },
    {
      "file": "plan.json",
      "issue": "W6-05 AC1 directs wiring pushToRemotes (a state-mutating git push to two remotes) directly into loop-land.ts 'after a successful land' as a fire-and-forget side effect; the acceptance text doesn't require this push to go through a receipted verb, which risks a trust-boundary bypass if remote push is triggered by/derived from agent-session-controlled state rather than the verified land receipt.",
      "fix": "When loop-land.ts is implemented, verify pushToRemotes fires only after the land verb's receipt is committed (not before/instead of it), that remote names/URLs come from trusted local git config rather than any agent-supplied input, and that a failed push produces its own receipt/log entry rather than silently altering state."
    }
  ],
  "notes": "This diff modifies only plan.json (ticket status, write_scope lists, acceptance criteria, and conductor notes) — no executable code is included (packages/forge/src/dual-remote.ts, packages/forge/src/index.ts, packages/harbormaster/src/loop-land.ts, scripts/sign-content.mjs, packages/validators/src/signing/loader.ts, or the .pem file itself all remain unseen). Command/path injection into git/child_process calls, unsafe deserialization, and literal hardcoded-secret checks cannot be performed against implementation code that isn't part of this diff. No secret values, keys, or tokens appear in the diff text itself. The key-provisioning plan described (public key committed at content/keys/shipwright-public.pem, private key only via SHIPWRIGHT_SIGNING_KEY env var, .keys/ gitignored) is consistent with Law 8/9 as written — re-audit once the actual code diff for W6-05/W6-07 (loop-land.ts, dual-remote.ts wiring, sign-content.mjs, loader.ts, and the committed .pem) is available, since that's where real injection/secrets/trust-boundary risk would materialize."
}
```
