# Security pass — wave W2 (2026-07-15T05:21:51.938Z)

```json
{
  "critical": [],
  "high": [
    {
      "file": "packages/gateway/src/providers/anthropic.ts",
      "issue": "streamEvents() yields a 'final' event computed from normalizeUsage({promptTokens, completionTokens}, ...) with no guard when the stream ends early (abort, dropped connection, or before a usage-bearing event arrives) — promptTokens/completionTokens can still be undefined at that point. The oai-compat.ts and openai.ts paths added in this same wave explicitly throw ProviderResponseShapeError('stream ended without a usage-bearing chunk... cannot meter this call') in that situation; Anthropic's path has no equivalent check and will silently emit a ChatResponse with degraded/zero usage instead. This directly contradicts the ticket's own acceptance criterion ('usage metering identical to non-streaming... no unmetered streamed call') and reintroduces exactly the silent-under-report-as-free failure mode the file's header explicitly says must be avoided.",
      "fix": "Add the same explicit guard used in oai-compat.ts/openai.ts: if the stream ends without promptTokens/completionTokens (or without a terminal stop_reason), throw ProviderResponseShapeError rather than falling through to normalizeUsage with partial/undefined counts. Add a stream-abort-before-usage test case mirroring oai-compat's 'ends without a usage chunk' test to close the gap."
    },
    {
      "file": "packages/gateway/src/providers/streaming.ts",
      "issue": "readSseDataLines() accumulates into `buffer` with no maximum size. If a configured provider endpoint (especially an oai-compat baseUrl, which is fully operator/user-configurable and may point at an untrusted or misbehaving local/proxy server) never emits the `\\n\\n` record terminator, or emits an extremely long single line, `buffer` grows unbounded for the lifetime of the request, exhausting process memory — a DoS against the gateway process itself.",
      "fix": "Cap the buffer size (e.g. reject/throw once buffer exceeds a configurable max, similar to typical HTTP header/line-length limits) and add a test that a pathological unterminated stream is rejected rather than accumulated indefinitely."
    }
  ],
  "medium": [
    {
      "file": "packages/gateway/src/providers/anthropic.ts",
      "issue": "Parsed SSE payloads are cast directly to the expected interface (`JSON.parse(payload) as AnthropicStreamEvent`) with no runtime shape validation. Same pattern in oai-compat.ts (`as OaiCompatStreamChunk`) and openai.ts. For oai-compat this is more exposed since baseUrl/headers are caller-supplied config, not a fixed vendor endpoint — a compromised or non-conformant server can send arbitrary JSON shapes that get treated as trusted typed data (e.g. non-string `error.message`, unexpected `delta.role`) with no validation before being folded into ChatResponse/usage.",
      "fix": "Validate parsed SSE JSON against a minimal runtime schema (zod or manual shape checks) before use, and fail closed (throw ProviderResponseShapeError) on shape mismatch instead of trusting the `as` cast."
    },
    {
      "file": "packages/gateway/src/providers/oai-compat.ts",
      "issue": "The stream's server-supplied `model` field (`modelId = event.model ?? modelId`) is used unvalidated for costTable lookup in normalizeUsage(). Since oai-compat targets arbitrary/operator-configured endpoints, a misbehaving or malicious endpoint could report a different (cheaper) model id than requested, causing under-metering of actual cost/usage.",
      "fix": "Validate the reported model id matches the requested model (or an documented alias) before using it for cost lookup; log/flag a mismatch rather than silently trusting it."
    },
    {
      "file": "packages/gateway/src/providers/anthropic-helpers.ts",
      "issue": "parseRetryAfterMs() is duplicated verbatim in oai-compat-helpers.ts (both files' own comments acknowledge this: 'not exported there, so duplicated'). Divergence risk: if one copy is patched (e.g., for a parsing edge case or clamping a malicious oversized Retry-After header) and the other isn't, retry/back-off behavior becomes inconsistent across adapters in a way that's easy to miss in review.",
      "fix": "Move parseRetryAfterMs into the shared streaming.ts (already the designated shared-plumbing home per this ticket) so both adapters use one implementation."
    }
  ],
  "notes": "This wave is confined to the gateway provider-streaming layer (Anthropic/OpenAI/oai-compat chatStream() + shared SSE framing); no child_process/git shell-out code, no filesystem/path handling, and no package.json/dependency changes are present in this diff, so command-injection, path-injection, and dependency-risk categories are not applicable here. No hardcoded secrets: 'sk-ant-test'/'sk-test' are test-fixture placeholders in *.test.ts files only, and AnthropicConfig/OaiCompatConfig still require credentials to be pre-resolved by the caller (FR-S2), consistent with existing pattern. No trust-boundary/receipt violation found — this layer only produces ChatStreamEvent objects and performs no durable state mutation, ticket state transition, or event-log write; downstream consumers (not in this diff) remain responsible for routing any resulting state changes through the verbs/receipts APIs rather than treating streamed LLM content as pre-verified. The queueStats() fix (summing inner+streamQueue) and the runQueuedStream() slot-holding design were reviewed for concurrency-limit bypass and look correct — no way found to exceed configured concurrency."
}
```
