import { describe, expect, it, vi } from 'vitest';
import { fetchGateReceipts, OnboardingApiError, runGuidedPipeline } from './api.js';
import { SAMPLE_BLUEPRINT_TITLE, SAMPLE_INTERVIEW_SESSION } from './sample-data.js';
import type { PipelineRunResult } from './types.js';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

const OPTS = { getToken: () => 'tok-123', baseUrl: 'http://127.0.0.1:4317' };

const RUN_RESULT: PipelineRunResult = {
  run_id: 'run-1',
  plan: { tickets: [{ id: 'T-1' }], violations: [], mermaid: 'graph TD' },
  plan_items: [
    {
      id: 'PLAN-1',
      catalog_id: 'CAT-1',
      state: 'accepted',
      ticket_id: 'T-1',
      ticket_created: true,
    },
  ],
};

describe('runGuidedPipeline', () => {
  it('POSTs the interview session and blueprint title to the pipeline/run route', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(RUN_RESULT, 201));
    const result = await runGuidedPipeline(
      'proj-1',
      {
        interviewSession: SAMPLE_INTERVIEW_SESSION,
        blueprintTitle: SAMPLE_BLUEPRINT_TITLE,
      },
      { ...OPTS, fetchImpl },
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:4317/api/v1/projects/proj-1/pipeline/run',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          interviewSession: SAMPLE_INTERVIEW_SESSION,
          blueprintTitle: SAMPLE_BLUEPRINT_TITLE,
        }),
        headers: expect.objectContaining({ Authorization: 'Bearer tok-123' }),
      }),
    );
    expect(result.run_id).toBe('run-1');
  });

  it('throws OnboardingApiError with the RFC 7807 detail on a non-OK response', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ detail: 'route not found' }, 404));
    await expect(
      runGuidedPipeline(
        'proj-1',
        {
          interviewSession: SAMPLE_INTERVIEW_SESSION,
          blueprintTitle: SAMPLE_BLUEPRINT_TITLE,
        },
        { ...OPTS, fetchImpl },
      ),
    ).rejects.toThrow(OnboardingApiError);
  });

  it('surfaces the 422 status for a decision-incomplete failure', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ detail: 'unresolved founder decision' }, 422));
    await expect(
      runGuidedPipeline(
        'proj-1',
        {
          interviewSession: SAMPLE_INTERVIEW_SESSION,
          blueprintTitle: SAMPLE_BLUEPRINT_TITLE,
        },
        { ...OPTS, fetchImpl },
      ),
    ).rejects.toMatchObject({ status: 422 });
  });
});

describe('fetchGateReceipts', () => {
  it('GETs gate-kind receipts and unwraps items', async () => {
    const receipt = {
      id: 'receipt-1',
      kind: 'gate',
      project_id: 'proj-1',
      phase: 2,
      ticket_id: null,
      validators: [],
      input_tree_hash: null,
      verify_command: null,
      verify_exit: 0,
      signed_by: 'operator',
      payload: {},
      created_at: '2026-07-20T00:00:00Z',
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ items: [receipt] }));
    const items = await fetchGateReceipts('proj-1', { ...OPTS, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:4317/api/v1/projects/proj-1/receipts?kind=gate',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(items).toEqual([receipt]);
  });
});

/**
 * W10-58: the run became a background job. These cases pin the half of that
 * change the client owns — POST, then poll to a terminal state — and pin it
 * BEHIND the unchanged awaited contract, which is why every existing case above
 * still passes untouched.
 */
describe('runGuidedPipeline drives the W10-58 job to a terminal state', () => {
  const ACCEPTED = { status: 'running', run_id: 'run-9' };

  it('polls the status route after a 202 and resolves with the completed plan', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(ACCEPTED, 202))
      .mockResolvedValueOnce(
        jsonResponse({
          run_id: 'run-9',
          status: 'running',
          phases: [{ name: 'blueprint', at: 't0' }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          run_id: 'run-9',
          status: 'completed',
          phases: [
            { name: 'blueprint', at: 't0' },
            { name: 'board', at: 't1' },
          ],
          result: RUN_RESULT,
        }),
      );
    const seen: string[][] = [];

    const result = await runGuidedPipeline(
      'proj-1',
      {
        interviewSession: SAMPLE_INTERVIEW_SESSION,
        blueprintTitle: SAMPLE_BLUEPRINT_TITLE,
      },
      {
        ...OPTS,
        fetchImpl,
        pollIntervalMs: 0,
        onProgress: (p) => seen.push(p.phases.map((phase) => phase.name)),
      },
    );

    expect(result).toEqual(RUN_RESULT);
    // The second call is the status route for the id the POST handed back.
    expect(fetchImpl.mock.calls[1]?.[0]).toBe(
      'http://127.0.0.1:4317/api/v1/projects/proj-1/pipeline/runs/run-9',
    );
    // Progress was reported as it arrived, not just once at the end — the whole
    // point of the ticket is that the wait stops being opaque.
    expect(seen).toEqual([['blueprint'], ['blueprint', 'board']]);
  });

  it('surfaces a failed run as OnboardingApiError carrying the server status and detail', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(ACCEPTED, 202))
      .mockResolvedValueOnce(
        jsonResponse({
          run_id: 'run-9',
          status: 'failed',
          phases: [{ name: 'blueprint', at: 't0' }],
          error: { status: 422, body: { detail: 'unresolved founder decision' } },
        }),
      );

    await expect(
      runGuidedPipeline(
        'proj-1',
        {
          interviewSession: SAMPLE_INTERVIEW_SESSION,
          blueprintTitle: SAMPLE_BLUEPRINT_TITLE,
        },
        { ...OPTS, fetchImpl, pollIntervalMs: 0 },
      ),
    ).rejects.toMatchObject({ status: 422, message: 'unresolved founder decision' });
  });

  it('returns an awaiting-decisions pause as the outcome, not an error', async () => {
    const awaiting = {
      status: 'awaiting_decisions',
      run_id: 'run-9',
      reasons: ['D-002 unresolved'],
      decisions: [{ key: 'storage', slate_id: 'slate-1', title: 'Storage approach' }],
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(ACCEPTED, 202))
      .mockResolvedValueOnce(
        jsonResponse({
          run_id: 'run-9',
          status: 'awaiting-decisions',
          phases: [{ name: 'blueprint', at: 't0' }],
          awaiting,
        }),
      );

    const result = await runGuidedPipeline(
      'proj-1',
      {
        interviewSession: SAMPLE_INTERVIEW_SESSION,
        blueprintTitle: SAMPLE_BLUEPRINT_TITLE,
      },
      { ...OPTS, fetchImpl, pollIntervalMs: 0 },
    );

    expect(result).toEqual(awaiting);
  });
});
