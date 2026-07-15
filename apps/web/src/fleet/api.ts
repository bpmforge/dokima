/**
 * Fleet REST client (API_DESIGN §1/§2 "projects & runs"). The server
 * auto-injects the bearer token into the served `index.html` as
 * `window.__SHIPWRIGHT_TOKEN__` (server.ts's `injectToken`) — a browser
 * page has no other way to read `~/.shipwright/token` (SC-08).
 */

import type { CreateProjectInput, ProjectBoardStats, ProjectCard } from './types.js';

interface ProjectCardWire {
  id: string;
  path: string;
  name: string;
  archived: boolean;
  created_at: string;
  last_opened_at: string;
  phase: number | null;
  board: ProjectBoardStats;
  berths_running: number;
  heartbeat_age_ms: number | null;
  pending_decide_count: number;
  spend_today: number;
}

function fromWire(wire: ProjectCardWire): ProjectCard {
  return {
    id: wire.id,
    path: wire.path,
    name: wire.name,
    archived: wire.archived,
    createdAt: wire.created_at,
    lastOpenedAt: wire.last_opened_at,
    phase: wire.phase,
    board: wire.board,
    berthsRunning: wire.berths_running,
    heartbeatAgeMs: wire.heartbeat_age_ms,
    pendingDecideCount: wire.pending_decide_count,
    spendTodayUsd: wire.spend_today,
  };
}

export class FleetApiError extends Error {
  constructor(
    public readonly status: number,
    detail?: string,
  ) {
    super(detail ?? `Fleet API request failed with status ${status}`);
    this.name = 'FleetApiError';
  }
}

export function readInjectedToken(): string | undefined {
  return (globalThis as { __SHIPWRIGHT_TOKEN__?: string }).__SHIPWRIGHT_TOKEN__;
}

export interface FleetApiOptions {
  fetchImpl?: typeof fetch;
  getToken?: () => string | undefined;
  baseUrl?: string;
}

async function request(
  urlPath: string,
  init: RequestInit,
  opts: FleetApiOptions,
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
    throw new FleetApiError(res.status, detail);
  }
  return res.json();
}

export async function fetchProjects(
  filter: { archived?: boolean } = {},
  opts: FleetApiOptions = {},
): Promise<ProjectCard[]> {
  const qs = filter.archived ? '?archived=true' : '';
  const body = (await request(`/api/v1/projects${qs}`, { method: 'GET' }, opts)) as {
    projects: ProjectCardWire[];
  };
  return body.projects.map(fromWire);
}

export async function createProject(
  input: CreateProjectInput,
  opts: FleetApiOptions = {},
): Promise<ProjectCard> {
  const wire = (await request(
    '/api/v1/projects',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    opts,
  )) as ProjectCardWire;
  return fromWire(wire);
}

export async function archiveProject(
  id: string,
  opts: FleetApiOptions = {},
): Promise<ProjectCard> {
  const wire = (await request(
    `/api/v1/projects/${encodeURIComponent(id)}/archive`,
    { method: 'POST' },
    opts,
  )) as ProjectCardWire;
  return fromWire(wire);
}
