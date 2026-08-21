/**
 * The session-budget sizing chain — chapter of `run-build-spawn.ts`, split
 * when W19-02's extraction pushed it past the 400-line cap. One pure-ish
 * pipeline: measured multiplier (W17-03) → T-27 ceiling clamp → calibration
 * shrink-only (W17-01, FR-L3), with the profile ledgered when it moved.
 */
import { appendEvent, listEvents, type EventLog } from '@dokima/events';
import {
  DEFAULT_MAX_TOOL_ITERATIONS,
  measuredTurnsMultiplier,
  type TurnsObservation,
} from '@dokima/harbormaster';
import { getCalibration } from '@dokima/memory';
import { MAX_TOOL_ITERATIONS_CEILING } from './run-build-policy.js';

/**
 * W17-01 (FR-L3, downward only): a maker whose calibration record shows a
 * real over-claiming history starts with a SMALLER budget — it earns the
 * rest back through observable progress. Never enlarges, never guesses:
 * no record or too few samples leaves the base untouched.
 */
/** W17-03: the model's recorded turn history, replayed from the append-only log. */
export function turnsObservationsFor(
  log: EventLog,
  model: string,
): TurnsObservation[] {
  const out: TurnsObservation[] = [];
  for (const event of listEvents(log)) {
    if (event.eventType !== 'session.turns_observed') continue;
    const payload = event.payload as TurnsObservation;
    if (payload.model === model) out.push(payload);
  }
  return out.slice(-25);
}

/**
 * W19-02: the whole sizing chain, callable — measured multiplier over the
 * model's real completed sessions (a raised-budget retry that CLOSES is
 * exactly such a sample, so the loop learns from it), clamped to the T-27
 * ceiling, then calibration shrinks only (FR-L3). Parks never count: the
 * multiplier reads completed sessions alone, so re-parking cannot inflate
 * the start. Emits session.budget_profile naming the samples it used.
 */
export function sizedBaseIterations(
  log: EventLog,
  model: string,
  opts: { userBase?: number; actorId: string; runId: string },
): number {
  const base = opts.userBase ?? DEFAULT_MAX_TOOL_ITERATIONS;
  const profile = measuredTurnsMultiplier(
    turnsObservationsFor(log, model),
    DEFAULT_MAX_TOOL_ITERATIONS,
  );
  const profiled = Math.min(
    Math.ceil(base * profile.multiplier),
    MAX_TOOL_ITERATIONS_CEILING,
  );
  const calibrated = calibratedBaseIterations(
    profiled,
    getCalibration(log.db, model, 'coding-agent') ?? undefined,
  );
  if (profile.multiplier !== 1) {
    appendEvent(log, {
      eventType: 'session.budget_profile',
      actorId: opts.actorId,
      runId: opts.runId,
      payload: {
        model,
        multiplier: profile.multiplier,
        samples: profile.samples,
        base: calibrated,
      },
    });
  }
  return calibrated;
}

export function calibratedBaseIterations(
  base: number,
  record: { readonly bias: number; readonly sampleCount: number } | undefined,
): number {
  if (!record || record.bias <= 0) return base;
  const shrunk = Math.floor(base * (1 - Math.min(record.bias, 0.5)));
  return Math.max(4, Math.min(shrunk, base));
}
