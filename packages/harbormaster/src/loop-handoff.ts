/**
 * Default HANDOFF builder (BLUEPRINT §4, W1-06's `Handoff` contract): a
 * thin projection of a `@dokima/tickets` `Ticket` onto the typed
 * HANDOFF the session runner renders. Real context-packet assembly (token
 * budgeting, memory recall) is FR-L5's own concern, not the claim loop's —
 * `context` here defaults to the ticket's `interface` field (or its title
 * when absent) and is overridable by passing a custom builder.
 *
 * A custom builder MAY be async (W12-08): FR-L5's Context Packer
 * (`assemblePacket`) queries a code index and a facts store, so it returns a
 * promise. Until W12-08 this type was synchronous, which meant the "fully
 * overridable" claim made here was false for every real packer and FR-L5
 * had no way in — the seam, not neglect, is why it never had a caller.
 * `defaultHandoffBuilder` stays synchronous; a sync function still satisfies
 * the widened type, so nothing that already passes a builder changed.
 */

import { ROLE_CODING_AGENT } from '@dokima/gateway';
import type { Handoff, HandoffTicket } from '@dokima/loop';
import type { Ticket } from '@dokima/tickets';

/** Falls back to the project's own full gate (CLAUDE.md law 3) when a ticket declares no `verify` command. */
export const DEFAULT_VERIFY_COMMAND = 'pnpm lint && pnpm typecheck && pnpm test';

export type HandoffBuilder = (ticket: Ticket) => Handoff | Promise<Handoff>;

/**
 * The synchronous subset. `defaultHandoffBuilder` returns THIS, not the
 * widened `HandoffBuilder`, so callers that build a HANDOFF directly (tests,
 * and anything composing on top of the default) keep reading its fields
 * without awaiting. Every `SyncHandoffBuilder` is a valid `HandoffBuilder`.
 */
export type SyncHandoffBuilder = (ticket: Ticket) => Handoff;

/** Builds a `HandoffBuilder` bound to a fixed role (default: `coding-agent`). */
export function defaultHandoffBuilder(
  role: string = ROLE_CODING_AGENT,
): SyncHandoffBuilder {
  return (ticket: Ticket): Handoff => {
    const handoffTicket: HandoffTicket = { id: ticket.id, title: ticket.title };
    return {
      role,
      mission: ticket.title,
      ticket: handoffTicket,
      context: ticket.interface ?? ticket.title,
      writeScope: ticket.writeScope,
      produce: ticket.acceptance.map((criterion) => criterion.text),
      verify: ticket.verify ?? DEFAULT_VERIFY_COMMAND,
    };
  };
}
