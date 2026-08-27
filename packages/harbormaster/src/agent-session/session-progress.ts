/**
 * session-progress.ts — the tool-turn budget that earns itself (W17-01).
 *
 * The fixed per-session iteration count conflated two opposite conditions:
 * a local model converging slowly (honest work, cut off mid-stride — the
 * 2026-08-21 live UAT parked two real tickets this way) and a model
 * spinning (which deserved to stop BEFORE the cap, not at it). This
 * chapter separates them with CODE-OBSERVED signals only:
 *
 *   progress   = a mutation tool call (write/edit/commit) that did not come
 *                back refused, or a verify exit strictly better than the
 *                best seen this session;
 *   spinning   = the same tool call (name + exact arguments) repeated
 *                REPEATED_CALL_LIMIT times consecutively, OR (W21-10) a
 *                non-mutation call whose name, arguments AND RESULT are
 *                byte-identical to earlier calls in this session, seen
 *                REPEATED_RESULT_LIMIT times in total.
 *
 * A window of turns containing progress extends the budget by one window,
 * never past the ceiling; a spin stops the session early with the reason
 * stated. The ceiling itself NEVER moves — it is T-27's runaway guard, and
 * the whole point of this design is that generosity lives between the
 * default and the ceiling, not above it.
 *
 * Model self-report is not a signal anywhere here (C-2): a model that
 * "feels close" earns nothing by saying so. Calibration shrinks the
 * STARTING budget for a maker with an over-claiming record (FR-L3's
 * asymmetry — downward only); that adjustment is the composing caller's
 * job (`run-build-spawn.ts`), because harbormaster may not import memory.
 */

/** Consecutive identical tool calls that count as spinning. */
export const REPEATED_CALL_LIMIT = 3;

/**
 * W21-10: total (not consecutive) zero-information repeats that count as
 * spinning.
 *
 * Found in live UAT: an agent finished the work, committed it, then called
 * `list` with identical arguments and got an identical result three times —
 * with a single `verify` interleaved between the second and third. The
 * consecutive counter reset on that one call, the guard never fired, and the
 * session burned the budget it had just earned and parked with no manifest.
 *
 * Consecutiveness is the wrong proxy. The behaviour worth stopping is "this
 * session keeps asking a question it already has the answer to", and one
 * interleaved call was enough to hide it. Two conditions keep the cumulative
 * version safe rather than trigger-happy:
 *
 *   - the RESULT must be identical too. If the result changed, the call
 *     learned something and must not count, however often it was made.
 *   - mutations are excluded. A repeated `write` is a retry, and mutations
 *     already earn budget as progress — counting them would punish the
 *     signal the rest of this module rewards.
 */
export const REPEATED_RESULT_LIMIT = 3;
export const DEFAULT_PROGRESS_WINDOW = 4;

const MUTATION_TOOLS = new Set(['write', 'edit', 'commit']);

/** Field separator for call fingerprints — never appears in a tool name. */
const SEP = '\u0000';

export interface SessionProgressOptions {
  /** Starting budget — the (possibly calibration-shrunk) default. */
  readonly base: number;
  /** T-27's absolute cap. Never exceeded, never moved. */
  readonly ceiling: number;
  readonly windowSize?: number;
}

export interface ProgressToolCall {
  readonly name: string;
  /** The call's raw arguments JSON — the identity half of the spin check. */
  readonly argsJson: string;
  /** The rendered TOOL_RESULT line — a refusal carries a "reason" field. */
  readonly resultText: string;
}

export type BudgetLedgerEntry =
  | {
      readonly kind: 'extended';
      readonly atIteration: number;
      readonly to: number;
      readonly signal: string;
    }
  | {
      readonly kind: 'stopped_early';
      readonly atIteration: number;
      readonly reason: string;
    };

export interface SessionProgressBudget {
  /** The current budget — grows only at window boundaries, only with progress, only to the ceiling. */
  budget(): number;
  /** Record one completed iteration's observable outcomes. */
  noteIteration(input: {
    readonly iteration: number;
    readonly toolCalls: readonly ProgressToolCall[];
    /** Parsed verify exit when this iteration ran verify; null/undefined otherwise. */
    readonly verifyExit?: number | null;
  }): void;
  /** Non-null when the session should stop now — spinning, stated. */
  earlyStop(): { readonly reason: string } | null;
  /** Every extension and early stop, for the ledger and the park evidence. */
  entries(): readonly BudgetLedgerEntry[];
  /**
   * W21-53: the progress signal from the LAST COMPLETED WINDOW, or null when
   * that window contained none. Already computed per window — it was simply
   * discarded at each boundary. It is what separates a session cut off
   * mid-stride from one that stalled with budget still to spend.
   */
  lastWindowProgress(): string | null;
}

