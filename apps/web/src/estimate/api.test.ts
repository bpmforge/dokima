import { describe, expect, it, vi } from 'vitest';
import {
  EstimateApiError,
  fetchEstimate,
  fetchSpendByRung,
  fetchWeeklyDigest,
  postWhatIf,
} from './api.js';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

const WIRE_ESTIMATE = {
  waves: [
    {
      wave: 0,
      ticket_count: 2,
      total_points: 2,
      usd_per_point: 0.63,
      estimated_usd: 1.26,
    },
  ],
  total_usd: 1.26,
  assumptions: ['no historical actuals; estimate uses rate-table list-price only'],
};

describe('fetchEstimate', () => {
  it('maps wire (snake_case) shape to camelCase and sends the token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(WIRE_ESTIMATE));
    const result = await fetchEstimate('proj-1', {
      fetchImpl,
      getToken: () => 'tok-123',
      baseUrl: 'http://127.0.0.1:4317',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:4317/api/v1/projects/proj-1/estimate',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer tok-123' }),
      }),
    );
    expect(result).toEqual({
      waves: [
        {
          wave: 0,
          ticketCount: 2,
          totalPoints: 2,
          usdPerPoint: 0.63,
          estimatedUsd: 1.26,
        },
      ],
      totalUsd: 1.26,
      assumptions: WIRE_ESTIMATE.assumptions,
    });
  });

  it('surfaces a non-ok response as EstimateApiError', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ detail: 'nope' }, 404));
    await expect(
      fetchEstimate('proj-1', { fetchImpl, getToken: () => 'tok' }),
    ).rejects.toMatchObject({ status: 404, message: 'nope' });
  });
});

describe('postWhatIf', () => {
  it('POSTs the overrides and maps the recomputed result', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(WIRE_ESTIMATE));
    const result = await postWhatIf(
      'proj-1',
      { 'code-reviewer': 0.02 },
      { fetchImpl, getToken: () => 'tok' },
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/v1/projects/proj-1/estimate/what-if',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ overrides: { 'code-reviewer': 0.02 } }),
      }),
    );
    expect(result.totalUsd).toBe(1.26);
  });
});

describe('fetchSpendByRung', () => {
  it('requests group_by=rung and maps the rollup', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        group_by: 'rung',
        items: [
          {
            rung: 'R3',
            totalUsd: 0.41,
            tickets: [{ ticketId: 'W0-02', spendUsd: 0.41, outcome: 'done' }],
          },
        ],
        assumptions: ['no persisted spend ledger yet'],
      }),
    );
    const result = await fetchSpendByRung('proj-1', { fetchImpl, getToken: () => 'tok' });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/v1/projects/proj-1/spend?group_by=rung',
      expect.anything(),
    );
    expect(result.groupBy).toBe('rung');
    expect(result.items).toEqual([
      {
        rung: 'R3',
        totalUsd: 0.41,
        tickets: [{ ticketId: 'W0-02', spendUsd: 0.41, outcome: 'done' }],
      },
    ]);
  });

  it('honest-empty rollup maps to an empty items list', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ group_by: 'rung', items: [], assumptions: ['no ledger yet'] }),
      );
    const result = await fetchSpendByRung('proj-1', { fetchImpl, getToken: () => 'tok' });
    expect(result.items).toEqual([]);
    expect(result.assumptions).toEqual(['no ledger yet']);
  });
});

describe('fetchWeeklyDigest', () => {
  it('maps the Review-tier card', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        tier: 'review',
        week_of: '2026-07-13',
        total_spend_usd: 0,
        by_rung: [],
        suppression_volume: [{ ruleId: 'no-magic-numbers', count: 3 }],
        assumptions: ['no ledger yet', 'no suppression store yet'],
      }),
    );
    const digest = await fetchWeeklyDigest('proj-1', {
      fetchImpl,
      getToken: () => 'tok',
    });
    expect(digest.tier).toBe('review');
    expect(digest.weekOf).toBe('2026-07-13');
    expect(digest.suppressionVolume).toEqual([{ ruleId: 'no-magic-numbers', count: 3 }]);
  });
});

describe('EstimateApiError', () => {
  it('falls back to a generic message when the body has no detail', () => {
    const err = new EstimateApiError(500);
    expect(err.message).toContain('500');
  });
});
