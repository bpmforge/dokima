/**
 * Board empty state copy (UX_SPEC §2b — write it, don't improvise).
 *
 * W10-56: this used to read "The board fills when Phase 3 design is
 * decomposed" with a button labelled "View current phase", and that button
 * navigated to the IMPROVEMENT PLAN screen — a different feature entirely,
 * which then reported "0 raw findings → 0 plan items" and explained itself in
 * terms of a nightly auto-verify the reader never asked about. Two wrong
 * things at once: a label promising a phase surface that does not exist, and a
 * destination that belongs to another workflow.
 *
 * What actually fills an empty board is describing the product (W10-54's
 * interview → blueprint → decomposition, reachable since W10-72), so the copy
 * now names that and the control goes there.
 */
export const BOARD_EMPTY_STATE = {
  message: 'The board fills once you describe your product and it is decomposed into tickets.',
  actionLabel: 'Describe your product',
} as const;
