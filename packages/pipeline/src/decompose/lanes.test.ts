import { describe, expect, it } from 'vitest';
import { deriveLanes, globOverlaps, writeScopesOverlap } from './lanes.js';
import type { TicketDraftInput } from './types.js';

function draft(id: string, writeScope: string[]): TicketDraftInput {
  return {
    id,
    type: 'task',
    title: id,
    writeScope,
    dependsOn: [],
    acceptance: [],
    verify: 'true',
    ownPackage: null,
    importsWorkspacePackages: [],
    providesInterfaces: [],
    consumesInterfaces: [],
  };
}

describe('globOverlaps / writeScopesOverlap', () => {
  it('matches identical literal paths', () => {
    expect(
      globOverlaps('packages/tickets/src/lanes.ts', 'packages/tickets/src/lanes.ts'),
    ).toBe(true);
  });

  it('`**` overlaps a literal path underneath it', () => {
    expect(globOverlaps('packages/tickets/**', 'packages/tickets/src/lanes.ts')).toBe(
      true,
    );
  });

  it('disjoint top-level globs never overlap', () => {
    expect(globOverlaps('apps/**', 'packages/**')).toBe(false);
  });

  it('writeScopesOverlap is true if any pair overlaps', () => {
    expect(
      writeScopesOverlap(
        ['apps/web/**', 'packages/pipeline/src/decompose/**'],
        ['packages/pipeline/src/decompose/lanes.ts'],
      ),
    ).toBe(true);
  });
});

describe('deriveLanes (BLUEPRINT §4 step 4: lanes from write-scope disjointness)', () => {
  it('AC1: disjoint write_scopes get their own lane', () => {
    const tickets = [draft('A', ['packages/a/**']), draft('B', ['packages/b/**'])];
    const lanes = deriveLanes(tickets);
    expect(lanes.get('A')).not.toEqual(lanes.get('B'));
  });

  it('AC1: overlapping write_scopes are forced into the same lane', () => {
    const tickets = [
      draft('A', ['packages/pipeline/src/decompose/**']),
      draft('B', ['packages/pipeline/src/decompose/lanes.ts']),
    ];
    const lanes = deriveLanes(tickets);
    expect(lanes.get('A')).toEqual(lanes.get('B'));
  });

  it('transitively chains overlap through a third ticket', () => {
    const tickets = [
      draft('A', ['packages/pipeline/src/decompose/lanes.ts']),
      draft('B', ['packages/pipeline/src/decompose/**']),
      draft('C', ['packages/pipeline/src/decompose/mermaid.ts']),
    ];
    const lanes = deriveLanes(tickets);
    expect(lanes.get('A')).toEqual(lanes.get('B'));
    expect(lanes.get('B')).toEqual(lanes.get('C'));
  });

  it('lane name is deterministic regardless of input order', () => {
    const forward = deriveLanes([
      draft('A', ['packages/x/**']),
      draft('B', ['packages/x/y.ts']),
    ]);
    const backward = deriveLanes([
      draft('B', ['packages/x/y.ts']),
      draft('A', ['packages/x/**']),
    ]);
    expect(forward.get('A')).toEqual('A');
    expect(backward.get('A')).toEqual('A');
    expect(forward.get('B')).toEqual(backward.get('B'));
  });
});
