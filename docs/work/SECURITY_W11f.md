# Security pass — wave 11 segment W11f (2026-08-06T23:20:25.753Z)

Range `6909a9b..f075326` · 118746 chars · W11-04 settings picker, W11-17 wiring, W11-18 misconfig refusal

Windowed because the full W11 diff is 540,697 chars and the conductor's own pass slices at 180000.

```json
{
  "critical": [
    {
      "file": "apps/server/src/cli/run-build.ts",
      "issue": "resolveAgentRunner() reads the effective `agentRunner` project/global setting and, when kind='external', uses its `command` field verbatim to choose the binary spawn()'d by the host process on every future `run start`. That setting is written through the fully generic `PUT /projects/{id}/settings` / `PUT /settings/global` endpoints (scope-routes.ts), which perform zero per-key validation for `agentRunner` — contrast with the same file's own `CONSENT_GATED_KEYS`/`refuseConsentGatedKey` mechanism that exists specifically because 'a caller could PUT straight through it' and bypass a lower-stakes flag (copilotEnabled). Here the stakes are categorically higher: any caller holding the single shared API bearer token (the only auth gate on this route, per auth-plugin.js) can turn a settings write into arbitrary host command execution on the next build run, with no confirmation/consent event minted (unlike D-019's copilot.consent_ack). This converts 'holds the API token' from 'can read/write project data' into 'can execute code as the Dokima server process' — a material privilege escalation introduced by this feature, and exactly the kind of durable, unreceipted state change CLAUDE.md law 4 warns against for ticket state, now present for a different but equally consequential class of state.",
      "fix": "Treat `agentRunner`'s `command` (and any future command-executing setting) like `copilotEnabled`: require a dedicated confirmation endpoint that mints an audit event with the real caller identity before an external command can be selected, and/or add it to a blocklist on the generic PUT so it can only be set via that dedicated path. At minimum, validate/allowlist the resolved binary or require it to be pre-registered by an out-of-band, higher-privilege action, so a bare settings PUT alone cannot select an arbitrary executable."
    }
  ],
  "high": [
    {
      "file": "apps/server/src/api/server/settings-types.ts",
      "issue": "parseAgentRunnerSetting() and the settings PUT path around it place no constraints on the shape or length of `command` beyond 'is it a string' — no path allowlist, no length cap, no check that the binary is one the operator is known to trust. Combined with the critical finding above, this means the only thing standing between a settings write and code execution is that the caller must format a valid `<bin> [args...]` string.",
      "fix": "At minimum validate `command` resolves to an allowlisted or previously-registered agent binary (mirroring how `defaultModelMatrixPreset` is checked against `PRESET_NAMES` in scope-routes.ts) rather than accepting any string; reject obviously-dangerous values (shell metacharacter-only binaries like `/bin/sh`, `/bin/bash`, `sh`, `bash`, `cmd`, `powershell`) unless explicitly confirmed."
    }
  ],
  "medium": [
    {
      "file": "apps/server/src/cli/run-build.ts",
      "issue": "resolveAgentRunner()'s external command is parsed with `(agentRunner.command ?? '').split(' ').filter(Boolean)`, the same naive whitespace split used for the pre-existing `--agent-command` CLI flag. It is not shell-injectable (createChildProcessSpawn in packages/loop/src/session.ts uses node:child_process spawn with an argv array, not `shell: true`), but it silently mis-parses any path or argument containing a space (e.g. a command under `/Applications/My Agent.app/...` or an argument needing internal spaces/quoting), which can cause the wrong binary or truncated arguments to run without any error — a correctness/robustness gap adjacent to the security surface described above.",
      "fix": "Use a proper shell-word tokenizer (e.g. an argv-splitting library) instead of `.split(' ')`, or store `command`/`args` as a structured array in `AgentRunnerSetting` instead of a single string, removing the ambiguity entirely."
    },
    {
      "file": "apps/server/src/cli/run-build.ts",
      "issue": "buildBuiltInSpawn()/resolveAgentRunner() correctly redact secrets from the prompt handed to `spawn` via `collectSecretValues` + the wrapped-spawn `redactDeep` pattern (loop-land.ts, loop-claim.ts, watchdog-session.ts all now do this consistently), but `resolveVault()` silently degrades to an all-empty `EMPTY_VAULT` whenever `createProjectSecretsVault` throws `NoKeychainAdapterError` (i.e. non-macOS without `DOKIMA_NO_KEYCHAIN`/`DOKIMA_VAULT_KEY`). The in-code rationale (no keychain ⇒ no secrets could ever have been registered) holds for a single-machine lifecycle, but breaks if a project directory (and its vault metadata) is copied/synced to a machine without a keychain adapter — redaction for previously-registered vault secrets would silently stop applying on that machine with no warning surfaced to the operator.",
      "fix": "When `resolveVault` degrades to `EMPTY_VAULT`, check whether the project's vault storage already contains registered entries (even if they can't be decrypted without the missing adapter) and, if so, print a warning to stderr that vault-based secret redaction is disabled for this run rather than staying silent."
    }
  ],
  "notes": "No hardcoded real secrets found — the only literal-looking credential values (DOKIMA_SIGNING_KEY='test-signing-key', DOKIMA_VAULT_KEY='test-vault-key') are test-only fixtures, scoped and restored via try/finally in *.test.ts files, consistent with existing repo patterns. No shell-injection vector confirmed: createChildProcessSpawn (packages/loop/src/session.ts) uses node:child_process spawn with an argv array and no shell:true, and explicitly defaults spawned-agent env to PATH-only (MINIMAL_SPAWN_ENV) rather than inheriting process.env, so the external-agent path does not leak host credentials into the child even though the command source is under-validated (see high/critical findings). No unsafe deserialization patterns found (JSON.parse usage is confined to test fixtures; production code narrows `unknown`/`JsonValue` explicitly in parseAgentRunnerSetting/isAgentRunnerSetting rather than eval'ing or trusting shapes). No dependency/package.json changes in this diff. The receipts/trust-boundary discipline for TICKET state is respected — nothing here mints ticket/phase state without going through runLandLoop's existing gate-and-receipt flow, and the W11-18 change (misconfigured external command now refuses with exit 2 instead of silently degrading to built-in) is a genuine improvement: it removes a prior silent-substitution failure mode. The one substantive new risk is architectural rather than a code bug: this wave adds the project's first settings key whose value is executed as a host process, sitting on the same generic, uniformly-authorized settings PUT surface used for inert configuration data — see critical/high findings for the recommended gating."
}
```
