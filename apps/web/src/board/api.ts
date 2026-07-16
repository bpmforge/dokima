import type { BoardTicket, ListResponse, ProblemDetails, Ticket } from './types.js';

/**
 * REST client for the board (API_DESIGN §2 "tickets — verbs"). Every
 * mutating POST carries an `Idempotency-Key` (API_DESIGN §1) and every
 * request the project's bearer token (D-005). Results are a discriminated
 * union rather than a throw: a 409 invariant refusal is expected UI flow
 * (FR-T4 "explain-this-refusal"), not an exceptional failure.
 */
export interface BoardApiOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  /** Injectable for tests; defaults to `crypto.randomUUID()` (API_DESIGN: "client UUID"). */
  idempotencyKey?: () => string;
}

export type LifecycleVerb =
  'claim' | 'start' | 'close' | 'accept' | 'release' | 'comment';

export type BoardResult<T> =
  { ok: true; data: T } | { ok: false; problem: ProblemDetails };

function authHeaders(opts: BoardApiOptions): Record<string, string> {
  return { Authorization: `Bearer ${opts.token}` };
}

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  return text.length > 0 ? JSON.parse(text) : null;
}

function asProblem(status: number, body: unknown, instance: string): ProblemDetails {
  if (typeof body === 'object' && body !== null && 'title' in body) {
    return body as ProblemDetails;
  }
  return {
    type: 'about:blank',
    title: 'request failed',
    status,
    detail: `unexpected response (status ${status})`,
    instance,
    request_id: 'unknown',
  };
}

export interface TicketFilters {
  status?: string;
  lane?: string;
  type?: string;
  claimable?: boolean;
  stale?: boolean;
}

function buildQuery(filters: TicketFilters | undefined): string {
  if (!filters) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

export async function fetchBoardTickets(
  opts: BoardApiOptions,
  projectId: string,
  filters?: TicketFilters,
): Promise<BoardResult<BoardTicket[]>> {
  const instance = `/projects/${projectId}/tickets`;
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(`${opts.baseUrl}${instance}${buildQuery(filters)}`, {
    method: 'GET',
    headers: authHeaders(opts),
  });
  const body = await parseJson(res);
  if (!res.ok) return { ok: false, problem: asProblem(res.status, body, instance) };
  return { ok: true, data: (body as ListResponse<BoardTicket>).items };
}

export interface FireVerbInput {
  owner?: string;
  body?: string;
  files?: string[];
  verify?: { command: string; exitCode: number };
  commits?: string[];
}

/**
 * `projectId` disambiguates which registered project's `state.db` owns this
 * ticket id — API_DESIGN's `POST /tickets/{id}/{verb}` catalog shape has no
 * project segment (the CLI never needed one: it always resolves one dbPath
 * from `cwd`), so a `?project=` query param is the server's minimal fix for
 * "one core serving N projects" (D-013) without changing the documented path.
 */
export async function fireTicketVerb(
  opts: BoardApiOptions,
  ticketId: string,
  verb: LifecycleVerb,
  projectId: string,
  input?: FireVerbInput,
): Promise<BoardResult<Ticket>> {
  const instance = `/tickets/${ticketId}/${verb}?project=${encodeURIComponent(projectId)}`;
  const doFetch = opts.fetchImpl ?? fetch;
  const key = (opts.idempotencyKey ?? (() => crypto.randomUUID()))();
  const res = await doFetch(`${opts.baseUrl}${instance}`, {
    method: 'POST',
    headers: {
      ...authHeaders(opts),
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    body: JSON.stringify(input ?? {}),
  });
  const body = await parseJson(res);
  if (!res.ok) return { ok: false, problem: asProblem(res.status, body, instance) };
  return { ok: true, data: body as Ticket };
}
