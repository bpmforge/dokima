/**
 * Macro coverage loop (RALPH_WIGGUM_LOOP.md, R-B5) — the mode-level
 * INVENTORY -> DISCOVER -> VERIFY -> GAP -> REPEAT loop, as distinct from
 * `@shipwright/loop`'s per-item micro-loop (FR-L1, `runMicroLoop`) which
 * this package cannot import (package.json is out of write_scope, the wall
 * `phases/types.ts` documents). `computeGapChecksum` is therefore a local
 * port of `micro-loop.ts`'s function of the same name and behavior
 * (deterministic, order-independent sha256 over the gap set) rather than an
 * import — same shape, different level (a row set here, a single item's
 * gap list there).
 *
 * `runCoverageLoop` takes an explicit `cap` so it stays mode-agnostic and
 * unit-testable in isolation; `runCoverageLoopForMode` is the AC2-load-
 * bearing wrapper that actually reads the cap off the mode via
 * `macroLoopCapForMode` — proving the mode-aware cap and the loop are wired
 * together, not two independent facts.
 */
import { createHash } from 'node:crypto';
import { macroLoopCapForMode } from './registry.js';
import type { ModeId } from './types.js';

export interface CoverageRow {
  readonly id: string;
  readonly category: string;
  readonly description: string;
}

export interface CoverageLoopDeps {
  /** DISCOVER: produce the artifact for every row in `rows` (GAP step:
   * only the previously-uncovered rows after pass 1). */
  discoverRows(rows: readonly CoverageRow[]): void | Promise<void>;
  /** VERIFY: the rows still uncovered after the latest DISCOVER call. */
  verifyCoverage(): readonly CoverageRow[] | Promise<readonly CoverageRow[]>;
}

export interface CoverageLoopIterationRecord {
  readonly iteration: number;
  readonly attempted: readonly CoverageRow[];
  readonly uncovered: readonly CoverageRow[];
  /** null once `uncovered` is empty — nothing left to checksum. */
  readonly gapChecksum: string | null;
}

export type CoverageLoopStatus = 'covered' | 'cap-exhausted' | 'no-progress';

export interface CoverageLoopResult {
  readonly status: CoverageLoopStatus;
  readonly iterations: readonly CoverageLoopIterationRecord[];
  readonly remainingGaps: readonly CoverageRow[];
}

/** Deterministic checksum over a gap row set, order-independent — local
 * port of `@shipwright/loop`'s `computeGapChecksum` (see module header). */
export function computeGapChecksum(rows: readonly CoverageRow[]): string {
  const normalized = rows
    .map((row) => `${row.id}\x00${row.category}\x00${row.description}`)
    .sort()
    .join('\x01');
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/**
 * Runs the macro coverage loop against `inventory` for up to `cap`
 * iterations. Byte-identical gap-set early-halt (RALPH_WIGGUM_LOOP.md step
 * 5): if two consecutive VERIFY passes report the exact same uncovered set,
 * the loop halts as `no-progress` immediately rather than burning the
 * remaining cap on rows that provably aren't converging.
 */
export async function runCoverageLoop(
  inventory: readonly CoverageRow[],
  deps: CoverageLoopDeps,
  cap: number,
): Promise<CoverageLoopResult> {
  if (!Number.isInteger(cap) || cap < 1) {
    throw new RangeError(`cap must be a positive integer, got ${cap}`);
  }

  const iterations: CoverageLoopIterationRecord[] = [];
  let pending = inventory;
  let priorChecksum: string | null = null;

  for (let iteration = 1; iteration <= cap; iteration += 1) {
    await deps.discoverRows(pending);
    const uncovered = await deps.verifyCoverage();

    if (uncovered.length === 0) {
      iterations.push({ iteration, attempted: pending, uncovered, gapChecksum: null });
      return { status: 'covered', iterations, remainingGaps: [] };
    }

    const gapChecksum = computeGapChecksum(uncovered);
    iterations.push({ iteration, attempted: pending, uncovered, gapChecksum });

    if (gapChecksum === priorChecksum) {
      return { status: 'no-progress', iterations, remainingGaps: uncovered };
    }

    priorChecksum = gapChecksum;
    pending = uncovered;
  }

  const lastIteration = iterations[iterations.length - 1];
  return {
    status: 'cap-exhausted',
    iterations,
    remainingGaps: lastIteration ? lastIteration.uncovered : [],
  };
}

/** Mode-aware entry point (R-B5): reads the cap off `mode` via
 * `macroLoopCapForMode` instead of taking one as a parameter, so a mode's
 * declared cap and the loop that enforces it can never drift apart. */
export function runCoverageLoopForMode(
  mode: ModeId,
  inventory: readonly CoverageRow[],
  deps: CoverageLoopDeps,
): Promise<CoverageLoopResult> {
  return runCoverageLoop(inventory, deps, macroLoopCapForMode(mode));
}
