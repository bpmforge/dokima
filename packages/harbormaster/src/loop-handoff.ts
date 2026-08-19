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

import { isVerifierRole, ROLE_CODING_AGENT } from '@dokima/gateway';
import type { Handoff, HandoffTicket } from '@dokima/loop';
import type { Ticket } from '@dokima/tickets';

/**
 * A ticket named a verifier role as the expert that DOES the work (C-4,
 * CLAUDE.md law 5). Its own name, not a generic build failure, because the
 * board is fixable and the fix is to name a maker expert.
 */
export class TicketRoleRefusedError extends Error {
  constructor(
    public readonly ticketId: string,
    public readonly role: string,
  ) {
    super(
      `ticket ${ticketId} names "${role}" as the expert that does the work, but ` +
        `that is a verifier role — a maker may not be its own verifier (C-4). ` +
        `Name the expert that should DO the ticket; the reviewer is resolved ` +
        `separately and must be a distinct identity.`,
    );
    this.name = 'TicketRoleRefusedError';
  }
}

/** Falls back to the project's own full gate (CLAUDE.md law 3) when a ticket declares no `verify` command. */
export const DEFAULT_VERIFY_COMMAND = 'pnpm lint && pnpm typecheck && pnpm test';

/**
 * What the LAST attempt got wrong (W13-29).
 *
 * BLUEPRINT §3.5 step 5 requires a revise pass to re-ground "with the specific
 * gaps fed back". The land loop rendered a byte-identical prompt every attempt,
 * so a retry was a re-roll of the same dice rather than a correction — while
 * the gaps themselves were already computed and then dropped: the close gate
 * reports `reasons[]`, the session reports `scopeViolations`, and a missing
 * manifest is known. All of it was discarded between attempts and re-derived
 * for `parkComment` at the end, where only a human would read it.
 */
export interface AttemptFeedback {
  /** 1-based number of the attempt that produced these gaps. */
  readonly attempt: number;
  /** Close-gate reasons, scope violations, or the missing-manifest fact. */
  readonly gaps: readonly string[];
}

/**
 * SECOND ARGUMENT, not a new builder type: the packed context builder
 * (W12-04) is the only production caller, and a default-only feedback path
 * would leave the product's own context layer blind to why the last pass
 * failed. Optional, so every existing builder stays valid unchanged.
 */
export type HandoffBuilder = (
  ticket: Ticket,
  feedback?: AttemptFeedback,
) => Handoff | Promise<Handoff>;

/**
 * The synchronous subset. `defaultHandoffBuilder` returns THIS, not the
 * widened `HandoffBuilder`, so callers that build a HANDOFF directly (tests,
 * and anything composing on top of the default) keep reading its fields
 * without awaiting. Every `SyncHandoffBuilder` is a valid `HandoffBuilder`.
 */
export type SyncHandoffBuilder = (ticket: Ticket, feedback?: AttemptFeedback) => Handoff;

/**
 * Builds a `HandoffBuilder` whose role is the RUN-WIDE FALLBACK (default:
 * `coding-agent`) for tickets that do not name an expert of their own.
 *
 * D-025/W12-06: the role used to be bound here and here only, so every ticket
 * in a run was dispatched to the same expert no matter what kind of work it
 * was — `content/` ships 93 experts and exactly one was ever used, because
 * every production call site takes the default. A ticket that names a `role`
 * now wins over this argument. That direction is the load-bearing half: the
 * only production path is `createPackedHandoffBuilder`, which ALWAYS passes a
 * role, so a builder-wins rule would leave the ticket field permanently
 * unreachable — the field would validate on the board and never reach a maker.
 *
 * C-4 IS KEPT MECHANICAL, NOT PROMISED. Because the ticket now wins, a ticket
 * could otherwise name `code-reviewer` or `challenger` as its own maker — the
 * maker declaring itself the verifier, which is precisely what C-4 forbids and
 * exactly the kind of thing a board field makes easy to do by accident.
 * `guardMakerVerifierDistinct` cannot catch it: that guard fires on the
 * VERIFIER side and compares models, and here the collapse has already
 * happened by the time a verifier is resolved. So this refuses, by name, at the
 * point the field is read. The board validator refuses the same thing earlier
 * (`scripts/validate-plan.mjs`); this is the backstop for tickets that reach a
 * run some other way.
 */
export function defaultHandoffBuilder(
  role: string = ROLE_CODING_AGENT,
): SyncHandoffBuilder {
  return (ticket: Ticket, feedback?: AttemptFeedback): Handoff => {
    if (ticket.role !== undefined && isVerifierRole(ticket.role)) {
      throw new TicketRoleRefusedError(ticket.id, ticket.role);
    }
    const handoffTicket: HandoffTicket = { id: ticket.id, title: ticket.title };
    return {
      role: ticket.role ?? role,
      mission: ticket.title,
      ticket: handoffTicket,
      context: withFeedback(ticket.interface ?? ticket.title, feedback),
      writeScope: ticket.writeScope,
      produce: ticket.acceptance.map((criterion) => criterion.text),
      verify: ticket.verify ?? DEFAULT_VERIFY_COMMAND,
    };
  };
}

/**
 * Appends the previous attempt's gaps to the context block.
 *
 * Appended rather than substituted: the ticket's own interface is still the
 * thing being built, and replacing it with a failure list would trade one kind
 * of blindness for another.
 *
 * NOT redacted here, and that is deliberate — `renderHandoff` redacts
 * `context` through `redactDeep` on the way out (SC-06), and it is the single
 * choke point every HANDOFF passes through. Redacting twice would imply a
 * second place to keep correct.
 */
export function withFeedback(context: string, feedback?: AttemptFeedback): string {
  if (!feedback || feedback.gaps.length === 0) return context;
  return [
    context,
    '',
    `PREVIOUS ATTEMPT (${feedback.attempt}) DID NOT CLOSE. Fix these, do not start over:`,
    ...feedback.gaps.map((gap) => `  - ${gap}`),
  ].join('\n');
}
