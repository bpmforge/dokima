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
 * W21-95: and then the corrected copy — "The board fills once you describe
 * your idea and it is broken into tickets" — was false for a different reader.
 * Onboarding a real repository produced a workspace BYTE-IDENTICAL to New
 * project on an empty folder, so someone who had just pointed Dokima at fifty
 * thousand lines of their own code was told the way in was to describe an
 * idea. The board could have been filled FROM that code: `runOnboardAnalysis`
 * gathers repo context, dispatches the analysis and proposes plan items, and
 * has been reachable over HTTP the whole time. The button existed, the
 * machinery existed, and nothing connected them.
 *
 * So the copy now names BOTH ways in and admits which one has not happened
 * yet. It says this for every project rather than only for onboarded ones,
 * deliberately: nothing persists which button created a project (W22-22), and
 * the sentence is true either way — an empty board can be filled from an idea
 * or from code, and Dokima has read neither until it is told to.
 */
export const BOARD_EMPTY_STATE = {
  message:
    'The board is empty. It fills either from a product you describe, or from ' +
    'code that is already here — Dokima has not read this folder yet.',
  actionLabel: 'Describe your product',
  /** The other way in: the analysis the product already has (W21-95). */
  analyseLabel: 'Analyse this repository',
  analysingLabel: 'Reading the repository…',
} as const;
