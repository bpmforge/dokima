import { describe, expect, it } from 'vitest';
import { deriveFeatures, featureGaps, UNMAPPED_FEATURE_ID } from './features.js';
import { decompose } from './decompose.js';
import type { Seam } from '../seams/types.js';
import type { DecomposedTicket, TicketDraftInput } from './types.js';

function ticket(
  overrides: Partial<DecomposedTicket> & { id: string; title: string },
): DecomposedTicket {
  return {
    type: 'task',
    lane: overrides.id,
    writeScope: [],
    dependsOn: [],
    acceptance: [],
    verify: 'true',
    ...overrides,
  };
}

function ac(id: string, text: string): DecomposedTicket['acceptance'][number] {
  return { id, text, done: false };
}

function exportSeam(
  overrides: Partial<Seam> & { id: string },
): Extract<Seam, { kind: 'export' }> {
  return {
    kind: 'export',
    packageName: '@dokima/x',
    exportName: 'thing',
    wiring_evidence: { file: 'packages/x/src/index.ts', exportName: 'thing' },
    ...overrides,
  } as Extract<Seam, { kind: 'export' }>;
}

const REQS = ['US-1', 'US-2', 'US-3', 'FR-A-1'];

describe('deriveFeatures — grouping by shared story citation', () => {
  it('tickets citing the same story are one feature; disjoint stories are separate features', () => {
    const tickets = [
      ticket({ id: 'T-1', title: 'Login form (US-1)' }),
      ticket({
        id: 'T-2',
        title: 'Session store',
        acceptance: [ac('T-2-AC1', 'US-1 session persists')],
      }),
      ticket({ id: 'T-3', title: 'Billing page (US-2)' }),
    ];
    const features = deriveFeatures(tickets, REQS);
    expect(features).toHaveLength(2);
    expect(features[0]).toMatchObject({
      id: 'F-US-1',
      stories: ['US-1'],
      tickets: ['T-1', 'T-2'],
    });
    expect(features[1]).toMatchObject({
      id: 'F-US-2',
      stories: ['US-2'],
      tickets: ['T-3'],
    });
  });

  it('a ticket citing two stories transitively merges their groups (union-find), id = lowest story', () => {
    const tickets = [
      ticket({ id: 'T-1', title: 'A (US-2)' }),
      ticket({ id: 'T-2', title: 'B (US-3)' }),
      ticket({ id: 'T-3', title: 'Bridge (US-2, US-3)' }),
    ];
    const features = deriveFeatures(tickets, REQS);
    expect(features).toHaveLength(1);
    expect(features[0]?.id).toBe('F-US-2');
    expect(features[0]?.stories).toEqual(['US-2', 'US-3']);
    expect(features[0]?.tickets).toEqual(['T-1', 'T-2', 'T-3']);
  });

  it('a cited id outside the requirement denominator does not count as a story', () => {
    const tickets = [ticket({ id: 'T-1', title: 'Ghost story (US-999)' })];
    const features = deriveFeatures(tickets, REQS);
    expect(features).toHaveLength(1);
    expect(features[0]?.id).toBe(UNMAPPED_FEATURE_ID);
  });

  it('every ticket lands in exactly one feature', () => {
    const tickets = [
      ticket({ id: 'T-1', title: 'US-1 work' }),
      ticket({ id: 'T-2', title: 'US-2 work' }),
      ticket({ id: 'T-3', title: 'no story here' }),
    ];
    const features = deriveFeatures(tickets, REQS);
    const placements = features.flatMap((f) => f.tickets);
    expect(placements.sort()).toEqual(['T-1', 'T-2', 'T-3']);
  });
});

describe('deriveFeatures — seam edges connect, never merge', () => {
  const tickets = [
    ticket({ id: 'T-1', title: 'Auth (US-1)' }),
    ticket({ id: 'T-2', title: 'Billing (US-2)' }),
  ];
  const seam = exportSeam({
    id: 'S-1',
    provider_ticket: 'T-1',
    consumer_ticket: 'T-2',
  });

  it('a cross-feature seam creates a connects_to edge with the stated reason', () => {
    const features = deriveFeatures(tickets, REQS, [seam]);
    expect(features).toHaveLength(2);
    expect(features[0]?.connects_to).toEqual([
      { feature: 'F-US-2', reason: 'seam S-1: T-1 -> T-2' },
    ]);
    expect(features[0]?.seams).toEqual(['S-1']);
    expect(features[1]?.seams).toEqual(['S-1']);
  });

  it('the connection does NOT merge the two features — a connection is not an identity', () => {
    const features = deriveFeatures(tickets, REQS, [seam]);
    expect(features.map((f) => f.id)).toEqual(['F-US-1', 'F-US-2']);
  });

  it('a seam inside one feature lists on it but creates no edge', () => {
    const sameFeature = [
      ticket({ id: 'T-1', title: 'Auth (US-1)' }),
      ticket({ id: 'T-2', title: 'Auth tokens (US-1)' }),
    ];
    const features = deriveFeatures(sameFeature, REQS, [seam]);
    expect(features).toHaveLength(1);
    expect(features[0]?.seams).toEqual(['S-1']);
    expect(features[0]?.connects_to).toEqual([]);
  });
});

