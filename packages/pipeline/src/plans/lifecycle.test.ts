import { describe, expect, it } from 'vitest';
import { matchCatalog, parseCatalog } from './catalog.js';
import { acceptItem, proposeFromMatches, startItem, verifyItem } from './lifecycle.js';
import { baselineSnapshot } from './test-helpers.js';
import { PlanLifecycleError } from './types.js';
import type { CatalogMatch, PlanItemRecord } from './types.js';

const CATALOG = parseCatalog(
  JSON.stringify({
    version: 'v1',
    entries: [
      {
        id: 'PC-004',
        condition: 'coverage.requiredSkipped > 0',
        recommendation: 'Close or waive the {n} SKIPPED required units in phase {phase}',
        verify: 'coverage.requiredSkipped == 0',
        severity: 3,
        leverage: 2,
      },
    ],
  }),
);

function clockFrom(start: number): () => string {
  let tick = start;
  return () => new Date(tick++).toISOString();
}

function matchFor(overrides: Partial<CatalogMatch> = {}): CatalogMatch {
  return {
    catalogId: 'PC-004',
    recommendation: 'Close or waive the 3 SKIPPED required units in phase Design',
    verifyCriterion: 'coverage.requiredSkipped == 0',
    severity: 3,
    leverage: 2,
    ...overrides,
  };
}

describe('proposeFromMatches', () => {
  it('creates a proposed item per new catalog match', () => {
    const created = proposeFromMatches([matchFor()], [], { now: clockFrom(0) });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      id: 'PC-004',
      catalogId: 'PC-004',
      state: 'proposed',
      ticketId: null,
      attempt: 0,
    });
  });

  it('skips a catalogId that already has an item in any state', () => {
    const existing: PlanItemRecord[] = [
      {
        id: 'PC-004',
        catalogId: 'PC-004',
        rank: 6,
        state: 'in_progress',
        ticketId: 'PLAN-PC-004',
        verifyCriterion: 'coverage.requiredSkipped == 0',
        recommendation: 'stale text',
        severity: 3,
        leverage: 2,
        lastVerifiedAt: null,
        evidence: {},
        createdAt: '2026-07-18T00:00:00.000Z',
        firstSeenAt: '2026-07-18T00:00:00.000Z',
        attempt: 0,
      },
    ];
    const created = proposeFromMatches([matchFor()], existing);
    expect(created).toEqual([]);
  });

  it('is a pure function against the real catalog fixture (no findings against an all-clear snapshot)', () => {
    const matches = matchCatalog(CATALOG, baselineSnapshot());
    expect(proposeFromMatches(matches, [])).toEqual([]);
  });
});

function proposedItem(): PlanItemRecord {
  const [created] = proposeFromMatches([matchFor()], [], { now: clockFrom(1000) });
  if (!created) throw new Error('expected proposeFromMatches to create one item');
  return created;
}

describe('acceptItem', () => {
  it('proposed -> accepted mints a ticket draft carrying the item verify', () => {
    const { item, ticketDraft } = acceptItem(proposedItem(), { lane: 'pipeline' });
    expect(item.state).toBe('accepted');
    expect(item.ticketId).toBe('PLAN-PC-004');
    expect(item.attempt).toBe(0);
    expect(ticketDraft.verify).toBe('coverage.requiredSkipped == 0');
    expect(ticketDraft.id).toBe('PLAN-PC-004');
    expect(ticketDraft.acceptance[0]?.text).toBe('coverage.requiredSkipped == 0');
  });

  it('regressed -> accepted increments the attempt counter', () => {
    const regressed: PlanItemRecord = {
      ...proposedItem(),
      state: 'regressed',
      attempt: 2,
    };
    const { item } = acceptItem(regressed, { lane: 'pipeline' });
    expect(item.state).toBe('accepted');
    expect(item.attempt).toBe(3);
  });

  it('refuses to accept an already-accepted item', () => {
    const accepted: PlanItemRecord = { ...proposedItem(), state: 'accepted' };
    expect(() => acceptItem(accepted, { lane: 'pipeline' })).toThrow(PlanLifecycleError);
  });

  it('refuses to accept a done item', () => {
    const done: PlanItemRecord = { ...proposedItem(), state: 'done' };
    expect(() => acceptItem(done, { lane: 'pipeline' })).toThrow(PlanLifecycleError);
  });
});

