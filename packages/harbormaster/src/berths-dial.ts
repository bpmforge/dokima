/**
 * Concurrency dial resolution (BLUEPRINT §5/§12, D-010, FR-H5, FR-S1):
 * "berths 1–N" is a project setting like any other under the three-scope
 * system (`@dokima/shared`'s `run > project > global` precedence,
 * D-012) — a run's berth count is just the effective value of the
 * `berths` key, with the run scope acting as the per-run override
 * (`ScopedSettings.run`, e.g. a CLI `--berths` flag or the UI's run
 * slider). No new precedence rule is invented here.
 *
 * `resolveAutorunBreakpoint` is the other half of BLUEPRINT §5's "one
 * toggle + one slider": Autorun is not a stored field of its own — it is
 * the UI's name for forcing `breakpoint: 'never'` while leaving the
 * berths slider free to move. Turning Autorun off restores whatever
 * breakpoint mode was otherwise selected (defaulting to `'ticket'`, the
 * most conservative mode, when none was).
 */

import { resolveEffectiveValue, type ScopedSettings } from '@dokima/shared';
import type { BreakpointMode } from './breakpoints-types.js';

export const BERTHS_SETTINGS_KEY = 'berths';

/** BLUEPRINT §5: "Berths=1 is strict sequential" — the safe default absent any scope's setting. */
export const DEFAULT_BERTHS = 1;

export interface ResolveBerthCountOptions {
  /** Global/project/run scopes to resolve `berths` from (D-012). Populate `.run.berths` for a run-level override — no separate override parameter exists because the run scope already IS the override. */
  readonly settings?: ScopedSettings;
}

/** Effective berth count for a run: highest-precedence scope that defines `berths`, clamped to >=1 (a non-positive or fractional dial value is a config error, not a refusal — floor it to the nearest sane sequential run). */
export function resolveBerthCount(options: ResolveBerthCountOptions = {}): number {
  const resolved = options.settings
    ? resolveEffectiveValue(BERTHS_SETTINGS_KEY, options.settings)
    : undefined;
  const value = typeof resolved?.value === 'number' ? resolved.value : DEFAULT_BERTHS;
  return Math.max(1, Math.trunc(value));
}

export interface AutorunToggle {
  readonly autorun: boolean;
  readonly berths: number;
  /** Explicit breakpoint mode when Autorun is off; ignored (forced to `'never'`) when Autorun is on. Defaults to `'ticket'` (BLUEPRINT §3.6's most conservative mode) when omitted. */
  readonly breakpoint?: BreakpointMode;
}

export interface ResolvedRunConcurrency {
  readonly breakpoint: BreakpointMode;
  readonly berths: number;
}

/** BLUEPRINT §5 "Autorun = breakpoint never × berths N": one toggle (Autorun) plus one slider (berths), composed into the pair `createRun` actually stores. */
export function resolveAutorunBreakpoint(toggle: AutorunToggle): ResolvedRunConcurrency {
  return {
    breakpoint: toggle.autorun ? 'never' : (toggle.breakpoint ?? 'ticket'),
    berths: toggle.berths,
  };
}
