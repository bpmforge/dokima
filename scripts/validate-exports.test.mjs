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
    'RED FIXTURE: reports a mechanism that is exported and tested but called from ' +
      'no production code — `createToolAnchor` is FR-L2 ground truth with a full ' +
      'test suite and no caller anywhere, which is W12-05',
    () => {
      expect(reported.has('loop:createToolAnchor')).toBe(true);
      expect(reported.has('loop:formatAnchorFactsForPrompt')).toBe(true);
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
