import { describe, expect, it, vi } from 'vitest';
import {
  computeGapChecksum,
  runMicroLoop,
  type MicroLoopCallbacks,
  type MicroLoopGap,
  type MicroLoopItem,
} from './micro-loop.js';

const ITEM: MicroLoopItem = {
  id: 'item-1',
  description: 'Add input validation to /login',
};

function checkableCriterion(statement = 'pnpm test packages/example passes') {
  return { checkable: true as const, statement };
}

function passingCallbacks(
  overrides: Partial<MicroLoopCallbacks> = {},
): MicroLoopCallbacks {
  return {
    restateCriterion: vi.fn().mockResolvedValue(checkableCriterion()),
    produce: vi.fn().mockResolvedValue({ output: 'diff' }),
    gatherEvidence: vi.fn().mockResolvedValue([]),
    selfVerify: vi.fn().mockResolvedValue({ passed: true, gaps: [] }),
    ...overrides,
  };
}

describe('runMicroLoop — CRITERION / refuse-to-loop', () => {
  it('returns BLOCKED and never calls produce when no checkable criterion exists', async () => {
    const produce = vi.fn();
    const callbacks = passingCallbacks({
      restateCriterion: vi.fn().mockResolvedValue({
        checkable: false,
        reason: 'no objectively decidable success criterion for this item',
      }),
      produce,
    });

    const result = await runMicroLoop(ITEM, callbacks);

    expect(result.status).toBe('BLOCKED');
    if (result.status === 'BLOCKED') {
      expect(result.reason).toMatch(/no objectively decidable/);
    }
    expect(produce).not.toHaveBeenCalled();
  });
});

describe('runMicroLoop — DONE path', () => {
  it('exits DONE on the first passing self-verify and reports passesUsed', async () => {
    const callbacks = passingCallbacks();

    const result = await runMicroLoop(ITEM, callbacks);

    expect(result.status).toBe('DONE');
    if (result.status === 'DONE') {
      expect(result.manifest.passesUsed).toBe(1);
      expect(result.manifest.criterion).toBe('pnpm test packages/example passes');
      expect(result.passes).toHaveLength(1);
    }
  });

  it('feeds specific gaps from a failed pass into the next PRODUCE call, then exits DONE', async () => {
    const gap: MicroLoopGap = {
      id: 'gap-1',
      description: 'missing null check on email field',
    };
    const selfVerify = vi
      .fn()
      .mockResolvedValueOnce({ passed: false, gaps: [gap] })
      .mockResolvedValueOnce({ passed: true, gaps: [] });
    const produce = vi.fn().mockResolvedValue({ output: 'diff' });
    const callbacks = passingCallbacks({ produce, selfVerify });

    const result = await runMicroLoop(ITEM, callbacks);

    expect(result.status).toBe('DONE');
    expect(produce).toHaveBeenCalledTimes(2);
    expect(produce.mock.calls[0]![0]).toMatchObject({ passNumber: 1, priorGaps: [] });
    expect(produce.mock.calls[1]![0]).toMatchObject({ passNumber: 2, priorGaps: [gap] });
  });
});

