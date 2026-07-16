/**
 * Chat REST client (`GET /api/v1/projects/:id/chat` — server.ts, currently
 * fixture-backed, see `fixtures.ts`'s module comment). Bearer token comes
 * from `window.__SHIPWRIGHT_TOKEN__`, the same server-injected global
 * `apps/web/src/fleet/api.ts` already reads (server.ts's `injectToken`).
 */

import type { ServerEnvelope } from '../lib/ws-client.js';

export class ChatApiError extends Error {
  constructor(
    public readonly status: number,
    detail?: string,
  ) {
    super(detail ?? `Chat API request failed with status ${status}`);
    this.name = 'ChatApiError';
  }
}

export function readInjectedToken(): string | undefined {
  return (globalThis as { __SHIPWRIGHT_TOKEN__?: string }).__SHIPWRIGHT_TOKEN__;
}

export interface ChatApiOptions {
  fetchImpl?: typeof fetch;
  getToken?: () => string | undefined;
  baseUrl?: string;
}

export async function fetchChatEvents(
  projectId: string,
  opts: ChatApiOptions = {},
): Promise<ServerEnvelope[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const getToken = opts.getToken ?? readInjectedToken;
  const token = getToken();
  const res = await fetchImpl(
    `${opts.baseUrl ?? ''}/api/v1/projects/${encodeURIComponent(projectId)}/chat`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
  );
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => undefined);
    const detail =
      typeof body === 'object' && body !== null && 'detail' in body
        ? String((body as { detail: unknown }).detail)
        : undefined;
    throw new ChatApiError(res.status, detail);
  }
  const body = (await res.json()) as { items: ServerEnvelope[] };
  return body.items;
}
