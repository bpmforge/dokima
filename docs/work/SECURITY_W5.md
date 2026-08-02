# Security pass — wave W5 (2026-07-20T19:29:25.409Z)

```json
{
  "critical": [],
  "high": [],
  "medium": [
    {
      "file": "apps/server/src/api/server/artifacts-routes/shared.ts",
      "issue": "DELIVERABLE_PHASES is a hand-maintained duplicate of packages/pipeline/src/phases/topology.ts's PHASES deliverable list, used as the sole source of truth for isGatedDeliverable's server-derived phase (the W5-21 fix for the client-forged-phase trust-boundary bug). Currently in sync, but nothing enforces that — if a deliverable is added/renamed in topology.ts without updating this map, phaseForDeliverablePath silently returns null for it and isGatedDeliverable treats that deliverable as ungated, silently reopening the same gating-bypass class W5-21 just fixed.",
      "fix": "Either export PHASES (or a path->phase lookup) from @dokima/pipeline's public surface and import it here, or add a unit test that asserts DELIVERABLE_PHASES' keys equal the flattened deliverable ids from topology.ts so drift fails CI instead of failing open."
    }
  ],
  "notes": "This diff is predominantly a security remediation wave and the fixes are sound: (1) the CRITICAL self-attested `gate` receipt for pipeline-phase output is removed entirely rather than patched, eliminating the maker==verifier violation (Law 4/5) — verified no other code still references the removed phaseForEvent/receipt-minting path; (2) the dynamic file://-import of @dokima/gateway is replaced with a real workspace dependency, removing an ad-hoc runtime code-loading pattern; (3) apps/server/src/api/decisions/routes.ts now requires an auth option and enforces it per-route via the same checkAuth used by the app-wide hook, with regression tests proving 401/403 on missing/bad token and disallowed Host (SC-08/D-005); (4) isGatedDeliverable no longer trusts a client-supplied `phase`, deriving it server-side from the deliverable path, with red-fixture tests proving a forged phase can neither fake nor hide gating; (5) W5-22's regression tests were fixed after correctly being called out as insufficient (they only proved 401-when-unauthenticated, not that the route was actually wired) — the follow-up adds authenticated requests that reach real 400 body-validation, correctly distinguishing 'wired' from 'missing'. No hardcoded production secrets, command/path injection, or unsafe deserialization found; all SQL access remains parameterized. Test-only bearer tokens/signing keys in *.test.ts files are fixture values, not leaked credentials. The only carryover risk is the duplicated phase-mapping table noted above."
}
```
