import type { HumanMessage } from './human-message.js';

/**
 * A person's reply in the feed. Visibly NOT an agent card: no kind header,
 * no model, no cost — an author, the ticket it was left on, and the words.
 * Rendered as plain text (React escapes it); the body is never HTML.
 */
export function HumanMessageItem({ message }: { message: HumanMessage }) {
  return (
    <article
      className="chat-human"
      data-testid={`chat-human-${message.id}`}
      data-kind="human"
      aria-label={`Reply from ${message.author} on ${message.ticketId}`}
    >
      <header className="chat-human__meta">
        <span className="chat-human__author" data-testid="chat-human-author">
          {message.author}
        </span>
        <span className="chat-human__ticket" data-testid="chat-human-ticket">
          on {message.ticketId}
        </span>
        <time className="chat-human__time" dateTime={message.at}>
          {formatTime(message.at)}
        </time>
      </header>
      <p className="chat-human__body" data-testid="chat-human-body">
        {message.body}
      </p>
    </article>
  );
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
