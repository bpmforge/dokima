/**
 * The canonical member-state mapping (W20-02, UX_SPEC §10).
 *
 * ONE derivation, shared by every Team surface — the board (W20-02), the work
 * diary (W20-03), the List view (W20-11) and the pixel office (W20-08). Three
 * surfaces inventing three slightly different truths is exactly the drift this
 * module exists to prevent.
 *
 * D-028's law is mechanical here: **no state without an event behind it**.
 * Every branch below names the signal it reads, and the absence of signals
 * resolves to `idle` — never to a flattering guess.
 */
import type { BoardTicket, HeartbeatData } from '../board/types.js';

export type MemberStateKind =
  | 'blocked-on-you'
  | 'working'
  | 'reading'
  | 'self-checking'
  | 'in-review'
  | 'submitted'
  | 'shipped'
  | 'idle';

export interface MemberState {
  readonly kind: MemberStateKind;
  /** Present-tense line for the card face; names the ticket when attributable. */
  readonly line: string;
  /** The ticket this state is about, when there is one. */
  readonly ticketId: string | null;
  /** The event kind / source this was derived from — shown in the diary, never invented. */
  readonly evidence: string;
}

/** An open item that is waiting on the founder (decide-tier). */
export interface FounderAsk {
  readonly actorId: string;
  readonly ticketId: string | null;
  readonly title: string;
}

export interface DeriveInput {
  /** Roster/actor id this member answers to. */
  readonly actorId: string;
  readonly tickets: readonly BoardTicket[];
  readonly heartbeats: ReadonlyMap<string, HeartbeatData>;
  /** Open founder-facing asks (W20-09's queue), any actor. */
  readonly asks: readonly FounderAsk[];
}

/** `pass` values a live heartbeat reports that mean "reading, not writing". */
const READ_PASSES = new Set(['read', 'search', 'explore', 'review-read']);
/** …and the one that means the session is checking its own work before handing in. */
const SELF_CHECK_PASSES = new Set(['verify', 'self-check', 'test']);

function ownedBy(t: BoardTicket, actorId: string): boolean {
  if (!t.ownerId) return false;
  return t.ownerId === actorId || t.ownerId.endsWith(`:${actorId}`);
}

/**
 * Precedence (UX_SPEC §10), highest first:
 *   blocked-on-you > live session (working / reading / self-checking)
 *   > in-review / submitted > shipped > idle
 *
 * Blocked-on-you outranks everything because it is the only state whose
 * resolution costs the founder's attention — burying it under "working"
 * would hide the one thing they must act on.
 */
export function deriveMemberState(input: DeriveInput): MemberState {
  const { actorId, tickets, heartbeats, asks } = input;

  const ask = asks.find(
    (a) => a.actorId === actorId || a.actorId.endsWith(`:${actorId}`),
  );
  if (ask) {
    return {
      kind: 'blocked-on-you',
      line: 'waiting on your answer',
      ticketId: ask.ticketId,
      evidence: 'open decide-tier item (W20-09 queue)',
    };
  }

  // A live heartbeat is the only proof a session is actually running.
  for (const [ticketId, hb] of heartbeats) {
    const owned = tickets.find((t) => t.id === ticketId && ownedBy(t, actorId));
    if (!owned) continue;
    if (SELF_CHECK_PASSES.has(hb.pass)) {
      return {
        kind: 'self-checking',
        line: `checking their own work on ${ticketId}`,
        ticketId,
        evidence: `heartbeat pass=${hb.pass}`,
      };
    }
    if (READ_PASSES.has(hb.pass)) {
      return {
        kind: 'reading',
        line: `reading for ${ticketId}`,
        ticketId,
        evidence: `heartbeat pass=${hb.pass}`,
      };
    }
    return {
      kind: 'working',
      line: `building ${ticketId}`,
      ticketId,
      evidence: `heartbeat pass=${hb.pass}`,
    };
  }

  // Reviewing someone else's work: in_review, and this member is NOT the maker.
  const reviewing = tickets.find(
    (t) => t.status === 'in_review' && !ownedBy(t, actorId) && wasReviewerOf(t, actorId),
  );
  if (reviewing) {
    return {
      kind: 'in-review',
      line: `reviewing ${reviewing.id}`,
      ticketId: reviewing.id,
      evidence: 'ticket in_review, reviewer identity distinct from maker',
    };
  }

  const submitted = tickets.find((t) => t.status === 'in_review' && ownedBy(t, actorId));
  if (submitted) {
    return {
      kind: 'submitted',
      line: `handed in ${submitted.id} — someone else is reviewing`,
      ticketId: submitted.id,
      evidence: 'ticket in_review, owned by this member',
    };
  }

  const shipped = tickets
    .filter((t) => t.status === 'done' && ownedBy(t, actorId) && t.closedAt)
    .sort((a, b) => (a.closedAt! < b.closedAt! ? 1 : -1))[0];
  if (shipped) {
    return {
      kind: 'shipped',
      line: `shipped ${shipped.id} ✓`,
      ticketId: shipped.id,
      evidence: 'ticket.closed with receipt',
    };
  }

  return {
    kind: 'idle',
    line: 'nothing assigned',
    ticketId: null,
    evidence: 'no events in the live window',
  };
}

/** Did this actor act on the ticket as someone other than its owner? */
function wasReviewerOf(t: BoardTicket, actorId: string): boolean {
  return t.history.some(
    (h) =>
      (h.actorId === actorId || h.actorId.endsWith(`:${actorId}`)) &&
      (h.verb === 'accept' || h.verb === 'comment'),
  );
}

/** Every state the mapping can produce — the List view (W20-11) asserts parity against this. */
export const ALL_MEMBER_STATES: readonly MemberStateKind[] = [
  'blocked-on-you',
  'working',
  'reading',
  'self-checking',
  'in-review',
  'submitted',
  'shipped',
  'idle',
];