describe('featureGaps', () => {
  it('flags every F-unmapped ticket as a ticket serving no story', () => {
    const tickets = [
      ticket({ id: 'T-1', title: 'US-1 work' }),
      ticket({ id: 'T-2', title: 'mystery chore' }),
    ];
    const gaps = featureGaps(deriveFeatures(tickets, REQS), REQS);
    expect(gaps.filter((g) => g.kind === 'ticket-serves-no-story')).toEqual([
      {
        kind: 'ticket-serves-no-story',
        subject: 'T-2',
        detail: 'T-2 cites no user story or requirement — it serves no story',
      },
    ]);
  });

  it('flags every denominator story with zero features', () => {
    const tickets = [ticket({ id: 'T-1', title: 'US-1 work' })];
    const gaps = featureGaps(deriveFeatures(tickets, REQS), REQS);
    const dropped = gaps.filter((g) => g.kind === 'story-has-no-feature');
    expect(dropped.map((g) => g.subject)).toEqual(['US-2', 'US-3', 'FR-A-1']);
  });

  it('a fully mapped plan has no gaps', () => {
    const tickets = [
      ticket({ id: 'T-1', title: 'US-1 US-2' }),
      ticket({ id: 'T-2', title: 'US-3 and FR-A-1' }),
    ];
    const gaps = featureGaps(deriveFeatures(tickets, REQS), REQS);
    expect(gaps).toEqual([]);
  });
});

describe('determinism', () => {
  it('same input twice produces identical output, order and all', () => {
    const tickets = [
      ticket({ id: 'T-1', title: 'US-2 and US-10 bridge' }),
      ticket({ id: 'T-2', title: 'US-2 detail' }),
      ticket({ id: 'T-3', title: 'no story' }),
      ticket({ id: 'T-4', title: 'FR-A-1 export' }),
    ];
    const reqs = ['US-2', 'US-10', 'FR-A-1'];
    const seams = [
      exportSeam({ id: 'S-1', provider_ticket: 'T-4', consumer_ticket: 'T-1' }),
      exportSeam({ id: 'S-2', provider_ticket: 'T-4', consumer_ticket: 'T-3' }),
    ];
    const first = deriveFeatures(tickets, reqs, seams);
    const second = deriveFeatures(tickets, reqs, seams);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('numeric-aware id choice: US-9 beats US-10 as the lowest story', () => {
    const tickets = [ticket({ id: 'T-1', title: 'US-9 plus US-10' })];
    const features = deriveFeatures(tickets, ['US-9', 'US-10']);
    expect(features[0]?.id).toBe('F-US-9');
    expect(features[0]?.stories).toEqual(['US-9', 'US-10']);
  });
});

describe('decompose() gains features additively', () => {
  const draft: TicketDraftInput = {
    id: 'T-1',
    type: 'task',
    title: 'Login (US-1)',
    writeScope: ['apps/web/src/**'],
    dependsOn: [],
    acceptance: ['US-1 login works'],
    verify: 'true',
    ownPackage: null,
    importsWorkspacePackages: [],
    providesInterfaces: [],
    consumesInterfaces: [],
  };

  it('without requirementIds the plan carries no features (existing callers unchanged)', () => {
    const plan = decompose([draft]);
    expect(plan.features).toBeUndefined();
    expect(plan.featureGaps).toBeUndefined();
    expect(plan.productMap).toBeUndefined();
  });

  it('with requirementIds the plan carries the feature map', () => {
    const plan = decompose([draft], { requirementIds: ['US-1'] });
    expect(plan.features).toEqual([
      {
        id: 'F-US-1',
        title: 'Login (US-1)',
        stories: ['US-1'],
        tickets: ['T-1'],
        seams: [],
        connects_to: [],
      },
    ]);
    expect(plan.featureGaps).toEqual([]);
    expect(plan.productMap).toContain('## F-US-1');
  });

  it('surfaces feature gaps with the plan, the same treatment violations get', () => {
    const orphan: TicketDraftInput = {
      ...draft,
      id: 'T-2',
      title: 'mystery chore',
      acceptance: ['does something'],
    };
    const plan = decompose([draft, orphan], { requirementIds: ['US-1', 'US-2'] });
    expect(plan.featureGaps?.map((g) => [g.kind, g.subject])).toEqual([
      ['ticket-serves-no-story', 'T-2'],
      ['story-has-no-feature', 'US-2'],
    ]);
    expect(plan.productMap).toContain('**WARNING: TICKETS SERVING NO STORY.**');
  });
});
