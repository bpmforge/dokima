import { describe, expect, it, vi } from 'vitest';
import { decideSlate, DecisionsApiError, fetchSlates } from './api.js';
import type { SlateRecord } from './types.js';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

const OPTS = { getToken: () => 'tok-123', baseUrl: 'http://127.0.0.1:4317' };

const FOUNDER_RECORD: SlateRecord = {
  id: 'slate-1',
  status: 'open',
  slate: {
    kind: 'founder',
    title: 'Product name',
    options: [
      { id: 'opt-a', label: 'Dokima', tradeoffs: 'Nautical theme, memorable.' },
      { id: 'opt-b', label: 'Buildbot', tradeoffs: 'Generic, unmemorable.' },
    ],
    recommendedId: 'opt-a',
    recommendedReasoning: 'Distinct in the crowded dev-tools space.',
  },
  chosen: null,
  rationale: null,
  d_id: null,
  decided_by: null,
  decided_at: null,
  created_at: '2026-07-19T00:00:00Z',
};

describe('fetchSlates', () => {
  it('GETs open slates and unwraps items', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [FOUNDER_RECORD] }));
    const items = await fetchSlates('proj-1', 'open', { ...OPTS, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:4317/api/v1/projects/proj-1/slates?status=open',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer tok-123' }),
      }),
    );
    expect(items).toEqual([FOUNDER_RECORD]);
  });

  it('omits the status query param when not given', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));
    await fetchSlates('proj-1', undefined, { ...OPTS, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:4317/api/v1/projects/proj-1/slates',
      expect.anything(),
    );
  });
});

describe('decideSlate', () => {
  it('POSTs chosen + rationale with the project as a query param', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 'slate-1',
        d_id: 'D-021',
        date: '2026-07-19',
        decision: 'Product name: Dokima',
        options_considered: 'Dokima, Buildbot',
        rationale: 'Distinct branding.',
      }),
    );
    const result = await decideSlate(
      'proj-1',
      'slate-1',
      { chosen: 'opt-a', rationale: 'Distinct branding.' },
      { ...OPTS, fetchImpl },
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:4317/api/v1/slates/slate-1/decide?project=proj-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ chosen: 'opt-a', rationale: 'Distinct branding.' }),
      }),
    );
    expect(result.d_id).toBe('D-021');
  });
});

describe('error handling', () => {
  it('throws DecisionsApiError with the RFC 7807 detail on a non-OK response', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ detail: 'no open decision slate' }, 404));
    await expect(fetchSlates('proj-1', 'open', { ...OPTS, fetchImpl })).rejects.toThrow(
      DecisionsApiError,
    );
    await expect(fetchSlates('proj-1', 'open', { ...OPTS, fetchImpl })).rejects.toThrow(
      'no open decision slate',
    );
  });
});
