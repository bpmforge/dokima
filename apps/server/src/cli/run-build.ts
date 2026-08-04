/**
 * cli/run-build.ts — the build-mode run (W10-77).
 *
 * Chapter of run-cmd.ts, split under the 400-line CODE_BOOK_PROTOCOL cap that
 * `validate-file-size` enforces repo-wide since W10-49. Extraction plus this
 * header only; no behaviour change.
 */

import type { EventLog } from '@dokima/events';
import { resolveAsset } from '@dokima/shared';
import { createChildProcessSpawn } from '@dokima/loop';
import {
  defaultHandoffBuilder,
  runLandLoop,
  type PushToRemotesFn,
} from '@dokima/harbormaster';
import type { BuildRunCommand, RunCliIO } from './run-types.js';

/**
 * The build-mode run (W10-77): claim work off the board and actually do it.
 *
 * Until this existed, `run start --mode new_product` minted a run record and
 * returned — measured at under a second on a box whose local model takes ~30s
 * for one call, with the board unchanged and no session anywhere. `--berths`
 * was validated, stored, and read by nothing. The engine it needed
 * (`runLandLoop`: claim -> session -> close gate -> land) was implemented in
 * W3-01a/b/c and exported from nothing until W10-78.
 *
 * THE AGENT COMMAND IS NEVER DEFAULTED. `runSession` detects work by `git
 * diff` in the ticket worktree, so a spawner that cannot edit files produces
 * zero changed paths, exhausts the session cap and auto-blocks every ticket —
 * a loop that looks like execution and lands nothing. The only honest options
 * are a real agent CLI or an explicit refusal, and choosing the former spends
 * the founder's own quota on unattended runs. So: refuse, and say what to do.
 */
export async function executeBuildRun(
  log: EventLog,
  command: BuildRunCommand,
  runId: string,
  io: RunCliIO,
): Promise<number> {
  if (!command.agentCommand) {
    io.stderr(
      `${runId} started, but no agent is configured to work the board — pass ` +
        `--agent-command <cli> (the command is run once per ticket session, ` +
        `inside that ticket's own git worktree, with the handoff as its final ` +
        `argument). Nothing was claimed.`,
    );
    return 2;
  }

  const [agentBin, ...agentArgs] = command.agentCommand.split(' ').filter(Boolean);
  if (!agentBin) {
    io.stderr(`--agent-command was empty after trimming; nothing was claimed`);
    return 2;
  }

  const signingKey = process.env.DOKIMA_SIGNING_KEY;
  if (!signingKey) {
    // The close gate MINTS a receipt (C-5). Minting with a placeholder would
    // produce receipts that verify against nothing, which is worse than
    // refusing to start.
    io.stderr(
      `${runId} started, but DOKIMA_SIGNING_KEY is unset — the close gate mints ` +
        `signed receipts and will not mint unverifiable ones. Nothing was claimed.`,
    );
    return 2;
  }

  const result = await runLandLoop({
    log,
    actorId: command.actorId,
    projectId: command.projectId,
    repoRoot: io.cwd,
    contentDir: resolveAsset('content', 'validators'),
    signingKey,
    spawn: createChildProcessSpawn({ command: agentBin, args: agentArgs }),
    buildHandoff: defaultHandoffBuilder(),
    pushToRemotes: localFirstPushToRemotes,
    now: io.now,
  });

  for (const outcome of result.processed) {
    io.stdout(
      `${outcome.ticketId}: ${outcome.landed ? 'landed' : `parked (${outcome.parkedReason ?? 'unknown'})`}` +
        ` after ${outcome.attempts.length} attempt(s)`,
    );
  }
  io.stdout(
    `${runId} finished: ${result.processed.filter((o) => o.landed).length} landed, ` +
      `${result.processed.filter((o) => !o.landed).length} parked (stop: ${result.stopReason})`,
  );
  return 0;
}

/**
 * Local-first push (FR-I2 partial). `runLandLoop` defaults `pushRemotes` to
 * whatever `git remote` actually reports, and a project with no remotes — the
 * normal local-first case — never reaches this. Reaching it means remotes ARE
 * configured, and real dual-remote push lives in `@dokima/forge`, which is not
 * a declared dependency of `apps/server`. Refusing loudly is correct: silently
 * returning success would report a push that never happened.
 */
const localFirstPushToRemotes: PushToRemotesFn = () => {
  throw new Error(
    'dual-remote push is not wired into the CLI yet (@dokima/forge is not an ' +
      'apps/server dependency) — the ticket landed locally and was NOT pushed',
  );
};
