/**
 * A move re-renders the card in a different column, which remounts it and
 * drops keyboard focus to <body>. The card that started the move leaves a
 * request here; the remounted card picks it up and takes focus back.
 */
let pending: string | null = null;

export function requestCardFocus(ticketId: string): void {
  pending = ticketId;
}

export function consumeCardFocus(ticketId: string): boolean {
  if (pending !== ticketId) return false;
  pending = null;
  return true;
}
