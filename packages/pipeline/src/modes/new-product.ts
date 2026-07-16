/**
 * Mode 1 — New Product: the full six-phase program (BLUEPRINT §3.2).
 * Reuses `../phases/topology.js`'s `PHASES` table verbatim rather than
 * re-declaring the phase→deliverable→role mapping a second time — that
 * table is `phases/`'s ticket to own (W5-01), this module only wraps it in
 * the `ModeDefinition` shape so mode-generic code (the macro coverage loop,
 * a future mode selector) never has to special-case "new-product means
 * PHASES".
 */
import { PHASES } from '../phases/topology.js';
import type { ModeDefinition, ModeStep } from './types.js';

export const NEW_PRODUCT_STEPS: readonly ModeStep[] = PHASES.map((phase) => ({
  id: `phase-${phase.id}`,
  name: phase.name,
  deliverables: phase.deliverables,
}));

export const NEW_PRODUCT_MODE: ModeDefinition = {
  id: 'new-product',
  name: 'New Product',
  macroLoopCap: 3,
  steps: NEW_PRODUCT_STEPS,
};
