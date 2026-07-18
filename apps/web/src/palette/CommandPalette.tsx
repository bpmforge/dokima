import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchArtifactDoc,
  fetchArtifactList,
  fetchReceipt,
  fetchReceipts,
} from '../artifacts/api.js';
import { MarkdownView } from '../artifacts/MarkdownView.js';
import { ReceiptInspector } from '../artifacts/ReceiptInspector.js';
import type { ArtifactDoc, ReceiptRecord } from '../artifacts/types.js';
import { fetchBoardTickets, fireTicketVerb, type LifecycleVerb } from '../board/api.js';
import { explainRefusal } from '../board/refusal.js';
import { availableVerbsFrom, verbTargetColumn } from '../board/transitions.js';
import type { BoardTicket, ProblemDetails } from '../board/types.js';
import { queryCodeIndex, type CodeSearchHit } from './codeIndex.js';
import './palette.css';
import { searchDocs, searchReceipts, searchTickets, resultKey } from './search.js';
import { isPaletteCloseKey, isPaletteOpenKey } from './shortcuts.js';
import { PALETTE_MODES, type PaletteMode, type PaletteResult } from './types.js';

export interface CommandPaletteProps {
  baseUrl: string;
  token: string;
  projectId: string;
  onJumpToTicket: (ticketId: string) => void;
  onSelectMode: (mode: PaletteMode) => void;
}

type Preview =
  | { kind: 'doc'; path: string; doc: ArtifactDoc | null; error: string | null }
  | { kind: 'receipt'; id: string; receipt: ReceiptRecord | null; error: string | null };

/**
 * ⌘K command palette (UX_SPEC §2a): jump to tickets/docs/receipts, fire
 * verbs, mode picker. WCAG 2.2 AA combobox pattern — a text input
 * (`role="combobox"`) owning a `role="listbox"` of options, arrow-key
 * navigation, `aria-activedescendant` mirroring the highlighted option
 * (UX_SPEC §9 "every drag has a verb equivalent" extends here: every
 * result and verb is keyboard-reachable, nothing requires a pointer).
 */
