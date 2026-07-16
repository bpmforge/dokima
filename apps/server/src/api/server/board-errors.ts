import { TicketError, type TicketErrorCode } from '@shipwright/tickets';
import { problem, PROBLEM_CONTENT_TYPE, type ProblemDetails } from '../problem.js';

/**
 * RFC 7807 mapping for a refused verb (API_DESIGN §1/§4, FR-T4
 * "explain-this-refusal"): `rule` is the ticket package's own error code —
 * a real, specific invariant name, not an invented FR id — so the popover
 * renders exactly what was checked, verbatim.
 */
const NOT_FOUND_CODES: readonly TicketErrorCode[] = ['TICKET_NOT_FOUND'];

export function ticketErrorToProblem(
  err: TicketError,
  instance: string,
  requestId: string,
): { status: number; body: ProblemDetails } {
  const status = NOT_FOUND_CODES.includes(err.code) ? 404 : 409;
  return {
    status,
    body: problem({
      type: `https://shipwright.dev/errors/${err.code.toLowerCase().replaceAll('_', '-')}`,
      title: `${err.code}`,
      status,
      detail: err.message,
      instance,
      requestId,
      rule: err.code,
    }),
  };
}

export { PROBLEM_CONTENT_TYPE };
