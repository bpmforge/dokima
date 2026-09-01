// product-loop.test.mjs — P5-01: the product goal loop. RED provenance: the
// board could drain to 100% done with stories unproven and nothing noticed —
// the A-1 class at system level. Exit is mechanical (assemblyGate + verify),
// never model prose; the two halts are the goal-skill budget rules.

import { describe, it, expect } from 'vitest';
import {
  buildLedger,
  gapsToProposals,
  makeDrivePort,
  productLoop,
} from './product-loop.mjs';

const SRS =
  'The app shall let users sign in (US-1). Admins export data (US-2). FR-AUTH-1 governs sessions.';
const ticket = (id, over = {}) => ({
  id,
  title: `${id} work`,
  lane: 'product',
  write_scope: ['x/**'],
  depends_on: [],
  acceptance: [`does ${id}`],
  points: 2,
  status: 'done',
  ...over,
});

const US_RE = /\b(US-\d+|FR-[A-Z0-9]+(?:-[A-Z0-9]+)*)\b/g;
const asmStubFull = {
  deriveRequirementIds: (t) => [...new Set([...t.matchAll(US_RE)].map((m) => m[1]))],
  assemblyGate: ({ ledger, requirementIds, testExists }) => {
    const gaps = [];
    for (const id of requirementIds) {
      const e = ledger[id];
      if (!e || e.implementingTickets.length === 0)
        gaps.push(
          `requirement ${id} is uncovered: ${id} is in the SRS but no ticket implements it (A-1 silent divergence)`,
        );
      else if (!e.provingTests.some((p) => testExists(p)))
        gaps.push(`requirement ${id} is coded-not-done: no existing proving test`);
    }
    return { pass: gaps.length === 0, gaps };
  },
  missingAssemblyTickets: () => [],
  generateAssemblyTickets: () => [],
  longTailGaps: () => [],
  generateLongTailWave: () => [],
};

function makePorts(over = {}) {
  const board = over.board ?? [];
  const appended = [];
  const ledgers = [];
  const conductorRuns = [];
  const logs = [];
  return {
    appended,
    ledgers,
    conductorRuns,
    logs,
    ports: {
      readSources: () => over.srs ?? SRS,
      readBoard: () => [...board, ...appended.flat()],
      appendTickets: (rows) => void appended.push(rows),
      writeLedger: (l) => void ledgers.push(l),
      provingTestsFor: over.provingTestsFor ?? (() => []),
      testExists: over.testExists ?? (() => false),
      seams: () => over.seams ?? [],
      seamResults: () => over.seamResults ?? [],
      verifyMain: over.verifyMain ?? (() => ({ green: true })),
      runConductor: (o) => void conductorRuns.push(o),
      log: (kind, data) => void logs.push({ kind, ...data }),
      assembler: over.assembler === null ? undefined : (over.assembler ?? asmStubFull),
      ...over.ports,
    },
  };
}

describe('buildLedger — evidence-derived, spec-denominated (P5-01)', () => {
  it('maps requirement ids to citing tickets and proving tests', () => {
    const l = buildLedger({
      requirementIds: ['US-1', 'US-2'],
      tickets: [ticket('T-1', { acceptance: ['implements US-1 login'] })],
      provingTestsFor: (id) => (id === 'US-1' ? ['e2e/us1.spec.ts'] : []),
    });
    expect(l['US-1'].implementingTickets).toEqual(['T-1']);
    expect(l['US-1'].provingTests).toEqual(['e2e/us1.spec.ts']);
    expect(l['US-2'].implementingTickets).toEqual([]);
  });
});

describe('gapsToProposals (P5-01)', () => {
  const asmStub = {
    missingAssemblyTickets: () => [],
    generateAssemblyTickets: () => [],
    longTailGaps: () => [],
    generateLongTailWave: () => [],
  };

  it('uncovered -> implementation proposal; coded-not-done -> proof proposal; both risk-taggable board rows', () => {
    const p = gapsToProposals({
      gaps: [
        'requirement US-1 is uncovered: US-1 is in the SRS but no ticket implements it (A-1 silent divergence)',
        'requirement US-2 is coded-not-done: US-2 has implementing tickets (T-9) but no proving test is listed',
      ],
      seams: [],
      tickets: [],
      asm: asmStub,
    });
    expect(p.map((x) => x.id)).toEqual(['PRD-US-1', 'PRF-US-2']);
    expect(p.every((x) => x.proposed_by === 'product-loop')).toBe(true);
    expect(p[0].acceptance[0]).toContain('US-1');
  });

  it('never duplicates an existing or already-proposed id', () => {
    const p = gapsToProposals({
      gaps: [
        'requirement US-1 is uncovered: x',
        'requirement US-1 is uncovered: repeated gap wording',
      ],
      seams: [],
      tickets: [ticket('PRD-US-9')],
      asm: asmStub,
    });
    expect(p.map((x) => x.id)).toEqual(['PRD-US-1']);
  });
});

