import { useEffect, useState } from 'react';

/**
 * Same portal pattern as `App.tsx`'s `useChatPaneNode`, targeting the
 * ticket drawer (`data-testid="ticket-drawer"`,
 * `board/drawer/TicketDrawer.tsx` — outside this ticket's write_scope).
 * Re-queries whenever `openTicketId` changes: the drawer only exists in the
 * DOM while a ticket is open, and unlike the always-present pane nodes, it
 * mounts/unmounts on every open/close, so a mount-only query would go stale
 * the first time the drawer closes and reopens on a different ticket. This
 * is how the session-trace view stays "linked from ticket cards" (this
 * ticket's acceptance criterion) without editing
 * `Card.tsx`/`TicketDrawer.tsx`: a card click already opens the drawer
 * (App.tsx's existing behavior), and `DrawerTraceLink` portals a launcher
 * into it.
 */
export function useTicketDrawerNode(openTicketId: string | null): HTMLElement | null {
  const [node, setNode] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!openTicketId) {
      setNode(null);
      return;
    }
    setNode(document.querySelector<HTMLElement>('[data-testid="ticket-drawer"]'));
  }, [openTicketId]);
  return node;
}
