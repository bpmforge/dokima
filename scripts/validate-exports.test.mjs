import { describe, expect, it } from 'vitest';
import { findUnreferencedExports, isBarrel, isTestFile } from './validate-exports.mjs';

describe('validate-exports (W12-10) — file classification', () => {
  it('treats every test-shaped file as non-evidence of use', () => {
    expect(isTestFile('packages/loop/src/anchors.test.ts')).toBe(true);
    expect(isTestFile('apps/web/src/App.test.tsx')).toBe(true);
    expect(isTestFile('scripts/validate-exports.test.mjs')).toBe(true);
    expect(isTestFile('e2e/board.spec.ts')).toBe(true);
    expect(isTestFile('packages/loop/src/anchors.ts')).toBe(false);
  });

  it('treats a barrel re-export as plumbing, not a consumer', () => {
    expect(isBarrel('packages/loop/src/index.ts')).toBe(true);
    expect(isBarrel('packages/memory/src/packer/index.ts')).toBe(true);
    expect(isBarrel('packages/loop/src/anchors.ts')).toBe(false);
  });
});

describe('validate-exports (W12-10) — the defect class, against this repo', () => {
  const result = findUnreferencedExports();
  const reported = new Set(result.findings.map((f) => `${f.package}:${f.symbol}`));

  it(
    'RED FIXTURE: reports mechanisms that are exported and tested but called from no ' +
      'production code, and every finding carries the test references that prove it ' +
      'was built and verified rather than merely unused',
    () => {
      // DELIBERATELY PINS NO SPECIFIC SYMBOL. The first version of this test
      // asserted `loop:createToolAnchor` was reported — true when W12-10
      // landed, false one ticket later when W12-05 wired it up, and the test
      // failed for the best possible reason: someone fixed the thing it was
      // complaining about. A test that goes red when the defect is REPAIRED
      // is backwards. The durable assertions are the shape of a finding and
      // the guards below that the validator goes quiet once code is wired.
      expect(result.findings.length).toBeGreaterThan(0);
      for (const finding of result.findings) {
        expect(typeof finding.package).toBe('string');
        expect(typeof finding.symbol).toBe('string');
        expect(finding.tests).toBeGreaterThan(0);
        expect(finding.testFiles.length).toBeGreaterThan(0);
      }
    },
  );

  it(
    'GUARD: `createToolAnchor` is NO LONGER reported — W12-05 gave FR-L2 a caller, ' +
      'and this is the validator demonstrating the property it exists for',
    () => {
      expect(reported.has('loop:createToolAnchor')).toBe(false);
      expect(reported.has('loop:formatAnchorFactsForPrompt')).toBe(false);
    },
  );

  it('GUARD: does not report a genuinely wired export — `runLandLoop` drives every build run', () => {
    expect(reported.has('harbormaster:runLandLoop')).toBe(false);
    expect(reported.has('harbormaster:runCloseGate')).toBe(false);
  });

  it(
    'GUARD: does not report `assemblePacket`, which W12-04 wired — the validator ' +
      'must go quiet when a mechanism actually gets a caller, or it proves nothing',
    () => {
      expect(reported.has('memory:assemblePacket')).toBe(false);
    },
  );

  it('scans a real denominator rather than a token sample', () => {
    expect(result.packages).toBeGreaterThanOrEqual(12);
    expect(result.scanned).toBeGreaterThan(1_000);
  });
});
