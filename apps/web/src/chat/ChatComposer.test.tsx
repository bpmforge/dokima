// @vitest-environment jsdom
/**
 * The Chat pane's reply box (product-owner decision, 2026-10-15). A reply is
 * a ticket comment; these pin the keyboard and screen-reader contract and the
 * honesty of the hint (agents do not read replies yet).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChatComposer, type ChatComposerProps } from './ChatComposer.js';

afterEach(() => {
  cleanup();
});

function setup(overrides: Partial<ChatComposerProps> = {}) {
  const onSend = vi.fn<ChatComposerProps['onSend']>().mockResolvedValue({ refreshed: true });
  const onTicketChange = vi.fn();
  render(
    <ChatComposer
      tickets={['E2E-1', 'E2E-2']}
      ticketId="E2E-1"
      onTicketChange={onTicketChange}
      onSend={onSend}
      {...overrides}
    />,
  );
  const textarea = screen.getByLabelText('Your reply on E2E-1') as HTMLTextAreaElement;
  return { onSend: (overrides.onSend as typeof onSend | undefined) ?? onSend, onTicketChange, textarea };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('ChatComposer', () => {
  it('labels the textarea, describes it with the hint, and names the ticket', () => {
    const { textarea } = setup();
    const hint = screen.getByTestId('chat-composer-hint');
    expect(textarea.getAttribute('aria-describedby')).toBe(hint.id);
    expect(screen.getByRole('form', { name: 'Reply on a ticket' })).toBeTruthy();
    expect(screen.getByLabelText('Ticket')).toBeTruthy();
  });

  it("RED FIXTURE: the hint never claims an agent reads the reply — it says where it is saved", () => {
    setup();
    const hint = screen.getByTestId('chat-composer-hint').textContent ?? '';
    expect(hint).toContain("Saved to E2E-1's history");
    expect(hint).toContain("Agents don't read replies yet");
    expect(hint).not.toMatch(/agent reads it/i);
  });

  it('refuses to send empty text and says why', async () => {
    const { onSend, textarea } = setup();
    fireEvent.change(textarea, { target: { value: '   ' } });
    fireEvent.click(screen.getByTestId('chat-composer-send'));
    await flush();
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByTestId('chat-composer-status').textContent).toBe(
      'Write a reply before sending.',
    );
    expect(textarea.getAttribute('aria-invalid')).toBe('true');
  });

  it('Ctrl+Enter and Cmd+Enter send; plain Enter is a newline', async () => {
    const { onSend, textarea } = setup();
    fireEvent.change(textarea, { target: { value: 'keep the old endpoint' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
    await flush();
    expect(onSend).toHaveBeenCalledWith('E2E-1', 'keep the old endpoint');
    expect(textarea.value).toBe('');
    expect(screen.getByTestId('chat-composer-status').textContent).toBe(
      'Reply saved to E2E-1.',
    );

    fireEvent.change(textarea, { target: { value: 'and the second thing' } });
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
    await flush();
    expect(onSend).toHaveBeenLastCalledWith('E2E-1', 'and the second thing');
  });

  it('shows a sending state and ignores a second send while one is in flight', async () => {
    let resolve!: (value: { refreshed: boolean }) => void;
    const onSend = vi.fn<ChatComposerProps['onSend']>(
      () => new Promise((r) => (resolve = r)),
    );
    const { textarea } = setup({ onSend });
    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.click(screen.getByTestId('chat-composer-send'));
    const button = screen.getByTestId('chat-composer-send') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Sending…');
    expect(screen.getByTestId('chat-composer').getAttribute('aria-busy')).toBe('true');
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
    expect(onSend).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve({ refreshed: false });
      await Promise.resolve();
    });
    expect(screen.getByTestId('chat-composer-status').textContent).toContain(
      'appears here when the chat reloads',
    );
  });

  it('a failed send keeps the words, shows a persistent alert, and Retry sends again', async () => {
    const onSend = vi
      .fn<ChatComposerProps['onSend']>()
      .mockRejectedValueOnce(new Error('ticket E2E-1 not found'))
      .mockResolvedValueOnce({ refreshed: true });
    const { textarea } = setup({ onSend });
    fireEvent.change(textarea, { target: { value: 'please look again' } });
    fireEvent.click(screen.getByTestId('chat-composer-send'));
    await flush();

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain("Couldn't send your reply to E2E-1: ticket E2E-1 not found");
    expect(textarea.value).toBe('please look again');
    // Typing does not dismiss it — it persists until a send succeeds.
    fireEvent.change(textarea, { target: { value: 'please look again!' } });
    expect(screen.queryByRole('alert')).not.toBeNull();

    fireEvent.click(screen.getByTestId('chat-composer-retry'));
    await flush();
    expect(onSend).toHaveBeenLastCalledWith('E2E-1', 'please look again!');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(textarea.value).toBe('');
  });

  it('the picker reports a ticket change to its owner', () => {
    const { onTicketChange } = setup();
    fireEvent.change(screen.getByTestId('chat-composer-ticket'), {
      target: { value: 'E2E-2' },
    });
    expect(onTicketChange).toHaveBeenCalledWith('E2E-2');
  });
});
