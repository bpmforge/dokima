/**
 * Mode topology types (BLUEPRINT §3.1 "Modes", FR-P5, US-106).
 *
 * This ticket's write_scope is `packages/pipeline/src/modes/**` only —
 * `packages/pipeline/package.json` is out of glob, the identical wall
 * `phases/types.ts` and `decompose/types.ts` already document. Nothing here
 * needs a cross-package import to work around it: `ModeStep` reuses
 * `../phases/types.js`'s `Deliverable` shape directly (same package, plain
 * relative import, not a workspace dependency) instead of duplicating it —
 * a mode step and a phase are both "one or more (id, producingRole) pairs".
 */
import type { Deliverable } from '../phases/types.js';

export type ModeId = 'new-product' | 'onboard' | 'feature' | 'improve';

export interface ModeStep {
  readonly id: string;
  readonly name: string;
  readonly deliverables: readonly Deliverable[];
}

export interface ModeDefinition {
  readonly id: ModeId;
  readonly name: string;
  /** RALPH_WIGGUM_LOOP macro coverage-loop cap (R-B5): 3 for New
   * Product/Onboard, 2 for Feature/Improve. */
  readonly macroLoopCap: 2 | 3;
  readonly steps: readonly ModeStep[];
}