function looksRefused(resultText: string): boolean {
  return resultText.includes('"reason"') || resultText.includes('"error"');
}

export function createSessionProgressBudget(
  options: SessionProgressOptions,
): SessionProgressBudget {
  const windowSize = options.windowSize ?? DEFAULT_PROGRESS_WINDOW;
  const ceiling = Math.max(1, Math.trunc(options.ceiling));
  let budget = Math.min(Math.max(1, Math.trunc(options.base)), ceiling);

  let windowSignal: string | null = null;
  let bestVerifyExit: number | null = null;
  let lastCallFingerprint: string | null = null;
  let identicalRun = 0;
  /** name+args+result -> how many times this exact zero-information call was made. */
  const zeroInformationCalls = new Map<string, number>();
  let stop: { reason: string } | null = null;
  let lastWindowSignal: string | null = null;
  const entries: BudgetLedgerEntry[] = [];

  return {
    budget: () => budget,
    earlyStop: () => stop,
    entries: () => entries.slice(),
    lastWindowProgress: () => lastWindowSignal,
    noteIteration({ iteration, toolCalls, verifyExit }) {
      for (const call of toolCalls) {
        // W21-10: the RESULT is part of the identity. A call repeated with the
        // same arguments but a DIFFERENT answer learned something — the world
        // moved underneath it — and stopping there was a false positive.
        const fingerprint = [call.name, call.argsJson, call.resultText].join(SEP);
        identicalRun = fingerprint === lastCallFingerprint ? identicalRun + 1 : 1;
        lastCallFingerprint = fingerprint;
        if (identicalRun >= REPEATED_CALL_LIMIT && !stop) {
          stop = {
            reason:
              `the same ${call.name} call was repeated ${identicalRun} times in a row ` +
              `with identical arguments — no progress is being made`,
          };
          entries.push({
            kind: 'stopped_early',
            atIteration: iteration,
            reason: stop.reason,
          });
        }
        // W21-10: the cumulative check. Same call, same answer, already seen —
        // interleaving something else between the repeats does not make it
        // progress.
        if (!MUTATION_TOOLS.has(call.name)) {
          // `fingerprint` already carries name + args + result.
          const seen = (zeroInformationCalls.get(fingerprint) ?? 0) + 1;
          zeroInformationCalls.set(fingerprint, seen);
          if (seen >= REPEATED_RESULT_LIMIT && !stop) {
            stop = {
              reason:
                `the same ${call.name} call was made ${seen} times with identical ` +
                `arguments and returned an identical result each time — the session ` +
                `is asking a question it already has the answer to`,
            };
            entries.push({
              kind: 'stopped_early',
              atIteration: iteration,
              reason: stop.reason,
            });
          }
        }

        if (MUTATION_TOOLS.has(call.name) && !looksRefused(call.resultText)) {
          windowSignal ??= `${call.name} changed the worktree`;
        }
      }
      if (verifyExit !== undefined && verifyExit !== null) {
        if (bestVerifyExit === null || verifyExit < bestVerifyExit) {
          if (bestVerifyExit !== null || verifyExit === 0) {
            windowSignal ??= `verify improved to exit ${verifyExit}`;
          }
          bestVerifyExit = verifyExit;
        }
      }

      // Window boundary: progress earns exactly one more window, and only
      // when the session would otherwise run out before finishing another
      // one — generosity exactly at the wall, never banked up front.
      if (iteration % windowSize === 0) {
        if (
          windowSignal !== null &&
          budget < ceiling &&
          iteration + windowSize > budget
        ) {
          budget = Math.min(budget + windowSize, ceiling);
          entries.push({
            kind: 'extended',
            atIteration: iteration,
            to: budget,
            signal: windowSignal,
          });
        }
        // W21-53: remembered BEFORE the reset. A window that produced a
        // signal but no extension (because the budget had room) is still a
        // window in which the session made progress.
        lastWindowSignal = windowSignal;
        windowSignal = null;
      }
    },
  };
}

