# Security pass — wave 11 segment W11b (2026-08-06T23:07:18.732Z)

Range `8e1f670..e553be4` · 149049 chars · W11-02 agent session tool loop

Windowed because the full W11 diff is 540,697 chars and the conductor's own pass slices at 180000.

```json
{
  "critical": [
    {
      "file": "packages/harbormaster/src/agent-session/fs-tools.ts",
      "issue": "`refuseIfHardExcluded()` (SC-01's `.git`/`.dokima`/`.github/workflows` block) is glob-matched against the untouched surface `relPath` (e.g. `notgit/hooks/pre-commit`), while the separate containment check (`assertRealWithinWorktree`) only verifies the realpath-resolved target stays inside the worktree root — it never re-checks that resolved target against HARD_EXCLUSIONS. Since `.git` is itself inside the worktree, a pre-existing ANCESTOR symlink (e.g. `notgit -> .git`, checked into the ticket's git history or left by a prior session — exactly the threat class this same ticket already treats as real for the containment fix) lets `write`/`edit` land inside `.git/hooks/*` while the surface path never matches the exclusion glob and the realpath containment check reports 'still inside the worktree'. The next `commit` tool call shells out to real `git commit` (via `commitWithScopeCheck`), executing the planted hook with the harbormaster process's own privileges — full code execution outside the declared 'no shell' closed tool set (SC-18).",
      "fix": "Re-run the hard-exclusion check against the realpath-resolved path (relative to the real worktree root, e.g. `path.relative(realRoot, real)`) inside `assertRealWithinWorktree`/`resolveOrRefusal`, not just against the pre-resolution surface `relPath` in `writeTool`/`editTool`. Refuse if either the surface or the resolved path matches HARD_EXCLUSIONS."
    }
  ],
  "high": [
    {
      "file": "packages/harbormaster/src/agent-session/fs-search.ts",
      "issue": "`isUnsafeSearchPattern`'s nested-quantifier/quantifier-count heuristic only tracks quantifiers that directly follow a closing `)` or that appear as raw `*`/`+`/`{` characters; it does not account for backreference-driven catastrophic backtracking. A pattern like `(a+)\\1+` — a textbook ReDoS pattern — parses as: `+` inside the group marks it risky, but the char immediately after `)` is `\\` (not a quantifier) so the 'quantified group' branch never fires, and the total quantifier count is only 2 (`+` in the group, `+` after `\\1`), which sits at the `MAX_QUANTIFIER_COUNT` cap and is not rejected. `toMatcher` therefore compiles this as a real `RegExp` and runs it against every line up to `MAX_MATCH_LINE_LENGTH` (300 chars); against a few hundred 'a' characters this backtracks exponentially and hangs the single-threaded harbormaster process well past `SEARCH_TIME_BUDGET_MS` (which can't interrupt an in-flight `.test()` call) — reproducing exactly the vulnerability this ticket's two prior rounds were meant to close.",
      "fix": "Extend `isUnsafeSearchPattern` to flag any pattern containing a backreference (`\\1`, `\\k<name>`, etc.) — these are rare in legitimate code-search patterns and are the dominant source of missed catastrophic cases the group/quantifier-counting heuristic can't structurally see. Longer-term, don't rely solely on static pre-analysis: run pattern matching with a real wall-clock-enforced timeout (e.g. execute the regex in a worker thread that can be terminated, since JS has no native per-call regex timeout) rather than only checking the budget between lines."
    },
    {
      "file": "packages/harbormaster/src/agent-session/handoff-fields.ts",
      "issue": "`parseHandoffFields` recovers WRITE-SCOPE and VERIFY by taking the LAST line in the rendered prompt shaped like `WRITE-SCOPE: `/`VERIFY: `, explicitly documented as foolable by a ticket CONTEXT that itself ends with a lookalike line. Unlike the write_scope path (re-validated by `commitWithScopeCheck` at commit time and, per the module's own comment, by `runCloseGate` independently re-reading `ticket.verify`), the in-session `verify` tool (`git-tools.ts`'s `verifyTool` → `reRunVerify`) executes this PARSED, spoofable command directly via a real shell with no independent re-validation before it runs. If ticket CONTEXT (assembled from docs/notes that may include prior agent-authored content) can be made to end with a fabricated `VERIFY: <cmd>` line, this lets untrusted content execute an arbitrary shell command through a tool set whose entire design point (SC-18) is 'no shell, no network, no installs'.",
      "fix": "Stop deriving VERIFY (and ideally WRITE-SCOPE) from parsed free text at all — thread the ticket's actual `verify`/`writeScope` fields into `GatewaySpawnSessionOptions` directly instead of round-tripping through `renderHandoff` output. If that's not immediately feasible, have `verifyTool`'s caller re-validate the parsed command against the authoritative `ticket.verify` (same defense the close gate already applies) before executing it in-session."
    }
  ],
  "medium": [
    {
      "file": "packages/harbormaster/src/agent-session/fs-containment.ts",
      "issue": "`assertRealWithinWorktree` performs its realpath containment check and then returns the pre-resolution string path (`resolved`); callers (`writeTool`/`editTool`) later call `fs.mkdir`/`fs.writeFile`/`fs.readFile` against that same string path, not the verified realpath. This is a classic check-then-use (TOCTOU) gap: if a symlink is introduced at an ancestor of the target between the check and the actual filesystem operation, the write can still escape. Exploitability is currently low since tool calls execute sequentially within one session, but it's worth closing given how much of this file's design already treats symlink races as a real threat class.",
      "fix": "Re-verify (or perform the write against) the realpath-resolved location, or re-run `assertRealWithinWorktree` immediately adjacent to the actual `fs.writeFile`/`fs.readFile` call rather than only once earlier in the function."
    },
    {
      "file": "packages/harbormaster/src/agent-session/fs-tools.ts",
      "issue": "`readTool` does not go through `assertRealWithinWorktree` like `list`/`search`/`write`/`edit` now do — it delegates to `classifyManifestFile` (`../scope.js`, outside this diff) instead. The module header asserts this function already does equivalent realpath/leaf-symlink containment, but that claim isn't verifiable from this diff, and it creates an asymmetry where the read path could diverge in behavior from the four tools that were just hardened for the exact same vulnerability class.",
      "fix": "Confirm `classifyManifestFile` performs full realpath-based containment (including the leaf-symlink and dangling-symlink cases `fs-containment.ts` now handles); if it doesn't, route `readTool` through `assertRealWithinWorktree` for consistency."
    },
    {
      "file": "packages/harbormaster/src/agent-session/fs-search.ts",
      "issue": "`walk()` recurses into every subdirectory with no depth bound and collects the full file list before any of the ReDoS/time-budget protections apply — a worktree with a very deep or very wide directory tree (which the model itself can build via repeated `write` calls within its iteration budget) can make the walk phase itself expensive or (for pathological depth) risk a stack overflow, independent of the search-pattern protections added in this ticket.",
      "fix": "Bound walk depth and/or total file count, and fold wall-clock budget checks into the walk phase itself rather than only the line-matching phase."
    }
  ],
  "notes": "Scope covered: all new/changed files under packages/harbormaster/src/agent-session/** plus the harbormaster barrel and plan.json/STATUS.md metadata. No hardcoded secrets found (test constants like TEST_SIGNING_KEY/FAKE_MODEL are clearly fixture-only, consistent with law 9's no-network fake-provider testing). No unsafe deserialization introduced (no new JSON.parse/eval of untrusted input in this diff). No new third-party dependencies added, so no new supply-chain/dependency risk from this wave. The two HIGH ReDoS/handoff-parsing findings and the CRITICAL exclusion-bypass finding all land squarely on the trust boundary this wave was built to harden (agent-session output vs. durable state / the closed tool set's 'no shell' guarantee) — recommend re-running this review after the fixes land, since all three interact with the same containment/exclusion code paths."
}
```
