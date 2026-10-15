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
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

describe('W21-85 — a real project\'s telemetry is never labelled Sample', () => {
  /**
   * The badge rendered on EVERY thread, with a tooltip swearing the content
   * was not real telemetry. That premise died when W13-63 landed the real
   * projection: a registered project gets its own parks and manifests here.
   * Live on Tally — the pane showed a genuine park finding, badged Sample,
   * so the one piece of evidence the founder needed read as demo data.
   */
  it('a thread from the real projection carries no Sample badge', () => {
    render(
      <ThreadPanel
        thread={{ id: 't', kind: 'program', concern: null, archived: false, cards: [] }}
      />,
    );
    expect(screen.queryByTestId('chat-thread-sample-badge')).toBeNull();
  });

  it('the fixture preview still says Sample', () => {
    render(
      <ThreadPanel
        thread={{
          id: 't',
          kind: 'program',
          concern: null,
          archived: false,
          cards: [],
          sample: true,
        }}
      />,
    );
    expect(screen.getByTestId('chat-thread-sample-badge').textContent).toBe('Sample');
  });
});

describe('ThreadPanel replies (product-owner decision, 2026-10-15)', () => {
  const thread = {
    id: 'thread-program',
    kind: 'program' as const,
    concern: null,
    archived: false,
    cards: [
      {
        kind: 'manifest' as const,
        id: 'm-1',
        threadId: 'thread-program',
        provenance: { agent: 'w', model: 'm', ticketId: 'E2E-1', costUsd: 0, receiptId: '' },
        files: [],
        verifyResult: 'pass' as const,
        diffStat: '0 file(s)',
      },
      {
        kind: 'human' as const,
        id: 'reply-2',
        threadId: 'thread-program',
        author: 'Operator',
        ticketId: 'E2E-1',
        body: 'Looks right.',
        at: '2026-10-15T10:00:00Z',
      },
    ],
  };

  it('renders a reply as a human message — no kind header, no provenance', () => {
    render(<ThreadPanel thread={thread} />);
    const reply = screen.getByTestId('chat-human-reply-2');
    expect(reply.getAttribute('data-kind')).toBe('human');
    expect(screen.getByTestId('chat-human-author').textContent).toBe('Operator');
    expect(screen.getByTestId('chat-human-body').textContent).toBe('Looks right.');
    expect(reply.querySelector('[data-testid="card-model"]')).toBeNull();
    expect(reply.getAttribute('aria-label')).toBe('Reply from Operator on E2E-1');
  });

  it("an agent card's Reply button names its ticket; no handler → no button", () => {
    const onReply = vi.fn();
    render(<ThreadPanel thread={thread} onReply={onReply} />);
    const button = screen.getByRole('button', { name: 'Reply on E2E-1' });
    fireEvent.click(button);
    expect(onReply).toHaveBeenCalledWith('E2E-1');
    cleanup();
    render(<ThreadPanel thread={thread} />);
    expect(screen.queryByTestId('chat-card-reply')).toBeNull();
  });
});
