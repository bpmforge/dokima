/**
 * loop-land-handoff-wrap.ts — the two facts a handoff can only learn from the
 * worktree (W21-75).
 *
 * `HandoffBuilder` takes a ticket and nothing else, which is right: a handoff
 * is built from the board. But two of its fields are true only of the tree the
 * session will actually run in, and both were wrong when guessed from the
 * board alone.
 *
 * `environment` (W21-12) says whether dependencies were installed.
 * `verify` said `pnpm lint && pnpm typecheck && pnpm test` — Dokima's own gate
 * — for every project the product builds, because decomposition writes no
 * verify command and `defaultHandoffBuilder` falls back to that literal.
 *
 * Wrapping here rather than widening `HandoffBuilder` and every caller is the
 * shape this engine already uses for `spawn` redaction; keeping both wrappers
 * together is what took `loop-land-ticket.ts` back under the 400-line cap.
 */
import type { Ticket } from '@dokima/tickets';
import type { AttemptFeedback } from './loop-handoff.js';
import type { LandLoopOptions } from './loop-land.js';
import { provisionEnvironmentNote, type ProvisionResult } from './worktree-provision.js';
import { verifyCommandFor } from './verify-command.js';

/**
 * Returns `options` with its handoff builder taught what the worktree knows:
 * whether provisioning ran, and the command the close gate will re-run.
 *
 * The verify wrap is unconditional — a maker told to satisfy one command and
 * judged on another is how Tally's agent came to write
 * `"test": "echo 'Tests passed' || true"`.
 */
export async function wrapHandoffForWorktree(
  options: LandLoopOptions,
  provision: ProvisionResult,
  worktreePath: string,
): Promise<LandLoopOptions> {
  let next = options;
  const environment = provisionEnvironmentNote(provision);
  if (environment) {
    const inner = next.buildHandoff;
    next = {
      ...next,
      buildHandoff: async (t: Ticket, f?: AttemptFeedback) => ({
        ...(await inner(t, f)),
        environment,
      }),
    };
  }
  const inner = next.buildHandoff;
  return {
    ...next,
    buildHandoff: async (t: Ticket, f?: AttemptFeedback) => ({
      ...(await inner(t, f)),
      verify: await verifyCommandFor(worktreePath, t.verify, t.acceptance ?? []),
    }),
  };
}
