/**
 * session-stream.ts — drive a model turn on `chatStream`, so a session is
 * observable while it works (W13-16).
 *
 * WHY. `gateway-session.ts` called `provider.chat()`, which resolves once, at
 * the end. A session therefore produced nothing observable until the whole
 * model call returned: on a local model that is minutes of silence with no way
 * to tell work from a hang, which is what made the first supervised runs so
 * hard to read. `chatStream` has been fully built since W2-09 — SSE parsing,
 * tool-call deltas, usage metering — and had no session caller in all that
 * time. This is the caller.
 *
 * THE LEDGER IS NOT NEGOTIABLE (acceptance 3). A streamed call must record the
 * same spend a non-streamed one does; a session that runs faster and meters
 * nothing is worse than the black box it replaced. Two things hold that line:
 *
 *   1. The contract already does most of it. `ChatStreamFinal` carries "the
 *      same normalized ChatResponse chat() would have returned, usage
 *      included" (gateway/types.ts), and `chatStream` is OPTIONAL — an adapter
 *      that cannot honour it does not implement it. So method presence is the
 *      capability signal, and a provider without it falls back to `chat()`
 *      automatically rather than by a list this file would have to maintain.
 *   2. A stream that ends with no `final` event is an ERROR here, not an empty
 *      answer. Returning a blank response would look to the caller exactly
 *      like a model that chose to say nothing, and would meter zero — the
 *      precise failure this ticket exists to prevent, arriving silently.
 *
 * GRANULARITY IS A DECISION, NOT A DEFAULT (acceptance 4). Per-token events
 * would flood an append-only hash-chained log; the log is the product's
 * durable explanation of itself, not a keystroke stream. So the split is:
 *
 *   - the LOG gets one `session.producing` event per model turn, on the first
 *     delta. That is the fact worth keeping forever — the model began
 *     producing at this time — and it is bounded by the turn budget that
 *     already bounds everything else.
 *   - the CALLER gets every delta through `onDelta`, unthrottled and in
 *     memory, for a live pane or a supervised run to render. Nothing durable,
 *     nothing chained, no cost.
 */
import { appendEvent, type EventLog } from '@dokima/events';
import type { ChatRequest, ChatResponse, Provider } from '@dokima/gateway';

export interface StreamTurnOptions {
  readonly provider: Provider;
  readonly request: ChatRequest;
  /** Where `session.producing` lands. Omitted in unit tests that assert only the response. */
  readonly log?: EventLog;
  readonly actorId: string;
  readonly ticketId?: string | null;
  readonly runId?: string | null;
  /** Live progress for a pane or a supervised run. Never durable. */
  readonly onDelta?: (chunk: string, cumulative: number) => void;
  /** W13-20: the model chose a tool. Live only, same as `onDelta`. */
  readonly onToolCall?: (name: string, index: number) => void;
  readonly now?: () => string;
}

export interface StreamTurnResult {
  readonly response: ChatResponse;
  /** False when the provider had no `chatStream` and this fell back to `chat()`. */
  readonly streamed: boolean;
  /** Characters seen before the final event — 0 on the fallback path. */
  readonly deltaChars: number;
  /** Tool names the model chose, in the order it chose them (W13-20). */
  readonly toolCalls: readonly string[];
}

export class StreamEndedWithoutFinalError extends Error {
  constructor(model: string) {
    super(
      `${model} streamed to completion without a final event, so there is no ` +
        `usage to meter. Treating this as an error rather than an empty ` +
        `response: an unmetered call that looks like a model choosing to say ` +
        `nothing is the exact failure streaming was supposed to remove.`,
    );
    this.name = 'StreamEndedWithoutFinalError';
  }
}

export async function runStreamedTurn(
  options: StreamTurnOptions,
): Promise<StreamTurnResult> {
  const { provider, request } = options;

  // No `chatStream` means the adapter has not ported its SSE path. Falling
  // back is the documented shape of the optional method, and it keeps the
  // ledger identical rather than trading it for progress.
  if (typeof provider.chatStream !== 'function') {
    return {
      response: await provider.chat(request),
      streamed: false,
      deltaChars: 0,
      toolCalls: [],
    };
  }

  const now = options.now ?? (() => new Date().toISOString());

  /**
   * The call is OPEN — emitted before the first byte, and the difference
   * between "nothing is happening" and "we are waiting".
   *
   * Found by the supervised run this ticket required (acceptance 5), not by a
   * fixture: every fixture passed while 15 of the run's 18.7 seconds — the
   * model's first turn — produced no observable signal at all. That turn
   * emitted `tool_calls` and no text, and `ChatStreamDelta` carries only
   * `content`, so a tool-calling turn streams nothing. It is also the COMMON
   * turn; on a 27B reasoning model it is minutes.
   *
   * Surfacing tool-call deltas needs `ChatStreamEvent` to carry them, which is
   * `packages/gateway`'s contract and outside this ticket — filed as W13-20.
   * This is the part that fits here, and it is not cosmetic: with a start time
   * on the log, a watcher can say "this call has been open 90 seconds",
   * which is exactly the work-or-hang question that made the first supervised
   * runs unreadable. Without it there is no timestamp to subtract from.
   */
  if (options.log) {
    appendEvent(options.log, {
      eventType: 'session.turn_started',
      actorId: options.actorId,
      ticketId: options.ticketId ?? null,
      runId: options.runId ?? null,
      payload: { model: request.model, at: now() },
    });
  }

  let deltaChars = 0;
  let announced = false;
  const toolCalls: string[] = [];
  let final: ChatResponse | undefined;

  /**
   * W13-20: `session.producing` means the model has begun EMITTING, whatever
   * it is emitting. It used to fire only on text, so a turn that emitted only
   * tool calls looked identical to a hung one — which measured as 41% of one
   * model's turns. The first output of either kind now announces the turn.
   */
  const announce = (what: { tool?: string }): void => {
    if (announced) return;
    announced = true;
    if (!options.log) return;
    appendEvent(options.log, {
      eventType: 'session.producing',
      actorId: options.actorId,
      ticketId: options.ticketId ?? null,
      runId: options.runId ?? null,
      // The tool name when there is one: "what is it doing?" beats "is it
      // alive?", and it costs nothing to say on an event already being written.
      payload: { model: request.model, at: now(), ...(what.tool ? { tool: what.tool } : {}) },
    });
  };

  for await (const event of provider.chatStream(request)) {
    if (event.type === 'tool_call') {
      toolCalls.push(event.name);
      announce({ tool: event.name });
      options.onToolCall?.(event.name, event.index);
      continue;
    }
    if (event.type === 'delta') {
      deltaChars += event.content.length;
      if (!announced) {
        announce({});
      }
      options.onDelta?.(event.content, deltaChars);
      continue;
    }
    final = event.response;
  }

  if (!final) throw new StreamEndedWithoutFinalError(request.model);
  return { response: final, streamed: true, deltaChars, toolCalls };
}

