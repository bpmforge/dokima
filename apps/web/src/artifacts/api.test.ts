import { describe, expect, it, vi } from 'vitest';
import {
  ArtifactApiError,
  fetchApprovalsLedger,
  fetchArtifactComments,
  fetchArtifactDiff,
  fetchArtifactDoc,
  fetchArtifactDocDiff,
  fetchArtifactList,
  fetchReceipt,
  fetchReceipts,
  postArtifactComment,
} from './api.js';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

const OPTS = { getToken: () => 'tok-123', baseUrl: 'http://127.0.0.1:4317' };

describe('fetchArtifactList', () => {
  it('GETs the project artifact list and unwraps items', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ items: [{ path: 'docs/SRS.md', title: 'SRS' }] }),
      );
    const items = await fetchArtifactList('proj-1', { ...OPTS, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:4317/api/v1/projects/proj-1/artifacts',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer tok-123' }),
      }),
    );
    expect(items).toEqual([{ path: 'docs/SRS.md', title: 'SRS' }]);
  });
});

describe('fetchArtifactDoc', () => {
  it('sends path (and rev when given) as query params', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ path: 'docs/SRS.md', content: 'x', rev: 'abc', versions: [] }),
      );
    await fetchArtifactDoc('proj-1', 'docs/SRS.md', 'abc', { ...OPTS, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:4317/api/v1/projects/proj-1/artifacts/doc?path=docs%2FSRS.md&rev=abc',
      expect.anything(),
    );
  });

  it('omits rev when not given', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ path: 'docs/SRS.md', content: 'x', rev: null, versions: [] }),
      );
    await fetchArtifactDoc('proj-1', 'docs/SRS.md', undefined, { ...OPTS, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:4317/api/v1/projects/proj-1/artifacts/doc?path=docs%2FSRS.md',
      expect.anything(),
    );
  });
});

describe('fetchArtifactDiff', () => {
  it('sends path and ticket as query params', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        path: 'docs/SRS.md',
        ticket: 'W4-05',
        branch: 'sw/w4-05-x',
        base: 'main',
        oldContent: 'a',
        newContent: 'b',
      }),
    );
    const diff = await fetchArtifactDiff('proj-1', 'docs/SRS.md', 'W4-05', {
      ...OPTS,
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:4317/api/v1/projects/proj-1/artifacts/diff?path=docs%2FSRS.md&ticket=W4-05',
      expect.anything(),
    );
    expect(diff.branch).toBe('sw/w4-05-x');
  });
});

describe('fetchArtifactDocDiff', () => {
  it('sends path and from as query params, omitting to when not given', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        path: 'docs/SRS.md',
        from: 'rev1',
        to: 'HEAD',
        oldContent: 'a',
        newContent: 'b',
      }),
    );
    const diff = await fetchArtifactDocDiff('proj-1', 'docs/SRS.md', 'rev1', undefined, {
      ...OPTS,
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:4317/api/v1/projects/proj-1/artifacts/doc-diff?path=docs%2FSRS.md&from=rev1',
      expect.anything(),
    );
    expect(diff.oldContent).toBe('a');
    expect(diff.newContent).toBe('b');
  });

  it('sends to when given', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        path: 'docs/SRS.md',
        from: 'rev1',
        to: 'rev2',
        oldContent: 'a',
        newContent: 'b',
      }),
    );
    await fetchArtifactDocDiff('proj-1', 'docs/SRS.md', 'rev1', 'rev2', {
      ...OPTS,
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:4317/api/v1/projects/proj-1/artifacts/doc-diff?path=docs%2FSRS.md&from=rev1&to=rev2',
      expect.anything(),
    );
  });
});

describe('artifact comments', () => {
  it('fetchArtifactComments unwraps items', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        items: [
          {
            seq: 1,
            at: '2026-01-01T00:00:00Z',
            actorId: 'operator',
            body: 'hi',
            versionRef: 'HEAD',
            revisionRequested: false,
          },
        ],
      }),
    );
    const items = await fetchArtifactComments('proj-1', 'docs/SRS.md', {
      ...OPTS,
      fetchImpl,
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.body).toBe('hi');
  });

  it('postArtifactComment POSTs a JSON body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          comment: {
            seq: 1,
            at: '2026-01-01T00:00:00Z',
            actorId: 'operator',
            body: 'hi',
            versionRef: 'HEAD',
            revisionRequested: true,
          },
          revisionRequested: true,
        },
        201,
      ),
    );
    const result = await postArtifactComment(
      'proj-1',
      { path: 'docs/SRS.md', body: 'hi', versionRef: 'HEAD', ticketId: 'W4-05' },
      { ...OPTS, fetchImpl },
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:4317/api/v1/projects/proj-1/artifacts/comments',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          path: 'docs/SRS.md',
          body: 'hi',
          versionRef: 'HEAD',
          ticketId: 'W4-05',
        }),
      }),
    );
    expect(result.revisionRequested).toBe(true);
  });
});

