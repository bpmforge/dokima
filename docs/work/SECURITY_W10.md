# Security pass — wave W10 (2026-08-04T21:32:39.952Z)

```json
{
  "critical": [],
  "high": [
    {
      "file": "plan.json",
      "issue": "Ticket W10-68 status flips todo→blocked and a new freeform 'notes' entry (authored by an automated 'CONDUCTOR' process, embedding a literal branch name 'sw/w10-68' and timestamp) is appended directly to plan.json with no receipt/event-log entry visible in this diff. Project Law 4 requires every durable ticket/phase state change go through the verbs/receipts API and forbids a code path that flips status without a receipt — a raw plan.json state mutation is exactly the prohibited pattern.",
      "fix": "Confirm this write was produced by writePlan()/the receipts pipeline and has a corresponding hash-chained events-table entry, not a direct file edit; if no receipt exists, revert and re-apply the status change through the proper API."
    },
    {
      "file": "plan.json",
      "issue": "The appended note is agent-session-authored free text (per Law 4, agent sessions are untrusted) that now lives in durable state and references a branch name. If any downstream tooling shells out to git using ticket notes/branch fields via string interpolation rather than argv-array execFile/spawn, this is a command-injection vector since the content is not operator-authored.",
      "fix": "Audit all call sites that read plan.json notes/branch data and pass them to child_process or git commands; ensure argument-array invocation only (never shell:true or template-built command strings), and treat notes as untrusted display data."
    }
  ],
  "medium": [
    {
      "file": "plan.json",
      "issue": "'notes' changed from a single string to an array of strings for this ticket with no accompanying schema/migration change in the diff. Consumers that assume notes:string (rendering, hashing, concatenation) will misbehave or throw for this record and any future mixed-type records.",
      "fix": "Add a normalizer at the read boundary (string|string[] → string[]) and update the plan.json validator/schema so all tickets validate consistently; add a regression test for legacy string-notes records."
    }
  ],
  "notes": "Diff is data-only (plan.json ticket bookkeeping) — no source code, dependency manifests, or literal secrets present, so no findings on hardcoded credentials, unsafe deserialization, or dependency risk from what's shown. Both high items are conditional: they flag exactly the failure modes this project's own CLAUDE.md calls out (Law 4 receipts requirement; git child-process shelling) that this diff's pattern (raw state-file mutation + agent-authored freeform text newly entering that file) would violate if the surrounding write path and downstream git-invocation sites don't already guard against them — verify against the actual writePlan() call site and git-spawning code before treating as confirmed."
}
```
