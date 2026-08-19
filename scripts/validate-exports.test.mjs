import { describe, expect, it, vi } from 'vitest';
import {
  countReferences,
  findUnreferencedExports,
  isBarrel,
  isTestFile,
  isTestSupportFile,
  moduleExports,
  stripComments,
} from './validate-exports.mjs';

/**
 * `findUnreferencedExports()` walks 1249 source files and runs the TypeScript
 * checker over every package barrel — measured at ~20s. Four tests called it
 * separately under vitest's default 5s timeout, and only ever passed because
 * `--retry=2` hid the cost on an idle machine. Under real load all four went
 * red at once and read as a regression in the validator rather than a flake in
 * its tests.
 *
 * ONE scan, and a timeout that reflects what it actually costs.
 */
vi.setConfig({ testTimeout: 90_000 });

let scanned;
function scan() {
  scanned ??= findUnreferencedExports();
  return scanned;
}

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
  const result = scan();
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

describe('the buried-export pass (W12-38)', () => {
  it(
    'RED FIXTURE: names runEscalationPolicy. The W12-10 pass reported 43 gaps ' +
      'and never mentioned it — a complete, tested escalation state machine ' +
      '(D-024 option b) with no production caller anywhere, invisible because ' +
      'it is not in a barrel at all. The ratchet was blind to the worst shape ' +
      'of the defect it exists to catch',
    () => {
      const { buried } = scan();
      expect(buried.map((b) => b.symbol)).toContain('runEscalationPolicy');
    },
  );

  it(
    'counts references in CODE, not in prose. runEscalationPolicy survived the ' +
      'first draft of this pass because loop-land-policy.ts names it twice in a ' +
      'comment explaining why that loop deliberately does not call it — counting ' +
      'an explanation of why nothing calls a function as a call',
    () => {
      const stripped = stripComments(
        'const a = 1; // runEscalationPolicy\n/* runEscalationPolicy */ const b = 2;',
      );
      expect(stripped).not.toContain('runEscalationPolicy');
      // Blanked, not deleted: removing a comment between two identifiers would
      // glue them into a third word that never existed in the file.
      expect(stripped).toContain('const a = 1;');
      expect(stripped).toContain('const b = 2;');
      expect(stripped.split('\n')).toHaveLength(2);
    },
  );

  it(
    'does not report recorded fixtures as dead. They are exported for tests and ' +
      'called by nothing else BY DESIGN — law 9a is why they exist — so reporting ' +
      'them reports the testing discipline as a defect (30 of the first 90)',
    () => {
      expect(isTestSupportFile('packages/gateway/src/providers/copilot-fixtures.ts')).toBe(true);
      expect(isTestSupportFile('packages/forge/src/mirror/mirror-test-helpers.ts')).toBe(true);
      expect(isTestSupportFile('packages/gateway/src/escalation/policy.ts')).toBe(false);
    },
  );

  it('reads the names a module exports, and only the value ones', () => {
    const names = moduleExports(
      'x.ts',
      [
        'export function used() {}',
        'export const value = 1;',
        'export class Thing {}',
        'export interface Shape { a: string }',
        'export type Alias = string;',
        'function notExported() {}',
        "export { rexported } from './other.js';",
      ].join('\n'),
    );
    expect(names).toEqual(['used', 'value', 'Thing']);
  });

  it('never double-reports a symbol the barrel pass already judged', () => {
    const { findings, buried } = scan();
    const barrelNames = new Set(findings.map((f) => f.symbol));
    for (const b of buried) expect(barrelNames.has(b.symbol)).toBe(false);
  });
});

describe('a comment is not a caller (W12-39)', () => {
  const files = ['/repo/pkg/src/thing.ts', '/repo/pkg/src/other.ts', '/repo/pkg/src/thing.test.ts'];

  /** Constructed, not hunted for: this must still hold after today's real instances get wired up. */
  function contents(otherFile) {
    return new Map([
      [files[0], 'export function widget() {}'],
      [files[1], otherFile],
      [files[2], "import { widget } from './thing.js';\nwidget();"],
    ]);
  }

  it(
    'RED FIXTURE: a symbol whose only non-test mention is inside a comment is ' +
      'reported. Under W12-10 counting it read as used, which is how runClaimLoop ' +
      'hid — behind a docstring that literally says its only callers are its own ' +
      'tests. The comment admitting the defect was what concealed it',
    () => {
      const { production, tests } = countReferences(
        'widget',
        files,
        contents('// widget is deliberately not called here\nconst x = 1;'),
        files[0],
      );
      expect(production).toBe(0);
      expect(tests).toBe(1);
    },
  );

  it('a block comment and a JSDoc mention are equally not calls', () => {
    for (const text of ['/* widget */ const x = 1;', '/**\n * See widget.\n */\nconst x = 1;']) {
      expect(countReferences('widget', files, contents(text), files[0]).production).toBe(0);
    }
  });

  it('a REAL call still counts — the sharpening must not blind the check', () => {
    const { production } = countReferences(
      'widget',
      files,
      contents("import { widget } from './thing.js';\nwidget();"),
      files[0],
    );
    expect(production).toBe(1);
  });

  it(
    'and the real repo proves the composition, not just the helper: runClaimLoop ' +
      'is reported now. Its own docstring says its only callers are its own ' +
      'tests, and that sentence is what used to count as the caller',
    () => {
      const names = scan().findings.map((f) => f.symbol);
      expect(names).toContain('runClaimLoop');
    },
  );
});
