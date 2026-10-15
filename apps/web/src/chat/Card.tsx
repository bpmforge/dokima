import { plainLeadFor } from './plain-lead.js';
import { ProvenanceLine } from './ProvenanceLine.js';
import type {
  ChatCard,
  FindingCard,
  ManifestCard,
  QuestionCard,
  SlateCard,
} from './types.js';

function QuestionCardBody({ card }: { card: QuestionCard }) {
  return (
    <>
      <p className="chat-card__question">{card.question}</p>
      <p className="chat-card__context">{card.context}</p>
      <ul className="chat-card__options">
        {card.options.map((option) => (
          <li key={option.id} data-default={option.isDefault}>
            {option.label}
            {option.isDefault && <span className="chat-card__badge">default</span>}
          </li>
        ))}
      </ul>
      <span className="chat-card__status" data-testid="card-status">
        {card.status}
      </span>
    </>
  );
}

/**
 * `evidence_href` arrives over the same untrusted `chat:<project>` wire as
 * every other card field (agent sessions are untrusted, THREAT_MODEL trust
 * boundary), so it is classified, never handed to `href` verbatim:
 *
 * - `/api/v1/receipts/<id>` → a receipt, opened IN-APP through the Receipt
 *   Inspector. A plain link there navigated the tab to a raw API URL with no
 *   bearer token — a 401 JSON page (review C2).
 * - `?project=…&view=trace&ticket=…` → an in-app view. This is what the real
 *   projection (`chat-projection.ts` `evidenceHrefFor`) emits; the old check
 *   accepted only `/api/v1/` paths, so every real finding read "evidence
 *   unavailable" (review C3). A bare query string is same-origin by
 *   construction; only the keys the server emits are accepted.
 * - anything else (a `javascript:`/`data:` URI, an absolute or
 *   protocol-relative URL, another path) → no link.
 */
export type EvidenceTarget =
  | { kind: 'receipt'; receiptId: string }
  | { kind: 'app'; href: string };

const APP_EVIDENCE_KEYS = new Set(['project', 'view', 'ticket']);
const APP_EVIDENCE_VIEWS = new Set(['trace']);
const RECEIPT_PATH = /^\/api\/v1\/receipts\/([^/?#]+)$/;

export function classifyEvidenceHref(href: string): EvidenceTarget | null {
  const receipt = RECEIPT_PATH.exec(href);
  if (receipt) {
    try {
      return { kind: 'receipt', receiptId: decodeURIComponent(receipt[1]!) };
    } catch {
      return null;
    }
  }
  if (href.startsWith('?') && href.length > 1) {
    const params = new URLSearchParams(href.slice(1));
    let any = false;
    for (const [key, value] of params) {
      any = true;
      if (!APP_EVIDENCE_KEYS.has(key) || value === '') return null;
      if (key === 'view' && !APP_EVIDENCE_VIEWS.has(value)) return null;
    }
    if (!any) return null;
    return { kind: 'app', href: `?${params.toString()}` };
  }
  return null;
}

export function isSafeEvidenceHref(href: string): boolean {
  return classifyEvidenceHref(href) !== null;
}

function FindingCardBody({
  card,
  onOpenReceipt,
}: {
  card: FindingCard;
  onOpenReceipt?: (receiptId: string) => void;
}) {
  const target = classifyEvidenceHref(card.evidenceHref);
  // W19-07: recognised mechanical findings lead with one human sentence; the
  // verbatim issue stays below, untouched — summarise, never paraphrase away.
  const lead = plainLeadFor(card.issue);
  return (
    <>
      <span className={`chat-card__severity chat-card__severity--${card.severity}`}>
        {card.severity}
      </span>
      {lead && (
        <p className="chat-card__lead" data-testid="card-plain-lead">
          {lead}
        </p>
      )}
      <p className="chat-card__issue">{card.issue}</p>
      {target?.kind === 'app' ? (
        <a className="chat-card__evidence" href={target.href} data-testid="card-evidence-link">
          evidence
        </a>
      ) : target?.kind === 'receipt' && onOpenReceipt ? (
        <button
          type="button"
          className="chat-card__evidence chat-card__evidence--button"
          data-testid="card-evidence-link"
          onClick={() => onOpenReceipt(target.receiptId)}
        >
          evidence
        </button>
      ) : (
        <span
          className="chat-card__evidence chat-card__evidence--unavailable"
          data-testid="card-evidence-link"
        >
          evidence unavailable
        </span>
      )}
    </>
  );
}

function ManifestCardBody({ card }: { card: ManifestCard }) {
  return (
    <>
      <ul className="chat-card__files">
        {card.files.map((file) => (
          <li key={file}>{file}</li>
        ))}
      </ul>
      <span
        className={`chat-card__verify chat-card__verify--${card.verifyResult}`}
        data-testid="card-verify-result"
      >
        verify {card.verifyResult}
      </span>
      <span className="chat-card__diffstat">{card.diffStat}</span>
    </>
  );
}

function SlateCardBody({ card }: { card: SlateCard }) {
  return (
    <>
      <ul className="chat-card__options">
        {card.options.map((option) => (
          <li key={option.id} data-recommended={option.id === card.recommendedId}>
            <strong>{option.label}</strong>
            {option.id === card.recommendedId && (
              <span className="chat-card__badge">recommended</span>
            )}
            <p>{option.tradeoffs}</p>
          </li>
        ))}
      </ul>
      <span className="chat-card__decision" data-testid="card-decision">
        {card.decidedId ?? 'undecided'}
      </span>
    </>
  );
}

export interface CardProps {
  card: ChatCard;
  /** Opens a receipt in-app (Receipt Inspector). Absent → receipts render as plain text. */
  onOpenReceipt?: (receiptId: string) => void;
}

/** Dispatches one of UX_SPEC §3's four structured card types (question/finding/manifest/slate). */
export function Card({ card, onOpenReceipt }: CardProps) {
  return (
    <article
      className={`chat-card chat-card--${card.kind}`}
      data-testid={`chat-card-${card.id}`}
      data-kind={card.kind}
    >
      <header className="chat-card__kind">{card.kind}</header>
      {card.kind === 'question' && <QuestionCardBody card={card} />}
      {card.kind === 'finding' && (
        <FindingCardBody card={card} onOpenReceipt={onOpenReceipt} />
      )}
      {card.kind === 'manifest' && <ManifestCardBody card={card} />}
      {card.kind === 'slate' && <SlateCardBody card={card} />}
      <ProvenanceLine provenance={card.provenance} onOpenReceipt={onOpenReceipt} />
    </article>
  );
}
