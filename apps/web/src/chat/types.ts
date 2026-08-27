/**
 * Chat workspace types (FR-C2, UX_SPEC §3). No backend chat/message table
 * exists yet (grep-verified against docs/DATABASE.md) — the shapes below
 * are this ticket's own domain model, event-sourced the same way the board
 * is (apps/web/src/board/types.ts's "client-local DTOs" precedent):
 * `Thread`/`ChatCard` are folded client-side from a stream of envelopes
 * shaped like `../lib/ws-client.js`'s `ServerEnvelope` — the same
 * `{sub, seq, type, at, data}` shape used everywhere else (API_DESIGN §3),
 * so live `chat:<project>` WS deltas and the REST replay
 * (`GET /projects/:id/chat`, currently fixture-backed — server.ts) are
 * reduced by the exact same code path (`reduceChatEvents.ts`).
 */

export type ThreadKind = 'program' | 'agent';

/** One program thread (pinned) + per-concern agent threads that archive on resolution (UX_SPEC §3). */
export interface Thread {
  id: string;
  kind: ThreadKind;
  /** null for the program thread; the concern label for an agent thread. */
  concern: string | null;
  archived: boolean;
  cards: ChatCard[];
  /**
   * W21-85: this thread is the FIXTURE preview, not this project's telemetry.
   * Only the unregistered preview surface sets it; a registered project's
   * chat is the real projection (chat-projection.ts, W13-63).
   */
  sample?: boolean;
}

/**
 * Provenance on every agent message (UX_SPEC §3): agent name, model, ticket
 * ID, and turn cost — cost click-throughs to the `budget_ledger` row via its
 * minting receipt (DATABASE.md §3 "budget_ledger", API_DESIGN's
 * `GET /receipts/{id}` — the only receipt-shaped endpoint documented).
 */
export interface Provenance {
  agent: string;
  model: string;
  ticketId: string;
  costUsd: number;
  receiptId: string;
}

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low';
export type QuestionStatus = 'open' | 'answered' | 'dismissed';

export interface QuestionOption {
  id: string;
  label: string;
  isDefault: boolean;
}

export interface QuestionCard {
  kind: 'question';
  id: string;
  threadId: string;
  provenance: Provenance;
  question: string;
  context: string;
  options: QuestionOption[];
  status: QuestionStatus;
}

export interface FindingCard {
  kind: 'finding';
  id: string;
  threadId: string;
  provenance: Provenance;
  severity: FindingSeverity;
  issue: string;
  evidenceHref: string;
}

export interface ManifestCard {
  kind: 'manifest';
  id: string;
  threadId: string;
  provenance: Provenance;
  files: string[];
  verifyResult: 'pass' | 'fail';
  diffStat: string;
}

export interface SlateOption {
  id: string;
  label: string;
  tradeoffs: string;
}

export interface SlateCard {
  kind: 'slate';
  id: string;
  threadId: string;
  provenance: Provenance;
  options: SlateOption[];
  recommendedId: string;
  decidedId: string | null;
}

/** UX_SPEC §3's four structured card types (question, slate, finding, manifest). */
export type ChatCard = QuestionCard | FindingCard | ManifestCard | SlateCard;

interface ProvenanceWire {
  agent: string;
  model: string;
  ticket_id: string;
  cost_usd: number;
  receipt_id: string;
}

function provenanceFromWire(wire: ProvenanceWire): Provenance {
  return {
    agent: wire.agent,
    model: wire.model,
    ticketId: wire.ticket_id,
    costUsd: wire.cost_usd,
    receiptId: wire.receipt_id,
  };
}

interface CardWireBase {
  id: string;
  thread_id: string;
  provenance: ProvenanceWire;
}

type QuestionCardWire = CardWireBase & {
  question: string;
  context: string;
  options: QuestionOption[];
  status: QuestionStatus;
};

type FindingCardWire = CardWireBase & {
  severity: FindingSeverity;
  issue: string;
  evidence_href: string;
};

type ManifestCardWire = CardWireBase & {
  files: string[];
  verify_result: 'pass' | 'fail';
  diff_stat: string;
};

type SlateCardWire = CardWireBase & {
  options: SlateOption[];
  recommended_id: string;
  decided_id: string | null;
};

/** Dispatches a `card.<kind>` WS/REST event into its typed `ChatCard`; unknown types are dropped (forward-compatible). */
export function cardFromWireEvent(type: string, data: unknown): ChatCard | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const base = data as CardWireBase;
  if (typeof base.id !== 'string' || typeof base.thread_id !== 'string') return undefined;

  switch (type) {
    case 'card.question': {
      const wire = data as QuestionCardWire;
      return {
        kind: 'question',
        id: wire.id,
        threadId: wire.thread_id,
        provenance: provenanceFromWire(wire.provenance),
        question: wire.question,
        context: wire.context,
        options: wire.options,
        status: wire.status,
      };
    }
    case 'card.finding': {
      const wire = data as FindingCardWire;
      return {
        kind: 'finding',
        id: wire.id,
        threadId: wire.thread_id,
        provenance: provenanceFromWire(wire.provenance),
        severity: wire.severity,
        issue: wire.issue,
        evidenceHref: wire.evidence_href,
      };
    }
    case 'card.manifest': {
      const wire = data as ManifestCardWire;
      return {
        kind: 'manifest',
        id: wire.id,
        threadId: wire.thread_id,
        provenance: provenanceFromWire(wire.provenance),
        files: wire.files,
        verifyResult: wire.verify_result,
        diffStat: wire.diff_stat,
      };
    }
    case 'card.slate': {
      const wire = data as SlateCardWire;
      return {
        kind: 'slate',
        id: wire.id,
        threadId: wire.thread_id,
        provenance: provenanceFromWire(wire.provenance),
        options: wire.options,
        recommendedId: wire.recommended_id,
        decidedId: wire.decided_id,
      };
    }
    default:
      return undefined;
  }
}

export interface ThreadOpenedWire {
  id: string;
  kind: ThreadKind;
  concern: string | null;
  /** W21-85: present and true only on the fixture preview stream. */
  sample?: boolean;
}

export function isThreadOpenedWire(data: unknown): data is ThreadOpenedWire {
  if (typeof data !== 'object' || data === null) return false;
  const candidate = data as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    (candidate.kind === 'program' || candidate.kind === 'agent')
  );
}

export interface ThreadArchivedWire {
  id: string;
}

export function isThreadArchivedWire(data: unknown): data is ThreadArchivedWire {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as { id?: unknown }).id === 'string'
  );
}
