# Security pass — wave W3 (2026-07-18T17:46:21.396Z)

```json
{
  "critical": [],
  "high": [
    {
      "file": "packages/harbormaster/src/berths.ts",
      "issue": "`resolveBerthWorktree` builds the on-disk worktree path via `path.join(repoRoot, '.dokima', 'worktrees', ticket.id)` with no validation that `ticket.id` is a safe path segment. If a ticket record with an id like `../../../etc` or containing path separators ever reaches this code (ticket creation is a verb API, not something this module re-validates), `git worktree add`/`fs.realpath` would operate outside the intended `.dokima/worktrees` sandbox, and `listWorktrees`/`createWorktree` would follow.",
      "fix": "Validate/allowlist ticket ids (e.g. match the plan.json ticket-id pattern, reject path separators and `..`) before using them in `path.join`, or resolve the final path and assert it is still contained within the worktrees root before using it."
    }
  ],
  "medium": [
    {
      "file": "packages/harbormaster/src/berths-dial.ts",
      "issue": "`resolveBerthCount` clamps only to a floor of 1 (`Math.max(1, Math.trunc(value))`) with no upper bound. A project/run-scope `berths` setting of an arbitrarily large number would cause `runBerths` to spin up that many concurrent identities, git worktrees, and child git processes, which is a local resource-exhaustion vector if that setting is ever influenced by an untrusted/shared config source.",
      "fix": "Clamp `berths` to a sane maximum (e.g. CPU count or a configured hard cap) in addition to the existing floor of 1."
    },
    {
      "file": "packages/harbormaster/src/berths.ts",
      "issue": "`ticket.title` is passed as `slug` into `createWorktree`/`branchNameFor` with no sanitization visible at this call site. If the title can contain arbitrary characters (leading `-`/`--`, path separators, `refs/` sequences), and `branchNameFor`/`createWorktree` (outside this diff) don't already sanitize it, this risks git ref/argument-injection style issues when the value is used to construct a branch name or passed to `git` commands.",
      "fix": "Confirm `branchNameFor`/`createWorktree` sanitize the slug (strip/replace unsafe characters, and never allow a value starting with `-`) and add a regression test asserting a hostile title cannot influence the git branch name or command arguments."
    }
  ],
  "notes": "Scope is a concurrency/scheduling module (packages/harbormaster) with git worktree and better-sqlite3 event-log interactions — no network-facing input, no secrets, no deserialization in this diff. All `git()` calls use array-form arguments (no shell string interpolation), so classic shell command injection is not present here. The claim/land single-writer synchronous invariant documented in berths-scheduler.ts and relied on by berths.ts (no `await` between pick and claim) is a real correctness property given Node's single-threaded event loop and better-sqlite3's synchronous API — not a vulnerability, but worth flagging to reviewers that any future `await` inserted between `pickNextBerthTicket` and `claimTicket` would reopen a TOCTOU race across berths. The trust-boundary/receipt discipline (Law 4) appears respected: this module never itself advances a ticket past `in_review`/never calls `acceptTicket`, and the injected `BerthTicketRunner` is where session/close-gate mechanics (and presumably receipt verification) live, outside this ticket's write_scope. mulberry32 PRNG is explicitly non-cryptographic and used only for test simulation, which is appropriate."
}
```
