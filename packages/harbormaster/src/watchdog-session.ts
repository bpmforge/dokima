/**
 * One watched agent session (BLUEPRINT §3.6/§7.1, FR-H2): wires
 * `watchdog-process.ts`'s real session-tree spawner to `@shipwright/loop`'s
 * `runSession` and `watchdog.ts`'s dead-letter escalation, so a caller
 * gets the same `SessionResult` shape `loop-claim.ts`/`loop-land.ts`
 * already work with, plus the watchdog guard, in one call. Not yet wired
 * into those loops — out of this ticket's write-scope
 * (packages/harbormaster/src/watchdog*) — this is the drop-in unit a
 * future ticket composes into the claim/land loops.
 */

import { runSession, type Handoff, type SessionResult } from '@shipwright/loop';
import type { EventLog } from '@shipwright/events';
import { createWatchdogChildProcessSpawn } from './watchdog-process.js';
import {
  deadLetterAndBlock,
  type WatchdogBreach,
  type WatchdogLimits,
} from './watchdog.js';

export interface RunWatchdogSessionOptions extends WatchdogLimits {
  readonly log: EventLog;
  readonly actorId: string;
  readonly ticketId: string;
  readonly runId?: string | null;
  readonly handoff: Handoff;
  /** Ticket worktree root — the session runs here (BLUEPRINT §3.9). */
  readonly cwd: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly pollIntervalMs?: number;
  readonly forceKillGraceMs?: number;
}

export interface RunWatchdogSessionResult {
  readonly session: SessionResult;
  readonly breach: WatchdogBreach | null;
}

/**
 * Runs one HANDOFF as a watched child-process session. On breach, mints
 * the dead-letter event and auto-blocks the ticket immediately (before
 * awaiting the killed tree's teardown), then still awaits `runSession` so
 * the caller gets a complete `SessionResult` (truncated output, whatever
 * manifest — if any — the tree emitted before it was killed).
 */
export async function runWatchdogSession(
  options: RunWatchdogSessionOptions,
): Promise<RunWatchdogSessionResult> {
  let breach: WatchdogBreach | null = null;

  const spawn = createWatchdogChildProcessSpawn({
    maxSessionSeconds: options.maxSessionSeconds,
    heartbeatStallSeconds: options.heartbeatStallSeconds,
    command: options.command,
    args: options.args,
    env: options.env,
    pollIntervalMs: options.pollIntervalMs,
    forceKillGraceMs: options.forceKillGraceMs,
    onBreach: (detected) => {
      breach = detected;
      deadLetterAndBlock({
        log: options.log,
        actorId: options.actorId,
        ticketId: options.ticketId,
        runId: options.runId,
        breach: detected,
      });
    },
  });

  const session = await runSession({ handoff: options.handoff, cwd: options.cwd, spawn });
  return { session, breach };
}
