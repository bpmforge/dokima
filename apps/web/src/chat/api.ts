/**
 * Chat REST client (`GET /api/v1/projects/:id/chat` — server.ts, currently
 * fixture-backed, see `fixtures.ts`'s module comment). Bearer token comes
 * from `window.__DOKIMA_TOKEN__`, the same server-injected global
 * `apps/web/src/fleet/api.ts` already reads (server.ts's `injectToken`).
 */

import { fireTicketVerb } from '../board/api.js';
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
  return (globalThis as { __DOKIMA_TOKEN__?: string }).__DOKIMA_TOKEN__;
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

/**
 * A reply from the Chat pane, sent as the ticket's `comment` verb — the same
 * `POST /api/v1/tickets/:id/comment` the board uses (board-routes.ts). No new
 * write path: it lands as a `ticket.commented` row in the hash-chained log,
 * attributed to the operator, and appears in the ticket's history. Throws
 * with the server's own refusal text so the composer can show it verbatim.
 */
export async function sendChatReply(
  projectId: string,
  ticketId: string,
  body: string,
  opts: ChatApiOptions = {},
): Promise<void> {
  const getToken = opts.getToken ?? readInjectedToken;
  const result = await fireTicketVerb(
    {
      baseUrl: `${opts.baseUrl ?? ''}/api/v1`,
      token: getToken() ?? '',
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    },
    // The id came over the chat wire; encode it so it can only ever name a
    // ticket, never another path segment.
    encodeURIComponent(ticketId),
    'comment',
    projectId,
    { body },
  );
  if (!result.ok) {
    throw new ChatApiError(
      result.problem.status,
      result.problem.detail || result.problem.title,
    );
  }
}
