/**
 * Notification center + morning queue REST client (API_DESIGN §2
 * "clarifications & approvals"). Same bearer-token-injected-by-the-SPA
 * discipline as `fleet/api.ts`/`roster/api.ts` (SC-08).
 */

import { readInjectedToken } from '../chat/api.js';
import type {
  NotificationItem,
  NotificationKind,
  NotificationStatus,
  NotificationTier,
} from './types.js';

interface NotificationWire {
  id: string;
  tier: NotificationTier;
  kind: NotificationKind;
  ref_type: string | null;
  ref_id: string | null;
  title: string;
  body: unknown;
  leverage: number;
  status: NotificationStatus;
  pushed_at: string | null;
  created_at: string;
  resolved_at: string | null;
  project_id: string;
  project_name: string;
}

function fromWire(wire: NotificationWire): NotificationItem {
  return {
    id: wire.id,
    tier: wire.tier,
    kind: wire.kind,
    refType: wire.ref_type,
    refId: wire.ref_id,
    title: wire.title,
    body: wire.body,
    leverage: wire.leverage,
    status: wire.status,
    pushedAt: wire.pushed_at,
    createdAt: wire.created_at,
    resolvedAt: wire.resolved_at,
    projectId: wire.project_id,
    projectName: wire.project_name,
  };
}

export class NotificationsApiError extends Error {
  constructor(
    public readonly status: number,
    detail?: string,
  ) {
    super(detail ?? `Notifications API request failed with status ${status}`);
    this.name = 'NotificationsApiError';
  }
}

export interface NotificationsApiOptions {
  fetchImpl?: typeof fetch;
  getToken?: () => string | undefined;
  baseUrl?: string;
}

async function request(
  urlPath: string,
  init: RequestInit,
  opts: NotificationsApiOptions,
): Promise<unknown> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const getToken = opts.getToken ?? readInjectedToken;
  const token = getToken();
  const res = await fetchImpl(`${opts.baseUrl ?? ''}${urlPath}`, {
    ...init,
    headers: {
      ...init.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => undefined);
    const detail =
      typeof body === 'object' && body !== null && 'detail' in body
        ? String((body as { detail: unknown }).detail)
        : undefined;
    throw new NotificationsApiError(res.status, detail);
  }
  return res.json();
}

export interface NotificationsFilter {
  tier?: NotificationTier;
  status?: NotificationStatus;
  projectId?: string;
}

function queryString(filter: NotificationsFilter): string {
  const params = new URLSearchParams();
  if (filter.tier) params.set('tier', filter.tier);
  if (filter.status) params.set('status', filter.status);
  if (filter.projectId) params.set('project', filter.projectId);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** `GET /api/v1/notifications` — the notification center feed, aggregated across projects by default (FR-F4). */
export async function fetchNotifications(
  filter: NotificationsFilter = {},
  opts: NotificationsApiOptions = {},
): Promise<NotificationItem[]> {
  const body = (await request(
    `/api/v1/notifications${queryString(filter)}`,
    { method: 'GET' },
    opts,
  )) as { items: NotificationWire[] };
  return body.items.map(fromWire);
}

/** `GET /api/v1/approvals/queue` — the leverage-sorted morning queue (UX_SPEC §7). */
export async function fetchMorningQueue(
  filter: { projectId?: string } = {},
  opts: NotificationsApiOptions = {},
): Promise<NotificationItem[]> {
  const qs = filter.projectId ? `?project=${encodeURIComponent(filter.projectId)}` : '';
  const body = (await request(
    `/api/v1/approvals/queue${qs}`,
    { method: 'GET' },
    opts,
  )) as {
    items: NotificationWire[];
  };
  return body.items.map(fromWire);
}

export async function decideApproval(
  id: string,
  projectId: string,
  decision: 'approved' | 'rejected',
  opts: NotificationsApiOptions = {},
): Promise<void> {
  await request(
    `/api/v1/approvals/${encodeURIComponent(id)}/decide?project=${encodeURIComponent(projectId)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision }),
    },
    opts,
  );
}

export async function dismissNotification(
  id: string,
  projectId: string,
  opts: NotificationsApiOptions = {},
): Promise<void> {
  await request(
    `/api/v1/notifications/${encodeURIComponent(id)}/dismiss?project=${encodeURIComponent(projectId)}`,
    { method: 'POST' },
    opts,
  );
}
