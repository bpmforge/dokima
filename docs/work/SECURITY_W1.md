# Security pass — wave W1 (2026-07-12T04:47:09.439Z)

```json
{
  "critical": [],
  "high": [
    {
      "file": "packages/loop/src/session.ts",
      "issue": "createChildProcessSpawn accumulates the untrusted agent session's stdout/stderr into unbounded strings (`stdout += chunk...`, `stderr += chunk...`) with no size cap, unlike execFile's maxBuffer used elsewhere in this same wave (session-scope.ts). Since BLUEPRINT/SC-02 treats agent sessions as untrusted, a misbehaving or hostile session can emit unbounded output and exhaust process memory (DoS) before the manifest is even parsed.",
      "fix": "Cap accumulated output (e.g. truncate/stream to a bounded ring buffer or reject once a byte threshold is exceeded) and surface a truncation flag in SpawnSessionOutput instead of buffering without limit."
    }
  ],
  "medium": [
    {
      "file": "packages/loop/src/session.ts",
      "issue": "createChildProcessSpawn's `timeoutMs` is optional and has no default; when omitted, an untrusted agent-session child process can hang indefinitely, tying up a process slot/resources. Additionally, Node's `timeout` option only signals the direct child, not any subprocess tree it spawns, so a hung child that has forked grandchildren can leave orphans running after 'timeout'.",
      "fix": "Enforce a mandatory default timeoutMs (e.g. 10-15 min) when the caller doesn't supply one, and run the child detached in its own process group (`detached: true`) so on timeout you can `process.kill(-child.pid)` to reap the whole tree, not just the direct child."
    },
    {
      "file": "packages/loop/src/session-scope.ts",
      "issue": "detectScopeViolations/computeChangedPaths is explicitly documented as a non-authoritative 'basic glob-classification' primitive — it has no hard exclusions for .git/**, .github/workflows/**, .shipwright/** and no symlink-escape resolution via realpath, both called out in the file's own comment as belonging to the real SC-01 enforcement (packages/git's checkWriteScope, not yet built). If a future integrator (e.g. the W3-01 harbormaster wiring) mistakenly treats session.ts's `scopeViolations` as the authoritative gate instead of routing through the real checkWriteScope, an agent session could write to .git/hooks, CI workflow files, or escape via a symlink undetected.",
      "fix": "Keep this module opt-in/advisory only, and add a loud runtime assertion or lint rule (or a README/type-level marker) preventing any gate/receipt-issuing code path from consuming `session.ts`'s scopeViolations directly until it is replaced by packages/git's checkWriteScope in W3-01."
    }
  ],
  "notes": "No hardcoded secrets found. All git/child-process invocations in this diff use execFile/spawn with argv arrays (no shell:true, no string interpolation into a shell command), so no shell/command injection was found; note the untrusted prompt is passed as a single argv element to the spawned agent CLI, which is safe from shell injection but could still be interpreted as a flag by a naively-parsed target CLI if the prompt text ever began with '-' (currently it always starts with the '════' HANDOFF rule, so low risk, worth a defensive '--' separator if the spawn contract changes). JSON.parse is used for all manifest parsing (no eval/vm/unsafe deserialization). The env-default fix already applied in this wave (MINIMAL_SPAWN_ENV = {PATH} instead of inheriting process.env) is a solid SC-03/SC-07 control against credential leakage into untrusted sessions. calibration.ts's gateDecision() deliberately excludes any confidence value from the DONE decision, which is a good structural control against the cited 2026-07-01 self-confidence inversion regression — worth preserving as-is. Nothing in this diff performs a durable state mutation from agent-session output directly; session.ts returns the manifest/scopeViolations as data only, consistent with SC-02's 'untrusted claim, caller must verify' design, and packages/loop/src/index.ts was deliberately left unwired, so no trust-boundary bypass currently reaches a gate. Re-audit once W3-01 wires session.ts's output into the harbormaster/receipts path."
}
```
