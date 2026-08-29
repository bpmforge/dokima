/**
 * loop-land-attempted.ts — a session that changed nothing has not attempted
 * the work (W21-44).
 *
 * Run 23's complete tool history, across BOTH ladder attempts:
 *
 *   agent-session.list   x6
 *   agent-session.read   x7
 *   agent-session.verify x2
 *
 * Fifteen calls, zero mutations. It never attempted to write anything, in
 * either attempt, and the ladder ran to exhaustion regardless. The close-gate
 * reason had reached it — "acceptance criterion AC-1 ran NOTHING … write the
 * tests it names" — and the second attempt was the same shape as the first.
 *
 * The signal is free and already collected. W17-01 counts mutating tool calls
 * as the progress that EARNS budget; the inverse of that same counter was
 * unused. A session that ends having made no successful write, edit or commit
 * has not attempted the work, whatever its manifest claims — code-observed
 * rather than model-reported (C-2), and unambiguous in a way "did it try hard
 * enough" never is.
 *
 * Spending a second attempt on it cannot help: the next attempt has the same
 * information and the same instruction, and run 23 is the proof.
 *
 * THAT IS ONLY TRUE WITHOUT A LADDER, and the first version of this chapter
 * missed it — see `attemptedNothingEndsTheLadder`.
 *
 * COUNTED FROM THE LEDGER, not by threading new state through the session —
 * the precedent W21-19 set for exactly this reason. `mcp.tool_call.completed`
 * already records every call with its tool id, and events are already scoped
 * to a ticket, so asking the log costs nothing new.
 *
 * WHY NOT `session.changedPaths`, which is right there on the result: it is
 * the worktree diff against the BASE, so it stays non-empty for every later
 * attempt once any earlier one wrote something. In run 23 it was non-empty
 * throughout — the branch already carried the previous run's commits — and
 * would have hidden the very case this exists to catch.
 */
import { listEvents, type EventLog } from '@dokima/events';
import { commentTicket } from '@dokima/tickets';
import { rungForAttempt, type LandEscalationPolicy } from './loop-land-policy.js';

/** Tool-name suffixes that change the worktree. Mirrors W17-01's MUTATION_TOOLS. */
const MUTATION_SUFFIXES = ['write', 'edit', 'commit'];

export interface ToolHistogram {
  readonly counts: ReadonlyMap<string, number>;
  readonly mutations: number;
  readonly total: number;
}

/** The highest event seq right now — the marker an attempt is measured from. */
export function latestSeq(log: EventLog): number {
  let max = 0;
  for (const event of listEvents(log)) if (event.seq > max) max = event.seq;
  return max;
}

/**
 * What a ticket's tool calls after `sinceSeq` actually did. `mutations` is the
 * number that changed something; a refusal is not counted, because a refused
 * write is an attempt the product blocked rather than one the model skipped.
 */
export function toolHistogramSince(
  log: EventLog,
  ticketId: string,
  sinceSeq: number,
): ToolHistogram {
  const counts = new Map<string, number>();
  let mutations = 0;
  let total = 0;
  for (const event of listEvents(log)) {
    if (event.seq <= sinceSeq) continue;
    if (event.eventType !== 'mcp.tool_call.completed') continue;
    if (event.ticketId !== ticketId) continue;
    const payload = event.payload as { toolId?: unknown; refused?: unknown };
    const toolId = typeof payload.toolId === 'string' ? payload.toolId : null;
    if (!toolId) continue;
    counts.set(toolId, (counts.get(toolId) ?? 0) + 1);
    total += 1;
    if (payload.refused === true) continue;
    if (MUTATION_SUFFIXES.some((suffix) => toolId.endsWith(suffix))) mutations += 1;
  }
  return { counts, mutations, total };
}

/**
 * Whether this attempt touched nothing. A session that made NO tool calls at
 * all is excluded: that is a session that never started properly, which the
 * infra-failure path already handles and which would be misdescribed here.
 */
export function attemptedNothing(histogram: ToolHistogram): boolean {
  return histogram.total > 0 && histogram.mutations === 0;
}

/**
 * The founder-facing evidence. Says what the session DID rather than that it
 * "failed" — a model that reads its way around a ticket twice without touching
 * it is saying something about the ticket or the model, and a person needs the
 * shape to tell which.
 */
export function attemptedNothingNotice(ticketId: string, histogram: ToolHistogram): string {
  const shape = [...histogram.counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([toolId, count]) => `${toolId} x${count}`)
    .join(', ');
  return (
    `${ticketId} was not attempted. The session made ${histogram.total} tool call(s) ` +
    `and changed nothing: ${shape}. No write, edit or commit succeeded, so there is ` +
    `no work to judge and a further attempt would carry the same information and the ` +
    `same instruction as this one.\n` +
    `Read this as a question about the ticket or the model rather than a failure of ` +
    `the run: a maker that reads its way around a ticket without touching it usually ` +
    `cannot see how to start.`
  );
}