describe('receipts', () => {
  const WIRE_RECEIPT = {
    id: 'rcpt-1',
    kind: 'gate',
    project_id: 'proj-1',
    phase: 3,
    ticket_id: 'W4-05',
    validators: [{ name: 'validate-plan', exitCode: 0, gapCount: 0 }],
    input_tree_hash: 'hash123',
    verify_command: 'pnpm test',
    verify_exit: 0,
    signed_by: null,
    payload: { foo: 'bar' },
    created_at: '2026-01-01T00:00:00Z',
  };

  it('fetchReceipt maps wire (snake_case) to camelCase', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(WIRE_RECEIPT));
    const receipt = await fetchReceipt('proj-1', 'rcpt-1', { ...OPTS, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:4317/api/v1/receipts/rcpt-1?project=proj-1',
      expect.anything(),
    );
    expect(receipt).toEqual({
      id: 'rcpt-1',
      kind: 'gate',
      projectId: 'proj-1',
      phase: 3,
      ticketId: 'W4-05',
      validators: [{ name: 'validate-plan', exitCode: 0, gapCount: 0 }],
      inputTreeHash: 'hash123',
      verifyCommand: 'pnpm test',
      verifyExit: 0,
      signedBy: null,
      payload: { foo: 'bar' },
      createdAt: '2026-01-01T00:00:00Z',
    });
  });

  it('fetchReceipts applies kind/ticket filters and maps each item', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ items: [WIRE_RECEIPT] }));
    const receipts = await fetchReceipts(
      'proj-1',
      { kind: 'gate', ticket: 'W4-05' },
      { ...OPTS, fetchImpl },
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:4317/api/v1/projects/proj-1/receipts?kind=gate&ticket=W4-05',
      expect.anything(),
    );
    expect(receipts[0]!.id).toBe('rcpt-1');
  });

  it('fetchApprovalsLedger unwraps items', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));
    const rows = await fetchApprovalsLedger('proj-1', { ...OPTS, fetchImpl });
    expect(rows).toEqual([]);
  });
});

describe('baseUrl prefix duplication guard (W10-29)', () => {
  it('does not double /api/v1 when baseUrl already carries the prefix (App.tsx real shape)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));
    await fetchReceipts(
      'proj-1',
      { ticket: 'W4-05' },
      { getToken: () => 'tok', baseUrl: '/api/v1', fetchImpl },
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/v1/projects/proj-1/receipts?ticket=W4-05',
      expect.anything(),
    );
  });

  it('strips a trailing /api/v1 from a full-origin baseUrl', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));
    await fetchArtifactList('proj-1', {
      getToken: () => 'tok',
      baseUrl: 'http://host:9/api/v1',
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://host:9/api/v1/projects/proj-1/artifacts',
      expect.anything(),
    );
  });

  it('strips a duplicating prefix even with a trailing slash on baseUrl', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));
    await fetchArtifactList('proj-1', {
      getToken: () => 'tok',
      baseUrl: '/api/v1/',
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/v1/projects/proj-1/artifacts',
      expect.anything(),
    );
  });

  it('strips a duplicating prefix with a trailing slash on a full-origin baseUrl', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));
    await fetchArtifactList('proj-1', {
      getToken: () => 'tok',
      baseUrl: 'http://host:9/api/v1/',
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://host:9/api/v1/projects/proj-1/artifacts',
      expect.anything(),
    );
  });

  it('leaves a plain-origin baseUrl (no /api/v1 suffix) untouched', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));
    await fetchArtifactList('proj-1', {
      getToken: () => 'tok',
      baseUrl: 'http://127.0.0.1:4317',
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:4317/api/v1/projects/proj-1/artifacts',
      expect.anything(),
    );
  });

  it('trims a trailing slash off a plain-origin baseUrl to avoid a double slash', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));
    await fetchArtifactList('proj-1', {
      getToken: () => 'tok',
      baseUrl: 'http://127.0.0.1:4317/',
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:4317/api/v1/projects/proj-1/artifacts',
      expect.anything(),
    );
  });

  it('throws instead of silently doubling when a duplicated prefix survives normalization', async () => {
    const fetchImpl = vi.fn();
    await expect(
      fetchArtifactList('proj-1', {
        getToken: () => 'tok',
        baseUrl: '/api/v1/api/v1',
        fetchImpl,
      }),
    ).rejects.toThrow(/duplicates the \/api\/v1 prefix/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('error handling', () => {
  it('throws ArtifactApiError with the RFC 7807 detail on a non-OK response', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ detail: 'no project registered' }, 404));
    await expect(fetchArtifactList('nope', { ...OPTS, fetchImpl })).rejects.toThrow(
      ArtifactApiError,
    );
    await expect(fetchArtifactList('nope', { ...OPTS, fetchImpl })).rejects.toThrow(
      'no project registered',
    );
  });
});
