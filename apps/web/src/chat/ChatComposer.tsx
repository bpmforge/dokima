import { useId, useState, type FormEvent, type KeyboardEvent, type RefObject } from 'react';

/**
 * The Chat pane's reply box (product-owner decision, 2026-10-15).
 *
 * A reply is a ticket comment, sent through the `comment` verb (`api.ts`
 * `sendChatReply`) — the same verbs path as the board, so it lands in the
 * hash-chained log and the ticket's history. Nothing here writes state any
 * other way.
 *
 * THE HINT SAYS WHAT HAPPENS, NOT WHAT WE WISH HAPPENED. Grep-verified when
 * this was written: no agent prompt reads ordinary ticket comments
 * (`packages/harbormaster` reads only the reviewer's `reject` reason and the
 * close gate's own refusal comments into a maker's next attempt). So the
 * hint says the reply is saved to the ticket's history and that agents do not
 * read it yet, and names the path that DOES reach the agent: rejecting the
 * ticket on the board. Change this copy in the same commit that makes agents
 * read replies, and not before.
 */
export interface ChatComposerProps {
  /** Tickets the chat names, most recent first. */
  tickets: readonly string[];
  /** The selected ticket (already defaulted by the caller). */
  ticketId: string;
  onTicketChange: (ticketId: string) => void;
  /**
   * Sends the reply. Resolves with whether the chat could be reloaded
   * afterwards; rejects (with the server's reason) when nothing was saved.
   */
  onSend: (ticketId: string, body: string) => Promise<{ refreshed: boolean }>;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
}

type Status =
  | { state: 'idle' }
  | { state: 'empty' }
  | { state: 'sending'; ticketId: string }
  | { state: 'sent'; ticketId: string; refreshed: boolean }
  | { state: 'error'; ticketId: string; message: string };

export function ChatComposer({
  tickets,
  ticketId,
  onTicketChange,
  onSend,
  textareaRef,
}: ChatComposerProps) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<Status>({ state: 'idle' });
  const baseId = useId();
  const hintId = `${baseId}-hint`;
  const fieldId = `${baseId}-text`;
  const sending = status.state === 'sending';

  const send = (target: string = ticketId) => {
    if (sending) return;
    const body = text.trim();
    if (body === '') {
      setStatus({ state: 'empty' });
      textareaRef?.current?.focus();
      return;
    }
    setStatus({ state: 'sending', ticketId: target });
    onSend(target, body)
      .then(({ refreshed }) => {
        setText('');
        setStatus({ state: 'sent', ticketId: target, refreshed });
      })
      .catch((error: unknown) => {
        // The text stays in the box: a failed send must never cost the words.
        setStatus({
          state: 'error',
          ticketId: target,
          message: error instanceof Error ? error.message : 'Request failed',
        });
      });
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    send();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      send();
    }
  };

  return (
    <form
      className="chat-composer"
      data-testid="chat-composer"
      aria-label="Reply on a ticket"
      aria-busy={sending}
      onSubmit={onSubmit}
    >
      <label className="chat-composer__ticket">
        Ticket
        <select
          data-testid="chat-composer-ticket"
          value={ticketId}
          disabled={sending}
          onChange={(event) => onTicketChange(event.target.value)}
        >
          {tickets.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </label>
      <label className="chat-composer__field" htmlFor={fieldId}>
        Your reply on {ticketId}
      </label>
      <textarea
        id={fieldId}
        ref={textareaRef}
        className="chat-composer__text"
        data-testid="chat-composer-text"
        rows={3}
        value={text}
        aria-describedby={hintId}
        aria-invalid={status.state === 'empty' || undefined}
        onChange={(event) => {
          setText(event.target.value);
          if (status.state === 'empty' || status.state === 'sent') setStatus({ state: 'idle' });
        }}
        onKeyDown={onKeyDown}
      />
      <p id={hintId} className="chat-composer__hint" data-testid="chat-composer-hint">
        Saved to {ticketId}&apos;s history. Agents don&apos;t read replies yet — to send
        work back to an agent, reject the ticket on the board. Ctrl+Enter or ⌘+Enter
        sends.
      </p>
      {status.state === 'error' && (
        <div className="chat-composer__error" role="alert" data-testid="chat-composer-error">
          <span>
            Couldn&apos;t send your reply to {status.ticketId}: {status.message}
          </span>
          <button
            type="button"
            className="btn-secondary"
            data-testid="chat-composer-retry"
            onClick={() => send(status.ticketId)}
          >
            Retry
          </button>
        </div>
      )}
      <div className="chat-composer__actions">
        <p className="chat-composer__status" role="status" data-testid="chat-composer-status">
          {status.state === 'empty' && 'Write a reply before sending.'}
          {status.state === 'sending' && `Sending to ${status.ticketId}…`}
          {status.state === 'sent' &&
            (status.refreshed
              ? `Reply saved to ${status.ticketId}.`
              : `Reply saved to ${status.ticketId}. It appears here when the chat reloads.`)}
        </p>
        <button
          type="submit"
          className="btn-secondary"
          data-testid="chat-composer-send"
          disabled={sending}
        >
          {sending ? 'Sending…' : 'Send reply'}
        </button>
      </div>
    </form>
  );
}
