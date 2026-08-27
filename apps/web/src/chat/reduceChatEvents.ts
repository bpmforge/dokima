import type { ServerEnvelope } from '../lib/ws-client.js';
import {
  cardFromWireEvent,
  isThreadArchivedWire,
  isThreadOpenedWire,
  type Thread,
} from './types.js';

/**
 * Pure fold from a `chat:<project>` event stream (REST replay or WS deltas,
 * both `ServerEnvelope`-shaped) into `Thread[]` — the program thread first
 * (pinned, UX_SPEC §3), then agent threads in first-seen order. A card
 * whose `thread_id` names a thread not yet opened is dropped rather than
 * synthesizing a thread, since only `thread.opened` carries the `kind`/
 * `concern` needed to render it correctly.
 */
export function reduceChatEvents(events: readonly ServerEnvelope[]): Thread[] {
  const threads = new Map<string, Thread>();
  const order: string[] = [];

  for (const event of events) {
    if (event.type === 'thread.opened' && isThreadOpenedWire(event.data)) {
      const { id, kind, concern, sample } = event.data;
      if (!threads.has(id)) order.push(id);
      threads.set(id, {
        id,
        kind,
        concern,
        ...(sample ? { sample: true } : {}),
        archived: false,
        cards: threads.get(id)?.cards ?? [],
      });
      continue;
    }
    if (event.type === 'thread.archived' && isThreadArchivedWire(event.data)) {
      const thread = threads.get(event.data.id);
      if (thread) thread.archived = true;
      continue;
    }
    const card = cardFromWireEvent(event.type, event.data);
    if (!card) continue;
    threads.get(card.threadId)?.cards.push(card);
  }

  return order
    .map((id) => threads.get(id))
    .filter((thread): thread is Thread => thread !== undefined)
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'program' ? -1 : 1));
}
