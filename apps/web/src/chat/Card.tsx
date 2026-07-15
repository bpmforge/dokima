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

function FindingCardBody({ card }: { card: FindingCard }) {
  return (
    <>
      <span className={`chat-card__severity chat-card__severity--${card.severity}`}>
        {card.severity}
      </span>
      <p className="chat-card__issue">{card.issue}</p>
      <a
        className="chat-card__evidence"
        href={card.evidenceHref}
        data-testid="card-evidence-link"
      >
        evidence
      </a>
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
}

/** Dispatches one of UX_SPEC §3's four structured card types (question/finding/manifest/slate). */
export function Card({ card }: CardProps) {
  return (
    <article
      className={`chat-card chat-card--${card.kind}`}
      data-testid={`chat-card-${card.id}`}
      data-kind={card.kind}
    >
      <header className="chat-card__kind">{card.kind}</header>
      {card.kind === 'question' && <QuestionCardBody card={card} />}
      {card.kind === 'finding' && <FindingCardBody card={card} />}
      {card.kind === 'manifest' && <ManifestCardBody card={card} />}
      {card.kind === 'slate' && <SlateCardBody card={card} />}
      <ProvenanceLine provenance={card.provenance} />
    </article>
  );
}
