# Security pass — wave W10 (2026-08-05T19:37:01.431Z)

```json
{
  "critical": [],
  "high": [
    {
      "file": "plan.json",
      "issue": "This diff flips ticket W10-68's status (todo→blocked) and appends a CONDUCTOR-authored note directly in plan.json, with no receipt or verb-call artifact visible in the diff itself. Project CLAUDE.md Law 4 (C-2/C-3) states agent/conductor sessions are untrusted and every durable ticket/phase state change must go through the verbs/receipts API — a bare plan.json mutation is exactly the trust-boundary bypass that control exists to prevent.",
      "fix": "Confirm this change was produced by the conductor invoking a receipts-backed verb (e.g. a blockTicket verb) that logged an event, not a direct file write by the agent process. If it was a direct write, route status transitions through the verbs API and require a corresponding receipt/event-log entry before the status field is considered authoritative."
    }
  ],
  "medium": [
    {
      "file": "plan.json",
      "issue": "The patch is a narrow two-hunk diff rather than a full-file rewrite, consistent with a byte-preserving writer, but nothing in the diff proves it went through the project's known-safe writePlan() path (see prior incident: naive JSON.stringify writes reformatted the file and broke a W9-11 test). Conductor-driven writers are a plausible place for that regression to reappear since they run unattended.",
      "fix": "Add a CI check asserting plan.json bytes outside the touched ticket's fields are unchanged for every writer path (including the conductor), not just for manually-invoked CLI edits."
    },
    {
      "file": "plan.json",
      "issue": "The appended note is free-text narrative from an autonomous conductor process; if this field is later rendered in a web UI (apps/web) without escaping, attacker- or model-controlled content in ticket notes could enable stored XSS. Not confirmed in this diff since no rendering code is included.",
      "fix": "Verify the web UI renders plan.json note/text fields as escaped text (not dangerouslySetInnerHTML/raw HTML) wherever ticket notes are displayed."
    }
  ],
  "notes": "This diff contains no application/runtime code, shell invocations, secrets, dependency manifests, or deserialization logic — only a plan.json status flip and an appended note. Most standard OWASP/injection/dependency categories don't apply to this specific diff. The only substantive finding is architectural: plan.json encodes durable ticket state, and per this project's own Law 4 such transitions must be receipt-backed since agent sessions are untrusted; this diff alone cannot confirm that invariant held."
}
```
