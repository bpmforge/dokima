import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchReceipt } from '../artifacts/api.js';
import { ReceiptInspector } from '../artifacts/ReceiptInspector.js';
import type { ReceiptRecord } from '../artifacts/types.js';
import { WsClient, type ServerEnvelope } from '../lib/ws-client.js';
import './chat.css';
import { fetchChatEvents, sendChatReply } from './api.js';
import { ChatComposer } from './ChatComposer.js';
import { ChatEmptyState } from './ChatEmptyState.js';
import { reduceChatEvents } from './reduceChatEvents.js';
import { replyTargets } from './reply-targets.js';
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

  // A person's reply (product-owner decision, 2026-10-15): the ticket the
  // composer is pointed at, set by a card's Reply button or the picker.
  const [replyTicket, setReplyTicket] = useState<string | null>(null);
  const replyTextRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setOpenReceipt(null);
    setReplyTicket(null);
  }, [projectId]);

  const onReply = useCallback((ticketId: string) => {
    setReplyTicket(ticketId);
    replyTextRef.current?.focus();
  }, []);

  // Sent through the ticket `comment` verb, then the chat is re-read from the
  // server so the reply shows as the log has it — never optimistically.
  const onSendReply = useCallback(
    async (ticketId: string, body: string) => {
      await sendChatReply(projectId, ticketId, body, { getToken: () => token });
      try {
        setEvents(await fetchChatEvents(projectId, { getToken: () => token }));
        return { refreshed: true };
      } catch {
        return { refreshed: false };
      }
    },
    [projectId, token],
  );

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
  // The fixture preview (W21-85) names tickets no project has: no replies there.
  const canReply = !threads.some((t) => t.sample);
  const targets = useMemo(() => replyTargets(events), [events]);
  const composerTicket =
    replyTicket !== null && targets.tickets.includes(replyTicket)
      ? replyTicket
      : targets.defaultTicket;
  const replyHandler = canReply && composerTicket !== null ? onReply : undefined;

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
              className="surface surface--attention chat__receipt"
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
            <ThreadPanel
              thread={programThread}
              onOpenReceipt={onOpenReceipt}
              onReply={replyHandler}
            />
          )}
          <div className="chat__agent-threads">
            {agentThreads.map((thread) => (
              <ThreadPanel
                key={thread.id}
                thread={thread}
                onOpenReceipt={onOpenReceipt}
                onReply={replyHandler}
              />
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
          {replyHandler && composerTicket !== null && (
            <ChatComposer
              tickets={targets.tickets}
              ticketId={composerTicket}
              onTicketChange={setReplyTicket}
              onSend={onSendReply}
              textareaRef={replyTextRef}
            />
          )}
        </>
      )}
    </div>
  );
}
