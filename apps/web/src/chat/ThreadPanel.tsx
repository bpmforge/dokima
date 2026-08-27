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
        {/*
          W21-85: ONLY on the fixture preview. This badge used to render on
          every thread, with a tooltip swearing the content was not real
          telemetry — a premise that went stale when W13-63 landed the real
          projection. A registered project's parks and manifests were being
          labelled fake, which is an honesty control (C-1) pointing the wrong
          way: it tells a person to discount the evidence they most need.
        */}
        {thread.sample && (
          <span
            className="chat__thread-badge chat__thread-badge--sample"
            data-testid="chat-thread-sample-badge"
            title="Preview of the card types — this is the unregistered sample stream, not a project's telemetry."
          >
            Sample
          </span>
        )}
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
