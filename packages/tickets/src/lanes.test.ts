import { describe, expect, it } from 'vitest';
import {
  findLaneScopeViolations,
  globOverlaps,
  LaneScopeError,
  validateLaneWriteScopes,
  writeScopesOverlap,
} from './lanes.js';
import type { Ticket } from './types.js';

function ticket(
  overrides: Partial<Ticket> & Pick<Ticket, 'id' | 'lane' | 'writeScope'>,
): Ticket {
  return {
    type: 'task',
    title: overrides.id,
    ownerId: null,
    status: 'ready',
    interface: null,
    dependsOn: [],
    acceptance: [],
    verify: null,
    manifest: null,
    history: [],
    evidence: [],
    claimedAt: null,
    claimRunId: null,
    closedAt: null,
    ...overrides,
  };
}

describe('globOverlaps (FR-T3 glob-overlap detection)', () => {
  it('two identical literal paths overlap', () => {
    expect(
      globOverlaps('packages/tickets/src/lanes.ts', 'packages/tickets/src/lanes.ts'),
    ).toBe(true);
  });

  it('a `**` subtree glob overlaps a literal file beneath it', () => {
    expect(globOverlaps('packages/tickets/**', 'packages/tickets/src/lanes.ts')).toBe(
      true,
    );
    expect(globOverlaps('packages/tickets/src/lanes.ts', 'packages/tickets/**')).toBe(
      true,
    );
  });

  it('two `**` subtrees under different top-level dirs do not overlap', () => {
    expect(globOverlaps('apps/**', 'packages/**')).toBe(false);
  });

  it('prefix-star globs overlap only when the prefix matches', () => {
    expect(
      globOverlaps(
        'packages/tickets/src/lanes*',
        'packages/tickets/src/lanes.property.test.ts',
      ),
    ).toBe(true);
    expect(
      globOverlaps('packages/tickets/src/lanes*', 'packages/tickets/src/reflow.ts'),
    ).toBe(false);
  });

  it('the two write_scope globs actually used by this ticket do not overlap', () => {
    expect(
      globOverlaps('packages/tickets/src/lanes*', 'packages/tickets/src/reflow*'),
    ).toBe(false);
  });

  it('is symmetric', () => {
    const pairs: [string, string][] = [
      ['packages/tickets/**', 'packages/tickets/src/lanes.ts'],
      ['apps/**', 'packages/**'],
      [
        'packages/gateway/src/providers/anthropic*',
        'packages/gateway/src/providers/openai*',
      ],
    ];
    for (const [a, b] of pairs) {
      expect(globOverlaps(a, b)).toBe(globOverlaps(b, a));
    }
  });
});

describe('writeScopesOverlap', () => {
  it('true when any pair of globs across the two lists overlaps', () => {
    expect(
      writeScopesOverlap(
        ['packages/tickets/src/lanes*', 'packages/tickets/src/reflow*'],
        ['packages/tickets/**'],
      ),
    ).toBe(true);
  });

  it('false when no pair overlaps', () => {
    expect(
      writeScopesOverlap(
        ['packages/tickets/src/lanes*'],
        ['packages/tickets/src/reflow*', 'packages/tickets/test/**'],
      ),
    ).toBe(false);
  });
});

describe('findLaneScopeViolations / validateLaneWriteScopes (FR-T3)', () => {
  it('rejects same-lane active tickets with overlapping write_scope', () => {
    const a = ticket({
      id: 'T-A',
      lane: 'core',
      writeScope: ['packages/tickets/**'],
      status: 'in_progress',
      ownerId: 'agent-1',
    });
    const b = ticket({
      id: 'T-B',
      lane: 'core',
      writeScope: ['packages/tickets/src/lanes.ts'],
      status: 'claimed',
      ownerId: 'agent-2',
    });
    const violations = findLaneScopeViolations([a, b]);
    expect(violations).toEqual([
      {
        kind: 'same-lane-active-overlap',
        ticketA: 'T-A',
        ticketB: 'T-B',
        laneA: 'core',
        laneB: 'core',
      },
    ]);
    expect(() => validateLaneWriteScopes([a, b])).toThrow(LaneScopeError);
  });

  it('does not reject same-lane overlap when only one ticket is active', () => {
    const a = ticket({
      id: 'T-A',
      lane: 'core',
      writeScope: ['packages/tickets/**'],
      status: 'in_progress',
      ownerId: 'agent-1',
    });
    const b = ticket({
      id: 'T-B',
      lane: 'core',
      writeScope: ['packages/tickets/src/lanes.ts'],
      status: 'ready',
    });
    expect(findLaneScopeViolations([a, b])).toEqual([]);
    expect(() => validateLaneWriteScopes([a, b])).not.toThrow();
  });

  it('does not reject same-lane active tickets with disjoint write_scope', () => {
    const a = ticket({
      id: 'T-A',
      lane: 'core',
      writeScope: ['packages/tickets/src/lanes*'],
      status: 'in_progress',
      ownerId: 'agent-1',
    });
    const b = ticket({
      id: 'T-B',
      lane: 'core',
      writeScope: ['packages/tickets/src/reflow*'],
      status: 'claimed',
      ownerId: 'agent-2',
    });
    expect(findLaneScopeViolations([a, b])).toEqual([]);
  });

  it('rejects cross-lane write-scope overlap regardless of status (schema error at plan load)', () => {
    const a = ticket({
      id: 'T-A',
      lane: 'core',
      writeScope: ['packages/tickets/**'],
      status: 'done',
    });
    const b = ticket({
      id: 'T-B',
      lane: 'infra',
      writeScope: ['packages/tickets/src/lanes.ts'],
      status: 'ready',
    });
    const violations = findLaneScopeViolations([a, b]);
    expect(violations).toEqual([
      {
        kind: 'cross-lane-overlap',
        ticketA: 'T-A',
        ticketB: 'T-B',
        laneA: 'core',
        laneB: 'infra',
      },
    ]);
    expect(() => validateLaneWriteScopes([a, b])).toThrow(LaneScopeError);
  });

  it('does not reject cross-lane tickets with disjoint write_scope', () => {
    const a = ticket({ id: 'T-A', lane: 'core', writeScope: ['packages/tickets/**'] });
    const b = ticket({ id: 'T-B', lane: 'infra', writeScope: ['apps/**'] });
    expect(findLaneScopeViolations([a, b])).toEqual([]);
  });
});
