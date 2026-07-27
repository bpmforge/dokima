// @vitest-environment jsdom
/**
 * ThreadPanel's "Sample" marker (W9-03, honesty control C-1): every thread
 * rendered by `ChatView` is currently sourced from the `GET .../chat`
 * fixture replay (`chat/fixtures.ts` / `apps/server/src/api/server.ts`'s
 * `CHAT_FIXTURE_ITEMS`) — no chat/message producer exists yet, so its cost
 * chips and model attributions must not be mistaken for real telemetry.
 * Covers both named sample threads from the review (the Program thread and
 * the W4-04 security review thread) without duplicating
 * `reduceChatEvents.test.ts`'s fold coverage.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { reduceChatEvents } from './reduceChatEvents.js';
import { CHAT_FIXTURE_EVENTS } from './fixtures.js';
import { ThreadPanel } from './ThreadPanel.js';

afterEach(() => {
  cleanup();
});

const [programThread, agentThread] = reduceChatEvents(CHAT_FIXTURE_EVENTS);

describe('ThreadPanel sample marker', () => {
  it('marks the program thread as Sample', () => {
    render(<ThreadPanel thread={programThread!} />);
    expect(screen.getByTestId('chat-thread-sample-badge').textContent).toBe('Sample');
  });

  it('marks the W4-04 security review agent thread as Sample', () => {
    render(<ThreadPanel thread={agentThread!} />);
    expect(agentThread!.concern).toBe('W4-04 security review');
    expect(screen.getByTestId('chat-thread-sample-badge').textContent).toBe('Sample');
  });

  it('leaves the existing thread and card selectors unaffected', () => {
    render(<ThreadPanel thread={programThread!} />);
    expect(screen.getByTestId(`chat-thread-${programThread!.id}`)).toBeTruthy();
    for (const card of programThread!.cards) {
      expect(screen.getByTestId(`chat-card-${card.id}`)).toBeTruthy();
    }
  });
});
