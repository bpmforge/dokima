/**
 * brief.ts — the founder can tell a stuck maker something (W21-59).
 *
 * PLAN-vault-002a has now had five runs. Run 41 accumulated real work; run 42
 * added nothing and the model oscillated between two wrong import forms —
 * `./argon2id` (ERR_MODULE_NOT_FOUND) and `./argon2id.js` (also
 * ERR_MODULE_NOT_FOUND, because nothing compiles). The correct form is
 * `./argon2id.ts`, which PLAN-vault-001b's tsconfig deliberately enabled with
 * `allowImportingTsExtensions`.
 *
 * So the founder could see exactly what the maker needed to know, and had no
 * way to say it. W21-27 (widen-scope) and W21-51 (depends-on) let a person
 * change a ticket's SHAPE; nothing let them add KNOWLEDGE. Comments do not
 * reach the maker — `buildHandoff` carries `title`, `writeScope`, the
 * acceptance criteria, the verify command, and `context`, and nothing else.
 *
 * The channel already existed and was simply unwritable. `context` is
 * `ticket.interface ?? ticket.title`, so the `interface` field IS the founder's
 * line to the maker — set once at decomposition and never again. This adds the
 * verb, and nothing else: no new plumbing, no second path into the prompt.
 *
 * IT IS A BRIEF, NOT AN INSTRUCTION TO OBEY. The maker still has to satisfy
 * the same gates against the same acceptance criteria (C-2) — a brief cannot
 * make anything pass, only tell a model something true about the project it
 * would otherwise have to discover. That is why it is safe for a person to
 * write, and why it is not a way around the trust boundary.
 */
import { appendEvent, type EventLog } from '@dokima/events';
import type { TicketVerbOptions } from './create.js';
import { TicketError } from './errors.js';
import { loadTickets } from './query.js';
import type { Ticket } from './types.js';


/**
 * The maker's ENTIRE tool surface, restated (W21-68).
 *
 * Reproduced rather than imported: `packages/tickets` may not depend on
 * `packages/harbormaster` (ARCHITECTURE.md §4), and the source of truth is
 * `AGENT_SESSION_TOOL_NAMES` in
 * `packages/harbormaster/src/agent-session/tools.ts`. Same discipline this
 * repo already applies to the gateway's failure-receipt shape. All seven are
 * repo-scoped; there is no documentation channel, no fetch, no network.
 */
const MAKER_TOOLS = ['read', 'list', 'search', 'write', 'edit', 'commit', 'verify'];

/**
 * A brief telling the maker to consult something it cannot reach (W21-68).
 *
 * FOUNDER ERROR FIRST, and the ticket says so: the brief that caused this was
 * hand-written. PLAN-vault-002a brief #2 said "consult the node:crypto
 * documentation for the permitted relationship between N, r and maxmem". The
 * maker has seven repo-scoped tools and no documentation channel, so it
 * guessed — and its guess was internally consistent and wrong, landing a
 * commit that violated both constraints stated in the document it could not
 * read.
 *
 * The brief channel exists precisely to carry what the maker CANNOT discover.
 * A brief that points at an unreachable source is therefore the one failure
 * mode the channel is built to prevent, and it was the one thing it could not
 * detect.
 *
 * A DIRECTIVE, NOT A MENTION. "The node:crypto documentation says N < 2^..." is
 * a founder stating the fact, which is exactly the right use of a brief;
 * "consult the node:crypto documentation" is an instruction to do something
 * impossible. The rule requires an imperative verb close to an off-repo source
 * noun, so the two are distinguished.
 *
 * MEASURED against the six real briefs on this machine before it was written:
 * it fires on exactly one, and that one is the defect. Brief #3 — the
 * founder's own correction, which reads "they are stated here because you have
 * no way to look them up" — stays clean, and it is the case a looser rule
 * would have broken.
 *
 * WARNS, NEVER REFUSES. A brief is a person telling a maker something true;
 * refusing one on a regex would put a pattern match in the way of the only
 * channel a stuck founder has. It also cannot be a gate for the reason C-2
 * gives about model output — this is prose, and prose checks are advisory.
 */
const OFF_REPO_DIRECTIVE =
  /\b(consult|refer to|look up|see|read|check|review|google|search for)\b[^.!?]{0,40}?\b(documentation|docs|spec|specification|rfc|manual|man page|manpage|mdn|website|web site|online|the internet)\b/i;

export function briefToolSurfaceWarning(brief: string): string | null {
  const match = OFF_REPO_DIRECTIVE.exec(brief);
  if (!match) return null;
  return (
    `brief warning: "${match[0].trim()}" asks the maker to consult something it ` +
    `cannot reach. Its entire tool surface is ${MAKER_TOOLS.join(', ')} — all ` +
    `repo-scoped, with no documentation, network or search channel. State the ` +
    `fact in the brief instead; that is what this channel is for. The brief was ` +
    `still set.`
  );
}

export interface SetTicketBriefInput {
  readonly ticketId: string;
  readonly actorId: string;
  /** The context the maker is handed. Replaces any previous brief. */
  readonly brief: string;
}

/**
 * Sets a ticket's `interface` — the context block every handoff for it will
 * carry. Refuses an empty brief: clearing it silently would leave the maker
 * with the title alone and no sign that anything was meant to be there.
 */
export function setTicketBrief(
  log: EventLog,
  input: SetTicketBriefInput,
  opts: TicketVerbOptions = {},
): Ticket {
  return log.db.transaction((): Ticket => {
    const tickets = loadTickets(log);
    const ticket = tickets.get(input.ticketId);
    if (!ticket) {
      throw new TicketError(
        'TICKET_NOT_FOUND',
        input.ticketId,
        `ticket ${input.ticketId} does not exist`,
      );
    }
    const brief = input.brief.trim();
    if (brief.length === 0) {
      throw new TicketError(
        'MANIFEST_INVALID',
        input.ticketId,
        `brief refused: an empty brief would leave the maker with the title alone ` +
          `and no sign anything was meant to be there`,
      );
    }
    appendEvent(
      log,
      {
        eventType: 'ticket.brief_set',
        actorId: input.actorId,
        ticketId: ticket.id,
        runId: opts.runId ?? null,
        // W21-68: recorded as well as printed, so the ledger shows a brief
        // that was flagged even when nobody was watching the terminal.
        payload: {
          from: ticket.interface,
          to: brief,
          ...(briefToolSurfaceWarning(brief) === null
            ? {}
            : { warning: briefToolSurfaceWarning(brief) }),
        },
      },
      opts,
    );
    const updated = loadTickets(log).get(ticket.id);
    if (!updated) {
      throw new TicketError('TICKET_NOT_FOUND', ticket.id, `ticket ${ticket.id} vanished`);
    }
    return updated;
  })();
}
