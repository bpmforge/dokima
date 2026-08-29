import type { FinishReason } from '@dokima/gateway';
import type { SpawnSessionOutput } from '@dokima/loop';
import { checkWatchdogBreach } from '../watchdog.js';

/**
 * session-limits.ts — the bounds that stop a session, and what they say.
 *
 * Chapter of `gateway-session.ts`, split at the 400-line CODE_BOOK_PROTOCOL
 * cap (W13-44). The seam is real: each of these answers "should this session
 * stop, and how do I explain that to a person", while what they were
 * extracted from is the turn loop that asks.
 *
 * Both return a `SpawnSessionOutput` rather than throwing, because a stop is
 * not an error — it is a session ending with an explanation. W13-41 puts that
 * explanation in the park comment, which is the only thing an operator reads
 * after a ticket fails.
 */

/**
 * The ceiling on ONE turn's output (W13-43).
 *
 * Every turn was unbounded until a local model entered a generation loop and
 * streamed for as long as the run was left going: `lsof` showed a live
 * connection, LM Studio sat at 160% CPU, our process at 0.7%. Nothing could
 * stop it — W13-15 deliberately replaced duration bounds with an IDLE bound,
 * which is correct for a model generating slowly and useless against one that
 * never stops, because every token resets the timer.
 *
 * SIZED FROM MEASURED TURNS, not guessed: across 166 real turns on this
 * board the median was 60 completion tokens, p95 was 438, and the largest
 * legitimate turn — a model writing a whole file — was 6,646. 32k is roughly
 * five times that, so honest work never meets it. A ceiling tight enough to
 * clip a real turn would be worse than the hang: it would truncate the
 * Completion Manifest every time and read as model incompetence.
 */
export const DEFAULT_MAX_TURN_TOKENS = 32_000;

/**
 * The wall-clock ceiling on ONE session (W13-44).
 *
 * The watchdog this uses — `checkWatchdogBreach` — has been built and tested
 * in this package since FR-H2 and had NEVER RUN. Its only non-test mention in
 * the repo was a comment, and `runWatchdogSession` was absent from the shipped
 * bundle entirely. Its own module header says why: it was left as "the drop-in
 * unit a future ticket composes into the claim/land loops", and that ticket
 * was never filed. Meanwhile W13-42 and W13-43 were both written because a
 * session ran forever.
 *
 * This is the LAST backstop, not the first. Everything tighter already fires
 * before it: the 60s stream idle abort (W13-15), the queue-wait bound
 * (W13-42), the per-turn output ceiling (W13-43), and the tool-iteration cap.
 * It exists for the case none of those can see — a session making steady,
 * legitimate-looking progress that simply never finishes.
 *
 * SIZED FROM MEASURED SESSIONS: attempts on this board ran roughly three
 * minutes each, so thirty minutes is about ten times a real session. A
 * backstop set near the honest duration would kill slow local hardware doing
 * genuine work, which is the mistake W13-15 exists to prevent.
 */
export const DEFAULT_MAX_SESSION_SECONDS = 1_800;

export interface WatchdogStopInput {
  /** 0 disables the bound. */
  readonly maxSessionSeconds: number;
  readonly startedAtMs: number;
  readonly nowMs: number;
  readonly iteration: number;
  readonly maxIterations: number;
}

/**
 * The watchdog, checked COOPERATIVELY at a turn boundary (W13-44).
 *
 * The predicate behind it — `checkWatchdogBreach` — had been built and tested
 * in this package since FR-H2 and had never run: its only non-test mention in
 * the repo was a comment, and `runWatchdogSession` was absent from the shipped
 * bundle. Meanwhile W13-42 and W13-43 were both written because a session ran
 * forever.
 *
 * Deliberately not a `Promise.race` against the session. An in-process session
 * cannot be cancelled from outside, so a race abandons one that keeps taking
 * turns, keeps spending against a ticket the loop has already given up on, and
 * keeps writing into the worktree after the close gate ran — a durable change
 * with no receipt behind it (Law 4). Checking here stops the work rather than
 * stopping the waiting.
 *
 * `heartbeatStallSeconds` equals the wall-clock ceiling because a turn
 * boundary IS the heartbeat at this level. The finer-grained stall guard is
 * the 60s stream idle abort inside the provider (W13-15), which sees mid-turn
 * silence this loop cannot.
 */
export function watchdogStop(input: WatchdogStopInput): SpawnSessionOutput | null {
  if (input.maxSessionSeconds <= 0) return null;
  const breach = checkWatchdogBreach(
    {
      maxSessionSeconds: input.maxSessionSeconds,
      heartbeatStallSeconds: input.maxSessionSeconds,
    },
    { startedAtMs: input.startedAtMs, lastHeartbeatAtMs: input.startedAtMs },
    input.nowMs,
  );
  if (!breach) return null;
  return {
    stdout: '',
    stderr:
      `agent session stopped: the watchdog fired after ` +
      `${Math.round(breach.elapsedMs / 1000)}s (ceiling ${input.maxSessionSeconds}s, ` +
      `reason ${breach.reason}) with no Completion Manifest, on turn ` +
      `${input.iteration} of ${input.maxIterations}. The session was making progress ` +
      `but not finishing.`,
    exitCode: 1,
  };
}

/**
 * The per-turn output ceiling was HIT (W13-43).
 *
 * `finish_reason: length` means the model was still going when it ran out of
 * room, so this turn's output is a fragment — continuing would feed a
 * truncated assistant message back and burn the rest of the iteration budget
 * on it.
 */
