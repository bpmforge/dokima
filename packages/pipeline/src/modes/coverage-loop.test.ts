import { describe, expect, it } from 'vitest';
import {
  computeGapChecksum,
  runCoverageLoop,
  runCoverageLoopForMode,
  type CoverageLoopDeps,
  type CoverageRow,
} from './coverage-loop.js';

const ROW_A: CoverageRow = { id: 'A', category: 'ROUTE', description: 'route A' };
const ROW_B: CoverageRow = { id: 'B', category: 'ROUTE', description: 'route B' };
const ROW_C: CoverageRow = { id: 'C', category: 'ROUTE', description: 'route C' };

function depsReturning(sequence: readonly (readonly CoverageRow[])[]): CoverageLoopDeps {
  let call = 0;
  return {
    discoverRows: () => {},
    verifyCoverage: () => {
      const rows = sequence[Math.min(call, sequence.length - 1)] ?? [];
      call += 1;
      return rows;
    },
  };
}

describe('computeGapChecksum', () => {
  it('is order-independent over the same gap set', () => {
    expect(computeGapChecksum([ROW_A, ROW_B])).toBe(computeGapChecksum([ROW_B, ROW_A]));
  });

  it('differs when the gap set differs', () => {
    expect(computeGapChecksum([ROW_A])).not.toBe(computeGapChecksum([ROW_A, ROW_B]));
  });

  it('is stable for the empty set', () => {
    expect(computeGapChecksum([])).toBe(computeGapChecksum([]));
  });
});

describe('runCoverageLoop', () => {
  it('rejects a non-positive-integer cap', async () => {
    await expect(runCoverageLoop([ROW_A], depsReturning([[]]), 0)).rejects.toThrow(
      RangeError,
    );
    await expect(runCoverageLoop([ROW_A], depsReturning([[]]), 1.5)).rejects.toThrow(
      RangeError,
    );
  });

  it('returns covered as soon as VERIFY reports zero uncovered rows', async () => {
    const result = await runCoverageLoop([ROW_A, ROW_B], depsReturning([[]]), 3);
    expect(result.status).toBe('covered');
    expect(result.remainingGaps).toEqual([]);
    expect(result.iterations).toHaveLength(1);
  });

  it('GAP step: each iteration re-discovers only the previously uncovered rows', async () => {
    const attempts: (readonly CoverageRow[])[] = [];
    const deps: CoverageLoopDeps = {
      discoverRows: (rows) => {
        attempts.push(rows);
      },
      verifyCoverage: (() => {
        let call = 0;
        return () => {
          const uncovered = call === 0 ? [ROW_A, ROW_B] : [];
          call += 1;
          return uncovered;
        };
      })(),
    };

    await runCoverageLoop([ROW_A, ROW_B, ROW_C], deps, 3);

    expect(attempts[0]).toEqual([ROW_A, ROW_B, ROW_C]);
    expect(attempts[1]).toEqual([ROW_A, ROW_B]);
  });

  it('mode-aware cap (R-B5): a gap set that keeps changing exhausts the cap, not a fixed count', async () => {
    // Every VERIFY returns a *different* non-empty gap set, so the
    // byte-identical no-progress halt never fires — the only thing that
    // can stop the loop is the cap itself.
    const everChangingDeps = (): CoverageLoopDeps => {
      let call = 0;
      return {
        discoverRows: () => {},
        verifyCoverage: () => {
          call += 1;
          return [{ id: `GAP-${call}`, category: 'ROUTE', description: `gap ${call}` }];
        },
      };
    };

    const featureResult = await runCoverageLoop([ROW_A], everChangingDeps(), 2);
    expect(featureResult.status).toBe('cap-exhausted');
    expect(featureResult.iterations).toHaveLength(2);

    const onboardResult = await runCoverageLoop([ROW_A], everChangingDeps(), 3);
    expect(onboardResult.status).toBe('cap-exhausted');
    expect(onboardResult.iterations).toHaveLength(3);
  });

  it('byte-identical gap-set early-halt: halts at iteration 2, never reaching a cap of 3', async () => {
    const deps = depsReturning([
      [ROW_A, ROW_B],
      [ROW_A, ROW_B],
      [ROW_A, ROW_B],
    ]);
    const result = await runCoverageLoop([ROW_A, ROW_B, ROW_C], deps, 3);

    expect(result.status).toBe('no-progress');
    expect(result.iterations).toHaveLength(2);
    expect(result.remainingGaps).toEqual([ROW_A, ROW_B]);
  });

  it('does not treat two different iterations that both merely have nonempty gaps as no-progress', async () => {
    const deps = depsReturning([[ROW_A, ROW_B], [ROW_A], [ROW_B]]);
    const result = await runCoverageLoop([ROW_A, ROW_B], deps, 3);
    expect(result.status).toBe('cap-exhausted');
    expect(result.iterations).toHaveLength(3);
  });
});

describe('runCoverageLoopForMode', () => {
  it('R-B5 wired: feature/improve halt at cap 2, new-product/onboard at cap 3, using the SAME ever-changing gap set', async () => {
    const everChangingDeps = (): CoverageLoopDeps => {
      let call = 0;
      return {
        discoverRows: () => {},
        verifyCoverage: () => {
          call += 1;
          return [{ id: `GAP-${call}`, category: 'ROUTE', description: `gap ${call}` }];
        },
      };
    };

    const feature = await runCoverageLoopForMode('feature', [ROW_A], everChangingDeps());
    const improve = await runCoverageLoopForMode('improve', [ROW_A], everChangingDeps());
    const newProduct = await runCoverageLoopForMode(
      'new-product',
      [ROW_A],
      everChangingDeps(),
    );
    const onboard = await runCoverageLoopForMode('onboard', [ROW_A], everChangingDeps());

    expect(feature.iterations).toHaveLength(2);
    expect(improve.iterations).toHaveLength(2);
    expect(newProduct.iterations).toHaveLength(3);
    expect(onboard.iterations).toHaveLength(3);
    for (const result of [feature, improve, newProduct, onboard]) {
      expect(result.status).toBe('cap-exhausted');
    }
  });

  it('byte-identical gap-set early-halt applies in every mode, including caps of 3', async () => {
    for (const mode of ['new-product', 'onboard'] as const) {
      const deps = depsReturning([[ROW_A], [ROW_A], [ROW_A]]);
      const result = await runCoverageLoopForMode(mode, [ROW_A], deps);
      expect(result.status).toBe('no-progress');
      expect(result.iterations).toHaveLength(2);
    }
    for (const mode of ['feature', 'improve'] as const) {
      const deps = depsReturning([[ROW_A], [ROW_A]]);
      const result = await runCoverageLoopForMode(mode, [ROW_A], deps);
      expect(result.status).toBe('no-progress');
      expect(result.iterations).toHaveLength(2);
    }
  });
});
