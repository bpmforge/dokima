/**
 * `SpawnSession` backed by `@dokima/gateway` instead of a child process
 * (D-023, FR-H6): renders nothing itself (the HANDOFF is already rendered
 * by the time `runSession` calls `spawn`) — sends the rendered prompt plus
 * the closed tool schema (`tools.ts`) through the role's configured model
 * (`route()`, FR-G2/FR-G6 structural guards included), executes the
 * model's tool calls against the ticket worktree via `packages/mcp`
 * (`mcp-wiring.ts`), feeds results back, and iterates until the model
 * emits a final message with no tool calls (the Completion Manifest,
 * parsed out-of-band by `runSession` itself — this module never parses or
 * trusts it) or the per-session budget stops it (T-27).
 *
 * REAL TOOL ROUND TRIP (W11-16, closing the gap W11-12 opened but did not
 * itself wire): the assistant turn that requested tool calls goes back into
 * `messages` carrying its `toolCalls` (`ChatMessage.toolCalls`, W11-12), and
 * each tool result is fed back as its own `'tool'`-role message carrying the
 * `toolCallId` of the call it answers (`ChatMessage.toolCallId`) — never a
 * synthetic `user` turn. `runToolCalls` (`mcp-wiring.ts`) is called once per
 * tool call rather than once per turn so each result can be echoed on its
 * own `tool`-role message; `mcp-wiring.ts` itself is out of this ticket's
 * write_scope, so its docstring still describes the old single-block
 * shape — a stale-comment follow-up, not a behavior gap.
 *
 * `SpawnSession`'s fixed `{prompt, cwd}` signature also carries no
 * `Handoff` object, so the ticket id this loop needs is recovered from the
 * rendered prompt itself (`handoff-fields.ts`'s `parseHandoffFields`) — the
 * same reason `role`/`runId`/`berthId` are fixed construction-time options
 * here instead, mirroring how `LandLoopOptions.role` already works one
 * level up.
 *
 * PROVENANCE (SC-17, W11-03, fixing a MEDIUM advisory raised on W11-02):
 * `write_scope` is NOT taken from that same prompt parse. C-2/C-3 make the
 * session untrusted, and the rendered prompt — CONTEXT included — is
 * reachable by session-influenced content (a file the session itself read,
 * BLUEPRINT §7); enforcing SC-17 against a string pulled from that text
 * would put the gate on the wrong side of the trust boundary it exists to
 * defend, self-attestation Law 4 refuses even when the parse happens to be
 * safe today. `write_scope` is instead looked up once per call via
 * `getTicket(options.log, ticketId)` — the same event-log-backed ticket
 * record `runCloseGate` (SC-02) already treats as ground truth — and used
 * for the whole session's `toolCtx`. An unresolvable `ticketId` (parse
 * failure, or a ticket the log has no record of) fails CLOSED to an empty
 * write_scope: `matchesAnyGlob` against `[]` never matches, so every
 * write/edit is refused rather than silently trusting the prompt's claim.
 *
 * PROVENANCE, VERIFY COMMAND TOO (W11-22, the sibling asymmetry the SC-17
 * fix above left standing): `verifyCommand` gets the identical treatment.
 * `parseHandoffFields` no longer extracts a VERIFY field at all —
 * `handoff-fields.ts` used to hand back the LAST `VERIFY: ` line in the
 * rendered prompt, the same last-match heuristic its own docstring
 * documented as foolable by a CONTEXT ending in a lookalike line, and a
 * command string that gets run is not a weaker case than a path glob.
 * `verifyCommand` is instead `ticket?.verify ?? DEFAULT_VERIFY_COMMAND` —
 * the same `getTicket` lookup `write_scope` above already uses, mirroring
 * `loop-gates.ts`'s own `ticket.verify ?? DEFAULT_VERIFY_COMMAND` for
 * `runCloseGate` (SC-02). `parseHandoffFields` now feeds exactly one thing
 * — the ticket id used for that lookup, safe for the reason
 * `handoff-fields.ts`'s own docstring gives. `runCloseGate` was never
 * reading this parsed copy (SC-02 independently re-reads `ticket.verify`
 * and re-runs it, so the durable verdict was never at risk) — which is why
 * this was HIGH and not CRITICAL — but the in-session `verify` tool call
 * ran the spoofable one until this fix.
 *
 * SC-01, OUT-OF-SESSION AND STILL AUTHORITATIVE (acceptance 2, W11-03): the
 * tool-boundary pre-check above (`fs-tools.ts`'s SC-17) is defence in depth,
 * never the only line — `refuseIfSessionExceededScope` below runs once,
 * unconditionally, at the ONE point in this loop that can hand a Completion
 * Manifest back to `runSession` (the natural-completion return, no more tool
 * calls left; the other two returns already carry no manifest text and exit
 * non-zero). It re-derives the truth the same way canonical SC-01 always
 * has — a real `git diff` of the worktree (`computeChangedPaths`,
 * `@dokima/loop`, unmodified) checked against `write_scope[]` and the hard
 * exclusions (`checkWriteScope`, `@dokima/git`, the exact function
 * `commitTool` already uses, unmodified) — never anything the model claimed
 * or chose to do. A session that got an out-of-scope path onto real disk by
 * ANY means the pre-check didn't anticipate (a bug in it, or acceptance 2's
 * own "pre-check disabled" fixture) still cannot produce a manifest: its
 * output is discarded, `runSession`'s caller sees `manifest === null`, and
 * `runCloseGate` (SC-02) never runs — so the ticket cannot close on this
 * attempt regardless of what `commitTool` did or didn't catch. This is
 * strictly stronger than `commitTool`'s own SC-01 check, which only fires
 * if the model chooses to call `commit` at all.
 */

