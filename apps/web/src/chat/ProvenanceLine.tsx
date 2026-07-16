import type { Provenance } from './types.js';

export interface ProvenanceLineProps {
  provenance: Provenance;
}

/**
 * "agent name · model used · ticket ID · turn cost" on every agent message
 * (UX_SPEC §3). The cost is the one click-through: "clicking cost opens the
 * ledger row" (SRS FR-C2 acceptance) — the `budget_ledger` row for this turn
 * (DATABASE.md §3) is reachable via its minting receipt, the only
 * receipt-shaped read documented (API_DESIGN `GET /receipts/{id}`); the
 * Receipt Inspector itself (FR-C5) is a later ticket, so this link is a
 * real, stable href a future viewer can resolve, not a dead-end button.
 */
export function ProvenanceLine({ provenance }: ProvenanceLineProps) {
  return (
    <div className="chat-card__provenance" data-testid="card-provenance">
      <span className="chat-card__agent" data-testid="card-agent">
        {provenance.agent}
      </span>
      <span className="chat-card__sep" aria-hidden="true">
        ·
      </span>
      <span className="chat-card__model" data-testid="card-model">
        {provenance.model}
      </span>
      <span className="chat-card__sep" aria-hidden="true">
        ·
      </span>
      <span className="chat-card__ticket" data-testid="card-ticket">
        {provenance.ticketId}
      </span>
      <span className="chat-card__sep" aria-hidden="true">
        ·
      </span>
      <a
        className="chat-card__cost"
        data-testid="card-cost-link"
        href={`/api/v1/receipts/${encodeURIComponent(provenance.receiptId)}`}
      >
        ${provenance.costUsd.toFixed(4)}
      </a>
    </div>
  );
}
