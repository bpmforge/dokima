/**
 * Mode registry — the lookup `getMode`/`macroLoopCapForMode` other modules
 * (the coverage loop, a future mode selector) use instead of importing all
 * four mode files directly. Mirrors `phases/topology.ts`'s `getPhase`/
 * `UnknownPhaseError` shape.
 */
import { FEATURE_MODE } from './feature.js';
import { IMPROVE_MODE } from './improve.js';
import { NEW_PRODUCT_MODE } from './new-product.js';
import { ONBOARD_MODE } from './onboard.js';
import type { ModeDefinition, ModeId } from './types.js';

export const MODES: readonly ModeDefinition[] = [
  NEW_PRODUCT_MODE,
  ONBOARD_MODE,
  FEATURE_MODE,
  IMPROVE_MODE,
];

export class UnknownModeError extends Error {
  constructor(id: string) {
    super(`no such mode: ${id}`);
    this.name = 'UnknownModeError';
  }
}

export function getMode(id: ModeId): ModeDefinition {
  const mode = MODES.find((m) => m.id === id);
  if (!mode) throw new UnknownModeError(id);
  return mode;
}

/** R-B5: 3 for New Product/Onboard, 2 for Feature/Improve. Reads the cap
 * live off `MODES` — never a second hard-coded switch that could drift
 * from the mode definitions themselves. */
export function macroLoopCapForMode(id: ModeId): 2 | 3 {
  return getMode(id).macroLoopCap;
}