import { appendEvent } from '@dokima/events';
import { route, FitnessCardStore, type TaskType } from '@dokima/gateway';
import {
  type SpawnSession,
  type SpawnSessionInput,
  type SpawnSessionOutput,
  type ValidatorResult,
} from '@dokima/loop';
import { prepareSession } from './session-setup.js';
import { ensureAgentSessionToolsRegistered, runToolCalls } from './mcp-wiring.js';
import { AGENT_SESSION_TOOL_SCHEMAS, TOOL_VERIFY } from './tools.js';
import { takeMeteredTurn } from './session-stream.js';
import { costCapStop, DEFAULT_MAX_SESSION_SECONDS,
  DEFAULT_MAX_TURN_TOKENS,
  turnTokenStop,
  budgetWarning,
  watchdogStop } from './session-limits.js';

// Re-exported so callers keep importing the session's limits from the session
// (W13-44 moved the definitions to the chapter that enforces them).
export { DEFAULT_MAX_SESSION_SECONDS, DEFAULT_MAX_TURN_TOKENS };
import {
  parseVerifyResult,
  refuseIfSessionExceededScope,
} from './session-verdicts.js';
import { createAnchorRefresher } from './session-anchors.js';
import {
  budgetExhaustedStderr,
  createSessionProgressBudget,
  earlyStopStderr,
  type ProgressToolCall,
} from './session-progress.js';
import {
  CHECKPOINT_REQUEST,
  checkpointStderrLine,
  parseCheckpointReply,
} from './session-checkpoint.js';


export const DEFAULT_MAX_TOOL_ITERATIONS = 12;


export const DEFAULT_AGENT_SESSION_TASK_TYPE: TaskType = 'code';
export const DEFAULT_AGENT_SESSION_VERIFY_TIMEOUT_MS = 10 * 60 * 1000;

export type { GatewaySpawnSessionOptions } from './gateway-session-options.js';
import type { GatewaySpawnSessionOptions } from './gateway-session-options.js';


/**
 * Turns a `verify` tool result into the `ValidatorResult` the FR-L2 tool
 * anchor consumes. `runToolCalls` renders each outcome as
 * `TOOL_RESULT <id> (<name>): <json>`, so the JSON is recovered from the
 * first `: ` after the header. Returns null for anything unparseable — an
 * anchor that invented a fact would be worse than one that stays silent,
 * which is the rule `anchors.ts` states for its own stub anchors.
 */

