/**
 * sandbox-preflight.ts — SC-07 fails closed (W13-25).
 *
 * The close gate now runs every verify under the process sandbox: cleaned env,
 * network denied. Both properties were verified by running them, not assumed —
 * a fetch inside the sandbox fails `ENOTFOUND`, and a secret placed in the
 * parent environment is invisible to the child.
 *
 * A host that cannot isolate must not quietly run unsandboxed. The board would
 * then show a green it did not earn, which is worse than never having claimed
 * the control — and SC-07 claimed it, as landed, since W6-06, while
 * `packages/harbormaster/src/sandbox/` sat complete and callerless because that
 * ticket's write_scope was the module and no ticket ever owned a call site.
 *
 * Refused HERE rather than per-verify so a run declines before claiming a
 * ticket — the same shape as the signing-key and vault refusals beside it.
 */
import { appendEvent, type EventLog } from '@dokima/events';
import { isSandboxProfileAvailable } from '@dokima/harbormaster';
import type { RunCliIO } from './run-types.js';

/**
 * False when the run must refuse. The waiver is an explicit, RECORDED act
 * rather than a silent fallback: the refusal names it, and a run that uses it
 * appends `sandbox.waived` so the log says the gate ran without its isolation.
 */
export function assertSandboxOrWaiver(
  log: EventLog,
  actorId: string,
  runId: string,
  io: RunCliIO,
): boolean {
  if (isSandboxProfileAvailable('process')) return true;

  if (!process.env.DOKIMA_ALLOW_UNSANDBOXED_VERIFY) {
    io.stderr(
      `${runId} refused: this host cannot sandbox a verify run, and SC-07 ` +
        `requires one — verify commands and validator packs are untrusted code. ` +
        `Install the platform mechanism (sandbox-exec on macOS, unshare on ` +
        `Linux), or set DOKIMA_ALLOW_UNSANDBOXED_VERIFY=1 to accept running ` +
        `them with your full environment and network. Nothing was claimed.`,
    );
    return false;
  }

  appendEvent(log, {
    eventType: 'sandbox.waived',
    actorId,
    runId,
    payload: { reason: 'no sandbox profile available on this host' },
  });
  io.stderr(
    `${runId}: running verify UNSANDBOXED — this host has no isolation ` +
      `mechanism and DOKIMA_ALLOW_UNSANDBOXED_VERIFY is set. Recorded.`,
  );
  return true;
}
