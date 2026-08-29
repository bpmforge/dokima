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
import { appendEvent, listEvents, type EventLog } from '@dokima/events';
import {
  closeTicket,
  commentTicket,
  latestRejectionReason,
  TicketError,
  type CloseTicketInput,
  type Ticket,
} from '@dokima/tickets';

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
 * A close that reverses a standing rejection without touching what it named
 * (W21-90).
 *
 * LIVE, Tally PLAN-tally-01, verbatim from the ledger: receipt minted 22:13,
 * ticket.rejected 22:14 naming ONE thing — package.json ships
 * `"test": "echo 'Tests passed' || true"`, a script that cannot fail — and a
 * second receipt minted 22:44. The reason DID reach the maker
 * (loop-land-rungs.ts delivers it as "a reviewer sent this back: ..."). The
 * maker then committed .gitignore and src/index.ts, left package.json
 * untouched, and the gate re-ran verify — including that unfailable script —
 * and minted.
 *
 * So a rejection had no teeth: the most specific thing anyone knew about the
 * ticket arrived as advice a maker could decline, with nothing checking
 * whether it was taken. It matters most in the founder-as-reviewer case this
 * product is built around — I rejected, the product carried my words to the
 * maker, and then handed me a receipt as though nothing had happened.
 *
 * IT DOES NOT BLOCK, deliberately (C-2). Only the close gate decides done, and
 * a rejection that could veto indefinitely would put a reviewer above the
 * evidence. But "cannot veto" and "cannot even be noticed" are different
 * things, and the product had the second. This is the first.
 *
 * PATHS, NOT PROSE. Whether a rejection was "addressed" is a judgement about
 * meaning and this makes none: it asks only whether a FILE the rejection named
 * appears among the files the close claims. A rejection naming no file yields
 * nothing rather than a guess — the conservatism `referencedPaths` (W21-43)
 * already applies to acceptance commands.
 */
export function rejectionNamedPaths(reason: string): string[] {
  const found = new Set<string>();
  for (const token of reason.split(/[\s,;:()"'`]+/)) {
    const candidate = token.replace(/[.,;:]+$/, '');
    if (candidate.length === 0 || candidate.startsWith('-')) continue;
    if (!candidate.includes('/') && !/^[\w.-]+\.[A-Za-z0-9]+$/.test(candidate)) continue;
    found.add(candidate);
  }
  return [...found];
}

export function unaddressedRejectionNotice(
  reason: string,
  claimedFiles: readonly string[],
): string | null {
  const named = rejectionNamedPaths(reason);
  if (named.length === 0) return null;
  const untouched = named.filter(
    (path) => !claimedFiles.some((file) => file === path || file.endsWith(`/${path}`)),
  );
  if (untouched.length === 0) return null;
  return (
    `THIS CLOSE REVERSES A REJECTION THAT WAS NOT ADDRESSED. The reviewer asked ` +
    `for ${untouched.join(', ')}, and this close changes none of them. The ` +
    `rejection said: "${reason}". The gate did not block on this — only the ` +
    `gate decides done (C-2) — but accepting now overrules that rejection, so ` +
    `read it before you do.`
  );
}



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
    const closed = closeTicket(log, input, { now: opts.now, runId: opts.runId ?? null });
    // W21-90: the close succeeded. If a rejection was still standing and this
    // close touched none of the files it named, say so ON THE TICKET, where
    // the person about to accept will read it. Recorded after the close so it
    // can never affect whether the close happened.
    const standing = latestRejectionReason(listEvents(log), input.ticketId);
    const notice = standing ? unaddressedRejectionNotice(standing, input.files) : null;
    if (notice) {
      commentTicket(log, { ticketId: input.ticketId, actorId: input.actorId, body: notice });
    }
    return closed;
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
