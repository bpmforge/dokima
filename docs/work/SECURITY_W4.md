# Security pass — wave W4 (2026-07-18T23:17:20.711Z)

```json
{
  "critical": [],
  "high": [
    {
      "file": "apps/server/src/api/events-sse.ts",
      "issue": "SseSocket.send()/ping() call reply.raw.write() with no 'error' listener registered on the hijacked response stream, and the socket's `state` is only ever transitioned to CLOSED via an explicit terminate() call — it is never updated on a real network-level failure (e.g. TCP RST from a dropped client connection). ping() also unconditionally self-emits 'pong' every heartbeat regardless of whether the underlying socket is actually alive, so a truly-dead connection is never detected and removed. The next scheduled publish/heartbeat then calls .write() on a destroyed stream; Node emits an unhandled 'error' event on writes to a destroyed/errored stream, which is fatal (crashes the process) when no listener is attached. Any authenticated client's ordinary network drop (mobile handoff, laptop sleep, NAT timeout) can therefore crash the whole server for all projects/users.",
      "fix": "Register reply.raw.on('error', () => socket.terminate()) (and request.raw.on('error', ...)) in registerEventsSseRoute so socket/stream errors are handled instead of left unhandled, and have terminate() flip `state` first so any in-flight write is skipped rather than racing another write."
    }
  ],
  "medium": [
    {
      "file": "apps/server/src/api/events-sse.ts",
      "issue": "ping() synthesizes its own 'pong' event unconditionally (`this.emit('pong')` immediately after writing the heartbeat comment), which defeats WsHub's missed-heartbeat dead-connection reaping for every SSE subscriber — a connection whose TCP path is already black-holed (no FIN/RST reaches the server) is kept 'alive' in WsHub's subscription/replay-buffer bookkeeping forever. Combined with no cap on concurrent SSE connections and no backpressure check on reply.raw.write()'s return value, a client (or several) that opens many subscriptions and stops reading responses can accumulate unbounded buffered writes and zombie hub state.",
      "fix": "Track real liveness independently (e.g. time since last successful flush, or rely on request.raw timeout/keep-alive settings) instead of self-acking every ping; check the boolean returned by reply.raw.write() and pause/drop publishes (or terminate the socket) when the underlying socket reports backpressure; consider capping concurrent SSE connections per token."
    },
    {
      "file": "apps/server/src/api/server/runs-routes.ts",
      "issue": "registerRunsRoutes (and ticket-edit-routes.ts) still call the old resolveProjectRecord() directly instead of the hardened resolveProjectOrProblem() introduced in this same wave (board-project.ts). A corrupt fleet.json therefore causes an uncaught FleetRegistryCorruptError to propagate out of the route handler on these two new endpoints, falling back to Fastify's generic (non problem+json) 500 instead of the intended 503, inconsistent with every other route hardened in this diff (THREAT_MODEL §5.6) and a possible stack-trace/path disclosure if the default Fastify error handler isn't hardened.",
      "fix": "Switch both files to resolveProjectOrProblem(request, reply, registryPath, projectId) like board-routes.ts/estimate-routes.ts/receipts-routes.ts do, so corrupt-registry cases return a clean 503 problem+json."
    },
    {
      "file": "apps/server/src/api/idempotency.ts",
      "issue": "IdempotencyStore is a single process-wide keyed cache with no structural tenant scoping — correctness of the cross-project isolation proven in board-routes.test.ts depends entirely on every call site manually remembering to prefix keys with projectId (as the module comment itself flags as a MUST). Nothing in the type or API prevents a future route from reusing a bare ticket/verb key and silently replaying another project's cached mutation response to a caller who only supplied a different `project` query param.",
      "fix": "Make project scoping structural rather than convention-based, e.g. require IdempotencyStore.get/put to take (projectId, key) as separate parameters and compose the composite key internally, so it's impossible to construct an unscoped replay key by omission."
    }
  ],
  "notes": "Reviewed for OWASP classes, secrets, command/path injection, trust-boundary violations, unsafe deserialization, and dependency risk. Artifact doc/diff routes retain existing isSafeRelativePath/isSafeGitRevision validation before any git-read call — no new git argument-injection surface found. PATCH /tickets/:id (ticket-edit-routes.ts) correctly refuses to fabricate a state mutation (returns 501 NOT_PERSISTED) rather than bypassing the receipts/event-log trust boundary — good adherence to Law 4. Idempotency keys for verb and comment routes are properly prefixed with projectId at both current call sites (verified by the added cross-project collision test), so the medium finding above is about future-proofing, not a currently exploitable gap. Test-only hardcoded tokens (e.g. 'test-token-0123456789abcdef') are fixture values, not real secrets. The only new dependency, @axe-core/playwright, is a devDependency used solely by Playwright a11y specs and ships in no production bundle."
}
```