describe('productLoop (P5-01) — the goal-skill contract, executable', () => {
  it('EXIT: a proven product (gate pass + verify green) ends the loop — done means done', async () => {
    const h = makePorts({
      srs: 'Only US-1 exists.',
      board: [ticket('T-1', { acceptance: ['US-1 shipped'] })],
      provingTestsFor: () => ['e2e/us1.spec.ts'],
      testExists: () => true,
    });
    const r = await productLoop(h.ports);
    expect(r.done).toBe(true);
    expect(r.iterations).toBe(1);
    expect(h.conductorRuns).toHaveLength(0); // nothing to drive — already proven
    expect(h.logs.find((l) => l.kind === 'product.done').msg).toContain(
      'done meaning done',
    );
  });

  it('GAP+DRIVE: an unproven story proposes tickets and runs the conductor; ledger written every iteration', async () => {
    let pass = 0;
    const h = makePorts({
      srs: 'Only US-1 exists.',
      board: [],
      // becomes proven after one conductor drive
      provingTestsFor: () => (pass > 0 ? ['e2e/us1.spec.ts'] : []),
      testExists: () => pass > 0,
      ports: {},
    });
    h.ports.runConductor = (o) => {
      pass++;
      h.conductorRuns.push(o);
    };
    const r = await productLoop(h.ports);
    expect(r.done).toBe(true);
    expect(r.iterations).toBe(2);
    expect(h.appended.flat().some((t) => t.id === 'PRD-US-1')).toBe(true);
    expect(h.conductorRuns).toEqual([{ maxTickets: 8 }]);
    expect(h.ledgers).toHaveLength(2);
  });

  it('NO-PROGRESS HALT: a byte-identical gap set stops the loop for a human — iterating again is futile', async () => {
    // Genuinely stuck: the proposal writer is frozen (operator hold / board
    // read-only), so iteration 2 sees EXACTLY iteration 1's gaps. A normal
    // run shifts uncovered -> coded-not-done via its own proposal first —
    // that class shift is progress and correctly does NOT halt.
    const h = makePorts({ srs: 'Only US-1 exists.', board: [] });
    h.ports.appendTickets = () => {};
    const r = await productLoop(h.ports);
    expect(r.done).toBe(false);
    expect(r.halt).toBe('no-progress');
    expect(r.iterations).toBe(2); // iteration 2 saw the identical gaps and refused a 3rd
    expect(r.stuckGaps.some((g) => g.includes('US-1'))).toBe(true);
  });

  it('ITERATION CAP: gaps that keep CHANGING still hit the budget ceiling, never a silent extra lap', async () => {
    let n = 0;
    const h = makePorts({
      board: [],
      // a rotating verify detail makes every iteration's gap set unique
      verifyMain: () => ({ green: false, detail: `flake-${n++}` }),
    });
    const r = await productLoop(h.ports, { maxIterations: 3 });
    expect(r.done).toBe(false);
    expect(r.halt).toBe('iteration-cap');
    expect(r.iterations).toBe(3);
    expect(h.conductorRuns).toHaveLength(3);
  });

  it('a RED verify on main blocks DONE even when the paperwork gate passes — receipts outrank bookkeeping', async () => {
    const h = makePorts({
      srs: 'Only US-1 exists.',
      board: [ticket('T-1', { acceptance: ['US-1 shipped'] })],
      provingTestsFor: () => ['e2e/us1.spec.ts'],
      testExists: () => true,
      verifyMain: () => ({ green: false, detail: 'pnpm test exit 1' }),
    });
    const r = await productLoop(h.ports, { maxIterations: 1 });
    expect(r.done).toBe(false);
  });
});

describe('productLoop with the REAL assembler (integration)', () => {
  it('the long-tail wave is PROPOSED by the loop and blocks DONE until its tickets are done', async () => {
    let driven = 0;
    const h = makePorts({
      srs: 'Only US-1 exists.',
      board: [ticket('T-1', { acceptance: ['US-1 shipped'] })],
      provingTestsFor: () => ['e2e/us1.spec.ts'],
      testExists: () => true,
      assembler: null, // force the real lazy TS import
    });
    h.ports.runConductor = (o) => {
      driven++;
      for (const batch of h.appended) for (const row of batch) row.status = 'done';
      h.conductorRuns.push(o);
    };
    const r = await productLoop(h.ports, { maxIterations: 3 });
    expect(r.done).toBe(true);
    expect(h.appended.flat().some((t) => t.long_tail === true)).toBe(true);
    expect(driven).toBe(1);
  });
});