/**
 * Records the evidence and reports whether the ladder should stop. Lives here
 * rather than at the call site because `loop-land-ticket.ts` sits at the
 * 400-line cap and because "did this attempt do anything" is one concern.
 *
 * THE CALLER MUST ONLY ACT ON THIS WHILE AN ATTEMPT REMAINS TO BE SAVED, and
 * the first version of this chapter got that wrong. `nextFeedback` already
 * documents the rule for `no_progress`: at the ceiling the ladder's own reason
 * is the true one, and relabelling an exhausted ladder would change FR-H1/H2's
 * documented outcome for the commonest failure there is. Ignoring it here
 * relabelled a T-27 budget stop that had no further attempt to lose — caught
 * by that fixture, not by review.
 */
export function parkIfAttemptedNothing(input: {
  readonly log: EventLog;
  readonly ticketId: string;
  readonly actorId: string;
  readonly runId?: string | undefined;
  readonly sinceSeq: number;
}): boolean {
  const histogram = toolHistogramSince(input.log, input.ticketId, input.sinceSeq);
  if (!attemptedNothing(histogram)) {
    /**
     * W21-65: the session DID work — and if none of it was committed, the
     * close gate cannot see any of it. That is the real blocker, and run 51
     * reached the gate without it ever being named.
     *
     * Here rather than in a new call site because this function already
     * computes the histogram for EVERY attempt and already holds the log; a
     * second pass over the same events to say a second thing about the same
     * attempt would be the drift this module's own header warns about. It
     * does not park — the work is real and the next attempt continues from
     * the same worktree.
     */
    if (wroteWithoutCommitting(histogram)) {
      commentTicket(
        input.log,
        {
          ticketId: input.ticketId,
          actorId: input.actorId,
          body: uncommittedWorkNotice(histogram),
        },
        { runId: input.runId ?? null },
      );
    }
    return false;
  }
  commentTicket(
    input.log,
    {
      ticketId: input.ticketId,
      actorId: input.actorId,
      body: attemptedNothingNotice(input.ticketId, histogram),
    },
    { runId: input.runId ?? null },
  );
  return true;
}

/**
 * Whether a session that changed nothing should PARK, or escalate instead.
 *
 * Run 27 caught this, and it was mine. R1 made ten calls, mutated nothing, and
 * this chapter parked the ticket after one attempt — pre-empting the climb to
 * R2. Run 26 had just proved that climb is exactly the answer: R1 spent forty
 * turns and produced no manifest, R2 produced one in eight.
 *
 * The error was in the sentence this module is built on. "A further attempt
 * would carry the same information and the same instruction" is true only when
 * the next attempt runs the SAME MODEL. Under a ladder it runs a different
 * one, which is the definition of new information — and a rung that did
 * nothing at all is the strongest signal there is that the rung is wrong,
 * rather than that the ticket is.
 *
 * So: park only when there is nowhere left to climb. A locked policy (one
 * pinned tier) and a run with no rung seam both qualify, because in both the
 * next attempt really is the same model over again.
 */
export function attemptedNothingEndsTheLadder(input: {
  /** Present only when the composing seam binds a distinct session per rung. */
  readonly hasRungSessions: boolean;
  readonly policy: LandEscalationPolicy;
  readonly attempt: number;
}): boolean {
  if (!input.hasRungSessions) return true;
  return (
    rungForAttempt(input.policy, input.attempt) ===
    rungForAttempt(input.policy, input.attempt + 1)
  );
}

/**
 * Work done and never durably recorded (W21-65).
 *
 * RUN 51, the most productive session of the whole exercise: read x24,
 * list x13, edit x7, write x10 — and commit x0. Seventeen mutations, nothing
 * committed. The branch tip was unchanged afterwards and only an uncommitted
 * spec edit survived. The close gate requires commits in the manifest, so that
 * session could never have closed no matter how good the code was: it reached
 * the gate, was refused on the acceptance criterion, and the real blocker was
 * never named.
 *
 * THE GAP IS BETWEEN TWO CHECKS THAT ALREADY EXIST. W21-44 asks whether the
 * session mutated ANYTHING, and this one mutated seventeen times. W21-60
 * catches a commit that stages nothing, and this is a commit never attempted.
 * Neither sees "wrote a lot, committed none".
 *
 * The signal costs nothing: the histogram is already in the ledger, and
 * `mutations > 0 AND commits === 0` is unambiguous.
 */
export function wroteWithoutCommitting(histogram: ToolHistogram): boolean {
  if (histogram.mutations === 0) return false; // W21-44's case, not this one.
  for (const [toolId, count] of histogram.counts) {
    if (count > 0 && toolId.endsWith('commit')) return false;
  }
  return true;
}

/**
 * What to tell the MAKER, mid-session, while it can still act.
 *
 * Deliberately maker-facing rather than a park reason: by the time a park is
 * written the session is over and the work is already stranded. Telling it at
 * a window boundary is cheaper than letting it reach a gate that will refuse
 * for a reason it will not understand.
 */
export function uncommittedWorkNotice(histogram: ToolHistogram): string {
  const changed = [...histogram.counts.entries()]
    .filter(([toolId]) => toolId.endsWith('write') || toolId.endsWith('edit'))
    .map(([toolId, count]) => `${toolId} x${count}`)
    .join(', ');
  return (
    `You have changed the worktree (${changed}) and made NO commit. The close ` +
    `gate reads commits, not the working tree — uncommitted work is invisible ` +
    `to it, and this session cannot close until you commit. Commit what you ` +
    `have before continuing.`
  );
}
