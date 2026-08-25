import type { BoardApiOptions } from '../api.js';
import type { DagEditResult, SpendByRung, TraceEvent } from './types.js';

function authHeaders(opts: BoardApiOptions): Record<string, string> {
  return { Authorization: `Bearer ${opts.token}` };
}

export async function getJson(opts: BoardApiOptions, path: string): Promise<unknown> {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(`${opts.baseUrl}${path}`, { headers: authHeaders(opts) });
  const text = await res.text();
  const body = text.length > 0 ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`request to ${path} failed with status ${res.status}`);
  return body;
}

/** `GET /projects/{id}/spend?group_by=rung` (drawer §4 "spend by rung"). */
export async function fetchSpendByRung(
  opts: BoardApiOptions,
  projectId: string,
): Promise<SpendByRung> {
  return (await getJson(
    opts,
    `/projects/${encodeURIComponent(projectId)}/spend?group_by=rung`,
  )) as SpendByRung;
}

/** `GET /tickets/{id}/runs?project=` — which run(s), if any, have worked this ticket. */
export async function fetchTicketRuns(
  opts: BoardApiOptions,
  projectId: string,
  ticketId: string,
): Promise<string[]> {
  const body = (await getJson(
    opts,
    `/tickets/${encodeURIComponent(ticketId)}/runs?project=${encodeURIComponent(projectId)}`,
  )) as { items: string[] };
  return body.items;
}

/** `GET /runs/{id}/trace?project=&ticket=` (drawer §4 "session trace link"). */
export async function fetchRunTrace(
  opts: BoardApiOptions,
  projectId: string,
  runId: string,
  ticketId: string,
): Promise<TraceEvent[]> {
  const body = (await getJson(
    opts,
    `/runs/${encodeURIComponent(runId)}/trace?project=${encodeURIComponent(projectId)}&ticket=${encodeURIComponent(ticketId)}`,
  )) as { items: TraceEvent[] };
  return body.items;
}

/**
 * `PATCH /tickets/{id}?project=` (UX_SPEC §4 "pre-build DAG edit … schema
 * invariants refuse bad edits with the same explain pattern"). Always a
 * `DagEditResult` rather than a thrown error for the two expected-refusal
 * codes — a 409 (bad edit) or 501 (validated, not yet persisted — module
 * header of the server route) are both normal outcomes here, not
 * exceptions (same discriminated-result discipline as `board/api.ts`'s
 * `BoardResult`).
 */
export async function patchDependsOn(
  opts: BoardApiOptions,
  projectId: string,
  ticketId: string,
  dependsOn: string[],
): Promise<DagEditResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(
    `${opts.baseUrl}/tickets/${encodeURIComponent(ticketId)}?project=${encodeURIComponent(projectId)}`,
    {
      method: 'PATCH',
      headers: { ...authHeaders(opts), 'Content-Type': 'application/json' },
      body: JSON.stringify({ dependsOn }),
    },
  );
  const text = await res.text();
  const body =
    text.length > 0 ? (JSON.parse(text) as { rule?: string; detail?: string }) : {};
  if (res.status === 409) {
    return {
      kind: 'refused',
      rule: body.rule ?? 'REFUSED',
      detail: body.detail ?? 'refused',
    };
  }
  if (res.status === 501) {
    return { kind: 'not-persisted', detail: body.detail ?? 'not persisted yet' };
  }
  return { kind: 'error', detail: body.detail ?? `unexpected status ${res.status}` };
}

/** W19-04: the run's WHOLE event slice (no ticket filter) — the end-of-run summary derives from it. */
export async function fetchRunTraceAll(
  opts: BoardApiOptions,
  projectId: string,
  runId: string,
): Promise<TraceEvent[]> {
  const body = (await getJson(
    opts,
    `/runs/${encodeURIComponent(runId)}/trace?project=${encodeURIComponent(projectId)}`,
  )) as { items: TraceEvent[] };
  return body.items;
}
