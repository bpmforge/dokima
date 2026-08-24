/**
 * W20-02 (UX_SPEC §10, D-028): the canonical member-state mapping.
 *
 * The rule these fixtures defend is "no state without an event behind it" —
 * every branch must name a real signal, and the absence of signals must
 * resolve to idle rather than to something flattering.
 */
import { describe, expect, it } from 'vitest';
import { makeBoardTicket } from '../board/test-helpers.js';
import type { HeartbeatData } from '../board/types.js';
import {
  ALL_MEMBER_STATES,
  deriveMemberState,
  type FounderAsk,
} from './memberState.js';

const hb = (pass: string, age = 3): HeartbeatData => ({ ticket: 'T-1', pass, age_s: age });
const base = { tickets: [], heartbeats: new Map(), asks: [] as FounderAsk[] };

describe('deriveMemberState (W20-02)', () => {
  it('RED FIXTURE: a member with NO signals is idle — never "working", never a flattering guess (D-028)', () => {
    const s = deriveMemberState({ ...base, actorId: 'coding-agent' });
    expect(s.kind).toBe('idle');
    expect(s.line).toBe('nothing assigned');
    expect(s.evidence).toContain('no events');
  });

  it('blocked-on-you outranks a live session — the one state that costs the founder attention is never buried', () => {
    const s = deriveMemberState({
      actorId: 'coding-agent',
      tickets: [makeBoardTicket({ id: 'T-1', status: 'in_progress', ownerId: 'coding-agent' })],
      heartbeats: new Map([['T-1', hb('edit')]]),
      asks: [{ actorId: 'coding-agent', ticketId: 'T-1', title: 'Raise the budget?' }],
    });
    expect(s.kind).toBe('blocked-on-you');
    expect(s.line).toContain('your answer');
  });

  it('a live heartbeat distinguishes working, reading and self-checking by its pass', () => {
    const t = [makeBoardTicket({ id: 'T-1', status: 'in_progress', ownerId: 'coding-agent' })];
    const at = (pass: string) =>
      deriveMemberState({ ...base, actorId: 'coding-agent', tickets: t, heartbeats: new Map([['T-1', hb(pass)]]) });
    expect(at('edit').kind).toBe('working');
    expect(at('search').kind).toBe('reading');
    expect(at('verify').kind).toBe('self-checking');
    expect(at('edit').evidence).toContain('heartbeat');
  });

  it("another member's heartbeat is not this member's state", () => {
    const s = deriveMemberState({
      ...base,
      actorId: 'test-engineer',
      tickets: [makeBoardTicket({ id: 'T-1', status: 'in_progress', ownerId: 'coding-agent' })],
      heartbeats: new Map([['T-1', hb('edit')]]),
    });
    expect(s.kind).toBe('idle');
  });

  it('maker and reviewer read differently on the SAME ticket — submitted vs in-review (Law 5 made visible)', () => {
    const ticket = makeBoardTicket({
      id: 'T-4',
      status: 'in_review',
      ownerId: 'coding-agent',
      history: [
        { verb: 'claim', actorId: 'coding-agent', at: '2026-08-24T10:00:00Z' },
        { verb: 'comment', actorId: 'challenger', at: '2026-08-24T11:00:00Z', body: 'checking' },
      ] as never,
    });
    const maker = deriveMemberState({ ...base, actorId: 'coding-agent', tickets: [ticket] });
    const reviewer = deriveMemberState({ ...base, actorId: 'challenger', tickets: [ticket] });
    expect(maker.kind).toBe('submitted');
    expect(reviewer.kind).toBe('in-review');
    expect(reviewer.evidence).toContain('distinct from maker');
  });

  it('a closed ticket reads as shipped, and a scoped actor id (berth-2:) matches its owner', () => {
    const s = deriveMemberState({
      ...base,
      actorId: 'coding-agent',
      tickets: [
        makeBoardTicket({
          id: 'T-9',
          status: 'done',
          ownerId: 'berth-2:coding-agent',
          closedAt: '2026-08-24T12:00:00Z',
        }),
      ],
    });
    expect(s.kind).toBe('shipped');
    expect(s.ticketId).toBe('T-9');
    expect(s.evidence).toContain('receipt');
  });

  it('every state the mapping can produce is enumerated for the List view parity test (W20-11)', () => {
    expect(new Set(ALL_MEMBER_STATES).size).toBe(ALL_MEMBER_STATES.length);
    expect(ALL_MEMBER_STATES).toContain('blocked-on-you');
    expect(ALL_MEMBER_STATES).toContain('idle');
  });
});
