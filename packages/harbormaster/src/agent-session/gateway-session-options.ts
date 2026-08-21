/**
 * gateway-session-options.ts — the session's option surface (W17-01 chapter
 * split under the 400-line CODE_BOOK_PROTOCOL cap; a pure move from
 * gateway-session.ts, re-exported there so every import site is unchanged).
 */
import type { EventLog } from '@dokima/events';
import type {
  AgentRole,
  CostLedger,
  FitnessCardStore,
  Provider,
  ScopedRoleMatrix,
  TaskType,
} from '@dokima/gateway';
import type { ExternalToolset } from './external-tools.js';
import type { Anchor } from '@dokima/loop';

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
   * W17-01: the budget that earns itself. Present, `maxIterations` becomes
   * the STARTING budget: code-observed progress extends it window by window
   * up to `ceiling` (T-27's cap, never moved), and spinning stops the
   * session early. Absent, the fixed pre-W17-01 loop is byte-identical.
   */
  readonly progressBudget?: { readonly ceiling: number };
  /** W13-43: ceiling on one turn's output. 0 disables the bound. */
  readonly maxTurnTokens?: number;
  /** W13-44: wall-clock ceiling on the whole session. 0 disables the bound. */
  readonly maxSessionSeconds?: number;
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
  /**
   * W14-03: external MCP tools for this session — schemas already
   * allowlist-filtered by the composer (apps/server, which owns both the
   * live client pool and the notification store the approval verdicts
   * live in). Absent = the closed seven only, exactly as before.
   */
  readonly externalTools?: ExternalToolset;
}
