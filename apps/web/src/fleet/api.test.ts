import { describe, expect, it, vi } from 'vitest';
import { archiveProject, createProject, fetchProjects, FleetApiError } from './api.js';

const WIRE_CARD = {
  id: 'proj-1',
  path: '/tmp/proj-1',
  name: 'Proj One',
  archived: false,
  created_at: '2026-01-01T00:00:00Z',
  last_opened_at: '2026-01-01T00:00:00Z',
  phase: null,
  board: { ready: 1, blocked: 0, done: 2 },
  berths_running: 0,
  heartbeat_age_ms: null,
  pending_decide_count: 3,
  spend_today: 1.5,
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe('fetchProjects', () => {
  it('maps wire (snake_case) shape to the camelCase ProjectCard and sends the token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ projects: [WIRE_CARD] }));
    const cards = await fetchProjects(
      {},
      { fetchImpl, getToken: () => 'tok-123', baseUrl: 'http://127.0.0.1:4317' },
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:4317/api/v1/projects',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer tok-123' }),
      }),
    );
    expect(cards).toEqual([
      {
        id: 'proj-1',
        path: '/tmp/proj-1',
        name: 'Proj One',
        archived: false,
        createdAt: '2026-01-01T00:00:00Z',
        lastOpenedAt: '2026-01-01T00:00:00Z',
        phase: null,
        board: { ready: 1, blocked: 0, done: 2 },
        berthsRunning: 0,
        heartbeatAgeMs: null,
        pendingDecideCount: 3,
        spendTodayUsd: 1.5,
      },
    ]);
  });

  it('appends ?archived=true when filtering for archived projects', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ projects: [] }));
    await fetchProjects({ archived: true }, { fetchImpl, getToken: () => undefined });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/v1/projects?archived=true',
      expect.anything(),
    );
  });

  it('omits the Authorization header when there is no token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ projects: [] }));
    await fetchProjects({}, { fetchImpl, getToken: () => undefined });
    const headers = fetchImpl.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('surfaces a non-ok response as FleetApiError with the problem detail', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ detail: 'no such directory' }, 400));
    await expect(
      fetchProjects({}, { fetchImpl, getToken: () => 'tok' }),
    ).rejects.toMatchObject({ status: 400, message: 'no such directory' });
  });
});

describe('createProject', () => {
  it('POSTs the input as JSON and maps the created card', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(WIRE_CARD, 201));
    const card = await createProject(
      { path: '/tmp/proj-1', mode: 'new', name: 'Proj One' },
      { fetchImpl, getToken: () => 'tok' },
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/v1/projects',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ path: '/tmp/proj-1', mode: 'new', name: 'Proj One' }),
      }),
    );
    expect(card.id).toBe('proj-1');
    expect(card.pendingDecideCount).toBe(3);
  });
});

describe('archiveProject', () => {
  it('POSTs to /api/v1/projects/:id/archive', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ...WIRE_CARD, archived: true }));
    const card = await archiveProject('proj-1', { fetchImpl, getToken: () => 'tok' });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/v1/projects/proj-1/archive',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(card.archived).toBe(true);
  });

  it('URL-encodes the project id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(WIRE_CARD));
    await archiveProject('has space', { fetchImpl, getToken: () => 'tok' });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/v1/projects/has%20space/archive',
      expect.anything(),
    );
  });
});

describe('FleetApiError', () => {
  it('falls back to a generic message when the body has no detail', () => {
    const err = new FleetApiError(500);
    expect(err.message).toContain('500');
  });
});
