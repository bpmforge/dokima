# Security pass — wave 11 segment W11e (2026-08-06T23:15:58.334Z)

Range `eae1592..6909a9b` · 103610 chars · W11-14 exact-value redaction, W11-15 refusal, W11-12 tool role, W11-16 emit

Windowed because the full W11 diff is 540,697 chars and the conductor's own pass slices at 180000.

```json
{
  "critical": [],
  "high": [
    {
      "file": "packages/harbormaster/src/loop-claim.ts",
      "issue": "`secretValues` (added in W11-14/W11-16 to redact vault-registered/.env secrets out of prompts and tool results before they reach a routed LLM) is wired into `gateway-session.ts` and `loop-land.ts`'s `attemptOnce`, but `loop-claim.ts:183` and `watchdog-session.ts:73` still call their `runSession`/spawn paths with no `secretValues`. The ticket's own notes acknowledge this ('NOT WIRED, named for follow-up rather than reached for'). Any session spawned through those two call sites still gets pattern-only redaction, so an exact-value secret with no recognizable shape (a bespoke token, rotated key, plain password) can reach the rendered prompt or tool output handed to an external/cloud provider, violating Law 8 (secrets never in prompts).",
      "fix": "Thread `secretValues` (e.g. `collectSecretValues(vault, projectDir)`) through `loop-claim.ts:183` and `watchdog-session.ts:73`'s `runSession`/spawn invocations, following the same wrap-`spawn`-and-`redactDeep`-the-prompt pattern just added to `loop-land.ts`'s `attemptOnce`, so redaction coverage is uniform across every path that can spawn an agent session."
    }
  ],
  "medium": [
    {
      "file": "packages/harbormaster/src/agent-session/tool-executor.ts",
      "issue": "`createAgentSessionToolExecutor`'s returned function calls `await dispatch(tool.name, args, ctx)` with no try/catch, then redacts only the resolved `outcome.result` via `redactDeep(outcome.result, ctx.secretValues ?? [])`. If any dispatched tool throws instead of returning (e.g. an fs error whose message embeds file content/path data, or any future tool implementation that throws with raw context in the error message), that thrown value propagates past this function without ever passing through the new redaction choke point. The header comment asserts 'every tool RESULT... passes through one redaction choke point here' — that invariant does not hold for exception paths.",
      "fix": "Wrap the `dispatch(...)` call in try/catch inside `createAgentSessionToolExecutor`; redact the caught error's message (and any embedded data) with the same `redactDeep`/`secretValues` pass before it is surfaced as a tool error result or rethrown, so redaction coverage is symmetric between success and failure outcomes."
    }
  ],
  "notes": "This wave is net security-positive: it adds a fail-closed refusal (`ProviderUnsupportedRoleError`) instead of silently mis-serializing tool-result turns onto the Anthropic/Vertex wire (would have silently dropped `tool_use_id`/mapped to plain text), and it closes a real secret-leakage gap for `verify`/`read`/`search` tool output by centralizing redaction in `tool-executor.ts` and `git-tools.ts`. No hardcoded real secrets found — 'correcthorsebatterystaple' is an xkcd-style placeholder used only in test fixtures. No new command/path injection surface (no new `exec`/`spawn`/shell calls), no unsafe deserialization (only `JSON.stringify`/`JSON.parse` on well-typed internal objects and test fixtures), and no new third-party dependencies. Trust-boundary/receipts invariants (write_scope enforcement, `refuseIfSessionExceededScope`) are unchanged by this diff. The two findings above are the only places this wave leaves the stated redaction guarantee incomplete."
}
```