/**
 * One whole model turn: route it, stream it, meter it.
 *
 * These three were inline in `gateway-session.ts`'s loop, which is where the
 * turn mechanics grew until the file hit the 400-line cap. They belong
 * together and they belong here — routing chooses the model, streaming runs
 * the call, and the ledger records what it cost, and none of the three is
 * meaningful without the other two. The loop above now reads as what it is:
 * take a turn, then decide what to do with the answer.
 */
export async function takeMeteredTurn(args: {
  readonly route: () => Promise<{ chain: readonly string[] }>;
  readonly resolveProvider: (model: string) => Provider;
  readonly messages: ChatRequest['messages'];
  readonly tools: ChatRequest['tools'];
  readonly ledger: {
    record(entry: {
      projectId: string;
      runId: string;
      ticketId: string;
      berthId: string;
      costUsd: number;
      promptTokens: number;
      completionTokens: number;
      model: string;
      recordedAt: string;
    }): void;
  };
  readonly projectId: string;
  readonly runId: string;
  readonly ticketId: string;
  readonly berthId: string;
  readonly log?: EventLog;
  readonly actorId: string;
  /** W13-24: FR-S1's "why is this role on this model?" needs the role on the record. */
  readonly role: string;
  readonly onDelta?: (chunk: string, cumulative: number) => void;
  /**
   * W13-43: the ceiling on ONE turn's output. Absent means unbounded, which is
   * what every turn was until a local model entered a generation loop and
   * streamed for as long as it was left running — the idle abort never fires
   * against a model that keeps producing, so nothing ended the run.
   */
  readonly maxTokens?: number;
  readonly now: () => string;
}): Promise<{ response: ChatResponse; model: string; streamed: boolean }> {
  const routed = await args.route();
  const model = routed.chain[0]!;
  const turn = await runStreamedTurn({
    provider: args.resolveProvider(model),
    request: {
      model,
      messages: args.messages,
      tools: args.tools,
      ...(args.maxTokens === undefined ? {} : { maxTokens: args.maxTokens }),
    } as ChatRequest,
    log: args.log,
    actorId: args.actorId,
    ticketId: args.ticketId,
    runId: args.runId,
    onDelta: args.onDelta,
    now: args.now,
  });

  // Unconditional, and on the SAME line for both paths: a streamed call that
  // meters nothing is the failure this ticket exists to prevent.
  args.ledger.record({
    projectId: args.projectId,
    runId: args.runId,
    ticketId: args.ticketId,
    berthId: args.berthId,
    costUsd: turn.response.usage.costUsd,
    promptTokens: turn.response.usage.promptTokens,
    completionTokens: turn.response.usage.completionTokens,
    model,
    recordedAt: args.now(),
  });

  /**
   * W13-24: the DURABLE half of metering. `CostLedger` is a private in-memory
   * array that dies with the process, so before this every completed run threw
   * its own spend away — W11's exit criterion 3 ("the run's spend ledger is
   * non-zero and attributable per role") could not be shown for ANY provider,
   * and `projects/stats.ts` returned a hardcoded 0 for the Fleet's spend
   * column while saying so in a comment.
   *
   * Enforcement is deliberately untouched: the budget breakers and the
   * per-ticket cap read the LIVE ledger during a run and work. What was
   * missing is the record after it.
   *
   * ONE EVENT PER METERED CALL is the grain, on the same rule W13-16 and
   * W13-20 used for this log: a 24-turn run writes 24 of these, comparable to
   * `session.turn_started`, and anything coarser (per ticket, per run) loses
   * the per-call attribution the criterion asks for. Numbers and a model id
   * only — never a prompt, a completion or a credential (law 8, FR-S2).
   */
  if (args.log) {
    appendEvent(args.log, {
      eventType: 'spend.recorded',
      actorId: args.actorId,
      ticketId: args.ticketId,
      runId: args.runId,
      payload: {
        role: args.role,
        model,
        costUsd: turn.response.usage.costUsd,
        promptTokens: turn.response.usage.promptTokens,
        completionTokens: turn.response.usage.completionTokens,
        streamed: turn.streamed,
        at: args.now(),
      },
    });
  }

  return { response: turn.response, model, streamed: turn.streamed };
}

