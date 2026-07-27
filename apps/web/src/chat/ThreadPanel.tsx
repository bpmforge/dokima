import { Card } from './Card.js';
import type { Thread } from './types.js';

export interface ThreadPanelProps {
  thread: Thread;
}

/**
 * One thread — the pinned program thread or a per-concern agent thread
 * (UX_SPEC §3). Every thread currently rendered here is sourced from the
 * `GET .../chat` fixture replay (`chat/fixtures.ts`, mirrored by
 * `apps/server/src/api/server.ts`'s `CHAT_FIXTURE_ITEMS`) — no chat/message
 * producer exists yet to populate it with real telemetry. The "Sample"
 * marker keeps its cost chips and model attributions from being mistaken
 * for real spend (honesty control C-1, W9-03); drop it once a real
 * producer lands (the same HANDOFF `types.ts` and `fixtures.ts` document).
 */
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
        <span
          className="chat__thread-badge chat__thread-badge--sample"
          data-testid="chat-thread-sample-badge"
          title="Fixture data — no real chat/message producer exists yet, so this isn't real telemetry."
        >
          Sample
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
