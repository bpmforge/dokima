import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATALOG_CONTENT_PATH, matchCatalog, parseCatalog } from './catalog.js';
import { CatalogValidationError } from './types.js';
import type { CatalogEntry } from './types.js';
import { baselineSnapshot } from './test-helpers.js';

const REPO_ROOT = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../..',
);

function readRealCatalog(): string {
  return readFileSync(path.join(REPO_ROOT, CATALOG_CONTENT_PATH), 'utf8');
}

const SAMPLE_ENTRY: CatalogEntry = {
  id: 'PC-004',
  condition: 'coverage.requiredSkipped > 0',
  recommendation: 'Close or waive the {n} SKIPPED required units in phase {phase}',
  verify: 'coverage.requiredSkipped == 0',
  severity: 3,
  leverage: 2,
};

describe('parseCatalog', () => {
  it('parses the real content/plan-catalog/catalog.v1.json fixture', () => {
    const entries = parseCatalog(readRealCatalog());
    expect(entries.length).toBe(12);
    expect(entries.map((e) => e.id)).toEqual([
      'PC-001',
      'PC-002',
      'PC-003',
      'PC-004',
      'PC-005',
      'PC-006',
      'PC-007',
      'PC-008',
      'PC-009',
      'PC-010',
      'PC-011',
      'PC-012',
    ]);
  });

  it('matches the design doc example entry (PC-004) verbatim', () => {
    const entries = parseCatalog(readRealCatalog());
    const pc004 = entries.find((e) => e.id === 'PC-004');
    expect(pc004).toEqual(SAMPLE_ENTRY);
  });

  it('rejects malformed JSON', () => {
    expect(() => parseCatalog('{not json')).toThrow(CatalogValidationError);
  });

  it('rejects a non-array entries field', () => {
    expect(() => parseCatalog(JSON.stringify({ version: 'v1', entries: {} }))).toThrow(
      CatalogValidationError,
    );
  });

  it('aggregates every validation issue rather than failing on the first', () => {
    const raw = JSON.stringify({
      version: 'v1',
      entries: [
        {
          id: 'bad-id',
          condition: '',
          recommendation: '',
          verify: '',
          severity: 9,
          leverage: 0,
        },
      ],
    });
    try {
      parseCatalog(raw);
      expect.unreachable('expected CatalogValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(CatalogValidationError);
      const issues = (err as CatalogValidationError).issues;
      expect(issues.length).toBeGreaterThanOrEqual(6);
    }
  });

  it('rejects an unparseable condition', () => {
    const raw = JSON.stringify({
      version: 'v1',
      entries: [
        {
          id: 'PC-001',
          condition: 'coverage.requiredSkipped >',
          recommendation: 'x',
          verify: 'coverage.requiredSkipped == 0',
          severity: 1,
          leverage: 1,
        },
      ],
    });
    expect(() => parseCatalog(raw)).toThrow(CatalogValidationError);
  });

  it('rejects duplicate ids', () => {
    const raw = JSON.stringify({
      version: 'v1',
      entries: [SAMPLE_ENTRY, SAMPLE_ENTRY],
    });
    expect(() => parseCatalog(raw)).toThrow(CatalogValidationError);
  });
});

describe('matchCatalog — byte-stable evaluation (FR-PLAN1)', () => {
  const catalog = parseCatalog(readRealCatalog());

  it('produces exactly the expected plan items for a known fixture snapshot', () => {
    const snapshot = baselineSnapshot({
      phase: 'Design',
      receipts: { staleCount: 2 },
      coverage: { requiredSkipped: 3 },
      gates: { missingRedFixtureCount: 1 },
    });

    const matches = matchCatalog(catalog, snapshot);

    expect(matches).toEqual([
      {
        catalogId: 'PC-001',
        recommendation:
          "Re-verify the 2 stale receipt(s) so downstream phases aren't gating on invalidated evidence",
        verifyCriterion: 'receipts.staleCount == 0',
        severity: 4,
        leverage: 3,
      },
      {
        catalogId: 'PC-004',
        recommendation: 'Close or waive the 3 SKIPPED required units in phase Design',
        verifyCriterion: 'coverage.requiredSkipped == 0',
        severity: 3,
        leverage: 2,
      },
      {
        catalogId: 'PC-008',
        recommendation:
          "Add the 1 missing planted-defect red fixture(s) — a gate that can't fail can't be trusted (PLAYBOOK.md)",
        verifyCriterion: 'gates.missingRedFixtureCount == 0',
        severity: 5,
        leverage: 5,
      },
    ]);
  });

  it('is byte-stable: re-evaluating the same snapshot twice yields identical JSON', () => {
    const snapshot = baselineSnapshot({
      coverage: { requiredSkipped: 5 },
      phase: 'Build',
    });
    const first = JSON.stringify(matchCatalog(catalog, snapshot));
    const second = JSON.stringify(matchCatalog(catalog, snapshot));
    expect(first).toBe(second);
  });

  it('produces zero matches against an all-clear snapshot', () => {
    expect(matchCatalog(catalog, baselineSnapshot())).toEqual([]);
  });

  it('skips only the phase-dependent entry when a template cannot render without a phase', () => {
    const snapshot = baselineSnapshot({
      coverage: { requiredSkipped: 1 },
      receipts: { staleCount: 2 },
      phase: null,
    });
    const matches = matchCatalog(catalog, snapshot);
    expect(matches.map((m) => m.catalogId)).toEqual(['PC-001']);
  });

  it('isolates a condition that cannot evaluate against this snapshot, continuing the batch', () => {
    const badEntry: CatalogEntry = {
      id: 'PC-999',
      condition: 'phase == "Design"',
      recommendation: 'unreachable',
      verify: 'phase == "Design"',
      severity: 1,
      leverage: 1,
    };
    const withBadEntry = [...catalog, badEntry];
    const snapshot = baselineSnapshot({
      gates: { missingRedFixtureCount: 1 },
      phase: null,
    });

    const matches = matchCatalog(withBadEntry, snapshot);

    expect(matches.map((m) => m.catalogId)).toEqual(['PC-008']);
  });
});