describe('runMicroLoop — REVISE / no-progress kill', () => {
  it('kills the loop with PARTIAL "no-progress" when the gap checksum repeats', async () => {
    const gap: MicroLoopGap = { id: 'gap-1', description: 'still missing null check' };
    const selfVerify = vi.fn().mockResolvedValue({ passed: false, gaps: [gap] });
    const callbacks = passingCallbacks({ selfVerify });

    const result = await runMicroLoop(ITEM, callbacks, { maxPasses: 3 });

    expect(result.status).toBe('PARTIAL');
    if (result.status === 'PARTIAL') {
      expect(result.reason).toBe('no-progress');
      expect(result.lesson).toMatch(/gap-1/);
    }
    // Killed after pass 2 confirms the checksum repeats; pass 3 never runs.
    expect(selfVerify).toHaveBeenCalledTimes(2);
  });

  it('does not kill when the gap set changes between passes', async () => {
    const selfVerify = vi
      .fn()
      .mockResolvedValueOnce({
        passed: false,
        gaps: [{ id: 'gap-1', description: 'missing null check' }],
      })
      .mockResolvedValueOnce({
        passed: false,
        gaps: [{ id: 'gap-2', description: 'missing rate limit' }],
      })
      .mockResolvedValueOnce({ passed: true, gaps: [] });
    const callbacks = passingCallbacks({ selfVerify });

    const result = await runMicroLoop(ITEM, callbacks, { maxPasses: 3 });

    expect(result.status).toBe('DONE');
    expect(selfVerify).toHaveBeenCalledTimes(3);
  });

  it('exits PARTIAL "max-passes-exhausted" when bounded passes run out without a repeat', async () => {
    let counter = 0;
    const selfVerify = vi.fn().mockImplementation(async () => {
      counter += 1;
      return {
        passed: false,
        gaps: [{ id: `gap-${counter}`, description: `distinct gap ${counter}` }],
      };
    });
    const callbacks = passingCallbacks({ selfVerify });

    const result = await runMicroLoop(ITEM, callbacks, { maxPasses: 2 });

    expect(result.status).toBe('PARTIAL');
    if (result.status === 'PARTIAL') {
      expect(result.reason).toBe('max-passes-exhausted');
    }
    expect(selfVerify).toHaveBeenCalledTimes(2);
  });

  it('rejects maxPasses that is not a positive integer', async () => {
    const callbacks = passingCallbacks();
    await expect(runMicroLoop(ITEM, callbacks, { maxPasses: 0 })).rejects.toThrow(
      RangeError,
    );
  });
});

describe('runMicroLoop — EVIDENCE bound', () => {
  it('throws when gatherEvidence exceeds the bounded look-action count', async () => {
    const evidence = Array.from({ length: 5 }, (_, i) => ({
      kind: 'grep',
      detail: `search ${i}`,
      result: 'no match',
    }));
    const callbacks = passingCallbacks({
      gatherEvidence: vi.fn().mockResolvedValue(evidence),
    });

    await expect(runMicroLoop(ITEM, callbacks)).rejects.toThrow(/exceeding the bound/);
  });

  it('allows exactly the bound (4) look-actions', async () => {
    const evidence = Array.from({ length: 4 }, (_, i) => ({
      kind: 'grep',
      detail: `search ${i}`,
      result: 'no match',
    }));
    const callbacks = passingCallbacks({
      gatherEvidence: vi.fn().mockResolvedValue(evidence),
    });

    const result = await runMicroLoop(ITEM, callbacks);
    expect(result.status).toBe('DONE');
  });
});

describe('runMicroLoop — honest failure contract', () => {
  it('throws when selfVerify fails with no gaps (specific-gap feedback is mandatory)', async () => {
    const callbacks = passingCallbacks({
      selfVerify: vi.fn().mockResolvedValue({ passed: false, gaps: [] }),
    });

    await expect(runMicroLoop(ITEM, callbacks)).rejects.toThrow(/specific-gap feedback/);
  });
});

describe('computeGapChecksum', () => {
  it('is order-independent over the gap set', () => {
    const a: MicroLoopGap[] = [
      { id: 'g1', description: 'first' },
      { id: 'g2', description: 'second' },
    ];
    const b: MicroLoopGap[] = [
      { id: 'g2', description: 'second' },
      { id: 'g1', description: 'first' },
    ];
    expect(computeGapChecksum(a)).toBe(computeGapChecksum(b));
  });

  it('differs when gap content differs', () => {
    const a: MicroLoopGap[] = [{ id: 'g1', description: 'first' }];
    const b: MicroLoopGap[] = [{ id: 'g1', description: 'first (revised)' }];
    expect(computeGapChecksum(a)).not.toBe(computeGapChecksum(b));
  });
});
