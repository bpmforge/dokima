// @vitest-environment jsdom
/**
 * The Chat pane accepts replies (product-owner decision, 2026-10-15): a card's
 * Reply points the composer at its ticket, a send goes through the ticket
 * `comment` verb, and the feed is re-read so the reply appears as the log has
 * it. The fixture preview never offers a reply.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ServerEnvelope } from '../lib/ws-client.js';
import { CHAT_FIXTURE_EVENTS } from './fixtures.js';

const api = vi.hoisted(() => ({
  fetchChatEvents: vi.fn(),
  sendChatReply: vi.fn(),
}));
vi.mock('./api.js', () => api);
vi.mock('../lib/ws-client.js', () => ({
  WsClient: class {
    connect() {}
    close() {}
  },
}));

const { ChatView } = await import('./ChatView.js');

const sub = 'chat:proj-1';
const prov = (ticket: string) => ({ agent: 'w', model: 'm', ticket_id: ticket, cost_usd: 0, receipt_id: '' });
const STREAM: ServerEnvelope[] = [
  { sub, seq: 1, type: 'thread.opened', at: 't', data: { id: 'thread-program', kind: 'program', concern: null } },
  {
    sub, seq: 2, type: 'card.finding', at: 't',
    data: { id: 'finding-2', thread_id: 'thread-program', provenance: prov('E2E-1'), severity: 'high', issue: 'Parked with evidence', evidence_href: '' },
  },
  {
    sub, seq: 3, type: 'card.manifest', at: 't',
    data: { id: 'manifest-3', thread_id: 'thread-program', provenance: prov('E2E-2'), files: [], verify_result: 'pass', diff_stat: '0 file(s)' },
  },
] as ServerEnvelope[];
const REPLY: ServerEnvelope = {
  sub, seq: 4, type: 'message.human', at: '2026-10-15T10:00:00Z',
  data: { id: 'reply-4', thread_id: 'thread-program', author: 'Operator', ticket_id: 'E2E-1', body: 'try again', at: '2026-10-15T10:00:00Z' },
} as ServerEnvelope;

beforeEach(() => {
  api.fetchChatEvents.mockReset();
  api.sendChatReply.mockReset();
});
afterEach(() => cleanup());

async function renderView() {
  await act(async () => {
    render(<ChatView token="tok" projectId="proj-1" />);
  });
}

describe('ChatView replies', () => {
  it('defaults the composer to the most recent card; Reply on a card retargets and focuses it', async () => {
    api.fetchChatEvents.mockResolvedValue(STREAM);
    await renderView();
    const picker = screen.getByTestId('chat-composer-ticket') as HTMLSelectElement;
    expect(picker.value).toBe('E2E-2');
    fireEvent.click(screen.getByRole('button', { name: 'Reply on E2E-1' }));
    expect(picker.value).toBe('E2E-1');
    expect(document.activeElement).toBe(screen.getByLabelText('Your reply on E2E-1'));
  });

  it('sends through the comment verb, then shows the reply as the server has it', async () => {
    api.fetchChatEvents.mockResolvedValueOnce(STREAM).mockResolvedValueOnce([...STREAM, REPLY]);
    api.sendChatReply.mockResolvedValue(undefined);
    await renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Reply on E2E-1' }));
    fireEvent.change(screen.getByLabelText('Your reply on E2E-1'), { target: { value: 'try again' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('chat-composer-send'));
    });
    expect(api.sendChatReply).toHaveBeenCalledWith('proj-1', 'E2E-1', 'try again', expect.anything());
    expect(screen.getByTestId('chat-human-reply-4').textContent).toContain('try again');
    expect(screen.getByTestId('chat-composer-status').textContent).toBe('Reply saved to E2E-1.');
  });

  it('the fixture preview offers no reply — its tickets belong to no project', async () => {
    api.fetchChatEvents.mockResolvedValue(CHAT_FIXTURE_EVENTS);
    await renderView();
    expect(screen.queryByTestId('chat-composer')).toBeNull();
    expect(screen.queryByTestId('chat-card-reply')).toBeNull();
  });
});
