import type { LifecycleVerb } from '../board/api.js';
import { availableVerbsFrom, verbMenuLabel } from '../board/transitions.js';
import type { BoardTicket } from '../board/types.js';
import type { CodeSearchHit } from './codeIndex.js';
import { resultKey, resultKindLabel } from './search.js';
import type { PaletteResult } from './types.js';

export interface PaletteResultListProps {
  listboxId: string;
  results: readonly PaletteResult[];
  activeIndex: number;
  tickets: readonly BoardTicket[];
  codeHits: readonly CodeSearchHit[] | null;
  onHover: (index: number) => void;
  onSelect: (result: PaletteResult) => void;
  onFireVerb: (ticketId: string, verb: Exclude<LifecycleVerb, 'comment'>) => void;
}

/** The palette's listbox: tickets (with a Move menu), docs, receipts, navigation, then code hits. */
export function PaletteResultList({
  listboxId,
  results,
  activeIndex,
  tickets,
  codeHits,
  onHover,
  onSelect,
  onFireVerb,
}: PaletteResultListProps) {
  return (
    <ul
      role="listbox"
      id={listboxId}
      aria-label="Results"
      className="command-palette__results"
      data-testid="palette-results"
    >
      {results.map((result, index) => {
        const key = resultKey(result);
        const ticket =
          result.kind === 'ticket' ? tickets.find((t) => t.id === result.id) : undefined;
        return (
          <li
            key={key}
            id={`palette-option-${key}`}
            role="option"
            aria-selected={index === activeIndex}
            className={`command-palette__result${index === activeIndex ? ' command-palette__result--active' : ''}`}
            data-testid={`palette-result-${key}`}
          >
            <button
              type="button"
              className="command-palette__result-label"
              onMouseEnter={() => onHover(index)}
              onClick={() => onSelect(result)}
            >
              <span className="command-palette__result-kind">
                {resultKindLabel(result)}
              </span>{' '}
              {result.title}
            </button>
            {ticket && availableVerbsFrom(ticket.status).length > 0 && (
              <label className="command-palette__verb-menu">
                <span className="sr-only">Fire a verb on {ticket.id}</span>
                <select
                  value=""
                  onChange={(event) => {
                    const verb = event.target.value as Exclude<LifecycleVerb, 'comment'>;
                    if (verb) onFireVerb(ticket.id, verb);
                  }}
                >
                  <option value="" disabled>
                    Move to…
                  </option>
                  {availableVerbsFrom(ticket.status).map((verb) => (
                    <option key={verb} value={verb}>
                      {verbMenuLabel(verb)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </li>
        );
      })}
      {codeHits && codeHits.length > 0 && (
        <>
          <li className="command-palette__section-label" aria-hidden="true">
            Code
          </li>
          {codeHits.map((hit) => (
            <li
              key={`code:${hit.path}:${hit.line}`}
              role="option"
              aria-selected={false}
              className="command-palette__result"
              data-testid={`palette-code-${hit.path}:${hit.line}`}
            >
              <span className="command-palette__result-label">
                {hit.path}:{hit.line} — {hit.snippet}
              </span>
            </li>
          ))}
        </>
      )}
    </ul>
  );
}
