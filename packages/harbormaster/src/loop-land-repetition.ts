/**
 * loop-land-repetition.ts — a spin that spans sessions (W21-19).
 *
 * W21-10 stops a session that keeps asking a question it already has the
 * answer to. Its counter is per-session, and deliberately so: a NEW session
 * cannot remember what the last one read, and re-reading state it has no
 * memory of is honest work, not a spin.
 *
 * But the live UAT showed the gap that leaves. One run made SIX
 * `agent-session.list` calls with byte-identical arguments AND byte-identical
 * results, spread across several sessions, and `session.stopped_early` stayed
 * at zero the whole time. The run burned attempt after attempt on the same
 * loop and nothing noticed, because no single session reached the threshold.
 *
 * This reads that pattern back out of the ledger rather than threading new
 * state through the session. `mcp.tool_call.completed` already records
 * `toolId`, `argsDigest` and `resultDigest` — identical arguments AND an
 * identical answer is exactly the zero-information shape, and the events are
 * already scoped to a ticket and a run. The ledger is the source of truth the
 * rest of the product is built on; asking it a question costs nothing new.
 *
 * IT REPORTS, IT DOES NOT STOP THE RUN — a decision, not an omission. A run
 * legitimately repeats reads after an absorbed infra retry (the session died
 * and started over; of course it lists the directory again), and stopping on
 * that would punish the retry mechanism W13-27 exists to provide. The
 * per-session guard already stops a genuine spin at the moment it happens.
 * What a person needs from the PARK evidence is the pattern the per-session
 * view cannot see: "this run asked the same question six times across four
 * sessions". Given that, a human can tell a stuck model from an unlucky one —
 * a judgement the product should not be making for them.
 */
import { listEvents, type EventLog } from '@dokima/events';

/**
 * Tools whose repetition means nothing new. Mutations are excluded for the
 * same reason as W21-10: a repeated write is a retry, not a spin.
 */
const MUTATION_TOOL_SUFFIXES = ['write', 'edit', 'commit'];

export interface RepeatedCall {
  readonly toolId: string;
  readonly count: number;
}

export interface RepetitionQuery {
  readonly log: EventLog;
  readonly ticketId: string;
  readonly runId?: string;
  /** How many identical calls before it is worth reporting. */
  readonly threshold?: number;
}

export const CROSS_SESSION_REPEAT_THRESHOLD = 3;

interface ToolCallPayload {
  readonly toolId?: unknown;
  readonly argsDigest?: unknown;
  readonly resultDigest?: unknown;
}

function isMutation(toolId: string): boolean {
  return MUTATION_TOOL_SUFFIXES.some((suffix) => toolId.endsWith(suffix));
}

/**
 * Zero-information calls repeated across the whole ticket's history, most
 * repeated first. Same arguments AND same result — if the answer changed, the
 * call learned something and does not count, however often it was made.
 */
export function repeatedZeroInformationCalls(query: RepetitionQuery): RepeatedCall[] {
  const threshold = query.threshold ?? CROSS_SESSION_REPEAT_THRESHOLD;
  const counts = new Map<string, { toolId: string; count: number }>();

  for (const event of listEvents(query.log)) {
    if (event.eventType !== 'mcp.tool_call.completed') continue;
    if (event.ticketId !== query.ticketId) continue;
    if (query.runId && event.runId !== query.runId) continue;
    const payload = event.payload as ToolCallPayload;
    const toolId = typeof payload.toolId === 'string' ? payload.toolId : null;
    const args = typeof payload.argsDigest === 'string' ? payload.argsDigest : null;
    const result = typeof payload.resultDigest === 'string' ? payload.resultDigest : null;
    if (!toolId || !args || !result) continue;
    if (isMutation(toolId)) continue;
    const key = `${toolId} ${args} ${result}`;
    const seen = counts.get(key);
    if (seen) seen.count += 1;
    else counts.set(key, { toolId, count: 1 });
  }

  return [...counts.values()]
    .filter((entry) => entry.count >= threshold)
    .sort((a, b) => b.count - a.count);
}

/**
 * The park-evidence line, or null when there is nothing to report. Names the
 * pattern in the words a person would use, and says explicitly that it did not
 * stop the run — otherwise the reader assumes the product acted on it.
 */
export function repetitionEvidenceLine(repeats: readonly RepeatedCall[]): string | null {
  if (repeats.length === 0) return null;
  const worst = repeats[0]!;
  const others =
    repeats.length > 1 ? ` (and ${repeats.length - 1} other repeated call(s))` : '';
  return (
    `Across this ticket's sessions the same ${worst.toolId} call was made ` +
    `${worst.count} times with identical arguments and an identical result${others} — ` +
    `no single session repeated it enough to stop itself, so the run kept ` +
    `spending attempts on it. This did not stop the run; it is here so you can ` +
    `see the pattern a per-session view cannot.`
  );
}

/**
 * The same fact, addressed to the MAKER (W21-69).
 *
 * W21-19 chose to REPORT this and not stop, and that decision stands — an
 * absorbed infra retry legitimately re-reads. But report-to-the-founder is not
 * the only alternative to stopping: the run holds a fact the session would act
 * on and never hands it over. The next session starts with no idea that the
 * file it is about to read has already been read 61 times, by its
 * predecessors, with identical arguments and identical bytes back.
 *
 * Run 52 is the evidence that it would have been used: its SESSION_CHECKPOINT
 * read `{"remaining":["add type: module to package.json to fix ES module
 * error"]}` while the actual failure was ERR_CRYPTO_INVALID_SCRYPT_PARAMS. The
 * maker re-read its way to a diagnosis the repetition record contradicts.
 *
 * PHRASED AS FACT, NEVER AS INSTRUCTION (acceptance 2). "Do not read X again"
 * would be the product telling a model how to work, and a wrong instruction
 * here is expensive — there are legitimate reasons to re-read. Stating what
 * happened lets the model draw its own conclusion, which is the same posture
 * `withFeedback` takes with the previous attempt's gaps.
 */
export function repetitionHandoffNote(repeats: readonly RepeatedCall[]): string | null {
  if (repeats.length === 0) return null;
  const worst = repeats[0]!;
  const others =
    repeats.length > 1 ? `, and ${repeats.length - 1} other call(s) repeat similarly` : '';
  return (
    `ALREADY TRIED IN EARLIER SESSIONS ON THIS TICKET: the ${worst.toolId} call ` +
    `has been made ${worst.count} times with identical arguments, returning an ` +
    `identical result every time${others}. Those answers have not changed and ` +
    `will not change by asking again.`
  );
}