/** Delivers the `@dokima/loop` `SpawnSession` contract `runSession` already takes (FR-H6), backed by the gateway rather than a child process. */
export function createGatewaySpawnSession(
  options: GatewaySpawnSessionOptions,
): SpawnSession {
  const fitnessStore = options.fitnessStore ?? new FitnessCardStore();
  const berthId = options.berthId ?? options.actorId;
  const now = options.now ?? (() => new Date().toISOString());
  const taskType = options.taskType ?? DEFAULT_AGENT_SESSION_TASK_TYPE;
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
  const maxTurnTokens = options.maxTurnTokens ?? DEFAULT_MAX_TURN_TOKENS;
  const maxSessionSeconds = options.maxSessionSeconds ?? DEFAULT_MAX_SESSION_SECONDS;
  const verifyTimeoutMs =
    options.verifyTimeoutMs ?? DEFAULT_AGENT_SESSION_VERIFY_TIMEOUT_MS;

  return async function gatewaySpawnSession(
    input: SpawnSessionInput,
  ): Promise<SpawnSessionOutput> {
    ensureAgentSessionToolsRegistered(options.log, {
      role: options.role,
      actorId: options.actorId,
    });

    const { ticketId, toolCtx, messages } = prepareSession({
      log: options.log,
      prompt: input.prompt,
      cwd: input.cwd,
      verifyTimeoutMs,
      secretValues: options.secretValues ?? [],
    });

    /**
     * FR-L2 tool anchor (W12-05). Validator/verify output is external ground
     * truth the model must reconcile with rather than reason past. Without
     * this the only record of a failed verify is one `tool` message that
     * scrolls away as the session grows, leaving the model's own later
     * turns as the most recent thing it sees — the exact "lost in a long
     * context window" failure the anchor framework was built for and never
     * wired into.
     */
    const validatorResults: ValidatorResult[] = [];
    // W13-23 anchor refresh — factory in session-anchors.ts.
    const refreshAnchor = createAnchorRefresher({
      messages,
      validatorResults,
      memoryAnchor: options.memoryAnchor,
      ticketId,
      itemDescription: input.prompt.slice(0, 200),
      criterion: toolCtx.verifyCommand,
      secretValues: options.secretValues,
    });

    const baseTurnDeps = {
      route: () =>
        route({
          matrix: options.matrix,
          role: options.role,
          taskType,
          actorId: options.actorId,
          fitnessStore,
        }),
      resolveProvider: options.resolveProvider,
      role: options.role,
      ledger: options.ledger,
      projectId: options.projectId,
      runId: options.runId,
      ticketId,
      berthId,
      log: options.log,
      actorId: options.actorId,
      onDelta: options.onDelta,
      ...(maxTurnTokens > 0 ? { maxTokens: maxTurnTokens } : {}),
      now,
    };

    // W17-02: one tool-free turn at a budget stop — best-effort, never
    // masks the stop itself (C-2).
    const checkpointSuffix = async (): Promise<string> => {
      try {
        messages.push({ role: 'user', content: CHECKPOINT_REQUEST });
        const { response } = await takeMeteredTurn({
          ...baseTurnDeps,
          messages,
          tools: [],
        });
        const parsed = parseCheckpointReply(response.message.content);
        return parsed ? `\n${checkpointStderrLine(parsed)}` : '';
      } catch {
        return '';
      }
    };

    let lastModel = 'unknown';
    // W17-03: each ending leaves a measured turns observation (mechanical).
    const observeTurns = (turns: number, completed: boolean): void => {
      appendEvent(options.log, {
        eventType: 'session.turns_observed',
        actorId: options.actorId,
        ticketId,
        runId: options.runId,
        payload: { model: lastModel, turns, completed },
      });
    };

    const startedAtMs = Date.parse(now());
    const progress = options.progressBudget
      ? createSessionProgressBudget({
          base: maxIterations,
          ceiling: options.progressBudget.ceiling,
        })
      : null;
    const budgetNow = () => progress?.budget() ?? maxIterations;

    for (let iteration = 1; iteration <= budgetNow(); iteration += 1) {
      const watchdog = watchdogStop({
        maxSessionSeconds,
        startedAtMs,
        nowMs: Date.parse(now()),
        iteration,
        maxIterations: budgetNow(),
      });
      if (watchdog) return watchdog;

      await refreshAnchor();
      const warning = budgetWarning(iteration, budgetNow());
      if (warning) messages.push({ role: 'user', content: warning });
      const turn = await takeMeteredTurn({
        ...baseTurnDeps,
        messages,
        tools: [
          ...AGENT_SESSION_TOOL_SCHEMAS,
          ...(options.externalTools?.schemas ?? []),
        ],
      });
      const { response } = turn;
      lastModel = turn.model;
      const { finishReason, message } = response;
      const truncated = turnTokenStop(finishReason, maxTurnTokens, message.content);
      if (truncated) return truncated;

      const costStop = costCapStop({
        cap: options.maxTicketCostUsd,
        spent: options.ledger.totalForTicket({
          projectId: options.projectId,
          runId: options.runId,
          ticketId,
        }),
        iteration,
      });
      if (costStop) return costStop;

      if (!response.toolCalls || response.toolCalls.length === 0) {
        messages.push(response.message);
        const scopeRefusal = await refuseIfSessionExceededScope(
          input.cwd,
          toolCtx.writeScope,
        );
        if (scopeRefusal) return scopeRefusal;
        observeTurns(iteration, true);
        return { stdout: response.message.content, stderr: '', exitCode: 0 };
      }

      // Echoes the model's own tool_calls back into history (see module
      // header) — required for a following `tool`-role turn's
      // `toolCallId` to make sense next to the assistant turn it answers.
      messages.push({ ...response.message, toolCalls: response.toolCalls });

      const iterationCalls: ProgressToolCall[] = [];
      for (const call of response.toolCalls) {
        const resultText = await runToolCalls(
          [call],
          toolCtx,
          {
            log: options.log,
            role: options.role,
            actorId: options.actorId,
            ticketId,
            runId: options.runId,
          },
          options.externalTools,
        );
        messages.push({ role: 'tool', content: resultText, toolCallId: call.id });
        iterationCalls.push({
          name: call.name,
          argsJson: JSON.stringify(call.arguments ?? null),
          resultText,
        });
        if (call.name === TOOL_VERIFY) {
          const result = parseVerifyResult(resultText, toolCtx.verifyCommand);
          // Latest verdict only: an anchor asserting both "passed" and
          // "failed" for the same command is not ground truth.
          if (result) {
            validatorResults.length = 0;
            validatorResults.push(result);
          }
        }
      }

      if (progress) {
        const before = progress.entries().length;
        progress.noteIteration({
          iteration,
          toolCalls: iterationCalls,
          verifyExit: validatorResults[0]?.exitCode ?? null,
        });
        // W17-01: every extension/early-stop is ledgered as it happens.
        for (const entry of progress.entries().slice(before)) {
          appendEvent(options.log, {
            eventType:
              entry.kind === 'extended'
                ? 'session.budget_extended'
                : 'session.stopped_early',
            actorId: options.actorId,
            ticketId,
            runId: options.runId,
            payload: entry,
          });
        }
        const stop = progress.earlyStop();
        if (stop) {
          observeTurns(iteration, false);
          return {
            stdout: '',
            stderr: earlyStopStderr(iteration, stop.reason) + (await checkpointSuffix()),
            exitCode: 1,
          };
        }
      }
    }

    const exhausted = progress
      ? budgetExhaustedStderr(
          progress.budget(),
          progress.entries(),
          progress.lastWindowProgress(),
          // W21-79: the install CEILING, not this session's start budget —
          // see `hardCeiling` in session-progress.ts for why that matters.
          options.progressBudget?.ceiling ?? null,
        )
      : `agent session stopped: exceeded the per-session tool-iteration budget ` +
        `(${maxIterations}) without a Completion Manifest (T-27). If the work was ` +
        `real but unfinished, raise maxToolIterations — chatty local models often ` +
        `need more than the default.`;
    observeTurns(progress?.budget() ?? maxIterations, false);
    return {
      stdout: '',
      // Checkpoints ride the W17-01 opt-in: the fixed legacy path stays
      // byte-identical (its tests count provider calls).
      stderr: exhausted + (progress ? await checkpointSuffix() : ''),
      exitCode: 1,
    };
  };
}
