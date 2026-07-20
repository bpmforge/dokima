/**
 * Parses and validates the `POST .../pipeline/run` request body.
 *
 * Deliberately has no `ledgerMarkdown` field (Law 4/C-3): the founder-
 * decision ledger `assertDecisionComplete` cross-checks a blueprint's
 * `FOUNDER-DECISION ... RESOLVED` markers against is trusted server state,
 * never caller input — an agent session posting this body is untrusted and
 * could otherwise forge a resolution for any D-ID it likes. `./ledger.js`
 * derives the real value from the project's own `docs/DECISIONS.md`; a
 * `ledgerMarkdown` key in the JSON body, if present, is simply never read.
 */
import type { InterviewSession } from '@shipwright/pipeline';
import { InvalidPipelineRunRequestError } from '../errors.js';

export interface RunPipelineRequestBody {
  readonly interviewSession: InterviewSession;
  readonly blueprintTitle: string;
}

export function parseRequestBody(body: unknown): RunPipelineRequestBody {
  if (typeof body !== 'object' || body === null) {
    throw new InvalidPipelineRunRequestError('body must be a JSON object');
  }
  const b = body as Record<string, unknown>;
  if (typeof b.interviewSession !== 'object' || b.interviewSession === null) {
    throw new InvalidPipelineRunRequestError('"interviewSession" must be an object');
  }
  if (typeof b.blueprintTitle !== 'string' || b.blueprintTitle.trim().length === 0) {
    throw new InvalidPipelineRunRequestError(
      '"blueprintTitle" must be a non-empty string',
    );
  }
  return {
    interviewSession: b.interviewSession as InterviewSession,
    blueprintTitle: b.blueprintTitle,
  };
}
