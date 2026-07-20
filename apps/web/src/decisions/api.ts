/**
 * Decision slate REST client (`apps/server/src/api/decisions/routes.ts`,
 * API_DESIGN.md "decisions & slates"). Mirrors `artifacts/api.ts`'s
 * fetch/error/token-injection shape rather than importing it — sibling
 * feature folders stay self-contained (same precedent `artifacts/api.ts`
 * itself documents for `chat/api.ts`).
 */

import type { DecisionResult, SlateRecord, SlateStatus } from './types.js';

export class DecisionsApiError extends Error {
  constructor(
    public readonly status: number,
    detail?: string,
  ) {
    super(detail ?? `Decisions API request failed with status ${status}`);
    this.name = 'DecisionsApiError';
  }
}

export function readInjectedToken(): string | undefined {
  return (globalThis as { __SHIPWRIGHT_TOKEN__?: string }).__SHIPWRIGHT_TOKEN__;
}

export interface DecisionsApiOptions {
  fetchImpl?: typeof fetch;
  getToken?: () => string | undefined;
  baseUrl?: string;
}

async function request(
  urlPath: string,
  init: RequestInit,
  opts: DecisionsApiOptions,
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
    throw new DecisionsApiError(res.status, detail);
  }
  if (res.status === 204) return undefined;
  return res.json();
}

export async function fetchSlates(
  projectId: string,
  status: SlateStatus | undefined,
  opts: DecisionsApiOptions = {},
): Promise<SlateRecord[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const body = (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/slates${qs}`,
    { method: 'GET' },
    opts,
  )) as { items: SlateRecord[] };
  return body.items;
}

export async function decideSlate(
  projectId: string,
  slateId: string,
  input: { chosen: string; rationale?: string },
  opts: DecisionsApiOptions = {},
): Promise<DecisionResult> {
  return (await request(
    `/api/v1/slates/${encodeURIComponent(slateId)}/decide?project=${encodeURIComponent(projectId)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    opts,
  )) as DecisionResult;
}
