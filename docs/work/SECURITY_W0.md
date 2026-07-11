# Security pass — wave W0 (2026-07-11T14:44:47.663Z)

```json
{
  "critical": [],
  "high": [
    {
      "file": "packages/shared/src/config/settings-files.ts",
      "issue": "looksLikeSecret()/findSecretLikeKeys() is a narrow denylist of 5 regexes (OpenAI/Anthropic sk-, GitHub gh*_, AWS AKIA, Slack xox*, PEM header). Any other secret shape — DB connection strings with embedded passwords, JWTs, GCP/Azure keys, bearer tokens, plain passwords — matches none of them and will be silently accepted by saveGlobalConfig/saveProjectSettings and written to disk in plaintext. The commit/status notes describe this as 'defensive enforcement... not just a scan,' but it is in fact only a scan, and an incomplete one, so it does not actually guarantee the FR-S2 invariant ('settings files never contain secrets').",
      "fix": "Treat this as a best-effort guard only, not the FR-S2 control. Widen detection (entropy/length heuristics for any string value, not just known prefixes) and/or require that any settings key ending in apiKey/token/secret/password be rejected outright unless it matches the credentialRef naming convention (e.g. shipwright:<provider>:<name>), which flips it from a denylist to an allowlist for sensitive-looking keys."
    },
    {
      "file": "packages/git/src/worktree.ts",
      "issue": "createWorktree() builds worktreePath via path.join(worktreesDir, opts.ticketId) with no validation of ticketId. path.join normalizes '..' segments, so a ticketId containing path traversal sequences (e.g. '../../../../tmp/evil') resolves the worktree outside .shipwright/worktrees, and the same raw ticketId is embedded directly in the branch name (branchNameFor only slugifies the `slug` argument, not `ticketId`). If ticket IDs ever originate from anything less trusted than a hand-reviewed plan.json (e.g. an agent-proposed ticket, per the project's own trust-boundary rule that agent sessions are untrusted), this is a path-traversal primitive that plants a git worktree/branch outside the intended sandbox.",
      "fix": "Validate ticketId against a strict allowlist pattern (e.g. /^[A-Za-z0-9._-]+$/) and reject anything containing '/', '..', or leading '-' before using it in either the branch name or the worktree path; resolve the final worktreePath and assert (via path.relative) that it stays inside worktreesDir before calling `git worktree add`."
    }
  ],
  "medium": [
    {
      "file": "packages/git/src/worktree.ts",
      "issue": "createWorktree() passes opts.baseRef (defaulting to 'HEAD') as a bare positional argument to `git worktree add -b <branch> <path> <baseRef>` with no check that it doesn't start with '-'. A caller-supplied baseRef beginning with a dash (e.g. '--upload-pack=...') would be parsed by git as a flag rather than a ref, a classic CLI argument-injection pattern. Not exploitable with the current single call site (baseRef is always omitted), but the exported function is a public API of the package.",
      "fix": "Reject/escape refs starting with '-' (e.g. prefix with './' or use `--` before positional args: `git worktree add -b <branch> <path> -- <baseRef>` is not valid syntax for this subcommand, so instead validate the ref doesn't start with '-' and throw otherwise)."
    },
    {
      "file": "packages/git/src/merge.ts",
      "issue": "mergeLocal() only checks that repoRoot is currently on targetBranch before running `git merge --no-ff <sourceBranch>`. It performs no verification that sourceBranch is actually the ticket's own branch, that the ticket was accepted, or that a receipt exists — i.e. it's a durable state-mutating operation (landing code into main) with no tie-in to the receipts/verification system the project's Law 4 requires for state changes. As written it's a low-level primitive, but nothing here stops a caller from merging an arbitrary/unreviewed branch into main.",
      "fix": "When this is wired into the ticket-closing flow (per plan.json W0-06 follow-ups), require the caller to pass a verified receipt/manifest reference and confirm sourceBranch matches the ticket's recorded branch name before merging; don't let mergeLocal be callable with an arbitrary branch string from an untrusted context."
    },
    {
      "file": "packages/shared/src/config/settings-files.ts",
      "issue": "writeSettingsFile() and the vault writer (packages/shared/src/config/credential-store.ts writeVault) call fs.writeFile without an explicit mode, so global config.json, project settings.json, and vault.json inherit default permissions (0666 & umask, typically 0644/0664) — world/group readable on shared or multi-user systems. vault.json holds AES-256-GCM ciphertext (so confidentiality relies solely on SHIPWRIGHT_VAULT_KEY secrecy) but settings.json/config.json can hold credentialRef names and other config that shouldn't be casually world-readable.",
      "fix": "Create these files with restrictive permissions, e.g. `fs.writeFile(filePath, data, { mode: 0o600 })`, and `fs.mkdir(dir, { recursive: true, mode: 0o700 })` for the containing .shipwright/ directories."
    },
    {
      "file": "packages/shared/src/config/settings-service.ts",
      "issue": "writeGlobalSetting/writeProjectSetting default to `noopSettingsEventSink` when no sink is supplied, so a settings mutation (FR-S3's audit trail) can silently produce zero audit events if a caller simply omits the `sink` option. Since W0-02 (event log) is blocked, every current caller is presumably omitting it, meaning settings changes today are effectively unaudited despite the commit log describing FR-S3 as implemented.",
      "fix": "Once packages/events is unblocked, make the sink mandatory at the service layer (no default no-op) so a missing audit wiring is a compile-time/runtime error rather than a silent gap; keep the no-op only in test helpers, not exported as the production default."
    }
  ],
  "notes": "Scope: this is the W0 scaffold + W0-06 (git worktree/commit/merge) + W0-07 (config/credential layer) wave. Trust-boundary/receipt enforcement (Law 4) isn't wired yet in this wave by design (W0-02/W0-03/W0-04 are still todo/blocked), so mergeLocal/commitWithScopeCheck are correctly scoped as low-level primitives rather than the final gated path — flagged above so it isn't forgotten when they're wired into the real ticket-closing flow. No hardcoded secrets, no shell-interpolated command execution (all git/security calls use execa/execFile with array args, not a shell), and no unsafe deserialization (JSON.parse output is always passed through isJsonValue/isSettingsMap validators) were found. Dependency versions (fastify 5.10, execa 9.6.1, react 19.2.7, vite 6.4.3) all resolve to real, non-typosquatted package names in pnpm-lock.yaml."
}
```
