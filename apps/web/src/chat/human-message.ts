/**
 * A person's reply in the Chat pane (product-owner decision, 2026-10-15).
 *
 * Deliberately NOT one of UX_SPEC §3's four agent card types and carries no
 * `Provenance`: nobody's model wrote it and it cost nothing, so a provenance
 * line with a model and a cost chip would be a fabrication. The server emits
 * it as `message.human` (chat-projection.ts) only for `ticket.commented` rows
 * whose author's identity is `human` — the body cannot make a row read as a
 * person's.
 */
export interface HumanMessage {
  kind: 'human';
  id: string;
  threadId: string;
  author: string;
  ticketId: string;
  body: string;
  at: string;
}

interface HumanMessageWire {
  id: string;
  thread_id: string;
  author: string;
  ticket_id: string;
  body: string;
  at: string;
}

function isHumanMessageWire(data: unknown): data is HumanMessageWire {
  if (typeof data !== 'object' || data === null) return false;
  const c = data as Record<string, unknown>;
  return (
    typeof c.id === 'string' &&
    typeof c.thread_id === 'string' &&
    typeof c.author === 'string' &&
    typeof c.ticket_id === 'string' &&
    typeof c.body === 'string' &&
    typeof c.at === 'string'
  );
}

/** `message.human` → `HumanMessage`; anything else (or a malformed payload) → undefined. */
export function humanMessageFromWire(type: string, data: unknown): HumanMessage | undefined {
  if (type !== 'message.human' || !isHumanMessageWire(data)) return undefined;
  return {
    kind: 'human',
    id: data.id,
    threadId: data.thread_id,
    author: data.author,
    ticketId: data.ticket_id,
    body: data.body,
    at: data.at,
  };
}
