/**
 * loop-gates-close.ts — a refused close leaves a trace (W21-32).
 *
 * The live shape this exists for: run `run-mtao40ub` ran eleven turns, handed
 * back a Completion Manifest, passed verify (exit 0), passed both required
 * validators (exit 0), and minted a real signed close receipt —
 * `#1303 gate.receipt_minted`. The ticket did not close. The ledger contained
 * ZERO explanation: `select count(*) from events where event_type =
 * 'ticket.closed'` was 0 across the entire project history, and nothing
 * anywhere said why.
 *
 * The mechanism was a swallowed throw. `runCloseGate` called `closeTicket`
 * immediately after minting with no handler; `closeTicket` refused
 * (`NOT_OWNER` — a stale run had released the ticket 69 seconds earlier), and
 * the error propagated to `runOneBerth`'s catch, which stored it as
 * `stopReason: 'error'` on the in-memory run outcome. Correct as far as it
 * goes, and invisible the moment the process exits.
 *
 * A gate refusal that produces no event is the one failure the ledger cannot
 * be asked about, which makes it the one failure a person cannot diagnose.
 * `close` is the point where a run's whole effort either becomes durable state
 * or evaporates, so it is the last place silence is acceptable.
 *
 * The event is appended and the error is RETHROWN unchanged. This records; it
 * does not recover. Deciding a refused close is survivable is the caller's
 * judgement and must not be smuggled in behind a logging helper.
 */
import { appendEvent, type EventLog } from '@dokima/events';
import { closeTicket, TicketError, type CloseTicketInput, type Ticket } from '@dokima/tickets';

export interface LedgeredCloseOptions {
  readonly now?: () => string;
  readonly runId?: string | null;
  /**
   * The receipt minted just before this close was attempted. On a refusal it
   * is the orphan — a valid signed receipt with no ticket transition behind
   * it — and naming it is what makes the two rows joinable afterwards.
   */
  readonly receiptId?: string | null;
}

/** The event type a refused close appends. */
export const CLOSE_REFUSED_EVENT = 'ticket.close_refused';

/**
 * `closeTicket`, plus an appended `ticket.close_refused` event when it throws.
 * The event carries the refusal reason verbatim, the reason code where the
 * refusal was a `TicketError`, and the receipt left orphaned by it.
 */
export function closeTicketLedgeringRefusal(
  log: EventLog,
  input: CloseTicketInput,
  opts: LedgeredCloseOptions = {},
): Ticket {
  try {
    return closeTicket(log, input, { now: opts.now, runId: opts.runId ?? null });
  } catch (err) {
    appendEvent(
      log,
      {
        eventType: CLOSE_REFUSED_EVENT,
        actorId: input.actorId,
        ticketId: input.ticketId,
        runId: opts.runId ?? null,
        payload: {
          reason: err instanceof Error ? err.message : String(err),
          code: err instanceof TicketError ? err.code : null,
          orphanedReceiptId: opts.receiptId ?? null,
        },
      },
      { now: opts.now },
    );
    throw err;
  }
}
