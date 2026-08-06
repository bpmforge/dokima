# Security pass — wave 11 segment W11a (2026-08-06T23:01:47.215Z)

Range `d6906ed..8e1f670` · 88115 chars · W10-68 structured provider binding

Windowed because the full W11 diff is 540,697 chars and the conductor's own pass slices at 180000.

```json
{
  "critical": [
    {
      "file": "apps/server/src/api/server/model-matrix-store.ts",
      "issue": "Diff shows 'Binary files a/... and b/... differ' for this TypeScript source file, meaning its actual code changes (including the new migrateLegacyModelMatrixRows() SQL-writing migration logic and the SELECT_ALL/SELECT * change referenced in docs/STATUS.md) are completely invisible to this review. A source file that should be plain UTF-8 text producing a binary diff indicates either NUL-byte/encoding corruption or content specifically constructed to evade diff-based review — either way it defeats the audit process itself, and any SQL string-building, env var handling, or persistence logic in this file cannot be verified as free of injection or trust-boundary issues.",
      "fix": "Re-generate the diff after confirming/fixing the file's encoding (should be UTF-8, no BOM, no embedded NUL bytes); manually diff the full file text against main; specifically verify migrateLegacyModelMatrixRows and putModelMatrix use parameterized statements (db.prepare(...).run(...)) for the provider_id UPDATE rather than string-concatenated SQL. Do not merge this wave until the textual diff has been reviewed."
    },
    {
      "file": "packages/harbormaster/src/agent-session/fs-tools.ts",
      "issue": "plan.json (ticket W11-02, this diff) documents a confirmed, still-open CRITICAL trust-boundary violation: assertRealWithinWorktree/realpathOfNearestAncestor only realpath-resolves the nearest EXISTING ANCESTOR of a target path, never the target's own leaf. A pre-existing leaf symlink inside the worktree pointing outside it (e.g. committed by an untrusted agent session in a prior turn) passes containment and the subsequent fs.writeFile follows it (Node has no default O_NOFOLLOW) — a full sandbox breakout letting agent-session tool output write arbitrary files outside the worktree, violating CLAUDE.md law 4 (agent sessions are untrusted; state changes must be mediated). The ticket's status was reverted from 'blocked' to 'todo' in this diff, i.e. it remains unfixed as of this wave.",
      "fix": "Before landing any wave that ships the agent-session tool loop, fix fs-tools.ts to attempt fs.realpath() on the FULL target path first and check containment against that; fall back to nearest-ancestor resolution only when the leaf genuinely does not exist yet (new-file case). Add the red fixture already specified in W11-02's acceptance (pre-existing leaf symlink -> outside path must throw ToolPathEscapeError) before merging any code that exercises this tool set against real filesystems."
    }
  ],
  "high": [
    {
      "file": "apps/server/src/api/server/matrix-routes.ts",
      "issue": "Documented but unfixed HANDOFF in this diff (W10-68 notes): isCopilotModel tests model.startsWith('copilot/'). Once a provider is ever registered with id 'copilot', the new migrateLegacyModelMatrixRows auto-backfill will split a legacy 'copilot/gpt-4' row into provider_id='copilot' + model='gpt-4' on its next write — and the D-019 consent-gate copilot_backed flag silently flips to false for that row, i.e. a consent/compliance control is silently disabled by an unrelated data-migration side effect rather than failing loudly.",
      "fix": "Key the Copilot classification off the provider entry's own kind/type or an explicit providerId==='copilot' check rather than a string-prefix convention on model, so the migration in this wave cannot silently disable the consent gate. Track as a matrix-routes.ts-scoped ticket before any provider is registered with id 'copilot'."
    }
  ],
  "medium": [
    {
      "file": "plan.json",
      "issue": "One W9-11 acceptance-note line was rewritten so that an escaped `\\u2014` sequence became a literal raw em-dash character while an adjacent `\\u00a7` escape on the same line was left untouched — i.e. this specific line was re-serialized rather than byte-preserved. plan.json is orchestration/trust state (ticket claims, statuses, scope); this project has a documented invariant (byte-preserving writePlan(), never JSON.stringify) specifically because naive re-serialization produces large unreviewable diffs and has previously broken a test (W9-11). A partial de-escaping in this diff suggests some edit path is not going through the byte-preserving writer.",
      "fix": "Confirm all plan.json edits in this wave went through the project's byte-preserving writePlan() rather than a generic JSON.stringify/re-save, and diff plan.json's raw bytes (not just parsed JSON) against main to rule out wider unintended re-encoding beyond this one line."
    }
  ],
  "notes": "The core logic change (model-resolution.ts bindProvider taking a structured {modelRef, providerId} pair, and the new migration adding model_matrix.provider_id) is a net security improvement: it restores fail-closed 'unknown-provider' refusal for an explicit binding instead of silently guessing from a slash, with no string concatenation into SQL and no new external input surface. The 013_model_matrix_provider.sql migration is a static table-recreate with no dynamic SQL. Test files correctly scope DOKIMA_HOME/temp dirs and restore env state in finally blocks. No hardcoded secrets, no new dependencies, and no new child_process/git-shell call sites were found in this diff. The two critical items above are the load-bearing findings: an unauditable binary diff on a persistence file, and a previously-identified, still-unpatched agent-sandbox symlink escape that this wave's own tracking file surfaces but does not fix."
}
```
