/**
 * W13-23. The anchor SET, not the anchor.
 */
import { describe, expect, it } from 'vitest';
import type { Anchor } from '@dokima/loop';
import { buildAnchorBlock } from './session-anchors.js';

const BASE = {
  ticketId: 'T-1',
  itemDescription: 'implement subtract',
  criterion: 'node src/check.mjs',
};

function memoryAnchorSaying(statement: string): Anchor {
  return {
    kind: 'memory',
    gather: async () => [{ kind: 'memory' as const, source: 'fact-1', statement }],
  } as unknown as Anchor;
}

describe('buildAnchorBlock (W13-23)', () => {
  it('says nothing when no anchor has anything to say', async () => {
    expect(await buildAnchorBlock({ ...BASE, validatorResults: [] })).toBeNull();
  });

  it(
    'RED FIXTURE: memory recalls on the FIRST turn, before any verify has run. ' +
      'The old block began `if (validatorResults.length === 0) return` — right ' +
      'while the tool anchor was the only one, and precisely wrong for memory, ' +
      'whose value is highest before the model has done anything',
    async () => {
      const block = await buildAnchorBlock({
        ...BASE,
        validatorResults: [],
        memoryAnchor: memoryAnchorSaying('subtract must handle negative operands'),
      });
      expect(block).not.toBeNull();
      expect(block).toContain('subtract must handle negative operands');
    },
  );

  it('composes tool and memory facts together once both have something', async () => {
    const block = await buildAnchorBlock({
      ...BASE,
      validatorResults: [{ name: 'verify', exitCode: 1, gapCount: 1 }],
      memoryAnchor: memoryAnchorSaying('a prior run failed on the same command'),
    });
    expect(block).toContain('verify');
    expect(block).toContain('a prior run failed on the same command');
  });

  it(
    'REDACTS recalled facts, not only tool output. A fact stored before a ' +
      'secret was registered would otherwise be read back out in the clear ' +
      '(FR-S2/SC-06)',
    async () => {
      const block = await buildAnchorBlock({
        ...BASE,
        validatorResults: [],
        memoryAnchor: memoryAnchorSaying('the token is hunter2-abcdef and it worked'),
        secretValues: ['hunter2-abcdef'],
      });
      expect(block).not.toContain('hunter2-abcdef');
    },
  );

  it('a memory anchor that recalls nothing leaves the block absent, not empty', async () => {
    const silent = { kind: 'memory', gather: async () => [] } as unknown as Anchor;
    expect(
      await buildAnchorBlock({ ...BASE, validatorResults: [], memoryAnchor: silent }),
    ).toBeNull();
  });
});
