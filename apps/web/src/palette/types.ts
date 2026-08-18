/**
 * Command palette result/mode types (UX_SPEC §2a: "jump to tickets/docs/
 * receipts, fire verbs, mode picker"). Kept local to `palette/**` rather
 * than importing board/artifacts' own row types verbatim — the palette
 * only needs id/title/path-shaped projections of each, not their full wire
 * contract.
 */

export type PaletteResultKind = 'ticket' | 'doc' | 'receipt';

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

export type PaletteResult = PaletteTicketResult | PaletteDocResult | PaletteReceiptResult;

/** UX_SPEC §2a: "'What are we doing today?' mode picker (New project / Onboard / Feature / Improve)". */
export type PaletteMode = 'new' | 'onboard' | 'feature' | 'improve';

export const PALETTE_MODES: readonly { mode: PaletteMode; label: string }[] = [
  { mode: 'new', label: 'New project' },
  { mode: 'onboard', label: 'Onboard existing repo' },
  { mode: 'feature', label: 'Feature' },
  { mode: 'improve', label: 'Improve' },
];