/** The session's stderr when the (possibly extended) budget ran out — names the final budget and how it got there, and keeps the raise-the-setting advice. */
export function budgetExhaustedStderr(
  finalBudget: number,
  entries: readonly BudgetLedgerEntry[],
  /** W21-53: the last completed window's progress signal, when the caller has one. */
  lastWindowProgress: string | null = null,
): string {
  const extensions = entries.filter((e) => e.kind === 'extended');
  const earned =
    extensions.length > 0
      ? ` (started lower and earned ${extensions.length} extension(s) from real progress)`
      : '';
  /**
   * W21-16: the advice used to be unconditional, and was WRONG in the case it
   * fired most. The live UAT parked a session that had just earned an
   * extension and still had headroom left — and the evidence told the founder
   * to raise the ceiling. Advice that is wrong in its own commonest case
   * teaches people to stop reading the evidence.
   *
   * The budget was only the binding constraint if it never grew. If it did
   * grow, the session had room and did not use it, and more ceiling buys more
   * of whatever it was doing instead of finishing.
   */
  /**
   * W21-53: W21-16 fixed advice that was wrong in one case and left it wrong
   * in the opposite one. Its branch — "you earned budget and still did not
   * finish, so more ceiling buys more of whatever you did instead" — is right
   * for a session that earns a few extensions early and then STALLS.
   *
   * It is exactly backwards for a session still working at the wall. Run 34
   * did that twice: extensions at iterations 16, 20, 24, 28, 32 and 36, every
   * window boundary to the ceiling, each signalled "write changed the
   * worktree" — and it was told raising the cap would not help. That is the
   * failure W17-01's own header exists to prevent: "honest work, cut off
   * mid-stride".
   *
   * The separator is the LAST COMPLETED WINDOW, and it needed no new judgement
   * — only for the per-window signal to stop being thrown away. Still making
   * progress in the final window means the CEILING stopped it. Nothing in the
   * final window means it stalled and had budget it did not use.
   *
   * An earlier attempt at this reasoned from the EXTENSIONS instead and had to
   * be reverted: extensions are only ever granted at the wall (the code
   * requires `iteration + windowSize > budget`), so every extension is a
   * final-window extension by construction and a single one is trivially
   * "unbroken". The extension ledger cannot answer this question; the window
   * signal can.
   */
  const advice =
    extensions.length === 0
      ? ` If the work was real but unfinished, raise maxToolIterations — chatty ` +
        `local models often need more than the default.`
      : lastWindowProgress
        ? ` It was STILL MAKING PROGRESS in its final window (${lastWindowProgress}), ` +
          `so the ceiling is what stopped it rather than a lack of progress — this ` +
          `is work cut off mid-stride, and raising maxToolIterations is the right ` +
          `response.`
        : ` This session EARNED more budget from real progress, then stopped making ` +
          `it before the end, so raising maxToolIterations will not help — the ` +
          `evidence to read is what it spent those turns on.`;
  return (
    `agent session stopped: exceeded the per-session tool-iteration budget ` +
    `(${finalBudget}${earned}) without a Completion Manifest (T-27).${advice}`
  );
}

/** The session's stderr for a no-progress early stop — spinning is stated, never billed to the numeric cap. */
export function earlyStopStderr(iteration: number, reason: string): string {
  return (
    `agent session stopped early at turn ${iteration}: ${reason}. ` +
    `Stopping now rather than spending the remaining budget on the same loop (T-27).`
  );
}

/**
 * W17-03: the measured turns observation one session leaves behind — the
 * raw material for a per-model starting-budget multiplier. Appended by
 * gateway-session at each session ending; read back by the composing
 * caller (run-build-spawn) when sizing the NEXT session's base. Mechanical
 * throughout: real turn counts from real sessions, never a guess.
 */
export interface TurnsObservation {
  readonly model: string;
  readonly turns: number;
  /** True when the session ended by answering (a manifest attempt), false on a budget stop. */
  readonly completed: boolean;
}

/**
 * The multiplier a model has EARNED from history: the mean turns its
 * completed sessions actually needed, over the default. Fewer than
 * `minSamples` completed sessions = 1 (never a guess); clamped [1, 2.5] —
 * a multiplier below 1 would shrink on fitness grounds, which is
 * calibration's job, not this profile's.
 */
export function measuredTurnsMultiplier(
  observations: readonly TurnsObservation[],
  defaultBudget: number,
  minSamples = 3,
): { readonly multiplier: number; readonly samples: number } {
  const completed = observations.filter((o) => o.completed && o.turns > 0);
  if (completed.length < minSamples) {
    return { multiplier: 1, samples: completed.length };
  }
  const mean = completed.reduce((a, o) => a + o.turns, 0) / completed.length;
  const multiplier = Math.min(2.5, Math.max(1, mean / defaultBudget));
  return { multiplier: Number(multiplier.toFixed(2)), samples: completed.length };
}
