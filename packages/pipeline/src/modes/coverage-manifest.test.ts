import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildOnboardCoverageManifest } from './coverage-manifest.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../../');
const VALIDATORS_DIR = path.join(REPO_ROOT, 'content/validators');
const ANTI_SLOP_RULES_PATH = path.join(REPO_ROOT, 'content/protocols/ANTI_SLOP_RULES.md');

const VALIDATOR_NAME_RE = /^(?:(?:validate|run)-.+|secrets-scan)\.sh$/;

function importedValidatorNamesOnDisk(): string[] {
  return readdirSync(VALIDATORS_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && VALIDATOR_NAME_RE.test(e.name))
    .filter((e) => {
      const contents = readFileSync(path.join(VALIDATORS_DIR, e.name), 'utf8');
      // W10-51: match EITHER provenance name. Upstream renamed
      // bpm-opencode-experts -> attest in v3.0.0 and W10-50 followed it, so a
      // filter on the old literal matched exactly one file after the refresh —
      // the re-applied local override that still carried a stale header. A test
      // that claims to match disk 1:1 must not silently shrink its own
      // denominator when an upstream name changes.
      return (
        contents.includes('Provenance: attest') ||
        contents.includes('Provenance: bpm-opencode-experts')
      );
    })
    .map((e) => e.name.replace(/\.sh$/, ''))
    .sort();
}

function ruleHeadingsOnDisk(): { id: string; name: string }[] {
  const contents = readFileSync(ANTI_SLOP_RULES_PATH, 'utf8');
  const headings: { id: string; name: string }[] = [];
  for (const line of contents.split('\n')) {
    const match = /^### (R-\d\d) (.+)$/.exec(line.trim());
    if (match?.[1] && match[2]) headings.push({ id: match[1], name: match[2] });
  }
  return headings;
}

describe('buildOnboardCoverageManifest (W8-08 AC2: name-ALL-of-the-set)', () => {
  it('names every validator actually imported from bpm-opencode-experts, matching disk 1:1', () => {
    const manifest = buildOnboardCoverageManifest();
    const onDisk = importedValidatorNamesOnDisk();
    const named = manifest.validators.map((v) => v.name).sort();
    expect(named).toEqual(onDisk);
  });

  it('carries R-01..R-31 sequentially with no gaps', () => {
    // W10-51: 30 -> 31. The v3.1.24 refresh adds R-31 (confabulated analysis).
    const manifest = buildOnboardCoverageManifest();
    const ids = manifest.antiSlopRules.map((r) => r.id);
    expect(ids).toEqual(
      Array.from({ length: 31 }, (_, i) => `R-${String(i + 1).padStart(2, '0')}`),
    );
  });

  it('every R-nn heading present in ANTI_SLOP_RULES.md matches the manifest name exactly', () => {
    const manifest = buildOnboardCoverageManifest();
    const byId = new Map(manifest.antiSlopRules.map((r) => [r.id, r.name]));
    for (const heading of ruleHeadingsOnDisk()) {
      expect(byId.get(heading.id), `${heading.id} should be in the manifest`).toBe(
        heading.name,
      );
    }
    // This assertion used to read `.not.toContain('R-30')`, pinning a known
    // drift: R-30 lived only in anti-slop-auditor.md, with no heading in
    // ANTI_SLOP_RULES.md. Its comment said a fix to the doc should be "a signal
    // to revisit R-30's tag, not a silent surprise" — and at v3.1.24 that is
    // exactly what happened. The drift closed upstream, the pin fired, and
    // R-30 moved from `shadow` to `advisory`. Inverted rather than deleted, so
    // a regression that dropped the heading again would be caught.
    expect(ruleHeadingsOnDisk().map((h) => h.id)).toContain('R-30');
    expect(ruleHeadingsOnDisk().map((h) => h.id)).toContain('R-31');
  });

  it('every entry has a valid D-014 lifecycle state, and nothing is left in shadow', () => {
    const manifest = buildOnboardCoverageManifest();
    const validStates = ['proposed', 'shadow', 'advisory', 'gate', 'deprecated'];
    for (const rule of manifest.antiSlopRules) {
      expect(validStates).toContain(rule.state);
    }
    for (const validator of manifest.validators) {
      expect(validStates).toContain(validator.state);
    }
    // W10-51: R-30 earned a canonical heading at v3.1.24, so it is advisory
    // like its peers and the shadow set is now empty. The set itself is kept as
    // the seam for the next rule documented in an agent before the rules doc.
    expect(manifest.antiSlopRules.find((r) => r.id === 'R-30')?.state).toBe('advisory');
    expect(manifest.antiSlopRules.filter((r) => r.state === 'shadow')).toEqual([]);
  });

  it('the six anti-slop-auditor.md-declared blocking rules are gate-tier', () => {
    const manifest = buildOnboardCoverageManifest();
    const byId = new Map(manifest.antiSlopRules.map((r) => [r.id, r.state]));
    for (const id of ['R-01', 'R-02', 'R-13', 'R-15', 'R-17', 'R-18']) {
      expect(byId.get(id)).toBe('gate');
    }
  });

  it('validate-build/validate-lint/validate-tests are gate-tier (phase 4/5, non-waivable)', () => {
    const manifest = buildOnboardCoverageManifest();
    const byName = new Map(manifest.validators.map((v) => [v.name, v.state]));
    for (const name of ['validate-build', 'validate-lint', 'validate-tests']) {
      expect(byName.get(name)).toBe('gate');
    }
  });

  it('is deterministic across calls', () => {
    expect(buildOnboardCoverageManifest()).toEqual(buildOnboardCoverageManifest());
  });
});
