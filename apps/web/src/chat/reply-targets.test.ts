import { describe, expect, it } from 'vitest';
import type { ServerEnvelope } from '../lib/ws-client.js';
import { reduceChatEvents } from './reduceChatEvents.js';
import { replyTargets } from './reply-targets.js';

const sub = 'chat:p';
const prov = (ticket: string) => ({
  agent: 'worker-1',
  model: 'm',
  ticket_id: ticket,
  cost_usd: 0,
  receipt_id: '',
});

const EVENTS: ServerEnvelope[] = [
  { sub, seq: 1, type: 'thread.opened', at: 't', data: { id: 'thread-program', kind: 'program', concern: null } },
  {
    sub, seq: 2, type: 'card.finding', at: 't',
    data: { id: 'f-2', thread_id: 'thread-program', provenance: prov('E2E-1'), severity: 'high', issue: 'Parked', evidence_href: '' },
  },
  {
    sub, seq: 3, type: 'card.manifest', at: 't',
    data: { id: 'm-3', thread_id: 'thread-program', provenance: prov('E2E-2'), files: [], verify_result: 'pass', diff_stat: '0' },
  },
  {
    sub, seq: 4, type: 'message.human', at: '2026-10-15T10:00:00Z',
    data: { id: 'reply-4', thread_id: 'thread-program', author: 'Operator', ticket_id: 'E2E-1', body: 'hi', at: '2026-10-15T10:00:00Z' },
  },
  {
    sub, seq: 5, type: 'card.manifest', at: 't',
    data: { id: 'm-5', thread_id: 'thread-program', provenance: prov('—'), files: [], verify_result: 'pass', diff_stat: '0' },
  },
] as ServerEnvelope[];

describe('replyTargets', () => {
  it('defaults to the most recent agent card naming a ticket; lists tickets most recent first', () => {
    expect(replyTargets(EVENTS)).toEqual({ tickets: ['E2E-1', 'E2E-2'], defaultTicket: 'E2E-2' });
  });

  it('a chat that names no ticket offers no reply target', () => {
    expect(replyTargets(EVENTS.slice(0, 1))).toEqual({ tickets: [], defaultTicket: null });
  });
});

describe('reduceChatEvents with human messages', () => {
  it('folds a message.human into its thread, in log order, distinct from agent cards', () => {
    const [program] = reduceChatEvents(EVENTS);
    expect(program!.cards.map((c) => c.kind)).toEqual(['finding', 'manifest', 'human', 'manifest']);
    expect(program!.cards[2]).toMatchObject({ kind: 'human', author: 'Operator', ticketId: 'E2E-1', body: 'hi' });
  });

  it('drops a malformed human message rather than guessing', () => {
    const bad = [
      EVENTS[0]!,
      { sub, seq: 9, type: 'message.human', at: 't', data: { id: 'x', thread_id: 'thread-program', body: 'no author' } },
    ] as ServerEnvelope[];
    expect(reduceChatEvents(bad)[0]!.cards).toEqual([]);
  });
});
