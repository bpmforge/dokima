import { describe, expect, it, vi } from 'vitest';
import { fetchAgentHistory, fetchRoster, RosterApiError } from './api.js';

const WIRE_EXPERT = {
  id: 'sdlc-lead',
  display_name: 'SDLC Lead',
  cluster: 'coordinators',
  mode: 'primary',
  description: 'Program manager and lead architect',
  effective_model: {
    chain: ['claude-sonnet-5'],
    scope: 'project' as const,
    used_default_role: false,
  },
  fitness_cards: [
    {
      model: 'claude-sonnet-5',
      verdict: 'fit' as const,
      harness_version: '1.0.0',
      run_at: '2026-07-15T00:00:00Z',
    },
  ],
  instruction_cost: null,
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe('fetchRoster', () => {
  it('maps wire (snake_case) shape to the camelCase RosterExpert', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ experts: [WIRE_EXPERT] }));
    const experts = await fetchRoster({}, { fetchImpl, getToken: () => 'tok' });

    expect(fetchImpl).toHaveBeenCalledWith('/api/v1/roster', expect.anything());
    expect(experts).toEqual([
      {
        id: 'sdlc-lead',
        displayName: 'SDLC Lead',
        cluster: 'coordinators',
        mode: 'primary',
        description: 'Program manager and lead architect',
        effectiveModel: {
          chain: ['claude-sonnet-5'],
          scope: 'project',
          usedDefaultRole: false,
        },
        fitnessCards: [
          {
            model: 'claude-sonnet-5',
            verdict: 'fit',
            harnessVersion: '1.0.0',
            runAt: '2026-07-15T00:00:00Z',
          },
        ],
        instructionCost: null,
      },
    ]);
  });

  it('appends ?project= when a project id is given', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ experts: [] }));
    await fetchRoster({ projectId: 'proj-1' }, { fetchImpl, getToken: () => 'tok' });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/v1/roster?project=proj-1',
      expect.anything(),
    );
  });

  it('surfaces a non-ok response as RosterApiError with the rule when present', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ detail: 'refused', rule: 'FR-E2: pin roles, not models' }, 500),
      );
    await expect(
      fetchRoster({}, { fetchImpl, getToken: () => 'tok' }),
    ).rejects.toMatchObject({
      status: 500,
      message: 'refused',
      rule: 'FR-E2: pin roles, not models',
    });
  });
});

describe('fetchAgentHistory', () => {
  it('GETs /roster/:agent/history?project= and maps the wire shape', async () => {
    const wire = {
      agent_id: 'sdlc-lead',
      handoffs_run: 2,
      outcomes: 1,
      verdict_scores: 0,
      spend: 0,
      escalations: 0,
      entries: [
        {
          seq: 1,
          event_type: 'ticket.claimed',
          kind: 'handoff' as const,
          ticket_id: 'T-1',
          occurred_at: '2026-07-15T00:00:00Z',
        },
      ],
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(wire));
    const history = await fetchAgentHistory('sdlc-lead', 'proj-1', {
      fetchImpl,
      getToken: () => 'tok',
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/v1/roster/sdlc-lead/history?project=proj-1',
      expect.anything(),
    );
    expect(history).toEqual({
      agentId: 'sdlc-lead',
      handoffsRun: 2,
      outcomes: 1,
      verdictScores: 0,
      spend: 0,
      escalations: 0,
      entries: [
        {
          seq: 1,
          eventType: 'ticket.claimed',
          kind: 'handoff',
          ticketId: 'T-1',
          occurredAt: '2026-07-15T00:00:00Z',
        },
      ],
    });
  });
});

describe('RosterApiError', () => {
  it('falls back to a generic message when the body has no detail', () => {
    const err = new RosterApiError(500);
    expect(err.message).toContain('500');
  });
});
