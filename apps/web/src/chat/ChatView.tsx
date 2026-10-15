import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchReceipt } from '../artifacts/api.js';
import { ReceiptInspector } from '../artifacts/ReceiptInspector.js';
import type { ReceiptRecord } from '../artifacts/types.js';
import { WsClient, type ServerEnvelope } from '../lib/ws-client.js';
import './chat.css';
import { fetchChatEvents } from './api.js';
import { ChatEmptyState } from './ChatEmptyState.js';
import { reduceChatEvents } from './reduceChatEvents.js';
import { ThreadPanel } from './ThreadPanel.js';

export interface ChatViewProps {
  token: string;
  projectId?: string;
}

function wsUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}/api/v1/ws`;
}

/**
 * Chat workspace (UX_SPEC §3, FR-C2): the program thread pinned on top,
 * per-concern agent threads below, structured question/finding/manifest/
 * slate cards with provenance + a cost click-through. `GET .../chat`
 * replays the event stream on load; `chat:<project>` WS deltas append to
 * it live — both flow through the same `reduceChatEvents` fold (API_DESIGN
 * §3: "every subscription has a REST read", reconciled on reconnect).
 */
export function ChatView({ token, projectId = 'default' }: ChatViewProps) {
  const [events, setEvents] = useState<ServerEnvelope[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Review C2: a card's receipt opens HERE, fetched with the bearer token,
  // instead of a bare link that navigated the tab to a raw 401 API page.
  const [openReceipt, setOpenReceipt] = useState<
    | { id: string; state: 'loading' }
    | { id: string; state: 'ready'; receipt: ReceiptRecord }
    | { id: string; state: 'error'; message: string }
    | null
  >(null);

  const onOpenReceipt = useCallback(
    (receiptId: string) => {
      setOpenReceipt({ id: receiptId, state: 'loading' });
      fetchReceipt(projectId, receiptId, { getToken: () => token })
        .then((receipt) => {
          setOpenReceipt((current) =>
            current?.id === receiptId ? { id: receiptId, state: 'ready', receipt } : current,
          );
        })
        .catch((error: unknown) => {
          setOpenReceipt((current) =>
            current?.id === receiptId
              ? {
                  id: receiptId,
                  state: 'error',
                  message: error instanceof Error ? error.message : 'Request failed',
                }
              : current,
          );
        });
    },
    [projectId, token],
  );

  useEffect(() => {
    setOpenReceipt(null);
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    // A stale error from a prior project/fetch must never outlive the fetch
    // that supersedes it — clear on every rerun, not only on failure.
    setLoadError(null);
    fetchChatEvents(projectId, { getToken: () => token })
      .then((items) => {
        if (!cancelled) setEvents(items);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error.message : 'Failed to load chat history',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, token]);

  useEffect(() => {
    const client = new WsClient({
      url: wsUrl(),
      token,
      subscriptions: [`chat:${projectId}`],
      onEnvelope: (envelope) => {
        if (envelope.sub !== `chat:${projectId}`) return;
        setEvents((current) => [...current, envelope]);
      },
    });
    client.connect();
    return () => client.close();
  }, [token, projectId]);

  const threads = useMemo(() => reduceChatEvents(events), [events]);
  const programThread = threads.find((t) => t.kind === 'program');
  const agentThreads = threads.filter(
    (t) => t.kind === 'agent' && (showArchived || !t.archived),
  );
  const hasAnyCards = threads.some((t) => t.cards.length > 0);

  if (!loaded) return null;

  return (
    <div className="chat" data-testid="chat-view">
      {loadError ? (
        <div className="chat__error" data-testid="chat-load-error">
          <p>Couldn&apos;t load chat history.</p>
          <span className="chat__error-hint">{loadError}</span>
        </div>
      ) : !hasAnyCards ? (
        <ChatEmptyState />
      ) : (
        <>
          {openReceipt && (
            <section
              className="chat__receipt"
              data-testid="chat-receipt"
              aria-label={`Receipt ${openReceipt.id}`}
            >
              <header className="chat__receipt-header">
                <span>Receipt {openReceipt.id}</span>
                <button
                  type="button"
                  className="chat__archived-toggle"
                  data-testid="chat-receipt-close"
                  onClick={() => setOpenReceipt(null)}
                >
                  Close
                </button>
              </header>
              {openReceipt.state === 'loading' && <p>Loading the receipt…</p>}
              {openReceipt.state === 'error' && (
                <p className="chat__receipt-error" role="alert" data-testid="chat-receipt-error">
                  Couldn&apos;t load this receipt: {openReceipt.message}
                </p>
              )}
              {openReceipt.state === 'ready' && <ReceiptInspector receipt={openReceipt.receipt} />}
            </section>
          )}
          {programThread && (
            <ThreadPanel thread={programThread} onOpenReceipt={onOpenReceipt} />
          )}
          <div className="chat__agent-threads">
            {agentThreads.map((thread) => (
              <ThreadPanel key={thread.id} thread={thread} onOpenReceipt={onOpenReceipt} />
            ))}
          </div>
          {threads.some((t) => t.kind === 'agent' && t.archived) && (
            <button
              type="button"
              className="chat__archived-toggle"
              data-testid="chat-toggle-archived"
              onClick={() => setShowArchived((current) => !current)}
            >
              {showArchived ? 'Hide archived' : 'Show archived'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
