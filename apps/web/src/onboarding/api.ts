/**
 * Guided-sample REST client (BLUEPRINT §12.3, FR-S4). Targets
 * `POST /api/v1/projects/:id/pipeline/run` (W5-18, wired into
 * `apps/server/src/api/server.ts` by W5-22) and
 * `GET /api/v1/projects/:id/receipts?kind=gate` (`server.ts`
 * `registerReceiptRoutes`) — same `request()`/token-injection/error-class
 * shape as `apps/web/src/fleet/api.ts`.
 *
 * `runGuidedPipeline` still surfaces any non-OK status as
 * `OnboardingApiError` rather than throwing a generic error — `GuidedSample.tsx`
 * degrades honestly (never fabricates a result) on the cases a real
 * pipeline run can still fail for: an unresolved founder decision (422), or
 * a misconfigured/older server that hasn't mounted the route (404).
 */
import { readInjectedToken } from '../fleet/api.js';
import {
  isRunAccepted,
  type GateReceipt,
  type PipelineRunOutcome,
  type PipelineRunPhase,
  type PipelineRunRequest,
  type PipelineRunResult,
  type PipelineRunStatus,
} from './types.js';

export class OnboardingApiError extends Error {
  constructor(
    public readonly status: number,
    detail?: string,
  ) {
    super(detail ?? `Onboarding API request failed with status ${status}`);
    this.name = 'OnboardingApiError';
  }
}

export interface OnboardingApiOptions {
  fetchImpl?: typeof fetch;
  getToken?: () => string | undefined;
  baseUrl?: string;
  /** W10-58: called each time the run's status is read, so a caller can render per-phase progress. */
  onProgress?: (progress: {
    readonly status: PipelineRunStatus['status'];
    readonly phases: readonly PipelineRunPhase[];
  }) => void;
  /** Poll spacing. 0 in tests so they neither sleep nor race. */
  pollIntervalMs?: number;
}

async function request(
  urlPath: string,
  init: RequestInit,
  opts: OnboardingApiOptions,
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
    throw new OnboardingApiError(res.status, detail);
  }
  return res.json();
}

export async function fetchRunStatus(
  projectId: string,
  runId: string,
  opts: OnboardingApiOptions = {},
): Promise<PipelineRunStatus> {
  return (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/pipeline/runs/${encodeURIComponent(runId)}`,
    { method: 'GET' },
    opts,
  )) as PipelineRunStatus;
}

/**
 * W10-58: the run is a background job, and this function hides that from its
 * existing callers ON PURPOSE.
 *
 * `GuidedSample` and `InterviewPanel` both await a single outcome, and the
 * first-run wizard's e2e drives exactly that path. Changing the contract here
 * would have meant changing them and the specs that cover them, for no gain:
 * what the founder needs is not a different call shape but PROGRESS during the
 * wait, which `onProgress` now supplies. The awaited result is unchanged —
 * still a completed plan or an awaiting-decisions pause, still an
 * `OnboardingApiError` on failure carrying the server's own status and detail.
 */
export async function runGuidedPipeline(
  projectId: string,
  body: PipelineRunRequest,
  opts: OnboardingApiOptions = {},
): Promise<PipelineRunOutcome> {
  const started = (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/pipeline/run`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    opts,
  )) as PipelineRunOutcome | { status: 'running'; run_id: string };

  // A server that still answers synchronously (or pauses immediately) is
  // returned as-is rather than polled for — the client does not require the
  // job behaviour to exist, it just uses it when it does.
  if (!isRunAccepted(started)) return started as PipelineRunOutcome;

  const runId = started.run_id;
  const interval = opts.pollIntervalMs ?? 400;
  for (;;) {
    const status = await fetchRunStatus(projectId, runId, opts);
    opts.onProgress?.({ status: status.status, phases: status.phases });
    if (status.status === 'completed' && status.result) return status.result;
    if (status.status === 'awaiting-decisions' && status.awaiting) return status.awaiting;
    if (status.status === 'failed') {
      throw new OnboardingApiError(
        status.error?.status ?? 500,
        status.error?.body?.detail ?? 'the run failed',
      );
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/**
 * `POST /api/v1/projects/:id/pipeline/:runId/resume` (W10-72).
 *
 * W10-67 built this route, persisted the paused run behind it, and proved it
 * against the real gate/store/ledger — but nothing in this app ever called it,
 * so the awaiting screen was a dead end and `run_id` reached React state and
 * died there. This is that missing call site.
 *
 * THE `{}` BODY IS DELIBERATE. The route takes no parameters, and Fastify
 * rejects a `content-type: application/json` request with an empty body:
 * `400 FST_ERR_CTP_EMPTY_JSON_BODY`. Measured against the running server, not
 * theorised — a bodyless POST here fails before the handler is ever reached.
 */
export async function resumePipeline(
  projectId: string,
  runId: string,
  opts: OnboardingApiOptions = {},
): Promise<PipelineRunResult> {
  return (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/pipeline/${encodeURIComponent(runId)}/resume`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    },
    opts,
  )) as PipelineRunResult;
}

export async function fetchGateReceipts(
  projectId: string,
  opts: OnboardingApiOptions = {},
): Promise<GateReceipt[]> {
  const result = (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/receipts?kind=gate`,
    { method: 'GET' },
    opts,
  )) as { items: GateReceipt[] };
  return result.items;
}

/**
 * One adaptive follow-up for a topic, or `null` when the model has enough
 * (W13-18, AC-1: "Interview adapts question depth to my answers").
 *
 * Never throws for a model problem. The route already degrades to `null` when
 * no model is reachable, and this swallows a transport failure the same way:
 * a local-only user (C-1) must still be able to describe their product, and an
 * interview that stops working because a follow-up failed is worse than one
 * that simply stops adapting.
 */
export async function fetchFollowUpQuestion(
  projectId: string,
  deliverableId: string,
  question: string,
  answers: readonly string[],
  opts: OnboardingApiOptions = {},
): Promise<string | null> {
  try {
    const body = (await request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/interview/next-question`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          deliverable_id: deliverableId,
          question,
          answers,
        }),
      },
      opts,
    )) as { question: string | null };
    return body.question ?? null;
  } catch {
    return null;
  }
}
