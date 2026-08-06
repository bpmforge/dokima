/**
 * Dispatches one closed-tool-set call (`tools.ts`) to its handler
 * (`fs-tools.ts`, `git-tools.ts`), bounded to one ticket's worktree/
 * write_scope/verify command. `@dokima/mcp`'s `requestToolCall` already
 * refuses any tool id outside the role's allowlist before this ever runs
 * (`mcp-wiring.ts` registers exactly the seven names below) — the
 * `default` branch is defensive, not a real path.
 *
 * Every tool RESULT — not just `verify`'s — passes through one redaction
 * choke point here (FR-S2, SC-06, W11-14) before it reaches the model:
 * `redactDeep(outcome.result, ctx.secretValues ?? [])` (`@dokima/shared`,
 * pattern PLUS exact-value passes). `read`/`search` (`fs-tools.ts`/
 * `fs-search.ts`) return raw file content / matched lines with no
 * redaction of their own — under Law 8 a repo file inside the ticket
 * worktree should never contain a live secret to begin with, so this is
 * defence-in-depth against an accidental commit, not the routine case
 * `verify` guards (a command's live, dynamic stdout/stderr, not static
 * repo text). `verify`'s own result is ALREADY redacted — and,
 * load-bearingly, redacted BEFORE its MAX_OUTPUT_CHARS truncation (see
 * `git-tools.ts`) — by the time it reaches this wrapper, so redacting it
 * again here is a safe, idempotent no-op (already-replaced text matches no
 * further pattern or value), never a second ordering-sensitive step.
 */

import { redactDeep } from '@dokima/shared';
import type { ToolExecutionResult, ToolExecutor } from '@dokima/mcp';
import {
  editTool,
  listTool,
  readTool,
  searchTool,
  writeTool,
  type EditToolArgs,
  type ListToolArgs,
  type ReadToolArgs,
  type SearchToolArgs,
  type WriteToolArgs,
} from './fs-tools.js';
import { commitTool, verifyTool, type CommitToolArgs } from './git-tools.js';
import {
  TOOL_COMMIT,
  TOOL_EDIT,
  TOOL_LIST,
  TOOL_READ,
  TOOL_SEARCH,
  TOOL_VERIFY,
  TOOL_WRITE,
} from './tools.js';

export interface AgentSessionToolContext {
  readonly cwd: string;
  readonly writeScope: readonly string[];
  readonly verifyCommand: string;
  readonly verifyTimeoutMs: number;
  /**
   * Exact secret values for the redaction pass every tool result goes
   * through below, beyond the known live-credential shapes (FR-S2, SC-06,
   * W11-14) — vault-registered and `.env` secret values, typically
   * `collectSecretValues(vault, projectDir)` (`@dokima/shared`). Omit for
   * pattern-only redaction.
   */
  readonly secretValues?: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string') {
    throw new Error(`tool argument "${key}" must be a string`);
  }
  return value;
}

function requireStringArray(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new Error(`tool argument "${key}" must be an array of strings`);
  }
  return value;
}

async function dispatch(
  toolName: string,
  args: Record<string, unknown>,
  ctx: AgentSessionToolContext,
): Promise<ToolExecutionResult> {
  switch (toolName) {
    case TOOL_READ: {
      const readArgs: ReadToolArgs = { path: requireString(args, 'path') };
      return { result: await readTool(ctx.cwd, readArgs), cost: 0 };
    }
    case TOOL_LIST: {
      const listArgs: ListToolArgs = {
        path: typeof args.path === 'string' ? args.path : undefined,
      };
      return { result: await listTool(ctx.cwd, listArgs), cost: 0 };
    }
    case TOOL_SEARCH: {
      const searchArgs: SearchToolArgs = {
        pattern: requireString(args, 'pattern'),
        path: typeof args.path === 'string' ? args.path : undefined,
      };
      return { result: await searchTool(ctx.cwd, searchArgs), cost: 0 };
    }
    case TOOL_WRITE: {
      const writeArgs: WriteToolArgs = {
        path: requireString(args, 'path'),
        content: requireString(args, 'content'),
      };
      return { result: await writeTool(ctx.cwd, ctx.writeScope, writeArgs), cost: 0 };
    }
    case TOOL_EDIT: {
      const editArgs: EditToolArgs = {
        path: requireString(args, 'path'),
        oldString: requireString(args, 'oldString'),
        newString: requireString(args, 'newString'),
      };
      return { result: await editTool(ctx.cwd, ctx.writeScope, editArgs), cost: 0 };
    }
    case TOOL_COMMIT: {
      const commitArgs: CommitToolArgs = {
        files: requireStringArray(args, 'files'),
        message: requireString(args, 'message'),
      };
      return { result: await commitTool(ctx.cwd, ctx.writeScope, commitArgs), cost: 0 };
    }
    case TOOL_VERIFY: {
      return {
        result: await verifyTool(
          ctx.cwd,
          ctx.verifyCommand,
          ctx.verifyTimeoutMs,
          ctx.secretValues ?? [],
        ),
        cost: 0,
      };
    }
    default:
      throw new Error(
        `unreachable: mcp allowlist already refused unknown tool "${toolName}"`,
      );
  }
}

/** Builds the `ToolExecutor` `@dokima/mcp`'s `requestToolCall` invokes once a call clears the allowlist — the one seam that actually touches the worktree/git. */
export function createAgentSessionToolExecutor(
  ctx: AgentSessionToolContext,
): ToolExecutor {
  return async ({ tool, args }): Promise<ToolExecutionResult> => {
    if (!isRecord(args)) throw new Error('tool arguments must be an object');
    const outcome = await dispatch(tool.name, args, ctx);
    return {
      result: redactDeep(outcome.result, ctx.secretValues ?? []),
      cost: outcome.cost,
    };
  };
}