export function CommandPalette({
  baseUrl,
  token,
  projectId,
  onJumpToTicket,
  onSelectMode,
}: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [tickets, setTickets] = useState<BoardTicket[]>([]);
  const [docs, setDocs] = useState<{ path: string; title: string }[]>([]);
  const [receipts, setReceipts] = useState<ReceiptRecord[]>([]);
  const [codeHits, setCodeHits] = useState<CodeSearchHit[] | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [refusal, setRefusal] = useState<ProblemDetails | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setPreview(null);
    setRefusal(null);
    setActiveIndex(0);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isPaletteOpenKey(event)) {
        event.preventDefault();
        setOpen((current) => !current);
      } else if (open && isPaletteCloseKey(event)) {
        close();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    void fetchBoardTickets({ baseUrl, token }, projectId).then((res) => {
      if (res.ok) setTickets(res.data);
    });
    void fetchArtifactList(projectId, { baseUrl, getToken: () => token }).then(setDocs);
    void fetchReceipts(projectId, {}, { baseUrl, getToken: () => token }).then(
      setReceipts,
    );
  }, [open, baseUrl, token, projectId]);

  useEffect(() => {
    if (!open || query.trim().length === 0) {
      setCodeHits(null);
      return;
    }
    let cancelled = false;
    void queryCodeIndex(projectId, query, { baseUrl, token }).then((hits) => {
      if (!cancelled) setCodeHits(hits);
    });
    return () => {
      cancelled = true;
    };
  }, [open, query, baseUrl, token, projectId]);

  const results = useMemo<PaletteResult[]>(
    () => [
      ...searchTickets(tickets, query),
      ...searchDocs(docs, query),
      ...searchReceipts(receipts, query),
    ],
    [tickets, docs, receipts, query],
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const selectResult = useCallback(
    (result: PaletteResult) => {
      setRefusal(null);
      if (result.kind === 'ticket') {
        onJumpToTicket(result.id);
        close();
      } else if (result.kind === 'doc') {
        setPreview({ kind: 'doc', path: result.path, doc: null, error: null });
        void fetchArtifactDoc(projectId, result.path, undefined, {
          baseUrl,
          getToken: () => token,
        })
          .then((doc) => setPreview({ kind: 'doc', path: result.path, doc, error: null }))
          .catch(() =>
            setPreview({
              kind: 'doc',
              path: result.path,
              doc: null,
              error: 'Failed to load doc',
            }),
          );
      } else {
        setPreview({ kind: 'receipt', id: result.id, receipt: null, error: null });
        void fetchReceipt(projectId, result.id, { baseUrl, getToken: () => token })
          .then((receipt) =>
            setPreview({ kind: 'receipt', id: result.id, receipt, error: null }),
          )
          .catch(() =>
            setPreview({
              kind: 'receipt',
              id: result.id,
              receipt: null,
              error: 'Failed to load receipt',
            }),
          );
      }
    },
    [projectId, baseUrl, token, onJumpToTicket, close],
  );

  const fireVerb = useCallback(
    async (ticketId: string, verb: Exclude<LifecycleVerb, 'comment'>) => {
      setRefusal(null);
      const result = await fireTicketVerb({ baseUrl, token }, ticketId, verb, projectId);
      if (result.ok) {
        setTickets((current) =>
          current.map((t) => (t.id === ticketId ? (result.data as BoardTicket) : t)),
        );
      } else {
        setRefusal(result.problem);
      }
    },
    [baseUrl, token, projectId],
  );

  const onInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const active = results[activeIndex];
        if (active) selectResult(active);
      }
    },
    [results, activeIndex, selectResult],
  );

  if (!open) return null;

  const listboxId = 'command-palette-listbox';

  return (
    <div className="command-palette__backdrop" data-testid="command-palette-backdrop">
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        data-testid="command-palette"
      >
        {preview ? (
          <div className="command-palette__preview">
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="command-palette__back"
            >
              ← Back
            </button>
            {preview.kind === 'doc' &&
              (preview.error ? (
                <p role="alert">{preview.error}</p>
              ) : preview.doc ? (
                <MarkdownView content={preview.doc.content} />
              ) : (
                <p>Loading…</p>
              ))}
            {preview.kind === 'receipt' &&
              (preview.error ? (
                <p role="alert">{preview.error}</p>
              ) : preview.receipt ? (
                <ReceiptInspector receipt={preview.receipt} />
              ) : (
                <p>Loading…</p>
              ))}
          </div>
        ) : (
          <>
            <input
              ref={inputRef}
              role="combobox"
              aria-expanded="true"
              aria-controls={listboxId}
              aria-activedescendant={
                results[activeIndex]
                  ? `palette-option-${resultKey(results[activeIndex])}`
                  : undefined
              }
              className="command-palette__input"
              placeholder="Jump to a ticket, doc, receipt… or pick a mode"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onInputKeyDown}
              data-testid="command-palette-input"
            />
            {refusal && (
              <p
                className="command-palette__refusal"
                role="alert"
                data-testid="palette-refusal"
              >
                <strong>{explainRefusal(refusal).rule}</strong>:{' '}
                {explainRefusal(refusal).message}
              </p>
            )}
            {query.trim().length === 0 && (
              <div className="command-palette__modes" data-testid="palette-modes">
                <p className="command-palette__section-label">What are we doing today?</p>
                {PALETTE_MODES.map(({ mode, label }) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      onSelectMode(mode);
                      close();
                    }}
                    data-testid={`palette-mode-${mode}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <ul
              role="listbox"
              id={listboxId}
              className="command-palette__results"
              data-testid="palette-results"
            >
              {results.map((result, index) => {
                const key = resultKey(result);
                const ticket =
                  result.kind === 'ticket'
                    ? tickets.find((t) => t.id === result.id)
                    : undefined;
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
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => selectResult(result)}
                    >
                      <span className="command-palette__result-kind">{result.kind}</span>{' '}
                      {result.title}
                    </button>
                    {ticket && availableVerbsFrom(ticket.status).length > 0 && (
                      <label className="command-palette__verb-menu">
                        <span className="sr-only">Fire a verb on {ticket.id}</span>
                        <select
                          value=""
                          onChange={(event) => {
                            const verb = event.target.value as Exclude<
                              LifecycleVerb,
                              'comment'
                            >;
                            if (verb) void fireVerb(ticket.id, verb);
                          }}
                        >
                          <option value="" disabled>
                            Fire verb…
                          </option>
                          {availableVerbsFrom(ticket.status).map((verb) => (
                            <option key={verb} value={verb}>
                              {verb} → {verbTargetColumn(verb)}
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
          </>
        )}
      </div>
    </div>
  );
}
