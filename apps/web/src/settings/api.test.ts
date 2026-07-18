import { describe, expect, it, vi } from 'vitest';
import {
  fetchAutonomy,
  fetchBudget,
  fetchEffectiveSettings,
  fetchModelMatrix,
  putModelMatrix,
  putProjectSettings,
} from './api.js';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe('settings api (part 1)', () => {
  it('fetchModelMatrix maps snake_case wire rows to camelCase and sends the token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        rows: [
          {
            role: 'coding-agent',
            task_type: 'code',
            model: 'local/qwen',
            fallback: [],
            updated_at: '2026-07-15T00:00:00Z',
            copilot_backed: false,
          },
        ],
        copilot_enabled: false,
      }),
    );
    const matrix = await fetchModelMatrix('proj-1', {
      fetchImpl,
      getToken: () => 'tok',
      baseUrl: 'http://127.0.0.1:4317',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:4317/api/v1/projects/proj-1/model-matrix',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(matrix).toEqual({
      rows: [
        {
          role: 'coding-agent',
          taskType: 'code',
          model: 'local/qwen',
          fallback: [],
          updatedAt: '2026-07-15T00:00:00Z',
          copilotBacked: false,
        },
      ],
      copilotEnabled: false,
    });
  });

  it('putModelMatrix sends snake_case task_type in the request body', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ rows: [], copilot_enabled: false }));
    await putModelMatrix(
      'proj-1',
      [{ role: 'coding-agent', taskType: 'code', model: 'local/qwen' }],
      { fetchImpl, getToken: () => 'tok' },
    );
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      rows: [
        { role: 'coding-agent', task_type: 'code', model: 'local/qwen', fallback: [] },
      ],
    });
  });

  it('fetchAutonomy always surfaces the never_auto list', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        mode: 'interactive',
        never_auto: [{ id: 'destructive-db', label: 'x', reason: 'y' }],
      }),
    );
    const autonomy = await fetchAutonomy('proj-1', { fetchImpl, getToken: () => 'tok' });
    expect(autonomy.neverAuto).toHaveLength(1);
  });

  it('fetchBudget maps breaker_thresholds to camelCase', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        run_limit_usd: 5,
        project_limit_usd: null,
        breaker_thresholds: { warn: 0.7, downshift: 0.85, hard_stop: 1 },
      }),
    );
    const budget = await fetchBudget('proj-1', { fetchImpl, getToken: () => 'tok' });
    expect(budget).toEqual({
      runLimitUsd: 5,
      projectLimitUsd: null,
      breakerThresholds: { warn: 0.7, downshift: 0.85, hardStop: 1 },
    });
  });

  it('fetchEffectiveSettings maps winning_scope + overridden to camelCase', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        berths: {
          value: 4,
          winning_scope: 'run',
          overridden: [{ scope: 'project', value: 2 }],
        },
      }),
    );
    const effective = await fetchEffectiveSettings('proj-1', {
      fetchImpl,
      getToken: () => 'tok',
    });
    expect(effective.berths).toEqual({
      value: 4,
      winningScope: 'run',
      overridden: [{ scope: 'project', value: 2 }],
    });
  });

  it('putProjectSettings PUTs the raw patch object', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ berths: 3 }));
    await putProjectSettings(
      'proj-1',
      { berths: 3 },
      { fetchImpl, getToken: () => 'tok' },
    );
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ berths: 3 });
  });
});
