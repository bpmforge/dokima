# Security pass — wave W0 (2026-07-15T02:53:55.342Z)

```json
{
  "critical": [],
  "high": [
    {
      "file": ".github/workflows/ci.yml",
      "issue": "conformance job's fix (execFileSync('pnpm',['exec','vitest','run',...rels])) correctly closes shell injection, but rels are still passed as bare positional args derived from git-tracked filenames. A committed path whose basename segment starts with '-' (e.g. 'packages/foo/--config=malicious.conformance.test.ts') is not shell-interpolated but IS interpreted by vitest's own CLI parser as a flag (--config, --reporter, --pool, etc.), letting a contributor who can land a file matching the conformance-test glob redirect vitest to load an attacker-controlled config/reporter module — argument injection distinct from the shell-injection bug this ticket fixed.",
      "fix": "Insert a literal '--' separator before the file list: execFileSync('pnpm', ['exec','vitest','run','--',...rels], {cwd, stdio:'inherit'}) so nothing after it is parsed as an option, regardless of leading '-' characters."
    },
    {
      "file": ".github/workflows/ci.yml",
      "issue": "All third-party actions (actions/checkout@v4, pnpm/action-setup@v4, actions/setup-node@v4) are pinned to mutable major-version tags, not immutable commit SHAs. A compromised or re-tagged upstream action would execute automatically on the next push/PR with no repo-side signal — the exact supply-chain risk class SC-16/.npmrc ignore-scripts=true is otherwise defending against.",
      "fix": "Pin each `uses:` to a full commit SHA (e.g. actions/checkout@<sha> # v4.x.x) and update via Dependabot/renovate so upgrades are reviewed diffs, not silent tag moves. Apply the same pin in nightly.yml."
    }
  ],
  "medium": [
    {
      "file": ".github/workflows/ci.yml",
      "issue": "supply-chain job runs `pnpm audit --prod --audit-level high`, which excludes devDependencies (eslint plugins, vitest, tsc, build tooling) from the advisory check entirely, so a high/critical CVE in a dev-only package would never fail CI.",
      "fix": "Add a non-blocking or warn-level `pnpm audit --dev` (or drop --prod) as a second step so dev-dependency advisories are at least visible, even if only prod deps gate the build."
    },
    {
      "file": ".github/workflows/ci.yml",
      "issue": "actions/checkout steps don't set `persist-credentials: false`; the ephemeral GITHUB_TOKEN is left in the runner's git config for the whole job. Blast radius is currently small because top-level `permissions: contents: read` already limits the token, but this is defense-in-depth that's cheap to add given how many steps in this workflow shell out to node/pnpm scripts.",
      "fix": "Add `with: { persist-credentials: false }` to each actions/checkout@v4 step in ci.yml and nightly.yml."
    }
  ],
  "notes": "The previously-flagged CRITICAL (execSync shell interpolation of git-tracked paths in the conformance job) is verified fixed in this diff via execFileSync with an argv array — confirmed correct pattern, just needs the '--' hardening above to fully close argument-injection. No hardcoded secrets, no unsafe deserialization, and no code path in this diff flips ticket/phase state outside the receipts model — this wave is CI/workflow config only. .npmrc ignore-scripts=true plus the documented allowBuilds exception is a sound SC-16 control. Workflows correctly reference no `secrets.*`, run with least-privilege `permissions: contents: read`, and pull_request (not pull_request_target) avoids the classic fork-PR privilege-escalation pattern."
}
```
