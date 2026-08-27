import type { ServerEnvelope } from '../lib/ws-client.js';

/**
 * The "fixture event stream" SRS's FR-C2 acceptance sketch names verbatim
 * ("Fixture event stream renders all four card types"). No chat/message
 * producer exists anywhere in this repo yet — no clarifications/slates/
 * findings event schema, no cost tracking reachable from `apps/server`
 * (`packages/gateway`/`packages/loop` aren't declared dependencies) — so
 * there is nothing "live" to source real provenance from this wave. This
 * fixture is this ticket's own recorded input (PLAYBOOK.md "recorded
 * fixtures, not live APIs"), driving both `reduceChatEvents.test.ts` here
 * and, hand-mirrored (apps/web and apps/server share no module boundary,
 * ARCHITECTURE.md §4), `apps/server/src/api/server.ts`'s
 * `GET /api/v1/projects/:id/chat` — keep the two in sync by hand, same
 * discipline as `apps/web/e2e/fixtures/fake-model-gateway.ts` hand-rolling
 * wire shapes instead of importing a package outside its dependency scope.
 */
export const CHAT_FIXTURE_EVENTS: ServerEnvelope[] = [
  {
    sub: 'chat:default',
    seq: 1,
    type: 'thread.opened',
    at: '2026-07-15T14:02:00Z',
    data: { id: 'thread-program', kind: 'program', concern: null, sample: true },
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
      sample: true,
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
          tradeoffs: 'No `GET /spend/:id` endpoint exists yet.',
        },
      ],
      recommended_id: 'receipt',
      decided_id: null,
    },
  },
];
