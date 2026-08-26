/**
 * agent-session/session-setup.ts — everything a session knows before its first
 * turn (chapter of gateway-session.ts, W21-30).
 *
 * Split at the 400-line CODE_BOOK_PROTOCOL cap, and the seam is real: this
 * resolves the ticket and builds the context a session STARTS from, while
 * gateway-session.ts is the loop that spends it. Three tickets in a row had to
 * shave a line off that file to fit; this is the split it was asking for.
 *
 * SC-17 lives here and is the reason this is not just plumbing: write_scope
 * and the verify command come from the TICKET RECORD, never from anything
 * parsed out of the prompt. An unresolvable ticket fails closed — an empty
 * write_scope refuses every write and edit — rather than falling back to
 * something permissive.
 */
import type { EventLog } from '@dokima/events';
import type { ChatMessage } from '@dokima/gateway';
import { parseHandoffFields } from './handoff-fields.js';
import { getTicket } from '@dokima/tickets';
import { DEFAULT_VERIFY_COMMAND } from '../loop-handoff.js';
import { SESSION_SYSTEM_PROMPT } from './session-prompt.js';

export interface PrepareSessionInput {
  readonly log: EventLog;
  readonly prompt: string;
  readonly cwd: string;
  readonly verifyTimeoutMs: number;
  readonly secretValues: readonly string[];
}

export interface PreparedSession {
  readonly ticketId: string;
  readonly toolCtx: {
    readonly cwd: string;
    readonly writeScope: string[];
    readonly verifyCommand: string;
    readonly verifyTimeoutMs: number;
    readonly secretValues: readonly string[];
  };
  readonly messages: ChatMessage[];
}

export function prepareSession(input: PrepareSessionInput): PreparedSession {
  const fields = parseHandoffFields(input.prompt);
  const ticketId = fields.ticketId ?? 'unknown';
  // SC-17 (see module header): write_scope AND verifyCommand are the ticket
  // record's own fields, never anything parsed from the prompt.
  const ticket = getTicket(input.log, ticketId);
  return {
    ticketId,
    toolCtx: {
      cwd: input.cwd,
      writeScope: ticket?.writeScope ?? [],
      verifyCommand: ticket?.verify ?? DEFAULT_VERIFY_COMMAND,
      verifyTimeoutMs: input.verifyTimeoutMs,
      secretValues: input.secretValues,
    },
    // W13-09: a system message, where there was none — see session-prompt.ts.
    messages: [
      { role: 'system', content: SESSION_SYSTEM_PROMPT },
      { role: 'user', content: input.prompt },
    ],
  };
}
