/**
 * Test-side adapter for the W10-58 job contract: POST the run, then poll its
 * status route until it reaches a terminal state, and present the result in the
 * shape the route used to return synchronously.
 *
 * WHY THIS EXISTS RATHER THAN 16 REWRITTEN TESTS: the suites in this directory
 * assert what a *completed* run produces — a hash-chained event trail, a
 * persisted board, a refused forgery, the model the matrix selected. None of
 * that is what W10-58 changes. Only the transport between "asked" and
 * "finished" changed, so only the transport is adapted here, and every existing
 * assertion keeps testing the thing it was written to test.
 *
 * Non-202 responses are returned UNTOUCHED, deliberately — the validation
 * failures (400 malformed body, 404 unknown project, 409 already running, 422
 * incomplete interview) are all still synchronous, and a helper that swallowed
 * them would hide the half of the contract that did not move.
 */
import type { FastifyInstance, InjectOptions } from 'fastify';

export interface AwaitedRunResponse {
  readonly statusCode: number;
  /** Mirrors Fastify's own `LightMyRequestResponse.json<T = any>()` so call sites keep their existing casts. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly json: <T = any>() => T;
}

interface RunStatusBody {
  readonly status: string;
  readonly result?: unknown;
  readonly awaiting?: unknown;
  readonly error?: { readonly status: number; readonly body: unknown };
}

export async function postAndAwaitRun(
  app: FastifyInstance,
  projectId: string,
  payload: InjectOptions['payload'],
): Promise<AwaitedRunResponse> {
  const accepted = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/pipeline/run`,
    payload,
  });
  if (accepted.statusCode !== 202) return accepted as unknown as AwaitedRunResponse;

  const { run_id: runId } = accepted.json() as { run_id: string };
  // Bounded rather than open-ended: a job that never terminates is a defect
  // this helper must report as one, not hang the suite until vitest's timeout
  // fires with no explanation of which run stalled.
  for (let attempt = 0; attempt < 2000; attempt += 1) {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/pipeline/runs/${runId}`,
    });
    const body = res.json() as RunStatusBody;
    if (body.status === 'completed') {
      return { statusCode: 201, json: () => body.result as never };
    }
    if (body.status === 'awaiting-decisions') {
      return { statusCode: 202, json: () => body.awaiting as never };
    }
    if (body.status === 'failed') {
      const failure = body.error!;
      return { statusCode: failure.status, json: () => failure.body as never };
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`run ${runId} never reached a terminal state`);
}
