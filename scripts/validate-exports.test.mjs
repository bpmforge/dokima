import { describe, expect, it, vi } from 'vitest';
import {
  countReferences,
  unreachedMarkers,
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
      expect(
        isTestSupportFile('packages/gateway/src/providers/copilot-fixtures.ts'),
      ).toBe(true);
      expect(isTestSupportFile('packages/forge/src/mirror/mirror-test-helpers.ts')).toBe(
        true,
      );
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
  const files = [
    '/repo/pkg/src/thing.ts',
    '/repo/pkg/src/other.ts',
    '/repo/pkg/src/thing.test.ts',
  ];

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
    for (const text of [
      '/* widget */ const x = 1;',
      '/**\n * See widget.\n */\nconst x = 1;',
    ]) {
      expect(countReferences('widget', files, contents(text), files[0]).production).toBe(
        0,
      );
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
    'and the real repo proves the composition, not just the helper: gateDecision ' +
      'is reported. Every non-test reference to it is prose, and under W12-10 ' +
      'counting that prose read as a call',
    () => {
      // W21-36 deleted runClaimLoop, which was this assertion's original
      // subject — it was reported here for months, which is precisely how the
      // deletion became a decision someone could make. `gateDecision` is the
      // other symbol W12-39 hand-verified as comment-only, so the case keeps
      // testing the real repo rather than retreating to a fixture.
      const names = scan().findings.map((f) => f.symbol);
      expect(names).toContain('gateDecision');
      expect(names).not.toContain('runClaimLoop');
    },
  );
});

describe('the three degrees of unreached (W22-02)', () => {
  const files = [
    '/repo/pkg/src/thing.ts',
    '/repo/pkg/src/other.ts',
    '/repo/pkg/src/thing.test.ts',
  ];
  const contents = (decl, other, test) =>
    new Map([
      [files[0], decl],
      [files[1], other],
      [files[2], test],
    ]);

  it('separates a caller inside the declaring file from one outside it', () => {
    // The distinction criterion 4 asks for. `production` stays their sum, so
    // both calibrated baselines are untouched by the split.
    const { production, inFile, external } = countReferences(
      'widget',
      files,
      contents('export function widget() {}\nwidget();', 'const x = 1;', 'const y = 1;'),
      files[0],
    );
    expect(production).toBe(1);
    expect(inFile).toBe(1);
    expect(external).toBe(0);
  });

  it('counts an outside caller as external, not in-file', () => {
    const { inFile, external } = countReferences(
      'widget',
      files,
      contents('export function widget() {}', 'widget();', 'const y = 1;'),
      files[0],
    );
    expect(inFile).toBe(0);
    expect(external).toBe(1);
  });

  it('reports "no caller anywhere" apart from "tested but never called"', () => {
    const { unreferenced, findings, buried } = scan();
    // Disjoint by construction: findings/buried require tests > 0, this
    // category requires tests === 0. If they ever overlap, the two calibrated
    // baselines are silently counting something new.
    const gated = new Set(
      [...findings, ...buried].map((f) => `${f.package}:${f.symbol}`),
    );
    for (const u of unreferenced)
      expect(gated.has(`${u.package}:${u.symbol}`)).toBe(false);
    // ONE now, and the drop is the point. This was two: tickets:numberCriteria
    // and harbormaster:baseProbePath. W22-14 set out to mark baseProbePath as
    // deliberately unreached and found the opposite — it was a wire that had
    // never been connected, and `unfalsifiableCriteria`'s failure path needed
    // exactly the value it computes. Giving it a real caller is why this
    // number moved; lowering it without one would be the forbidden direction.
    expect(unreferenced.length).toBe(1);
    expect(unreferenced.map((u) => u.symbol)).not.toContain('baseProbePath');
  });

  it('adding the new categories did not move either gated number', () => {
    // The whole point of keeping them disjoint. If this fails, a baseline in
    // conductor.config.json is now measuring a different thing than it was
    // calibrated against.
    const { findings, buried } = scan();
    expect(findings.length).toBe(46);
    expect(buried.length).toBe(45);
  });
});

