/**
 * Extracts a ticket id from a click that bubbled up from a `board-card`
 * (data-testid `card-{id}`, set by `board/Card.tsx` — outside this
 * ticket's write_scope). Event delegation on the portaled subtree is the
 * only way to hook a card click without editing `Card.tsx`/`BoardView.tsx`
 * directly, same "stop touching that file" discipline as this module's
 * other pane portals. Clicks on the card's own controls (the move menu, Move,
 * retry) are ignored so opening the drawer never fights them.
 */
export function ticketIdFromCardClick(
  event: React.MouseEvent<HTMLElement>,
): string | null {
  const target = event.target as HTMLElement;
  // Controls inside the card act for themselves; only the title button and
  // the card body open the drawer.
  if (target.closest('select, label, button:not(.board-card__open)')) return null;
  const card = target.closest<HTMLElement>('[data-testid^="card-"]');
  if (!card) return null;
  const testId = card.getAttribute('data-testid');
  return testId ? testId.slice('card-'.length) : null;
}
