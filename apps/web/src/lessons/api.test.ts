import { describe, expect, it, vi } from 'vitest';
import { fileFieldReport, listFieldReports, triageFieldReport } from './api.js';
import type { FieldReportDraft, FieldReportRecord } from './types.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': status === 409 ? 'application/problem+json' : 'application/json',
    },
  });
}

function fetchCall(
  fetchImpl: ReturnType<typeof vi.fn>,
  index: number,
): { url: string; init: RequestInit & { headers: Record<string, string> } } {
  const call = fetchImpl.mock.calls[index];
  if (!call) throw new Error(`expected fetch call ${index}`);
  const [url, init] = call as [string, RequestInit];
  return { url, init: init as RequestInit & { headers: Record<string, string> } };
}

const RECORD: FieldReportRecord = {
  id: 1,
  ticketId: 'W1-01',
  source: 'trace',
  sourceRef: 'trace:run-1:5',
  whatHappened: 'gate passed on a spoofed receipt',
  expected: 'gate should refuse',
  evidenceLinks: ['run:run-1'],
  filedBy: 'human-brad',
  filedAt: '2026-07-20T09:00:00.000Z',
  status: 'pending',
  triagedBy: null,
  triagedAt: null,
  triageNote: null,
  resultingPlaybookEntryId: null,
  resultingTicketId: null,
};

const DRAFT: FieldReportDraft = {
  ticketId: 'W1-01',
  source: 'trace',
  sourceRef: 'trace:run-1:5',
  whatHappened: 'gate passed on a spoofed receipt',
  expected: 'gate should refuse',
  evidenceLinks: ['run:run-1'],
};

describe('fileFieldReport', () => {
  it('POSTs the draft with an idempotency key and bearer token', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(201, RECORD));
    const result = await fileFieldReport(
      { baseUrl: 'http://x', token: 'tok', fetchImpl, idempotencyKey: () => 'key-1' },
      'PROJ1',
      DRAFT,
    );
    expect(result).toEqual({ ok: true, data: RECORD });
    const { url, init } = fetchCall(fetchImpl, 0);
    expect(url).toBe('http://x/projects/PROJ1/field-reports');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.headers['Idempotency-Key']).toBe('key-1');
    expect(JSON.parse(init.body as string)).toEqual(DRAFT);
  });

  it('surfaces a non-2xx response as a problem result rather than throwing', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(422, {
        type: 'about:blank',
        title: 'incomplete field report',
        status: 422,
        detail: 'whatHappened is required',
        instance: '/projects/PROJ1/field-reports',
        request_id: 'req-1',
      }),
    );
    const result = await fileFieldReport(
      { baseUrl: 'http://x', token: 'tok', fetchImpl },
      'PROJ1',
      { ...DRAFT, whatHappened: '' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem.status).toBe(422);
  });
});

describe('listFieldReports', () => {
  it('GETs the list, encoding an optional status filter', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { items: [RECORD] }));
    const result = await listFieldReports(
      { baseUrl: 'http://x', token: 'tok', fetchImpl },
      'PROJ1',
      'pending',
    );
    expect(result).toEqual({ ok: true, data: [RECORD] });
    const { url } = fetchCall(fetchImpl, 0);
    expect(url).toBe('http://x/projects/PROJ1/field-reports?status=pending');
  });

  it('omits the status query param when not given', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { items: [] }));
    await listFieldReports({ baseUrl: 'http://x', token: 'tok', fetchImpl }, 'PROJ1');
    const { url } = fetchCall(fetchImpl, 0);
    expect(url).toBe('http://x/projects/PROJ1/field-reports');
  });
});

describe('triageFieldReport', () => {
  it('POSTs a playbook-acceptance decision', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { ...RECORD, status: 'accepted_playbook' }),
    );
    const result = await triageFieldReport(
      { baseUrl: 'http://x', token: 'tok', fetchImpl, idempotencyKey: () => 'key-2' },
      'PROJ1',
      RECORD.id,
      {
        decision: 'playbook',
        taskClass: 'spoofed receipt bypass',
        entry: 'verify signature',
      },
    );
    expect(result.ok).toBe(true);
    const { url, init } = fetchCall(fetchImpl, 0);
    expect(url).toBe('http://x/field-reports/1/triage?project=PROJ1');
    expect(JSON.parse(init.body as string)).toEqual({
      decision: 'playbook',
      taskClass: 'spoofed receipt bypass',
      entry: 'verify signature',
    });
  });

  it('POSTs a reject decision', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { ...RECORD, status: 'rejected' }),
    );
    await triageFieldReport(
      { baseUrl: 'http://x', token: 'tok', fetchImpl },
      'PROJ1',
      RECORD.id,
      {
        decision: 'reject',
        triageNote: 'not reproducible',
      },
    );
    const { init } = fetchCall(fetchImpl, 0);
    expect(JSON.parse(init.body as string)).toEqual({
      decision: 'reject',
      triageNote: 'not reproducible',
    });
  });
});
