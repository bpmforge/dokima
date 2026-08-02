import { describe, expect, it } from 'vitest';
import { decompose } from './decompose.js';
import type { TicketDraftInput } from './types.js';

function draft(overrides: Partial<TicketDraftInput> & { id: string }): TicketDraftInput {
  return {
    type: 'task',
    title: overrides.id,
    writeScope: [],
    dependsOn: [],
    acceptance: [],
    verify: 'true',
    ownPackage: null,
    importsWorkspacePackages: [],
    providesInterfaces: [],
    consumesInterfaces: [],
    ...overrides,
  };
}

describe('decompose (BLUEPRINT §4 step 4, US-203, field report §10)', () => {
  it('AC1: assigns lanes from write-scope disjointness and carries acceptance/verify through', () => {
    const plan = decompose([
      draft({
        id: 'T1',
        title: 'Build the thing',
        writeScope: ['packages/foo/**'],
        acceptance: ['does the thing', 'does it fast'],
        verify: 'pnpm test',
      }),
      draft({ id: 'T2', writeScope: ['packages/bar/**'] }),
    ]);

    expect(plan.tickets).toHaveLength(2);
    const t1 = plan.tickets.find((t) => t.id === 'T1');
    expect(t1?.lane).not.toEqual(plan.tickets.find((t) => t.id === 'T2')?.lane);
    expect(t1?.acceptance).toEqual([
      { id: 'T1-AC1', text: 'does the thing', done: false },
      { id: 'T1-AC2', text: 'does it fast', done: false },
    ]);
    expect(t1?.verify).toEqual('pnpm test');
  });

  it('AC1: renders the DAG as mermaid', () => {
    const plan = decompose([draft({ id: 'T1', writeScope: ['packages/foo/**'] })]);
    expect(plan.mermaid.startsWith('flowchart TD')).toBe(true);
    expect(plan.mermaid).toContain('t_T1');
  });

  it('AC2: surfaces plan-linter violations alongside the DAG rather than throwing', () => {
    const plan = decompose([
      draft({
        id: 'W1-02',
        consumesInterfaces: [
          { packageName: '@dokima/events', exportName: 'mintReceipt' },
        ],
      }),
    ]);
    expect(plan.tickets).toHaveLength(1);
    expect(plan.violations).toEqual([
      {
        kind: 'unowned-interface',
        ticketId: 'W1-02',
        detail:
          'consumes @dokima/events#mintReceipt but no ticket in the DAG owns its public re-export',
      },
    ]);
  });

  it('a clean DAG has zero violations', () => {
    const plan = decompose([draft({ id: 'T1' })]);
    expect(plan.violations).toEqual([]);
  });

  it('US-203: the returned plan is plain data — editing a draft and re-decomposing reflects the edit (human-editable DAG)', () => {
    const original: TicketDraftInput[] = [
      draft({ id: 'T1', writeScope: ['packages/foo/**'] }),
      draft({ id: 'T2', writeScope: ['packages/foo/**'] }),
    ];
    const before = decompose(original);
    expect(before.tickets.find((t) => t.id === 'T1')?.lane).toEqual(
      before.tickets.find((t) => t.id === 'T2')?.lane,
    );

    // Human splits T2's write_scope so it no longer overlaps T1 — a JSON
    // edit to the plain draft array, nothing structural.
    const edited = original.map((t) =>
      t.id === 'T2' ? { ...t, writeScope: ['packages/bar/**'] } : t,
    );
    const after = decompose(edited);
    expect(after.tickets.find((t) => t.id === 'T1')?.lane).not.toEqual(
      after.tickets.find((t) => t.id === 'T2')?.lane,
    );
  });
});
