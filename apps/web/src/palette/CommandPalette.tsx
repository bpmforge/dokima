import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useModalLayer } from '../lib/useModalLayer.js';
import { fetchArtifactDoc, fetchReceipt } from '../artifacts/api.js';
import { fireTicketVerb, type LifecycleVerb } from '../board/api.js';
import { explainRefusal } from '../board/refusal.js';
import type { BoardTicket, ProblemDetails } from '../board/types.js';
import { paletteNavEntries, searchNav } from './navEntries.js';
import { OPEN_PALETTE_EVENT } from './openPalette.js';
import './palette.css';
import { PalettePreview, type Preview } from './PalettePreview.js';
import { PaletteResultList } from './PaletteResultList.js';
import { searchDocs, searchReceipts, searchTickets, resultKey } from './search.js';
import { isPaletteOpenKey } from './shortcuts.js';
import {
  PALETTE_MODES,
  type PaletteMode,
  type PaletteNavTarget,
  type PaletteResult,
} from './types.js';
import { usePaletteData } from './usePaletteData.js';

export interface CommandPaletteProps {
  baseUrl: string;
  /** Without a token nothing project-scoped can be fetched; navigation still works. */
  token?: string;
  /** The open project, or null — on the Fleet the palette offers navigation only. */
  projectId: string | null;
  onJumpToTicket: (ticketId: string) => void;
  onSelectMode: (mode: PaletteMode) => void;
  onNavigate: (target: PaletteNavTarget) => void;
}

/**
 * ⌘K command palette (UX_SPEC §2a): jump to tickets/docs/receipts, fire
 * verbs, go to any screen or project, mode picker. Mounted once, in the app
 * shell, so it answers on every screen; ticket/doc/receipt search needs an
 * open project and says so when there is none. WCAG 2.2 AA combobox pattern
 * — a text input (`role="combobox"`) owning a `role="listbox"` of options,
 * arrow-key navigation, `aria-activedescendant` mirroring the highlighted
 * option: every result and verb is keyboard-reachable, nothing requires a
 * pointer — and nothing requires a keyboard either (the header's Search
 * button opens it through `OPEN_PALETTE_EVENT`).
 */
export function CommandPalette({
  baseUrl,
  token,
  projectId,
  onJumpToTicket,
  onSelectMode,
  onNavigate,
}: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [refusal, setRefusal] = useState<ProblemDetails | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { tickets, setTickets, docs, receipts, codeHits, projects } = usePaletteData(
    open,
    query,
    baseUrl,
    token,
    projectId,
  );

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
      }
    };
    const onRequestOpen = () => setOpen(true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener(OPEN_PALETTE_EVENT, onRequestOpen);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener(OPEN_PALETTE_EVENT, onRequestOpen);
    };
  }, []);

  const dialogRef = useRef<HTMLDivElement>(null);
  useModalLayer(dialogRef, close, open);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const navEntries = useMemo(
    () => paletteNavEntries({ projectId, projects }),
    [projectId, projects],
  );

  const results = useMemo<PaletteResult[]>(
    () => [
      ...(projectId
        ? [
            ...searchTickets(tickets, query),
            ...searchDocs(docs, query),
            ...searchReceipts(receipts, query),
          ]
        : []),
      ...searchNav(navEntries, query),
    ],
    [projectId, tickets, docs, receipts, navEntries, query],
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const selectResult = useCallback(
    (result: PaletteResult) => {
      setRefusal(null);
      if (result.kind === 'nav') {
        onNavigate(result.target);
        close();
      } else if (result.kind === 'ticket') {
        onJumpToTicket(result.id);
        close();
      } else if (!projectId || !token) {
        return;
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
    [projectId, baseUrl, token, onJumpToTicket, onNavigate, close],
  );

  const fireVerb = useCallback(
    async (ticketId: string, verb: Exclude<LifecycleVerb, 'comment'>) => {
      if (!projectId || !token) return;
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
    [baseUrl, token, projectId, setTickets],
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
  const active = results[activeIndex];

  return (
    <div
      className="command-palette__backdrop"
      data-testid="command-palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        data-testid="command-palette"
      >
        {preview ? (
          <PalettePreview preview={preview} onBack={() => setPreview(null)} />
        ) : (
          <>
            <input
              ref={inputRef}
              role="combobox"
              aria-expanded="true"
              aria-controls={listboxId}
              aria-activedescendant={
                active ? `palette-option-${resultKey(active)}` : undefined
              }
              className="command-palette__input"
              placeholder={
                projectId
                  ? 'Jump to a ticket, doc, receipt or screen… or pick a mode'
                  : 'Go to a project or screen… or pick a mode'
              }
              aria-label={
                projectId
                  ? 'Search tickets, docs, receipts and screens, or pick a mode'
                  : 'Search projects and screens, or pick a mode'
              }
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onInputKeyDown}
              data-testid="command-palette-input"
            />
            {!projectId && (
              <p className="command-palette__hint" data-testid="palette-no-project-hint">
                Ticket, doc and receipt search needs an open project — open one below.
              </p>
            )}
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
                <p className="command-palette__section-label">Go to</p>
              </div>
            )}
            <PaletteResultList
              listboxId={listboxId}
              results={results}
              activeIndex={activeIndex}
              tickets={tickets}
              codeHits={codeHits}
              onHover={setActiveIndex}
              onSelect={selectResult}
              onFireVerb={(ticketId, verb) => void fireVerb(ticketId, verb)}
            />
          </>
        )}
      </div>
    </div>
  );
}
