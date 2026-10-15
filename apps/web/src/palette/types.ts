/**
 * Command palette result/mode types (UX_SPEC §2a: "jump to tickets/docs/
 * receipts, fire verbs, mode picker"). Kept local to `palette/**` rather
 * than importing board/artifacts' own row types verbatim — the palette
 * only needs id/title/path-shaped projections of each, not their full wire
 * contract.
 */

export type PaletteResultKind = 'ticket' | 'doc' | 'receipt' | 'nav';

export interface PaletteTicketResult {
  kind: 'ticket';
  id: string;
  title: string;
  status: string;
  lane: string;
}

export interface PaletteDocResult {
  kind: 'doc';
  path: string;
  title: string;
}

export interface PaletteReceiptResult {
  kind: 'receipt';
  id: string;
  title: string;
}

/** Screens the palette can send you to. Mirrors the header's destinations without importing `App/` (the palette must not depend on the shell that mounts it). */
export type PaletteView =
  | 'team'
  | 'interview'
  | 'plans'
  | 'decisions'
  | 'lessons'
  | 'roster'
  | 'notifications'
  | 'settings';

export type PaletteNavTarget =
  | { kind: 'fleet' }
  | { kind: 'board' }
  | { kind: 'view'; view: PaletteView }
  | { kind: 'project'; projectId: string };

/** A navigation entry: a screen to go to, or a project to open. */
export interface PaletteNavResult {
  kind: 'nav';
  id: string;
  title: string;
  target: PaletteNavTarget;
}

export type PaletteResult =
  PaletteTicketResult | PaletteDocResult | PaletteReceiptResult | PaletteNavResult;

/** UX_SPEC §2a: "'What are we doing today?' mode picker (New project / Onboard / Feature / Improve)". */
export type PaletteMode = 'new' | 'onboard' | 'feature' | 'improve';

export const PALETTE_MODES: readonly { mode: PaletteMode; label: string }[] = [
  { mode: 'new', label: 'New project' },
  { mode: 'onboard', label: 'Onboard existing repo' },
  { mode: 'feature', label: 'Feature' },
  { mode: 'improve', label: 'Improve' },
];
