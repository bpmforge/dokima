/** `?ticket=` — which ticket's session trace `view=trace` is replaying (BLUEPRINT §12.4). */
export function readTraceTicketId(): string | null {
  return new URLSearchParams(window.location.search).get('ticket');
}

/** Pushes `?view=trace&ticket=<id>` (BLUEPRINT §12.4) — App.tsx still owns the `setView('trace')` state transition. */
export function pushTraceViewUrl(ticketId: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('view', 'trace');
  url.searchParams.set('ticket', ticketId);
  window.history.pushState({}, '', url);
}
