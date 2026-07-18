# Security pass — wave W4 (2026-07-18T14:44:27.111Z)

```json
{
  "critical": [
    {
      "file": "packages/harbormaster/src/resume.ts",
      "issue": "This diff only resets W3-03 to status:todo and encodes a two-phase fix as acceptance text in plan.json — the actual code is unchanged. resumeProject still calls closeTicket (appending ticket.closed-class events) from inside checkClaimedTicket as it iterates claimed tickets, before every ticket in the batch has been checked for drift. If a later ticket has drift, the function returns {ok:false, driftReport} but earlier tickets already got permanent, unrollbackable event-log writes (append-only log, Law 7), producing a partially-committed resume that contradicts FR-H3 and the trust-boundary requirement that state changes only go through verified receipts.",
      "fix": "Ship the two-phase implementation now specified in acceptance: Phase 1 must be check-only (validate every claimed ticket's receipt + drift, zero event-log writes); Phase 2 (the actual closeTicket/event-append calls) must only run if every ticket passed Phase 1. Move closeTicket out of checkClaimedTicket entirely. Add the red fixture (last ticket in a batch has drift → zero ticket.closed events for earlier tickets) before closing this ticket."
    }
  ],
  "high": [
    {
      "file": "apps/server/src/api/server/artifacts-routes/helpers.ts, git-read.ts (docs routes, W4-05)",
      "issue": "Still status:todo in this diff — no source fix is included. isSafeRelativePath only rejects absolute paths and '..' segments; it does not confine reads to docs/ and does not lstat the resolved target. readWorkingTree/showAtRev follow OS symlinks, so an authenticated caller (or an untrusted agent session per Law 4) can read arbitrary in-repo files such as .shipwright/state.db or .env via GET /artifacts/doc.",
      "fix": "Confine every doc-route read to a realpath-verified DOCS_SUBDIR, reject dot-prefixed path segments, and lstat the fully resolved target (not just the lexical string) before serving content, per the acceptance criteria already encoded in plan.json."
    },
    {
      "file": "apps/server/src/api/server/scope-routes.ts (W4-06)",
      "issue": "Still status:todo — no source fix included. The generic PUT /api/v1/projects/{id}/settings (applyEachKey/putProjectSetting) has no blocklist, so a caller can PUT {copilotEnabled:true} directly and bypass the D-019 consent gate entirely: no risk warning shown, no copilot.consent_ack ledgered event minted.",
      "fix": "Reject consent-gated keys (copilotEnabled and any NEVER-AUTO-adjacent flag) in the generic settings PUT handler; those may only be set via the dedicated consent endpoint that mints the acknowledgement event. Add the red fixture: direct PUT is rejected and does not enable Copilot."
    },
    {
      "file": "packages/harbormaster/src/loop-gates.ts (classifyManifestFile, W3-09)",
      "issue": "Still status:todo — no source fix included. Containment check (fs.realpath) and the subsequent fs.readFile are separate syscalls against the same path string with no fd held between them, so a background process spawned by an untrusted verify command can symlink-swap the manifest file between check and read (classic TOCTOU), smuggling an out-of-root file into a receipt hash.",
      "fix": "Open the file once (fs.open, O_NOFOLLOW on the final component), verify containment via the held fd, and read from that same fd — never re-resolve the path string in a second syscall. Add the red fixture for a symlink swapped mid-check."
    }
  ],
  "medium": [
    {
      "file": "packages/shared/src/index.ts",
      "issue": "secrets/index.ts (redactDeep, collectSecretValues) is now re-exported from the main @shipwright/shared barrel instead of a scoped subpath. collectSecretValues materializes live secret values (reads .env/.env.local/.env.*.local into memory) — putting it on the package's default export surface makes it reachable from every consumer of @shipwright/shared, not just the two intended redaction choke points (loop/handoff, events/append), widening exposure for accidental leakage (logging, debugging, error dumps) of real secret material.",
      "fix": "Add a dedicated \"./secrets\" subpath to packages/shared/package.json exports (mirroring the existing \"./config\" pattern) instead of broadening the main barrel, so only intentional callers import secret-materializing functions."
    }
  ],
  "notes": "The bulk of this diff is plan.json ticket-tracking metadata: previously 'blocked' tickets (W3-03, W3-09, W3-17, W4-05, W4-06, W4-07, W4-11, W5-10) are reset to 'todo'/rescoped and their previously-identified CRITICAL/HIGH security gaps are encoded into acceptance-criteria text for a future supervised build pass. No source code implementing those fixes is present in this diff, so the underlying vulnerabilities (partial event-log commit on resume, docs-route path traversal, consent-gate bypass, manifest TOCTOU) remain live in the current codebase — they are reported here as still-open findings, not newly introduced ones. The only actual source change is the packages/shared/src/index.ts barrel export. No hardcoded secrets, no new command/path-injection sinks, and no unsafe deserialization were introduced by this diff itself."
}
```
