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
 * KNOWN LIMITATION (report, don't silently work around — MASTER_PROMPT
 * §"when stuck"): `ChatRequest.messages` is `ChatMessage[]` with
 * `{role: 'system'|'user'|'assistant', content: string}` (W11-01,
 * `packages/gateway`, out of this ticket's write_scope) — there is no
 * `tool`-role message and no field for an assistant turn to echo the
 * `tool_calls` it made. A real OpenAI-compatible wire round-trip requires
 * both. Tool results are therefore fed back as a synthetic `user` message
 * (`mcp-wiring.ts`'s `runToolCalls`) — this satisfies the fake-provider
 * test harness and this ticket's own red fixtures, but will not reach a
 * live cloud provider without `packages/gateway` adding a `tool` role and
 * a `toolCalls` echo field to `ChatMessage`/`ChatRequest`. Filed as a
 * HANDOFF in this ticket's `notes`.
 *
 * `SpawnSession`'s fixed `{prompt, cwd}` signature also carries no
 * `Handoff` object, so the ticket id / write_scope / verify command this
 * loop needs are recovered from the rendered prompt itself
 * (`handoff-fields.ts`) — the same reason `role`/`runId`/`berthId` are
 * fixed construction-time options here instead, mirroring how
 * `LandLoopOptions.role` already works one level up.
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
import type { SpawnSession, SpawnSessionInput, SpawnSessionOutput } from '@dokima/loop';
import { DEFAULT_VERIFY_COMMAND } from '../loop-handoff.js';
import { parseHandoffFields } from './handoff-fields.js';
import { ensureAgentSessionToolsRegistered, runToolCalls } from './mcp-wiring.js';
import { AGENT_SESSION_TOOL_SCHEMAS } from './tools.js';

export const DEFAULT_MAX_TOOL_ITERATIONS = 12;
export const DEFAULT_AGENT_SESSION_TASK_TYPE: TaskType = 'code';
export const DEFAULT_AGENT_SESSION_VERIFY_TIMEOUT_MS = 10 * 60 * 1000;

export interface GatewaySpawnSessionOptions {
  readonly log: EventLog;
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
  /** Optional per-session USD cap, checked against `ledger.totalForTicket` between iterations — the other half of acceptance 1's "or the budget stops it". */
  readonly maxCostUsd?: number;
  readonly verifyTimeoutMs?: number;
  readonly now?: () => string;
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
    const toolCtx = {
      cwd: input.cwd,
      writeScope: fields.writeScope,
      verifyCommand: fields.verifyCommand ?? DEFAULT_VERIFY_COMMAND,
      verifyTimeoutMs,
    };

    const messages: ChatMessage[] = [{ role: 'user', content: input.prompt }];

    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
      const routed = await route({
        matrix: options.matrix,
        role: options.role,
        taskType,
        actorId: options.actorId,
        fitnessStore,
      });
      const model = routed.chain[0]!;
      const provider = options.resolveProvider(model);
      const response = await provider.chat({
        model,
        messages,
        tools: [...AGENT_SESSION_TOOL_SCHEMAS],
      });

      options.ledger.record({
        projectId: options.projectId,
        runId: options.runId,
        ticketId,
        berthId,
        costUsd: response.usage.costUsd,
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        model,
        recordedAt: now(),
      });

      if (options.maxCostUsd !== undefined) {
        const spent = options.ledger.totalForTicket({
          projectId: options.projectId,
          runId: options.runId,
          ticketId,
        });
        if (spent >= options.maxCostUsd) {
          return {
            stdout: '',
            stderr:
              `agent session stopped: per-session cost cap ($${options.maxCostUsd}) reached ` +
              `after ${iteration} model call(s) ($${spent.toFixed(4)} spent)`,
            exitCode: 1,
          };
        }
      }

      // KNOWN LIMITATION (see module header): `response.message` carries no
      // `toolCalls` field to echo back — only its (often empty) text.
      messages.push(response.message);

      if (!response.toolCalls || response.toolCalls.length === 0) {
        return { stdout: response.message.content, stderr: '', exitCode: 0 };
      }

      const resultsText = await runToolCalls(response.toolCalls, toolCtx, {
        log: options.log,
        role: options.role,
        actorId: options.actorId,
        ticketId,
        runId: options.runId,
      });
      messages.push({ role: 'user', content: resultsText });
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
