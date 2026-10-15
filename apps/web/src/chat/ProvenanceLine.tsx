import type { Provenance } from './types.js';

export interface ProvenanceLineProps {
  provenance: Provenance;
  /** Opens the receipt in-app. Absent, or no receipt id → the cost is plain text. */
  onOpenReceipt?: (receiptId: string) => void;
}

/** Turn cost in dollars: two decimals, and "<$0.01" for a real but sub-cent spend. */
export function formatTurnCost(costUsd: number): string {
  if (costUsd > 0 && costUsd < 0.005) return '<$0.01';
  return `$${costUsd.toFixed(2)}`;
}

/**
 * "agent name · model used · ticket ID · turn cost" on every agent message
 * (UX_SPEC §3). The cost is the one click-through: "clicking cost opens the
 * ledger row" (SRS FR-C2 acceptance), reached through the card's minting
 * receipt.
 *
 * Review C2: this used to be a plain `<a href="/api/v1/receipts/<id>">`. The
 * projection sent an empty id, and an anchor carries no bearer token, so a
 * click navigated the tab out of the app to a raw 401 JSON page. The receipt
 * now opens in-app (the caller fetches it and shows the Receipt Inspector),
 * and a card with no receipt shows its cost as text — no link to nowhere.
 */
export function ProvenanceLine({ provenance, onOpenReceipt }: ProvenanceLineProps) {
  const cost = formatTurnCost(provenance.costUsd);
  const receiptId = provenance.receiptId;
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
      {receiptId !== '' && onOpenReceipt ? (
        <button
          type="button"
          className="chat-card__cost chat-card__cost--button"
          data-testid="card-cost-link"
          title="Open the receipt for this turn"
          onClick={() => onOpenReceipt(receiptId)}
        >
          {cost}
        </button>
      ) : (
        <span className="chat-card__cost" data-testid="card-cost-link">
          {cost}
        </span>
      )}
    </div>
  );
}
