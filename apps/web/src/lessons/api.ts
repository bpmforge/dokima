/**
 * REST client for field-report intake + triage (BLUEPRINT §12.6, UX_SPEC §7
 * G-10c). Mirrors `../board/api.ts`'s pattern: every mutating POST carries
 * an `Idempotency-Key`, every request the project's bearer token, and a
 * refusal is a `BoardResult`-shaped discriminated union rather than a throw
 * (FR-T4 "explain-this-refusal"). Targets the real routes registered by
 * `apps/server/src/api/lessons/routes.ts`.
 */
import type { BoardApiOptions } from '../board/api.js';
import type { ProblemDetails } from '../board/types.js';
import type { FieldReportDraft, FieldReportRecord, FieldReportStatus } from './types.js';

export type FieldReportResult<T> =
  { ok: true; data: T } | { ok: false; problem: ProblemDetails };

export type TriageDecision =
  | { decision: 'playbook'; taskClass: string; entry: string; triageNote?: string }
  | {
      decision: 'ticket';
      ticketId: string;
      title: string;
      lane: string;
      writeScope: string[];
      acceptance?: string[];
      verify?: string | null;
      triageNote?: string;
    }
  | { decision: 'reject'; triageNote?: string };

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

/** `POST /projects/{id}/field-reports` — files a report; the server assigns `filedBy` from the authenticated actor. */
export async function fileFieldReport(
  opts: BoardApiOptions,
  projectId: string,
  draft: FieldReportDraft,
): Promise<FieldReportResult<FieldReportRecord>> {
  const instance = `/projects/${encodeURIComponent(projectId)}/field-reports`;
  const doFetch = opts.fetchImpl ?? fetch;
  const key = (opts.idempotencyKey ?? (() => crypto.randomUUID()))();
  const res = await doFetch(`${opts.baseUrl}${instance}`, {
    method: 'POST',
    headers: {
      ...authHeaders(opts),
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    body: JSON.stringify(draft),
  });
  const body = await parseJson(res);
  if (!res.ok) return { ok: false, problem: asProblem(res.status, body, instance) };
  return { ok: true, data: body as FieldReportRecord };
}

/** `GET /projects/{id}/field-reports?status=` — the triage queue's read path. */
export async function listFieldReports(
  opts: BoardApiOptions,
  projectId: string,
  status?: FieldReportStatus,
): Promise<FieldReportResult<FieldReportRecord[]>> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  const instance = `/projects/${encodeURIComponent(projectId)}/field-reports${query}`;
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(`${opts.baseUrl}${instance}`, {
    method: 'GET',
    headers: authHeaders(opts),
  });
  const body = await parseJson(res);
  if (!res.ok) return { ok: false, problem: asProblem(res.status, body, instance) };
  return { ok: true, data: (body as { items: FieldReportRecord[] }).items };
}

/** `POST /field-reports/{id}/triage?project=` — accept-to-playbook, accept-to-ticket, or reject. The server refuses self-triage (the filer cannot confirm their own report, Law 5). Field reports live in a project's own event log, so the project id disambiguates the same way `../decisions/api.ts`'s `?project=` decide call does. */
export async function triageFieldReport(
  opts: BoardApiOptions,
  projectId: string,
  reportId: number,
  decision: TriageDecision,
): Promise<FieldReportResult<FieldReportRecord>> {
  const instance = `/field-reports/${encodeURIComponent(String(reportId))}/triage?project=${encodeURIComponent(projectId)}`;
  const doFetch = opts.fetchImpl ?? fetch;
  const key = (opts.idempotencyKey ?? (() => crypto.randomUUID()))();
  const res = await doFetch(`${opts.baseUrl}${instance}`, {
    method: 'POST',
    headers: {
      ...authHeaders(opts),
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    body: JSON.stringify(decision),
  });
  const body = await parseJson(res);
  if (!res.ok) return { ok: false, problem: asProblem(res.status, body, instance) };
  return { ok: true, data: body as FieldReportRecord };
}