describe('the @unreached marker (W22-02)', () => {
  const files = [
    '/repo/pkg/src/thing.ts',
    '/repo/pkg/src/other.ts',
    '/repo/pkg/src/thing.test.ts',
  ];
  const contents = (decl, other, test) =>
    new Map([
      [files[0], decl],
      [files[1], other],
      [files[2], test],
    ]);

  it('parses a symbol and its reason', () => {
    const { markers, malformed } = unreachedMarkers(
      '// @unreached widget: kept for the published API, no internal caller by design',
    );
    expect(markers.get('widget')).toBe(
      'kept for the published API, no internal caller by design',
    );
    expect(malformed).toEqual([]);
  });

  it('REFUSES a marker with no reason rather than honouring it', () => {
    // A suppression with no recorded reason is indistinguishable from an
    // accident, which is the prose-intent-as-control this validator replaces.
    const { markers, malformed } = unreachedMarkers('// @unreached widget');
    expect(markers.size).toBe(0);
    expect(malformed).toEqual(['widget']);
  });

  it('survives a JSDoc block without swallowing the closing delimiter', () => {
    const { markers } = unreachedMarkers(
      '/**\n * @unreached widget: withheld until W99-01 wires it\n */',
    );
    expect(markers.get('widget')).toBe('withheld until W99-01 wires it');
  });

  it(
    'RED FIXTURE: naming the symbol in the marker must not COUNT as a call. ' +
      'If comments were not stripped, the marker would suppress through the ' +
      'wrong mechanism — a false negative wearing the costume of a decision, ' +
      'with the recorded reason doing no work at all',
    () => {
      const { production } = countReferences(
        'widget',
        files,
        contents(
          'export function widget() {}',
          '// @unreached widget: withheld until the consumer exists\nconst x = 1;',
          'const y = 1;',
        ),
        files[0],
      );
      expect(production).toBe(0);
    },
  );

  it('the repo carries no @unreached markers again — P5-01 wired the four P3-05 mechanisms and deleted them, as the markers themselves promised', () => {
    // History: pre-P3-05 this asserted suppressed === []; P3-05 landed four
    // marked mechanisms awaiting a caller; P5-01 (the product loop) IS that
    // caller — productLoop/gapsToProposals call all four — so the markers
    // are gone and the list shrank back to empty, the direction the marker
    // contract demands. A future marker must carry a reason and a named
    // wiring ticket, and this assertion grows with it, then shrinks again.
    const { suppressed, malformedMarkers } = scan();
    expect(suppressed).toEqual([]);
    expect(malformedMarkers).toEqual([]);
  });
});

describe('stripComments understands code, not just delimiters (W22-02)', () => {
  it('RED FIXTURE: a glob in a string is not a block comment', () => {
    // packages/pipeline/src/modes/feature.ts writes deliverable('src/**', ...).
    // The original regex read that `/*` as a comment opener and blanked
    // nineteen lines, so FEATURE_STEPS' only real use vanished and the symbol
    // was reported as referenced by nothing at all.
    const text = "const steps = ['src/**'];\nexport const A = 1;\nconst use = A;\n";
    const stripped = stripComments(text);
    expect(stripped).toContain('src/**');
    expect((stripped.match(/\bA\b/g) ?? []).length).toBe(2);
  });

  it('RED FIXTURE: a regex literal containing /* is not a block comment', () => {
    // packages/pipeline/src/decompose/linter.ts:172 is `if (!/[/*.]/.test(p))`.
    // A hand-written scanner that understood strings but not regex literals
    // read that as a comment opener and buried lintDecomposition's body,
    // making the three linter functions it calls look dead.
    const text = 'if (!/[/*.]/.test(p)) { helper(); }\nconst again = helper;\n';
    const stripped = stripComments(text);
    expect((stripped.match(/\bhelper\b/g) ?? []).length).toBe(2);
  });

  it('still blanks real comments — the sharpening must not blind the check', () => {
    const stripped = stripComments('// widget\n/* widget */\nconst x = 1;');
    expect(stripped).not.toContain('widget');
  });

  it('preserves length and line count, so nothing downstream shifts', () => {
    const text = "// a\nconst s = 'b/**c';\n/* d */ const e = /[/*]/;\n";
    const stripped = stripComments(text);
    expect(stripped.length).toBe(text.length);
    expect(stripped.split('\n').length).toBe(text.split('\n').length);
  });

  it('the fix removed false positives without moving either gated number', () => {
    // The whole reason this could be fixed inside this ticket: both ratchets
    // in conductor.config.json are calibrated against these counts, and a
    // counting change that moved them would need its own recalibration.
    const { findings, buried, unreferenced } = scan();
    expect(findings.length).toBe(46);
    expect(buried.length).toBe(45);
    // FEATURE_STEPS and IMPROVE_STEPS were reported as unreached by the broken
    // stripper. Both are used in their own files; neither is a finding now.
    const named = unreferenced.map((u) => u.symbol);
    expect(named).not.toContain('FEATURE_STEPS');
    expect(named).not.toContain('IMPROVE_STEPS');
  });
});
