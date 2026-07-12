import { describe, expect, it, vi } from 'vitest';
import {
  runMicroLoop,
  type MicroLoopCallbacks,
  type MicroLoopItem,
} from './micro-loop.js';

const ITEM: MicroLoopItem = {
  id: 'toy-item-1',
  description: 'Implement bounded queue pop()',
};

/**
 * A scripted stand-in for a model: one entry per pass, consumed in order.
 * Mirrors the "fake model" convention used across the loop/gateway
 * conformance suites (docs/TESTING.md §7) without depending on the real
 * Model Gateway (W2), which this ticket does not require.
 */
function fakeModel(
  passes: ReadonlyArray<{
    passed: boolean;
    gaps?: { id: string; description: string }[];
  }>,
) {
  let call = 0;
  return {
    restateCriterion: vi.fn().mockResolvedValue({
      checkable: true,
      statement: 'pop() removes and returns the oldest element, or throws when empty',
    }),
    produce: vi.fn().mockResolvedValue({ output: 'function pop() { /* ... */ }' }),
    gatherEvidence: vi
      .fn()
      .mockResolvedValue([
        { kind: 'run', detail: 'vitest queue.test.ts', result: 'ran' },
      ]),
    selfVerify: vi.fn().mockImplementation(async () => {
      const pass = passes[call];
      call += 1;
      if (!pass) throw new Error('fakeModel: no scripted pass left');
      return { passed: pass.passed, gaps: pass.gaps ?? [] };
    }),
  } satisfies MicroLoopCallbacks;
}

/**
 * Conformance suite adapted from the source-system micro-loop semantics
 * (docs/research/source-system-foreman-jarvis.md §2, `runItemMicroLoop` +
 * the MICRO_LOOP contract) — behavior parity per D-008, not code copying.
 * Each test title quotes the source-derived requirement it ports
 * (SRS FR-L1 conformance column).
 */
describe('source-system micro-loop semantics conformance (docs/research/source-system-foreman-jarvis.md §2)', () => {
  it('"undecidable-criterion item refuses to run"', async () => {
    const callbacks: MicroLoopCallbacks = {
      restateCriterion: vi.fn().mockResolvedValue({
        checkable: false,
        reason:
          'the item is a vague research question with no objectively checkable outcome',
      }),
      produce: vi.fn(),
      gatherEvidence: vi.fn(),
      selfVerify: vi.fn(),
    };

    const result = await runMicroLoop(ITEM, callbacks);

    expect(result.status).toBe('BLOCKED');
    expect(callbacks.produce).not.toHaveBeenCalled();
  });

  it('"identical gap set two passes running kills the loop"', async () => {
    const repeatedGaps = [
      { id: 'gap-empty-throw', description: 'pop() on empty queue does not throw' },
    ];
    const callbacks = fakeModel([
      { passed: false, gaps: repeatedGaps },
      { passed: false, gaps: repeatedGaps },
      { passed: false, gaps: repeatedGaps },
    ]);

    const result = await runMicroLoop(ITEM, callbacks, { maxPasses: 3 });

    expect(result.status).toBe('PARTIAL');
    if (result.status === 'PARTIAL') {
      expect(result.reason).toBe('no-progress');
    }
    // Kill fires on the second identical gap set — pass 3 is never attempted.
    expect(callbacks.selfVerify).toHaveBeenCalledTimes(2);
  });

  it('"PARTIAL exit records the lesson" with the specific unresolved gaps', async () => {
    const gaps = [
      {
        id: 'gap-fifo-order',
        description: 'pop() returns newest instead of oldest element',
      },
    ];
    const callbacks = fakeModel([
      { passed: false, gaps },
      { passed: false, gaps },
    ]);

    const result = await runMicroLoop(ITEM, callbacks, { maxPasses: 2 });

    expect(result.status).toBe('PARTIAL');
    if (result.status === 'PARTIAL') {
      expect(result.lesson).toContain('toy-item-1');
      expect(result.lesson).toContain('gap-fifo-order');
    }
  });

  it('"focused call -> self-grade -> re-validate with gap feedback, until gate passes or maxPasses" reaches DONE within the pass budget', async () => {
    const callbacks = fakeModel([
      {
        passed: false,
        gaps: [{ id: 'gap-fifo-order', description: 'wrong element order' }],
      },
      { passed: true },
    ]);

    const result = await runMicroLoop(ITEM, callbacks, { maxPasses: 3 });

    expect(result.status).toBe('DONE');
    if (result.status === 'DONE') {
      expect(result.manifest.passesUsed).toBe(2);
    }
  });

  it('"bounded look-actions (<=4)" — evidence step is capped, not open-ended tool use', async () => {
    const callbacks = fakeModel([{ passed: true }]);
    callbacks.gatherEvidence = vi.fn().mockResolvedValue([
      { kind: 'grep', detail: 'a', result: 'x' },
      { kind: 'grep', detail: 'b', result: 'x' },
      { kind: 'read', detail: 'c', result: 'x' },
      { kind: 'run', detail: 'd', result: 'x' },
      { kind: 'run', detail: 'e', result: 'x' },
    ]);

    await expect(runMicroLoop(ITEM, callbacks)).rejects.toThrow(/exceeding the bound/);
  });
});
