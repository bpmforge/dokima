# Security pass — wave W6 (2026-07-20T23:59:09.623Z)

```json
{
  "critical": [
    {
      "file": "packages/harbormaster/src/land-push.ts",
      "issue": "pushLandedBranch()/configuredRemotes() defaults to whatever `git remote` returns from the ticket's own worktree, with no allowlist, and land-push.ts / dual-remote.ts then execFile('git', ['push', remote, ref]) against every one of them automatically after a successful close gate. Git remotes support the `ext::<command>` transport helper and per-remote `remote.<name>.receivepack`/`uploadpack` config, both of which execute an arbitrary local command when git pushes to that 'remote'. Per Law 4, agent sessions are explicitly untrusted; if a coding-agent session (within its write_scope, or via any bug that lets it touch .git/config in its own worktree) adds a remote like `git remote add x ext::sh -c 'evil'` or sets `remote.origin.receivepack=/tmp/evil.sh`, the very next successful land automatically executes it — a durable, high-impact state change (arbitrary command execution) with no receipt, review, or human gate in between, directly contradicting 'agent sessions are untrusted; every durable state change goes through the verbs/receipts APIs.'",
      "fix": "Never trust `git remote` output directly as the push target list. Require an explicit, harness-configured allowlist of remote names/URLs (e.g. only 'origin' and 'github', validated against known-good URLs read from a trusted config file outside any agent's write_scope) and pass that as LandLoopOptions.pushRemotes instead of defaulting to configuredRemotes(). Additionally reject/validate remote URLs that use the `ext::`, `fd::`, or other command-executing transport schemes before ever pushing."
    }
  ],
  "high": [
    {
      "file": "packages/forge/src/dual-remote.ts",
      "issue": "execFileAsync('git', ['push', remote, ref], { cwd }) passes `remote` and `ref` as bare positional args with no `--` separator before them and no check that they don't start with `-`. If either value (ref comes from worktree.branch, which is derived from ticket id/title — data that can originate from an untrusted agent session per Law 4) begins with a dash, it can be interpreted as a git option (e.g. a crafted `--upload-pack=...`/`--receive-pack=...`-style flag or other push option) rather than a literal remote/ref, enabling argument injection even without full shell injection.",
      "fix": "Insert a literal `--` separator before positional arguments: `['push', '--', remote, ref]`, and additionally validate/reject remote names and ref/branch strings that start with `-` before calling execFile."
    }
  ],
  "medium": [
    {
      "file": "packages/harbormaster/src/land-push.ts",
      "issue": "recordFailedPushes only records failed pushes as a ticket comment; there is no receipt or verification that a *successful* push actually reached the intended, expected remote URL (e.g. spoofed/rewritten remote pointing somewhere unexpected would report ok:true with no discrepancy check against known-good remote URLs).",
      "fix": "When recording push outcomes, also assert/log the remote URL (git remote get-url) alongside the name, and compare against an expected allowlist so a redirected remote is visible as ticket evidence, not just a silent 'ok'."
    },
    {
      "file": "content/validators/validate-remote-parity.sh",
      "issue": "`git -C \"$ROOT\"` and downstream `tracking_ref=\"refs/remotes/${remote}/${BRANCH}\"` build ref paths from `$ROOT`/`$BRANCH`/`$remote` without validating they don't begin with `-`; a project root or branch name starting with a dash could be misinterpreted as a git option by rev-parse/remote calls (defense-in-depth gap, lower likelihood since BRANCH/REMOTES come from local git metadata rather than direct external input).",
      "fix": "Quote is already present, but add explicit leading-dash rejection (or use `--` separators) for $ROOT/$BRANCH/$remote before passing them to git subcommands, matching the argument-injection guard recommended for dual-remote.ts."
    }
  ],
  "notes": "No hardcoded secrets found in this diff. All new git invocations use execFile with argv arrays (no shell:true), which correctly avoids shell/command-string injection — the residual risk is git's own argument- and transport-level injection (ext:: helper, receivepack config, leading-dash flags), not shell metacharacters. packages/forge remains dependency-free (uses node:child_process directly), so no new supply-chain exposure. Failed-push visibility via commentTicket correctly uses the ticket verb/event-log API rather than a swallowed return value, consistent with Law 4's receipt requirement — the gap is that the push mechanism itself trusts repo-local, potentially agent-writable git config as its target list rather than treating it as untrusted input."
}
```
