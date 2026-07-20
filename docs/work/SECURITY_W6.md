# Security pass — wave W6 (2026-07-20T23:22:10.525Z)

```json
{
  "critical": [],
  "high": [
    {
      "file": "packages/validators/src/signing/loader.ts",
      "issue": "loadValidatorPackWithFallback() has an escape hatch: when the manifest file is missing or fails to parse/schema-validate (result.manifest stays undefined) AND allowUnsigned=true, the function falls through to an unsigned directory scan that returns every *.sh file matching the naming pattern with zero signature/hash/license verification. This is the ONLY place in the new signing system where deny-by-default can be fully disabled. The default param (allowUnsigned=false) is safe, but the function is exported from the package barrel (index.ts) and no caller in this diff is shown wiring allowUnsigned=false explicitly in production — the entire trust model hinges on call-site discipline outside this diff's write_scope.",
      "fix": "Require an explicit, loudly-named opt-in (e.g. a config flag documented as 'DANGEROUS: disables content-pack signature verification') rather than a plain boolean default; log a high-visibility warning (not just a string in `warnings[]`) whenever the unsigned path is taken; and add a grep-able validator/CI check that no production call site ever passes allowUnsigned=true so this can only be reached in test/dev fixtures."
    }
  ],
  "medium": [
    {
      "file": "packages/validators/src/signing/loader.ts",
      "issue": "The defense-in-depth path-boundary check inside loadSignedPack's specs filter reuses the reason code 'file-hash-mismatch' for an unrelated failure ('Path escapes content directory boundary'), even though a dedicated 'path-traversal'-style value would be more accurate. Since the schema-level `.refine()` in manifest.ts already rejects any path containing '..' or a leading '/', this branch should be unreachable in practice, but if it is ever hit (e.g., schema and loader drift apart in a future change) the rejection reason will misleadingly read as a hash problem, hiding a real attack attempt from telemetry/audit logs.",
      "fix": "Add a distinct RejectedValidator reason (e.g. 'path-traversal') for the boundary-escape branch, and add a unit test asserting that reason specifically (current red fixture only exercises the schema-level rejection, not this defense-in-depth branch, so it is untested)."
    },
    {
      "file": "packages/validators/src/signing/manifest.ts",
      "issue": "Path traversal is blocked purely via string matching (`!p.startsWith('/') && !p.includes('..')`) rather than canonicalizing the path (e.g. `path.normalize` + resolved-prefix check, as loader.ts already does downstream). This is currently sufficient because Node's path.join treats literal '..' as the only parent-directory token, but it means the traversal-safety property is asserted in two different ways in two different files (string check in manifest.ts, resolved-path check in loader.ts) — a future edit to one without the other could silently reopen the hole.",
      "fix": "Make loader.ts's resolved-path/contentDir-prefix check the single source of truth for traversal safety, and treat the manifest.ts schema refine as a fast-reject convenience only (already partially the case) — document this explicitly in a comment so future changes don't remove one check assuming the other still covers it."
    },
    {
      "file": "packages/validators/package.json",
      "issue": "New runtime dependency `zod@^4.4.1` (resolved 4.4.3) added for manifest schema validation. Not itself a known-vulnerable version, but it's a new supply-chain surface for a security-critical package (signature/license gating) and isn't currently constrained to an exact/pinned version in lockstep with docs/TECH_STACK.md per project Law 2.",
      "fix": "Confirm docs/TECH_STACK.md is updated to record the zod version per Law 2, and consider pinning an exact version (not `^`) for a package that gates trust decisions, so a future transitive/minor bump can't change validation semantics unnoticed."
    }
  ],
  "notes": "No hardcoded secrets found — only the Ed25519 public key (content/keys/shipwright-public.pem) is committed, which is correct by design; the private key is sourced from SHIPWRIGHT_SIGNING_KEY env var only, and .keys/ is gitignored, matching the Law 8 requirement. No new command/path-injection surface introduced (no new child_process/execa/git shell-outs in this diff; scripts/sign-content.mjs only reads files and uses node:crypto). No unsafe deserialization beyond standard JSON.parse gated by a zod schema (unknown keys stripped by default, no prototype-pollution vector observed). The deny-by-default license/signature/hash gating in loadSignedPack itself is correctly fail-closed (specs=[] on any failure) and is well covered by red-fixture tests for tampered signature, wrong license, hash mismatch, and missing files. The one meaningful trust-boundary concern is the allowUnsigned fallback path (flagged HIGH above) — its safety currently depends entirely on production callers never setting it true, which isn't verifiable from this diff alone since no call site is included yet."
}
```
