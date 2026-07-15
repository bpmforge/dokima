import { useEffect, useMemo, useState } from 'react';
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

  useEffect(() => {
    let cancelled = false;
    fetchChatEvents(projectId, { getToken: () => token })
      .then((items) => {
        if (!cancelled) setEvents(items);
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
      {!hasAnyCards ? (
        <ChatEmptyState />
      ) : (
        <>
          {programThread && <ThreadPanel thread={programThread} />}
          <div className="chat__agent-threads">
            {agentThreads.map((thread) => (
              <ThreadPanel key={thread.id} thread={thread} />
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
