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

import type { EventLog } from '@dokima/events';
import {
  route,
  FitnessCardStore,
  type AgentRole,
  type ChatMessage,
  type CostLedger,
  type Provider,
  type ScopedRoleMatrix,
  type TaskType,
} from '@dokima/gateway';
import { checkWriteScope } from '@dokima/git';
import {
  computeChangedPaths,
  type Anchor,
  type SpawnSession,
  type SpawnSessionInput,
  type SpawnSessionOutput,
  type ValidatorResult,
} from '@dokima/loop';
import { getTicket } from '@dokima/tickets';
import { DEFAULT_VERIFY_COMMAND } from '../loop-handoff.js';
import { parseHandoffFields } from './handoff-fields.js';
import { ensureAgentSessionToolsRegistered, runToolCalls } from './mcp-wiring.js';
import { AGENT_SESSION_TOOL_SCHEMAS, TOOL_VERIFY } from './tools.js';
import { takeMeteredTurn } from './session-stream.js';
import { buildAnchorBlock } from './session-anchors.js';
import { SESSION_SYSTEM_PROMPT } from './session-prompt.js';

/**
 * SC-01's own real check (see module header), run once the tool loop has
 * genuinely ended. `changedPaths` is the REAL worktree diff against `HEAD`
 * (tracked + untracked, exactly what canonical SC-01 diffs) — never the
 * model's claims. Returns a refusal `SpawnSessionOutput` (no manifest text,
 * non-zero exit, same shape the iteration/cost-cap stops already use) when
 * any changed path fails `checkWriteScope`; `null` when the diff is clean.
 */
async function refuseIfSessionExceededScope(
  cwd: string,
  writeScope: readonly string[],
): Promise<SpawnSessionOutput | null> {
  const changedPaths = await computeChangedPaths(cwd, 'HEAD');
  const violations = await checkWriteScope([...changedPaths], [...writeScope], cwd);
  if (violations.length === 0) return null;
  return {
    stdout: '',
    stderr:
      'agent session refused (SC-01, out-of-session — this runs regardless of the ' +
      'tool-boundary pre-check): the real worktree diff contains path(s) outside ' +
      `write_scope after the tool loop ended — ${violations
        .map((v) => `${v.path} (${v.reason})`)
        .join(', ')}. Session output discarded; no Completion Manifest was produced.`,
    exitCode: 1,
  };
}

export const DEFAULT_MAX_TOOL_ITERATIONS = 12;
export const DEFAULT_AGENT_SESSION_TASK_TYPE: TaskType = 'code';
export const DEFAULT_AGENT_SESSION_VERIFY_TIMEOUT_MS = 10 * 60 * 1000;

