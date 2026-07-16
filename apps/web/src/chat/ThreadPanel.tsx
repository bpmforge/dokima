import { Card } from './Card.js';
import type { Thread } from './types.js';

export interface ThreadPanelProps {
  thread: Thread;
}

/** One thread — the pinned program thread or a per-concern agent thread (UX_SPEC §3). */
export function ThreadPanel({ thread }: ThreadPanelProps) {
  return (
    <section
      className={`chat__thread chat__thread--${thread.kind}`}
      data-testid={`chat-thread-${thread.id}`}
      data-archived={thread.archived}
      aria-label={
        thread.kind === 'program' ? 'Program thread' : (thread.concern ?? 'Agent thread')
      }
    >
      <header className="chat__thread-header">
        <span className="chat__thread-title">
          {thread.kind === 'program' ? 'Program' : thread.concern}
        </span>
        {thread.archived && <span className="chat__thread-badge">archived</span>}
      </header>
      <div className="chat__thread-cards" role="list">
        {thread.cards.map((card) => (
          <Card key={card.id} card={card} />
        ))}
      </div>
    </section>
  );
}
