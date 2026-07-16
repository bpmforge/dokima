import { describe, expect, it, vi } from 'vitest';
import { fetchBoardTickets, fireTicketVerb } from './api.js';
import { makeBoardTicket } from './test-helpers.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': status === 409 ? 'application/problem+json' : 'application/json',
    },
  });
}

/** Typed accessor for a fetch mock's Nth call — noUncheckedIndexedAccess-safe. */
function fetchCall(
  fetchImpl: ReturnType<typeof vi.fn>,
  index: number,
): { url: string; init: RequestInit & { headers: Record<string, string> } } {
  const call = fetchImpl.mock.calls[index];
  if (!call) throw new Error(`expected fetch call ${index}`);
  const [url, init] = call as [string, RequestInit];
  return { url, init: init as RequestInit & { headers: Record<string, string> } };
}

describe('fetchBoardTickets', () => {
  it('GETs the project tickets list with the bearer token and returns items', async () => {
    const ticket = makeBoardTicket({ id: 'W4-01' });
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { items: [ticket], next_cursor: null }),
    );
    const result = await fetchBoardTickets(
      { baseUrl: 'http://127.0.0.1:4317/api/v1', token: 'tok', fetchImpl },
      'PROJ1',
    );
    expect(result).toEqual({ ok: true, data: [ticket] });
    const { url, init } = fetchCall(fetchImpl, 0);
    expect(url).toBe('http://127.0.0.1:4317/api/v1/projects/PROJ1/tickets');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('encodes filters as query params (API_DESIGN GET /projects/{id}/tickets)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { items: [], next_cursor: null }),
    );
    await fetchBoardTickets(
      { baseUrl: 'http://x/api/v1', token: 'tok', fetchImpl },
      'PROJ1',
      { claimable: true, lane: 'ui' },
    );
    const { url } = fetchCall(fetchImpl, 0);
    expect(url).toBe('http://x/api/v1/projects/PROJ1/tickets?claimable=true&lane=ui');
  });

  it('surfaces a non-2xx response as a problem result rather than throwing', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(401, {
        type: 'about:blank',
        title: 'missing token',
        status: 401,
        detail: 'missing bearer token',
        instance: '/projects/PROJ1/tickets',
        request_id: 'req_1',
      }),
    );
    const result = await fetchBoardTickets(
      { baseUrl: 'http://x/api/v1', token: '', fetchImpl },
      'PROJ1',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem.status).toBe(401);
  });
});

describe('fireTicketVerb', () => {
  it('POSTs the verb with an Idempotency-Key and returns the updated ticket', async () => {
    const updated = makeBoardTicket({ id: 'W4-01', status: 'claimed' });
    const fetchImpl = vi.fn(async () => jsonResponse(200, updated));
    const result = await fireTicketVerb(
      {
        baseUrl: 'http://x/api/v1',
        token: 'tok',
        fetchImpl,
        idempotencyKey: () => 'fixed-key',
      },
      'W4-01',
      'claim',
      'PROJ1',
    );
    expect(result).toEqual({ ok: true, data: updated });
    const { url, init } = fetchCall(fetchImpl, 0);
    expect(url).toBe('http://x/api/v1/tickets/W4-01/claim?project=PROJ1');
    expect(init.method).toBe('POST');
    expect(init.headers['Idempotency-Key']).toBe('fixed-key');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('surfaces a 409 invariant refusal as a problem+json result (FR-T4)', async () => {
    const problem = {
      type: 'https://shipwright.dev/errors/close-requires-receipt',
      title: 'close refused: verify has not passed',
      status: 409,
      detail: 'ticket W2-04 verify exited 1',
      instance: '/api/v1/tickets/W2-04/close',
      request_id: 'req_2',
      rule: 'FR-T2',
    };
    const fetchImpl = vi.fn(async () => jsonResponse(409, problem));
    const result = await fireTicketVerb(
      { baseUrl: 'http://x/api/v1', token: 'tok', fetchImpl },
      'W2-04',
      'close',
      'PROJ1',
    );
    expect(result).toEqual({ ok: false, problem });
  });
});