describe('makeDrivePort (P6-03) — one loop, two engines, same call', () => {
  const recorder = () => {
    const calls = [];
    return { calls, spawn: (cmd, args) => void calls.push({ cmd, args }) };
  };

  it('conductor engine maps maxTickets to the bootstrap harness dial', () => {
    const r = recorder();
    makeDrivePort({ engine: 'conductor', spawn: r.spawn })({ maxTickets: 8 });
    expect(r.calls).toEqual([
      { cmd: 'node', args: ['scripts/conductor.mjs', '--max-tickets', '8'] },
    ]);
  });

  it("berths engine drives the PRODUCT's own run-start path with its own dials", () => {
    const r = recorder();
    makeDrivePort({ engine: 'berths', spawn: r.spawn, projectId: 'proj-1', berths: 3 })({
      maxTickets: 8,
    });
    const [{ cmd, args }] = r.calls;
    expect(cmd).toBe('node');
    expect(args[0]).toBe('apps/server/src/bootstrap/cli-entry.mjs');
    expect(args.slice(1, 3)).toEqual(['run', 'start']);
    expect(args).toContain('--project');
    expect(args[args.indexOf('--berths') + 1]).toBe('3');
    expect(args[args.indexOf('--breakpoint') + 1]).toBe('never');
    // maxTickets is deliberately NOT smuggled into a berths dial
    expect(args).not.toContain('8');
  });

  it('BOTH engines receive the drive call UNCHANGED from the loop', async () => {
    for (const engine of ['conductor', 'berths']) {
      let pass = 0;
      const r = recorder();
      const h = makePorts({
        srs: 'Only US-1 exists.',
        board: [],
        provingTestsFor: () => (pass > 0 ? ['e2e/us1.spec.ts'] : []),
        testExists: () => pass > 0,
      });
      h.ports.runConductor = (call) => {
        pass++;
        expect(call).toEqual({ maxTickets: 8 }); // identical shape either engine
        makeDrivePort({ engine, spawn: r.spawn, projectId: 'p' })(call);
      };
      const res = await productLoop(h.ports);
      expect(res.done).toBe(true);
      expect(r.calls).toHaveLength(1); // the engine was actually driven
    }
  });

  it('unknown engine and berths-without-project both refuse loudly', () => {
    expect(() => makeDrivePort({ engine: 'warp', spawn: () => {} })).toThrow(
      /conductor\|berths/,
    );
    expect(() => makeDrivePort({ engine: 'berths', spawn: () => {} })).toThrow(
      /project id/,
    );
  });
});

describe('P6-09 — the loop runs under PLAIN node, not only vitest', () => {
  it('a spawned plain-node process loads the REAL assembler (red = assembler-unavailable, the first live run)', async () => {
    const { execFileSync } = await import('node:child_process');
    const script = `
      const { productLoop } = await import('./scripts/conductor/product-loop.mjs');
      const r = await productLoop({
        readSources: () => 'Only US-1 exists.',
        readBoard: () => [],
        appendTickets: () => {},
        writeLedger: () => {},
        provingTestsFor: () => [],
        testExists: () => false,
        seams: () => [],
        seamResults: () => [],
        verifyMain: () => ({ green: false, detail: 'x' }),
        runConductor: () => {},
        log: () => {},
      }, { maxIterations: 1 });
      console.log(JSON.stringify({ halt: r.halt ?? null }));
    `;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: new URL('../..', import.meta.url).pathname,
      encoding: 'utf8',
    });
    const { halt } = JSON.parse(out.trim().split('\n').pop());
    expect(halt).not.toBe('assembler-unavailable');
    expect(halt).toBe('iteration-cap'); // the real assembler measured a real gap set
  }, 30_000);
});

describe('P6-12 — redundant PRF rows are NAMED for retirement, never silently kept', () => {
  it('a PRF whose requirement closed is named; one still needed is not; the loop flips no state itself', async () => {
    const h = makePorts({
      srs: 'US-1 and US-2 exist.',
      board: [
        ticket('T-1', { acceptance: ['implements US-1'] }),
        ticket('PRF-US-1', { status: 'todo' }), // redundant: US-1 closed below
        ticket('T-2', { acceptance: ['implements US-2'] }),
        ticket('PRF-US-2', { status: 'todo' }), // still needed: US-2 has no test
      ],
      provingTestsFor: (id) => (id === 'US-1' ? ['e2e/us1.spec.ts'] : []),
      testExists: (p) => p === 'e2e/us1.spec.ts',
    });
    await productLoop(h.ports, { maxIterations: 1 });
    const named = h.logs.find((l) => l.kind === 'product.redundant');
    expect(named.msg).toContain('PRF-US-1');
    expect(named.msg).not.toContain('PRF-US-2');
    // the loop holds no verb: the board rows were not mutated
    expect(h.ports.readBoard().find((t) => t.id === 'PRF-US-1').status).toBe('todo');
  });
});