export function turnTokenStop(
  finishReason: FinishReason,
  maxTurnTokens: number,
  /**
   * W21-18: what the turn actually SAID. A reasoning model spends tokens on
   * reasoning before it answers, and those tokens are reported separately
   * from `content` — so a turn that hit the ceiling mid-thought comes back
   * with content EMPTY and everything in the provider's reasoning field.
   * Measured against a real MTP server: with a 16-token budget, `content` was
   * `""`, the whole budget was reasoning tokens, and finish_reason was
   * "length".
   *
   * That is the opposite diagnosis from a model that would not stop talking,
   * and it deserves the opposite advice. Emptiness is the discriminator
   * because it is already on the response — no new plumbing, no guessing.
   */
  content = '',
): SpawnSessionOutput | null {
  if (finishReason !== 'length') return null;
  const saidNothing = content.trim().length === 0;
  return {
    stdout: '',
    stderr: saidNothing
      ? `agent session stopped: one turn hit the ${maxTurnTokens}-token output ` +
        `ceiling having produced NO answer text at all (T-27). That is the ` +
        `signature of a reasoning model truncated mid-thought — its reasoning ` +
        `tokens count against this ceiling and its answer never started. This ` +
        `is not "no manifest returned": the model was cut off before it could ` +
        `return anything. Give it room by raising maxTurnTokens, or route this ` +
        `role to a model that reasons less per turn.`
      : `agent session stopped: one turn hit the ${maxTurnTokens}-token output ` +
        `ceiling and was still generating (T-27). That is a model that will not ` +
        `stop, not a model that needs more room — raise maxTurnTokens only if a ` +
        `legitimate turn is genuinely this large.`,
    exitCode: 1,
  };
}

/**
 * W17-01 (moved from gateway-session.ts under the 400-line cap, behavior
 * unchanged): the per-ticket cost cap check — a session whose ticket has
 * spent its cap stops with the spend stated.
 */
export function costCapStop(input: {
  readonly cap: number | undefined;
  readonly spent: number;
  readonly iteration: number;
}): SpawnSessionOutput | null {
  if (input.cap === undefined || input.spent < input.cap) return null;
  return {
    stdout: '',
    stderr:
      `agent session stopped: per-ticket cost cap ($${input.cap}) ` +
      `reached after ${input.iteration} model call(s) this session ` +
      `($${input.spent.toFixed(4)} spent on this ticket across all attempts)`,
    exitCode: 1,
  };
}

/**
 * W21-30: how many turns are left, told to the session that is spending them.
 *
 * Run 11 came the closest the product had: the agent's own checkpoint read
 * `completed: ["Verification passed with pnpm lint && pnpm typecheck && pnpm
 * test (exit 0)"]` — the work was DONE and VERIFIED — and it then ran out of
 * turns before emitting the Completion Manifest. The attempt before it ended
 * on "Use git add to stage only write-scope files, then commit and generate
 * manifest".
 *
 * The session was never told the arithmetic. It received a system prompt about
 * how a session ends and a handoff about the ticket, and no turn number and no
 * remaining count — so it explored at a comfortable pace and discovered the
 * wall by hitting it, with the work finished and unclaimed.
 *
 * This reports a number the loop is already using to decide when to stop, so
 * it introduces no model judgement anywhere (C-2). It fires only near the end:
 * a warning on every turn is a warning nobody reads.
 */
export const BUDGET_WARNING_TURNS = 3;

export function budgetWarning(
  iteration: number,
  budget: number,
  warnWithin = BUDGET_WARNING_TURNS,
): string | null {
  const remaining = budget - iteration;
  if (remaining < 0 || remaining > warnWithin) return null;
  if (remaining === 0) {
    return (
      'BUDGET: this is your LAST tool turn. The session ends after it. If the ' +
      'work is done, stop calling tools and reply with ONLY the Completion ' +
      'Manifest now — a session that ends without one closes nothing and the ' +
      'work is discarded.'
    );
  }
  return (
    `BUDGET: ${remaining} tool turn${remaining === 1 ? '' : 's'} left before this ` +
    'session ends. If the work is done, stop exploring and reply with ONLY the ' +
    'Completion Manifest; if it is not, spend what is left finishing it rather ' +
    'than reading.'
  );
}

/**
 * Told to the maker mid-session, once, while it can still act (W21-65).
 *
 * RUN 51 was the most productive session of the exercise — read x24, list x13,
 * edit x7, write x10 — and commit x0. Seventeen mutations, nothing committed;
 * the branch tip was unchanged afterwards. The close gate reads COMMITS, so
 * that session could never have closed however good the code was: it reached
 * the gate, was refused on the acceptance criterion, and the real blocker was
 * never named.
 *
 * Sits beside `budgetWarning` because it is the same kind of message — the
 * product telling a session something it cannot observe about its own
 * situation — but it fires on a DIFFERENT signal. Budget warnings fire near
 * the end; this fires as soon as the pattern appears, because the whole value
 * is having turns left in which to fix it.
 */
export const UNCOMMITTED_WORK_WARNING =
  'UNCOMMITTED WORK: you have changed files and made no commit. The close gate ' +
  'reads COMMITS, not the working tree — uncommitted changes are invisible to ' +
  'it and this session cannot close until you commit. Commit what you have now, ' +
  'then carry on.';
