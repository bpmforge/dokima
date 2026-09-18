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
        statusA: 'in_progress',
        statusB: 'claimed',
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

  it('rejects cross-lane write-scope overlap among tickets that can still write; a DONE one has released its territory (W23-31, D-015)', () => {
    const released = ticket({
      id: 'T-A',
      lane: 'core',
      writeScope: ['packages/tickets/**'],
      status: 'done',
    });
    const a = { ...released, status: 'ready' as const };
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
        statusA: 'ready',
        statusB: 'ready',
      },
    ]);
    // The same pair once T-A is done: territory released, nothing to refuse.
    expect(findLaneScopeViolations([released, b])).toEqual([]);
    expect(() => validateLaneWriteScopes([a, b])).toThrow(LaneScopeError);
  });

  it('does not reject cross-lane tickets with disjoint write_scope', () => {
    const a = ticket({ id: 'T-A', lane: 'core', writeScope: ['packages/tickets/**'] });
    const b = ticket({ id: 'T-B', lane: 'infra', writeScope: ['apps/**'] });
    expect(findLaneScopeViolations([a, b])).toEqual([]);
  });
});

describe('a done ticket has released its territory (W23-31, D-015)', () => {
  it('RED FIXTURE (Vault, 2026-09-18): a new ticket in another lane may own a file a DONE ticket once wrote; the same pair with the old ticket still ready is refused', () => {
    const scaffold = ticket({
      id: 'PLAN-vault-001',
      lane: 'vault-001',
      writeScope: ['package.json'],
      status: 'done',
    });
    const fix = ticket({
      id: 'PLAN-vault-000',
      lane: 'vault-000',
      writeScope: ['package.json'],
      status: 'ready',
    });
    expect(findLaneScopeViolations([scaffold, fix])).toEqual([]);
    expect(findLaneScopeViolations([{ ...scaffold, status: 'waived' }, fix])).toEqual([]);
    const stillReady = findLaneScopeViolations([{ ...scaffold, status: 'ready' }, fix]);
    expect(stillReady).toHaveLength(1);
    expect(stillReady[0]).toMatchObject({
      kind: 'cross-lane-overlap',
      statusA: 'ready',
      statusB: 'ready',
    });
  });

  it('the refusal names the statuses it counted', () => {
    const a = ticket({
      id: 'A',
      lane: 'x',
      writeScope: ['src/a.ts'],
      status: 'in_review',
    });
    const b = ticket({ id: 'B', lane: 'y', writeScope: ['src/a.ts'], status: 'ready' });
    const err = new LaneScopeError(findLaneScopeViolations([a, b]));
    expect(err.message).toContain('A (x, in_review)');
    expect(err.message).toContain('B (y, ready)');
  });
});
