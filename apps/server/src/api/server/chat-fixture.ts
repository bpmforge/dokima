/**
 * server/chat-fixture.ts — the hardcoded chat fixture and its route — 143 lines of canned content that had no business inline in the composition root.
 *
 * Chapter of the 408-line api/server.ts, split under the 400-line
 * CODE_BOOK_PROTOCOL cap (W10-48). Extraction only, no behaviour change.
 * Lives here rather than in a new directory: a sibling server/ already
 * existed, and bootstrap/ would collide with apps/server/src/bootstrap/.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * `GET /api/v1/projects/:id/chat` (FR-C2, UX_SPEC §3). No chat/message
 * producer exists anywhere in this repo yet — no clarifications/slates/
 * findings event schema in `@dokima/events`, no cost tracking reachable
 * from `apps/server` (`packages/gateway`/`packages/loop` aren't declared
 * dependencies here, same class of constraint as this file's own
 * `@fastify/websocket` note above) — so this replays a fixture event
 * stream, exactly as SRS's FR-C2 acceptance sketch names it ("Fixture event
 * stream renders all four card types"), same discipline as
 * `apps/web/e2e/fixtures/fake-model-gateway.ts` hand-rolling wire shapes
 * instead of importing an out-of-scope package. Hand-mirrored in
 * `apps/web/src/chat/fixtures.ts` (no module boundary between the two
 * apps to import across, ARCHITECTURE.md §4) — keep both in sync by hand.
 * HANDOFF: replace with a real projection once a chat/message producer
 * exists (loop/Harbormaster chat wiring, a future ticket).
 */
const CHAT_FIXTURE_ITEMS = [
  {
    sub: 'chat:default',
    seq: 1,
    type: 'thread.opened',
    at: '2026-07-15T14:02:00Z',
    data: { id: 'thread-program', kind: 'program', concern: null },
  },
  {
    sub: 'chat:default',
    seq: 2,
    type: 'thread.opened',
    at: '2026-07-15T14:03:00Z',
    data: {
      id: 'thread-w4-04-security',
      kind: 'agent',
      concern: 'W4-04 security review',
    },
  },
  {
    sub: 'chat:default',
    seq: 3,
    type: 'card.question',
    at: '2026-07-15T14:04:00Z',
    data: {
      id: 'card-question-1',
      thread_id: 'thread-w4-04-security',
      provenance: {
        agent: 'security-auditor',
        model: 'claude-sonnet-5',
        ticket_id: 'W4-04',
        cost_usd: 0.0421,
        receipt_id: 'rcpt_chat_q1',
      },
      question:
        'Should the cost provenance link open the receipt or the spend ledger row?',
      context:
        'FR-C2 names both "receipt/artifact" and "ledger row" for the same click-through.',
      options: [
        { id: 'receipt', label: 'Receipt', isDefault: true },
        { id: 'ledger', label: 'Spend ledger row', isDefault: false },
      ],
      status: 'open',
    },
  },
  {
    sub: 'chat:default',
    seq: 4,
    type: 'card.finding',
    at: '2026-07-15T14:05:00Z',
    data: {
      id: 'card-finding-1',
      thread_id: 'thread-w4-04-security',
      provenance: {
        agent: 'security-auditor',
        model: 'claude-sonnet-5',
        ticket_id: 'W4-04',
        cost_usd: 0.0187,
        receipt_id: 'rcpt_chat_f1',
      },
      severity: 'medium',
      issue:
        'Cost click-through targets an unimplemented /api/v1/receipts/:id (documented, not built).',
      evidence_href: '/api/v1/receipts/rcpt_chat_f1',
    },
  },
  {
    sub: 'chat:default',
    seq: 5,
    type: 'card.manifest',
    at: '2026-07-15T14:06:00Z',
    data: {
      id: 'card-manifest-1',
      thread_id: 'thread-program',
      provenance: {
        agent: 'coding-agent',
        model: 'claude-sonnet-5',
        ticket_id: 'W4-04',
        cost_usd: 0.129,
        receipt_id: 'rcpt_chat_m1',
      },
      files: ['apps/web/src/chat/ChatView.tsx', 'apps/web/src/chat/Card.tsx'],
      verify_result: 'pass',
      diff_stat: '+612 -0',
    },
  },
  {
    sub: 'chat:default',
    seq: 6,
    type: 'card.slate',
    at: '2026-07-15T14:07:00Z',
    data: {
      id: 'card-slate-1',
      thread_id: 'thread-program',
      provenance: {
        agent: 'dokima-pm',
        model: 'claude-opus-4-8',
        ticket_id: 'W4-04',
        cost_usd: 0.005,
        receipt_id: 'rcpt_chat_s1',
      },
      options: [
        {
          id: 'receipt',
          label: 'Link cost to the receipt',
          tradeoffs: 'Ships today; FR-C5 viewer lands later.',
        },
        {
          id: 'ledger',
          label: 'Link cost to a spend-ledger row',
          tradeoffs: 'No GET /spend/:id endpoint exists yet.',
        },
      ],
      recommended_id: 'receipt',
      decided_id: null,
    },
  },
];

export function registerChatRoute(app: FastifyInstance): void {
  app.get(
    '/api/v1/projects/:id/chat',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.send({ items: CHAT_FIXTURE_ITEMS });
    },
  );
}
