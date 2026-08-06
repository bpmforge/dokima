/**
 * `ToolSchema`/`ToolCall` (`packages/gateway/src/providers/types.ts`) are
 * real types `ChatRequest.tools`/`ChatResponse.toolCalls` already
 * reference — but W11-01 never widened `providers/index.ts`'s barrel to
 * re-export them by name, so `import { ToolSchema } from '@dokima/gateway'`
 * fails with "no exported member" even though the shape is live and used.
 * `packages/gateway/src/providers/index.ts` is outside this ticket's
 * write_scope, so rather than hand-duplicate the field lists (drift risk)
 * or silently widen another package's file (PLAYBOOK.md: "if scope must
 * widen, stop and write a HANDOFF"), both are derived structurally via
 * indexed access on the types that ARE exported. Flagged as a HANDOFF in
 * this ticket's notes — the real fix is widening that barrel.
 */
import type { ChatRequest, ChatResponse } from '@dokima/gateway';

export type ToolSchema = NonNullable<ChatRequest['tools']>[number];
export type ToolCall = NonNullable<ChatResponse['toolCalls']>[number];
