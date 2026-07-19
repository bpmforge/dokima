import { describe, expect, it, vi } from 'vitest';
import { acceptPlanItem, dismissPlanItem, fetchPlan, PlansApiError } from './api.js';

const WIRE_ITEM = {
  id: 'PC-001',
  catalog_id: 'PC-001',
  rank: 12,
  state: 'proposed',
  ticket_id: null,
  verify_criterion: 'receipts.staleCount == 0',
  recommendation: 'Re-verify the 2 stale receipt(s)',
  severity: 4,
  leverage: 3,
  last_verified_at: null,
  evidence: {},
  created_at: '2026-07-18T09:00:00.000Z',
  first_seen_at: '2026-07-18T09:00:00.000Z',
  attempt: 0,
  dismissed_at: null,
  dismissed_reason: null,
};

const WIRE_FUNNEL = {
  raw_findings: 1,
  plan_items: 1,
  accepted: 0,
  done: 0,
  regressed: 0,
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe('fetchPlan', () => {
  it('maps wire (snake_case) items + funnel to camelCase', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [WIRE_ITEM], funnel: WIRE_FUNNEL }));
    const { items, funnel } = await fetchPlan('proj-1', {
      fetchImpl,
      getToken: () => 'tok',
    });
    expect(items).toEqual([
      {
        id: 'PC-001',
        catalogId: 'PC-001',
        rank: 12,
        state: 'proposed',
        ticketId: null,
        verifyCriterion: 'receipts.staleCount == 0',
        recommendation: 'Re-verify the 2 stale receipt(s)',
        severity: 4,
        leverage: 3,
        lastVerifiedAt: null,
        evidence: {},
        createdAt: '2026-07-18T09:00:00.000Z',
        firstSeenAt: '2026-07-18T09:00:00.000Z',
        attempt: 0,
        dismissedAt: null,
        dismissedReason: null,
      },
    ]);
    expect(funnel).toEqual({
      rawFindings: 1,
      planItems: 1,
      accepted: 0,
      done: 0,
      regressed: 0,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/v1/projects/proj-1/plan',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('surfaces a non-ok response as PlansApiError with the problem detail', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ detail: 'not found' }, 404));
    await expect(
      fetchPlan('ghost', { fetchImpl, getToken: () => 'tok' }),
    ).rejects.toMatchObject({
      status: 404,
      message: 'not found',
    });
  });
});

describe('acceptPlanItem', () => {
  it('POSTs lane/write_scope/depends_on to :id/accept', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ item: { ...WIRE_ITEM, state: 'accepted' } }));
    await acceptPlanItem(
      'proj-1',
      'PC-001',
      { lane: 'pipeline', writeScope: ['packages/foo/**'], dependsOn: ['W1-01'] },
      { fetchImpl, getToken: () => 'tok' },
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/v1/projects/proj-1/plan-items/PC-001/accept',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          lane: 'pipeline',
          write_scope: ['packages/foo/**'],
          depends_on: ['W1-01'],
        }),
      }),
    );
  });
});

describe('dismissPlanItem', () => {
  it('POSTs a note to :id/dismiss', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ item: WIRE_ITEM }));
    await dismissPlanItem('proj-1', 'PC-001', 'not applicable', {
      fetchImpl,
      getToken: () => 'tok',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/v1/projects/proj-1/plan-items/PC-001/dismiss',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ note: 'not applicable' }),
      }),
    );
  });
});

describe('PlansApiError', () => {
  it('falls back to a generic message when the body has no detail', () => {
    const err = new PlansApiError(500);
    expect(err.message).toContain('500');
  });
});
