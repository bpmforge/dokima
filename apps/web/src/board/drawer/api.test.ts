import { describe, expect, it } from 'vitest';
import {
  fetchRunTrace,
  fetchSpendByRung,
  fetchTicketRuns,
  patchDependsOn,
} from './api.js';

const OPTS = { baseUrl: 'https://example.test/api/v1', token: 'tok' };

function fakeFetch(status: number, body: unknown) {
  return async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
}

describe('fetchSpendByRung', () => {
  it('parses the honest-empty rollup shape', async () => {
    const result = await fetchSpendByRung(
      {
        ...OPTS,
        fetchImpl: fakeFetch(200, { group_by: 'rung', items: [], assumptions: ['x'] }),
      },
      'p1',
    );
    expect(result).toEqual({ group_by: 'rung', items: [], assumptions: ['x'] });
  });
});

describe('fetchTicketRuns / fetchRunTrace', () => {
  it('returns an empty list when no run has touched the ticket', async () => {
    const result = await fetchTicketRuns(
      { ...OPTS, fetchImpl: fakeFetch(200, { items: [] }) },
      'p1',
      'W2-04',
    );
    expect(result).toEqual([]);
  });

  it('returns trace events filtered server-side', async () => {
    const items = [
      {
        seq: 1,
        event_type: 'loop.pass',
        actor_id: 'agent-1',
        ticket_id: 'W2-04',
        run_id: 'run-1',
        payload: {},
        created_at: '2026-07-18T00:00:00Z',
      },
    ];
    const result = await fetchRunTrace(
      { ...OPTS, fetchImpl: fakeFetch(200, { items }) },
      'p1',
      'run-1',
      'W2-04',
    );
    expect(result).toEqual(items);
  });
});

describe('patchDependsOn', () => {
  it('maps 409 to a refused result with rule + detail', async () => {
    const result = await patchDependsOn(
      {
        ...OPTS,
        fetchImpl: fakeFetch(409, {
          rule: 'DEPENDS_ON_CYCLE',
          detail: 'cycle: A -> B -> A',
        }),
      },
      'p1',
      'A',
      ['B'],
    );
    expect(result).toEqual({
      kind: 'refused',
      rule: 'DEPENDS_ON_CYCLE',
      detail: 'cycle: A -> B -> A',
    });
  });

  it('maps 501 to a not-persisted result', async () => {
    const result = await patchDependsOn(
      { ...OPTS, fetchImpl: fakeFetch(501, { detail: 'validated, not persisted' }) },
      'p1',
      'A',
      ['B'],
    );
    expect(result).toEqual({ kind: 'not-persisted', detail: 'validated, not persisted' });
  });

  it('maps any other status to a generic error result', async () => {
    const result = await patchDependsOn(
      { ...OPTS, fetchImpl: fakeFetch(500, { detail: 'boom' }) },
      'p1',
      'A',
      ['B'],
    );
    expect(result).toEqual({ kind: 'error', detail: 'boom' });
  });
});