export interface GatewaySpawnSessionOptions {
  readonly log: EventLog;
  /**
   * W13-23: prior VERIFIED findings for this ticket, recalled from the
   * project's fact store. Injected rather than constructed — harbormaster may
   * not import `memory` (ARCHITECTURE §4) — and optional, because a project
   * with no memory store must still run.
   */
  readonly memoryAnchor?: Anchor;
  /** W13-16 live model output, delta by delta. Not durable — see `session-stream.ts`. */
  readonly onDelta?: (chunk: string, cumulative: number) => void;
  /** The role this session runs as — governs BOTH the gateway routing decision below and the mcp allowlist (mcp-wiring.ts). */
  readonly role: AgentRole;
  readonly matrix: ScopedRoleMatrix;
  readonly actorId: string;
  readonly projectId: string;
  /** Ledger/audit grouping key for every model call and tool call this spawn function's whole lifetime makes (see module header: not threaded through per-ticket by the claim/land loop today). */
  readonly runId: string;
  /** Defaults to `actorId` — the ledger's berth-attribution key (FR-H5). */
  readonly berthId?: string;
  readonly taskType?: TaskType;
  /** Defaults to a fresh, empty store — an unbenched (model, role) pair passes the fitness guard silently (FR-G6's own contract). */
  readonly fitnessStore?: FitnessCardStore;
  /** Resolves a model id from the routed chain to the `Provider` that serves it. Production wiring binds this to the registry; tests inject a fake, no-network `Provider` (CLAUDE.md law 9). */
  readonly resolveProvider: (model: string) => Provider;
  readonly ledger: CostLedger;
  /** Per-session tool-call-turn cap (T-27: "a session iterates tool calls indefinitely... without producing a manifest"). */
  readonly maxIterations?: number;
  /**
   * Optional USD cap, checked between iterations against
   * `ledger.totalForTicket` — the other half of acceptance 1's "or the
   * budget stops it". This is a per-TICKET cap, not per-session: `ledger`
   * is constructed once and shared across every attempt a claim/land loop
   * makes on a ticket, so `totalForTicket` already includes spend from
   * earlier attempts on the same ticket. A ticket that blew the cap on
   * attempt 1 will stop attempt 2 after its very first model call.
   */
  readonly maxTicketCostUsd?: number;
  readonly verifyTimeoutMs?: number;
  readonly now?: () => string;
  /**
   * Extra secret values for the `verify` tool's redaction pass beyond the
   * known live-credential shapes (FR-S2, SC-06, W11-14) — vault-registered
   * and `.env` secret values, typically the result of
   * `collectSecretValues(vault, projectDir)` (`@dokima/shared`), gathered
   * by the caller since collecting them is async while `toolCtx` here is
   * built synchronously per session (same pattern as `RenderHandoffOptions.
   * secretValues` in `packages/loop/src/handoff.ts`). Omit for pattern-only
   * redaction.
   */
  readonly secretValues?: readonly string[];
}

/**
 * Turns a `verify` tool result into the `ValidatorResult` the FR-L2 tool
 * anchor consumes. `runToolCalls` renders each outcome as
 * `TOOL_RESULT <id> (<name>): <json>`, so the JSON is recovered from the
 * first `: ` after the header. Returns null for anything unparseable — an
 * anchor that invented a fact would be worse than one that stays silent,
 * which is the rule `anchors.ts` states for its own stub anchors.
 */
export function parseVerifyResult(
  resultText: string,
  verifyCommand: string,
): ValidatorResult | null {
  const start = resultText.indexOf('{');
  if (start === -1) return null;
  try {
    const parsed: unknown = JSON.parse(resultText.slice(start));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const exitCode = (parsed as { exitCode?: unknown }).exitCode;
    if (typeof exitCode !== 'number') return null;
    return {
      name: verifyCommand,
      exitCode,
      // The verify tool reports a command result, not a gap-counting
      // validator, so a non-zero exit IS the single gap. Inventing a
      // finer count from stdout would be fabrication.
      gapCount: exitCode === 0 ? 0 : 1,
    };
  } catch {
    return null;
  }
}