describe('startItem', () => {
  it('accepted -> in_progress when a ticket is linked', () => {
    const { item: accepted } = acceptItem(proposedItem(), { lane: 'pipeline' });
    const started = startItem(accepted);
    expect(started.state).toBe('in_progress');
  });

  it('refuses to start a proposed item', () => {
    expect(() => startItem(proposedItem())).toThrow(PlanLifecycleError);
  });

  it('refuses to start an accepted item with no ticket link', () => {
    const accepted: PlanItemRecord = {
      ...proposedItem(),
      state: 'accepted',
      ticketId: null,
    };
    expect(() => startItem(accepted)).toThrow(PlanLifecycleError);
  });
});

describe('verifyItem', () => {
  function inProgressItem(): PlanItemRecord {
    const { item: accepted } = acceptItem(proposedItem(), { lane: 'pipeline' });
    return startItem(accepted);
  }

  it('in_progress -> done when the verify criterion is satisfied', () => {
    const snapshot = baselineSnapshot({ coverage: { requiredSkipped: 0 } });
    const result = verifyItem(inProgressItem(), snapshot, { now: clockFrom(5000) });
    expect(result.state).toBe('done');
    expect(result.lastVerifiedAt).not.toBeNull();
  });

  it('in_progress stays in_progress when the verify criterion is still violated', () => {
    const snapshot = baselineSnapshot({ coverage: { requiredSkipped: 4 } });
    const result = verifyItem(inProgressItem(), snapshot);
    expect(result.state).toBe('in_progress');
  });

  it('done -> regressed when a later snapshot violates the criterion (FR-PLAN3)', () => {
    const done: PlanItemRecord = { ...inProgressItem(), state: 'done' };
    const snapshot = baselineSnapshot({ coverage: { requiredSkipped: 2 } });
    const result = verifyItem(done, snapshot);
    expect(result.state).toBe('regressed');
  });

  it('done stays done when the criterion is still satisfied', () => {
    const done: PlanItemRecord = { ...inProgressItem(), state: 'done' };
    const snapshot = baselineSnapshot({ coverage: { requiredSkipped: 0 } });
    const result = verifyItem(done, snapshot);
    expect(result.state).toBe('done');
  });

  it('refuses to verify a proposed item', () => {
    expect(() => verifyItem(proposedItem(), baselineSnapshot())).toThrow(
      PlanLifecycleError,
    );
  });

  it('refuses to verify a regressed item', () => {
    const regressed: PlanItemRecord = { ...inProgressItem(), state: 'regressed' };
    expect(() => verifyItem(regressed, baselineSnapshot())).toThrow(PlanLifecycleError);
  });
});

describe('full lifecycle round trip', () => {
  it('proposed -> accepted -> in_progress -> done -> regressed -> accepted (attempt 1)', () => {
    let item = proposedItem();
    expect(item.state).toBe('proposed');

    const accept1 = acceptItem(item, { lane: 'pipeline' });
    item = accept1.item;
    expect(item.state).toBe('accepted');

    item = startItem(item);
    expect(item.state).toBe('in_progress');

    item = verifyItem(item, baselineSnapshot({ coverage: { requiredSkipped: 0 } }));
    expect(item.state).toBe('done');

    item = verifyItem(item, baselineSnapshot({ coverage: { requiredSkipped: 7 } }));
    expect(item.state).toBe('regressed');

    const accept2 = acceptItem(item, { lane: 'pipeline' });
    expect(accept2.item.state).toBe('accepted');
    expect(accept2.item.attempt).toBe(1);
  });
});
