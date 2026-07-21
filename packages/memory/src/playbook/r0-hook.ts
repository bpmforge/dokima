/**
 * R0 escalation-rung hook, structurally compatible with
 * `packages/gateway/src/escalation/memory-hook.ts`'s `MemoryConsultHook`
 * (this package can't import that package — no workspace dependency
 * declared in this ticket's write_scope, same constraint documented on the
 * gateway side). `r0-hook.test.ts` proves the structural match for real by
 * dynamically importing gateway's actual `runEscalationLadder` and driving
 * it with this hook: a playbook/fact hit resolves the ladder at R0 with
 * zero `runAttempt` (model) calls; a miss proceeds to R1.
 */
import type { SqliteHandle } from '../store/handle.js';
import { consultPlaybook, type ConsultPlaybookOptions } from './consult.js';

export interface R0ConsultInput {
  readonly ticketId: string;
  readonly criterion: string;
}

export interface R0ConsultResult {
  readonly answered: boolean;
  readonly findingId?: string;
  readonly summary?: string;
}

export interface R0MemoryConsultHook {
  consult(input: R0ConsultInput): R0ConsultResult | Promise<R0ConsultResult>;
}

/** Real R0 hook backed by this project's playbook + fact bank (BLUEPRINT §3.3). */
export function createPlaybookMemoryConsultHook(
  handle: SqliteHandle,
  options: ConsultPlaybookOptions = {},
): R0MemoryConsultHook {
  return {
    consult(input) {
      return consultPlaybook(handle, input, options);
    },
  };
}
