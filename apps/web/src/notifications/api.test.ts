import { describe, expect, it, vi } from 'vitest';
import {
  decideApproval,
  dismissNotification,
  fetchMorningQueue,
  fetchNotifications,
  NotificationsApiError,
} from './api.js';

const WIRE_ITEM = {
  id: 'n-1',
  tier: 'decide',
  kind: 'approval',
  ref_type: null,
  ref_id: null,
  title: 'Merge W4-07',
  body: { diffStat: '+10 -2' },
  leverage: 30,
  status: 'open',
  pushed_at: null,
  created_at: '2026-07-18T09:00:00.000Z',
  resolved_at: null,
  project_id: 'proj-1',
  project_name: 'Proj One',
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe('fetchNotifications', () => {
  it('maps wire (snake_case) shape to the camelCase NotificationItem', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ items: [WIRE_ITEM] }));
    const items = await fetchNotifications({}, { fetchImpl, getToken: () => 'tok' });
    expect(items).toEqual([
      {
        id: 'n-1',
        tier: 'decide',
        kind: 'approval',
        refType: null,
        refId: null,
        title: 'Merge W4-07',
        body: { diffStat: '+10 -2' },
        leverage: 30,
        status: 'open',
        pushedAt: null,
        createdAt: '2026-07-18T09:00:00.000Z',
        resolvedAt: null,
        projectId: 'proj-1',
        projectName: 'Proj One',
      },
    ]);
  });

  it('encodes tier/status/project filters as query params', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));
    await fetchNotifications(
      { tier: 'decide', status: 'open', projectId: 'proj-1' },
      { fetchImpl, getToken: () => 'tok' },
    );
    const url = fetchImpl.mock.calls[0]?.[0] as string;
    expect(url).toContain('tier=decide');
    expect(url).toContain('status=open');
    expect(url).toContain('project=proj-1');
  });

  it('surfaces a non-ok response as NotificationsApiError with the problem detail', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ detail: 'bad tier' }, 400));
    await expect(
      fetchNotifications({}, { fetchImpl, getToken: () => 'tok' }),
    ).rejects.toMatchObject({ status: 400, message: 'bad tier' });
  });
});

describe('fetchMorningQueue', () => {
  it('GETs /api/v1/approvals/queue, optionally scoped to one project', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ items: [WIRE_ITEM] }));
    await fetchMorningQueue(
      { projectId: 'proj-1' },
      { fetchImpl, getToken: () => 'tok' },
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/v1/approvals/queue?project=proj-1',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});

describe('decideApproval', () => {
  it('POSTs the decision to /api/v1/approvals/:id/decide?project=', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ id: 'n-1', status: 'done' }));
    await decideApproval('n-1', 'proj-1', 'approved', {
      fetchImpl,
      getToken: () => 'tok',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/v1/approvals/n-1/decide?project=proj-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ decision: 'approved' }),
      }),
    );
  });
});

describe('dismissNotification', () => {
  it('POSTs to /api/v1/notifications/:id/dismiss?project=', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ id: 'n-1', status: 'dismissed' }));
    await dismissNotification('n-1', 'proj-1', { fetchImpl, getToken: () => 'tok' });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/v1/notifications/n-1/dismiss?project=proj-1',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('NotificationsApiError', () => {
  it('falls back to a generic message when the body has no detail', () => {
    const err = new NotificationsApiError(500);
    expect(err.message).toContain('500');
  });
});
