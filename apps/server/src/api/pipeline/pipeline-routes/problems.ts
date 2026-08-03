/** Maps the pipeline route's typed errors to RFC 7807 problem responses. */
import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { SigningKeyRequiredError } from '@dokima/events';
import {
  DuplicateOpenQuestionKeyError,
  IncompleteInterviewSessionError,
  InvalidFounderSlateError,
  InvalidOpenQuestionKeyError,
  InvalidTechnicalSlateError,
  UnresolvedFounderDecisionError,
} from '@dokima/pipeline';
import { InvalidPipelineRunRequestError, MalformedModelOutputError } from '../errors.js';
import { ModelResolutionError } from '../model-resolution.js';

interface ProblemMapping {
  readonly status: number;
  readonly title: string;
  readonly rule?: string;
}

const KNOWN_ERROR_STATUSES: readonly [new (...args: never[]) => Error, ProblemMapping][] =
  [
    [
      IncompleteInterviewSessionError,
      {
        status: 422,
        title: 'Incomplete interview session',
        rule: 'INCOMPLETE_INTERVIEW',
      },
    ],
    [
      DuplicateOpenQuestionKeyError,
      {
        status: 422,
        title: 'Duplicate open-question key',
        rule: 'DUPLICATE_OPEN_QUESTION_KEY',
      },
    ],
    [
      InvalidOpenQuestionKeyError,
      {
        status: 422,
        title: 'Invalid open-question key',
        rule: 'INVALID_OPEN_QUESTION_KEY',
      },
    ],
    [
      InvalidFounderSlateError,
      { status: 422, title: 'Invalid founder slate', rule: 'INVALID_FOUNDER_SLATE' },
    ],
    [
      UnresolvedFounderDecisionError,
      {
        status: 422,
        title: 'Unresolved founder-decision marker',
        rule: 'UNRESOLVED_FOUNDER_DECISION',
      },
    ],
    [
      InvalidTechnicalSlateError,
      { status: 422, title: 'Invalid technical slate', rule: 'INVALID_TECHNICAL_SLATE' },
    ],
    [
      MalformedModelOutputError,
      { status: 502, title: 'Malformed model output', rule: 'MALFORMED_MODEL_OUTPUT' },
    ],
    [
      SigningKeyRequiredError,
      { status: 503, title: 'Signing key not configured', rule: 'SIGNING_KEY_REQUIRED' },
    ],
    // W10-69. A model the registry cannot bind is a configuration problem the
    // user can fix — an unknown or ambiguous provider prefix, or a matrix row
    // pointing at a provider that is disabled or gone. 409 rather than 400:
    // the request is well-formed, the stored configuration conflicts with it.
    // Naming it matters more than the code does — the alternative this ticket
    // replaced was a SILENT fallback to localhost, which told the user nothing
    // and quietly ran a different model than the one they chose.
    [
      ModelResolutionError,
      { status: 409, title: 'Model could not be resolved', rule: 'MODEL_RESOLUTION' },
    ],
    [
      InvalidPipelineRunRequestError,
      { status: 400, title: 'Invalid request body', rule: 'INVALID_REQUEST' },
    ],
  ];

export function problemForError(
  err: unknown,
  request: FastifyRequest,
): { status: number; body: Record<string, unknown> } | undefined {
  if (!(err instanceof Error)) return undefined;
  const match = KNOWN_ERROR_STATUSES.find(([Ctor]) => err instanceof Ctor);
  if (!match) return undefined;
  const [, mapping] = match;
  return {
    status: mapping.status,
    body: {
      type: `https://dokima.dev/errors/${mapping.rule?.toLowerCase().replaceAll('_', '-') ?? 'pipeline-run-error'}`,
      title: mapping.title,
      status: mapping.status,
      detail: err.message,
      instance: request.url,
      request_id: randomUUID(),
      rule: mapping.rule,
    },
  };
}
