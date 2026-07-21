import { createPortal } from 'react-dom';
import { useTicketDrawerNode } from './useTicketDrawerNode.js';

export interface DrawerTraceLinkProps {
  ticketId: string | null;
  onOpenTrace: (ticketId: string) => void;
}

/** Portals a "session trace" launcher into the open ticket drawer — see `useTicketDrawerNode`. */
export function DrawerTraceLink({ ticketId, onOpenTrace }: DrawerTraceLinkProps) {
  const node = useTicketDrawerNode(ticketId);
  if (!node || !ticketId) return null;
  return createPortal(
    <button
      type="button"
      className="app-shell__open-trace"
      data-testid="open-session-trace"
      onClick={() => onOpenTrace(ticketId)}
    >
      Open full session trace →
    </button>,
    node,
  );
}
