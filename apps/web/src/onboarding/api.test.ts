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
