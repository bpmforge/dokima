# Security pass — wave W6 (2026-07-18T22:20:01.751Z)

```json
{
  "critical": [],
  "high": [
    {
      "file": "packages/forge/src/gitea-pr.ts",
      "issue": "mergePullRequest() defaults to the 'reviewer' identity for SC-14/C-4 (maker != reviewer merge authority), but the identity parameter is caller-overridable and resolveToken() in gitea-http.ts returns the makerToken for any identity value other than the literal string 'reviewer'. A caller (bug, mis-wired verb, or a future code path that forwards a ticket-supplied identity) can pass identity='maker' and merge a PR using the maker token, silently defeating the mechanical maker!=reviewer separation the project treats as a hard invariant (CLAUDE.md law 5).",
      "fix": "Make mergePullRequest ignore or reject a caller-supplied identity for the merge call itself — hard-code resolveToken(runtime, 'reviewer') internally (or throw ForgeIdentityError on any other value) so merge authority is enforced by construction, not by default parameter value."
    },
    {
      "file": "packages/forge/src/gitea-http.ts",
      "issue": "requestGiteaApi/requestGiteaApiOrNotFound build request URLs via raw template-literal interpolation of ref.owner, ref.repo, branch, sha, and issue/PR numbers (see gitea-repo.ts, gitea-pr.ts pullsPath/protectionPath, gitea-issues.ts issuesPath, gitea-protection.ts protectionPath, gitea-status.ts) with no encodeURIComponent. If any of these values are ultimately derived from ticket/board data (branch names, repo refs) that can be influenced by a lower-trust source, a value containing '/', '?', '#', or '..' segments can alter the intended request path or append query parameters to an unintended Gitea API endpoint.",
      "fix": "encodeURIComponent() every dynamic path segment (owner, repo, branch, sha) before interpolating it into the URL, in every gitea-*.ts chapter that builds a path."
    }
  ],
  "medium": [
    {
      "file": "packages/forge/src/gitea-types.ts",
      "issue": "GiteaAdapterConfig.baseUrl has no scheme/host validation (no https-only enforcement, no loopback/link-local/internal-range blocklist), and gitea-http.ts's fetchRaw uses the global fetch with default redirect-follow behavior and no explicit redirect policy. If baseUrl is ever populated from project-level config that a lower-trust actor can influence, this is an SSRF vector that would carry live maker/reviewer bearer tokens to an attacker-chosen host, and a malicious or compromised Gitea endpoint could redirect requests cross-origin.",
      "fix": "Validate baseUrl against an explicit allowlist/expected scheme (https only) before use, and set an explicit redirect policy (e.g. redirect: 'manual' with controlled handling) rather than relying on fetch's default follow behavior."
    },
    {
      "file": "packages/forge/src/gitea-parity.ts",
      "issue": "checkForgeAdapterParity only compares structural key-paths (keyPaths()), not values, so a chapter that returns the wrong-but-same-shaped data (e.g. private:true reported as private:false, or permissions swapped) would still pass 'parity' — this is the artifact this ticket cites as satisfying the CONTRACTS.md §2 Proof ('parity validator red on induced divergence'), but it cannot catch value-level regressions in security-relevant fields like repo visibility or permission flags.",
      "fix": "For security-sensitive fields (private, archived, permissions.*), add explicit value-equality assertions in checkForgeAdapterParity or a follow-up validator, not just shape comparison."
    }
  ],
  "notes": "No hardcoded real secrets found — token literals in test files ('maker-token','reviewer-token','bad-token') are clearly synthetic fixtures. No child_process/shell usage in this diff (generic-git.ts deliberately never shells out to git, consistent with D-014 honest-degradation). No unsafe deserialization — all JSON.parse calls are on HTTP response bodies from the configured forge, not eval'd or used to reconstruct executable objects. This diff does not itself perform any board/ticket state mutation without a receipt — it's a low-level HTTP adapter; the identity-override gap on mergePullRequest (HIGH #1) is the most direct hit against this project's explicitly documented trust-boundary law (C-4, 'maker != verifier is mechanical'), so it should be prioritized. The two HIGH items are new code following the same pattern github.ts likely already uses (not visible in this diff) — worth checking github-pr.ts/github-http.ts for the identical merge-identity-override and unescaped-path-segment issues, since fixing only the Gitea adapter would leave the GitHub adapter with the same exposure."
}
```