/** Delivers the `@dokima/loop` `SpawnSession` contract `runSession` already takes (FR-H6), backed by the gateway rather than a child process. */
export function createGatewaySpawnSession(
  options: GatewaySpawnSessionOptions,
): SpawnSession {
  const fitnessStore = options.fitnessStore ?? new FitnessCardStore();
  const berthId = options.berthId ?? options.actorId;
  const now = options.now ?? (() => new Date().toISOString());
  const taskType = options.taskType ?? DEFAULT_AGENT_SESSION_TASK_TYPE;
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
  const verifyTimeoutMs =
    options.verifyTimeoutMs ?? DEFAULT_AGENT_SESSION_VERIFY_TIMEOUT_MS;

  return async function gatewaySpawnSession(
    input: SpawnSessionInput,
  ): Promise<SpawnSessionOutput> {
    ensureAgentSessionToolsRegistered(options.log, {
      role: options.role,
      actorId: options.actorId,
    });

    const fields = parseHandoffFields(input.prompt);
    const ticketId = fields.ticketId ?? 'unknown';
    // SC-17 (see module header): write_scope AND verifyCommand are the
    // ticket record's own fields, never anything parsed from the prompt —
    // an unresolvable ticket fails closed to an empty write_scope (every
    // write/edit refused) and the default verify command.
    const ticket = getTicket(options.log, ticketId);
    const toolCtx = {
      cwd: input.cwd,
      writeScope: ticket?.writeScope ?? [],
      verifyCommand: ticket?.verify ?? DEFAULT_VERIFY_COMMAND,
      verifyTimeoutMs,
      secretValues: options.secretValues ?? [],
    };

    // W13-09: a system message, where there was none — see session-prompt.ts.
    const messages: ChatMessage[] = [
      { role: 'system', content: SESSION_SYSTEM_PROMPT },
      { role: 'user', content: input.prompt },
    ];

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
    let anchorMessage: ChatMessage | null = null;

    /**
     * Re-stated at the END of history on every round, not appended once. The
     * previous copy is removed first so the transcript carries exactly one
     * anchor block — always adjacent to the current turn, never growing
     * without bound. Composition lives in `session-anchors.ts` (W13-23).
     */
    const refreshAnchor = async (): Promise<void> => {
      const content = await buildAnchorBlock({
        validatorResults,
        memoryAnchor: options.memoryAnchor,
        ticketId,
        itemDescription: input.prompt.slice(0, 200),
        criterion: toolCtx.verifyCommand,
        secretValues: options.secretValues,
      });
      if (content === null) return;
      if (anchorMessage) {
        const previous = messages.indexOf(anchorMessage);
        if (previous !== -1) messages.splice(previous, 1);
      }
      anchorMessage = { role: 'user', content };
      messages.push(anchorMessage);
    };

    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
      await refreshAnchor();
      // W13-16: route, stream and meter are one act — see `session-stream.ts`.
      const { response } = await takeMeteredTurn({
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
        messages,
        tools: [...AGENT_SESSION_TOOL_SCHEMAS],
        ledger: options.ledger,
        projectId: options.projectId,
        runId: options.runId,
        ticketId,
        berthId,
        log: options.log,
        actorId: options.actorId,
        onDelta: options.onDelta,
        now,
      });

      if (options.maxTicketCostUsd !== undefined) {
        const spent = options.ledger.totalForTicket({
          projectId: options.projectId,
          runId: options.runId,
          ticketId,
        });
        if (spent >= options.maxTicketCostUsd) {
          return {
            stdout: '',
            stderr:
              `agent session stopped: per-ticket cost cap ($${options.maxTicketCostUsd}) ` +
              `reached after ${iteration} model call(s) this session ` +
              `($${spent.toFixed(4)} spent on this ticket across all attempts)`,
            exitCode: 1,
          };
        }
      }

      if (!response.toolCalls || response.toolCalls.length === 0) {
        messages.push(response.message);
        const scopeRefusal = await refuseIfSessionExceededScope(
          input.cwd,
          toolCtx.writeScope,
        );
        if (scopeRefusal) return scopeRefusal;
        return { stdout: response.message.content, stderr: '', exitCode: 0 };
      }

      // Echoes the model's own tool_calls back into history (see module
      // header) — required for a following `tool`-role turn's
      // `toolCallId` to make sense next to the assistant turn it answers.
      messages.push({ ...response.message, toolCalls: response.toolCalls });

      for (const call of response.toolCalls) {
        const resultText = await runToolCalls([call], toolCtx, {
          log: options.log,
          role: options.role,
          actorId: options.actorId,
          ticketId,
          runId: options.runId,
        });
        messages.push({ role: 'tool', content: resultText, toolCallId: call.id });
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
    }

    return {
      stdout: '',
      stderr:
        `agent session stopped: exceeded the per-session tool-iteration budget ` +
        `(${maxIterations}) without a Completion Manifest (T-27)`,
      exitCode: 1,
    };
  };
}
