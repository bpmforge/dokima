/**
 * The approved-build client (W23-14, AB-14).
 *
 * Kept beside `api.ts` rather than inside it: that file is the board's ticket
 * verbs, and this is one feature's own surface — the approval, the progress a
 * reload reads back, and the list a reload needs to find the live run at all.
 */

import type { ProblemDetails } from './types.js';
import type { BoardApiOptions, BoardResult } from './api.js';

export type BuildPhase =
  | 'not_started'
  | 'building'
  | 'checking'
  | 'fixing'
  | 'ready_to_review'
  | 'needs_decision'
  | 'stopped'
  | 'failed';

export interface TicketProgress {
  readonly ticketId: string;
  readonly state: string;
  readonly reason: string | null;
  readonly ruleId: string | null;
  readonly repairRounds: number;
}

export interface BuildRunProgress {
  readonly runId: string;
  readonly projectId: string;
  readonly approvedBuild: boolean;
  readonly phase: BuildPhase;
  readonly detail: string;
  readonly outcome: string | null;
  readonly stopRequested: boolean;
  readonly tickets: readonly TicketProgress[];
}

export interface ApprovedBuildPreview {
  readonly inputDigest: string;
  readonly budgetUsd: number;
  readonly tickets: readonly {
    readonly id: string;
    readonly title: string;
    readonly lane: string;
    readonly writeScope: readonly string[];
    readonly acceptance: readonly string[];
  }[];
  readonly makerModel: string | null;
  readonly reviewerModel: string | null;
  readonly independentReview: boolean;
  readonly independentReviewReason: string | null;
  readonly stillAsksYou: readonly { id: string; label: string; reason: string }[];
}

function headers(opts: BoardApiOptions): Record<string, string> {
  return { Authorization: `Bearer ${opts.token}`, 'content-type': 'application/json' };
}

async function request<T>(
  opts: BoardApiOptions,
  instance: string,
  init: RequestInit,
  map: (body: unknown) => T,
): Promise<BoardResult<T>> {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(`${opts.baseUrl}${instance}`, {
    ...init,
    headers: headers(opts),
  });
  const text = await res.text();
  const body = text.length > 0 ? JSON.parse(text) : null;
  if (!res.ok) {
    const problem =
      typeof body === 'object' && body !== null && 'title' in body
        ? (body as ProblemDetails)
        : {
            type: 'about:blank',
            title: 'request failed',
            status: res.status,
            detail: `unexpected response (status ${res.status})`,
            instance,
            request_id: 'unknown',
          };
    return { ok: false, problem };
  }
  return { ok: true, data: map(body) };
}

/** What the approval covers. Read from the project, never shaped by the caller. */
export async function fetchApprovedBuildPreview(
  opts: BoardApiOptions,
  projectId: string,
  budgetUsd: number,
): Promise<BoardResult<ApprovedBuildPreview>> {
  return request(
    opts,
    `/projects/${projectId}/approved-build/preview?budget_usd=${budgetUsd}`,
    { method: 'GET' },
    (body) => {
      const w = body as Record<string, never>;
      const raw = w as unknown as {
        input_digest: string;
        budget_usd: number;
        tickets: {
          id: string;
          title: string;
          lane: string;
          write_scope: string[];
          acceptance: string[];
        }[];
        maker_model: string | null;
        reviewer_model: string | null;
        independent_review: boolean;
        independent_review_reason: string | null;
        still_asks_you: { id: string; label: string; reason: string }[];
      };
      return {
        inputDigest: raw.input_digest,
        budgetUsd: raw.budget_usd,
        tickets: raw.tickets.map((t) => ({
          id: t.id,
          title: t.title,
          lane: t.lane,
          writeScope: t.write_scope,
          acceptance: t.acceptance,
        })),
        makerModel: raw.maker_model,
        reviewerModel: raw.reviewer_model,
        independentReview: raw.independent_review,
        independentReviewReason: raw.independent_review_reason,
        stillAsksYou: raw.still_asks_you,
      };
    },
  );
}

/** Records the approval. The server recomputes the digest; this only asks. */
export async function approveBuild(
  opts: BoardApiOptions,
  projectId: string,
  budgetUsd: number,
  actorId = 'operator',
): Promise<BoardResult<{ approvalId: string; inputDigest: string }>> {
  return request(
    opts,
    `/projects/${projectId}/approved-build`,
    {
      method: 'POST',
      body: JSON.stringify({ actor_id: actorId, budget_usd: budgetUsd }),
    },
    (body) => {
      const raw = body as { approval_id: string; input_digest: string };
      return { approvalId: raw.approval_id, inputDigest: raw.input_digest };
    },
  );
}

/** Starts an approved run. `approved_build` is per-request and explicit (D-032). */
export async function startApprovedBuildRun(
  opts: BoardApiOptions,
  projectId: string,
  budgetUsd: number,
  actorId = 'operator',
): Promise<BoardResult<{ runId: string }>> {
  return request(
    opts,
    `/projects/${projectId}/build-runs`,
    {
      method: 'POST',
      body: JSON.stringify({
        actor_id: actorId,
        approved_build: true,
        budget_usd: budgetUsd,
      }),
    },
    (body) => ({ runId: (body as { run_id: string }).run_id }),
  );
}

function toProgress(body: unknown): BuildRunProgress {
  const raw = body as BuildRunProgress;
  return raw;
}

/** The run's progress from durable state — what a reload reads. */
export async function fetchBuildProgress(
  opts: BoardApiOptions,
  projectId: string,
  runId: string,
): Promise<BoardResult<BuildRunProgress>> {
  return request(
    opts,
    `/projects/${projectId}/build-runs/${runId}/progress`,
    { method: 'GET' },
    toProgress,
  );
}

/** Every run this project recorded, newest first. */
export async function fetchBuildRuns(
  opts: BoardApiOptions,
  projectId: string,
): Promise<BoardResult<readonly BuildRunProgress[]>> {
  return request(opts, `/projects/${projectId}/build-runs`, { method: 'GET' }, (body) =>
    ((body as { runs?: BuildRunProgress[] }).runs ?? []).map(toProgress),
  );
}
