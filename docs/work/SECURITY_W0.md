# Security pass — wave W0 (2026-07-12T03:09:04.290Z)

```json
{
  "critical": [],
  "high": [
    {
      "file": "plan.json",
      "issue": "Ticket W0-08's status field is flipped from 'todo' to 'blocked' by direct edit to plan.json rather than through the receipts/event-log APIs. CLAUDE.md's own trust-boundary law (C-2/C-3, Law 4) states every durable state change must go through verbs/receipts and that agent-session outputs must never directly mutate state — this is the same class of issue the field report itself flags as CRITICAL in §4 row 6 ('conductor hand-editing plan.json status without receipts'), for which only a narrow human-signed waiver (SW-001) was granted.",
      "fix": "Confirm this edit is covered by the existing SW-001 waiver scope or obtain/record a new explicit waiver; long-term, route all ticket-status transitions through the verbs/receipts API so plan.json becomes a projection rather than a directly-writable source of truth."
    }
  ],
  "medium": [
    {
      "file": "plan.json",
      "issue": "The blocked-ticket note embeds raw compiler/tool stderr (file paths, line/column numbers, internal module names) directly into a durable, checked-in artifact; if this pipeline is later fed by less-trusted agent output, unsanitized tool output could be used to inject misleading or crafted 'notes' content that downstream automation (e.g. the conductor) treats as trusted status evidence.",
      "fix": "Treat ticket notes as data, not instructions: when consumed by conductor logic, don't parse/execute note content, and consider truncating/escaping embedded tool output before persisting."
    }
  ],
  "notes": "This diff is almost entirely documentation (docs/CONDUCTOR_FIELD_REPORT.md, new file) plus a small plan.json status/notes update — no source code, no dependency manifests, no command construction, no deserialization, and no secrets are touched, so most of the requested classes (injection, unsafe deserialization, hardcoded credentials, dependency risk) have no surface in this diff. The one substantive concern is the trust-boundary one called out above: this is exactly the pattern (conductor/tooling directly editing plan.json ticket state outside the receipts system) that the field report itself documents as previously triggering a security-critical finding and requiring a human waiver (SW-001). Recommend verifying this specific edit is within that waiver's scope, or treat it as a new instance requiring sign-off. The field report's own content (describing a prior hash-chain preimage delimiter bug and a receipt-binding-by-ID-only bug, both already fixed per the text) is historical narrative, not new code in this diff, so it's noted but not re-flagged as a live finding."
}
```
