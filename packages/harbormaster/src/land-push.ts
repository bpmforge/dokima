/**
 * Dual-remote push after a successful land (FR-I2). Split out of
 * `loop-land.ts` per CODE_BOOK_PROTOCOL.md's 400-line file cap: inlining
 * this step in `loop-land.ts` pushed it to 420 lines.
 *
 * Structurally mirrors `@shipwright/forge`'s real `pushToRemotes` rather
 * than importing it directly — `packages/harbormaster/package.json`
 * declares no `@shipwright/forge` dependency, and this ticket's
 * `write_scope` doesn't grant editing it (no `package.json` glob), so the
 * caller injects the real implementation (the same seam `spawn`/
 * `SpawnSession` already uses for `@shipwright/loop`).
 *
 * SCOPE NOTE (review-caught, not a full amplifier-hole-11 close): this
 * pushes the ticket's own pre-review branch (`worktree.branch`) at the
 * loop's checkpoint (`in_review`) — it runs BEFORE the human/reviewer
 * merge to `main` this package deliberately never performs (`loop-land.ts`
 * module docstring). It is real, useful per-ticket backup/visibility of
 * reviewed work landing on both remotes, but it is NOT the conductor's
 * `pushRemotes()` (conductor.mjs:375), which pushes `main` on ROOT AFTER
 * `git merge --no-ff`. A genuine main-branch parity guard against
 * amplifier hole 11 needs a check at that actual merge point (conductor.mjs
 * or wherever branch-protection/reviewer-merge happens), which is outside
 * this file and outside this ticket's `write_scope`.
 */

import { git } from '@shipwright/git';
import { commentTicket } from '@shipwright/tickets';
import type { EventLog } from '@shipwright/events';

export interface LandPushRemoteResult {
  readonly remote: string;
  readonly ok: boolean;
  readonly detail: string;
}

export type PushToRemotesFn = (options: {
  readonly cwd: string;
  readonly remotes: readonly string[];
  readonly ref: string;
}) => Promise<readonly LandPushRemoteResult[]>;

/** `git remote` names actually configured on the repo, read fresh (never cached — a remote added between runs must be picked up). */
export async function configuredRemotes(cwd: string): Promise<readonly string[]> {
  const { stdout } = await git(cwd, ['remote']);
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Pushes a landed ticket's branch to `remotes` (defaulting to whatever the
 * repo actually has configured, local-first: zero remotes is a normal,
 * valid setup and pushes nothing). Isolated per-remote inside
 * `pushToRemotes` (`Promise.allSettled`) — an unreachable remote never
 * aborts the push to the other, nor the land loop itself. Returns the
 * per-remote results (empty when zero remotes are configured) so the
 * caller can surface a failed push instead of it vanishing silently.
 */
export async function pushLandedBranch(
  pushToRemotes: PushToRemotesFn,
  worktreePath: string,
  branch: string,
  remotes?: readonly string[],
): Promise<readonly LandPushRemoteResult[]> {
  const targets = remotes ?? (await configuredRemotes(worktreePath));
  if (targets.length === 0) return [];
  return pushToRemotes({ cwd: worktreePath, remotes: targets, ref: branch });
}

/**
 * Records any failed remote from `pushLandedBranch`'s results as ticket
 * evidence (Law 4: durable state visibility goes through the verbs API,
 * not a swallowed return value) — a no-op when every push succeeded.
 */
export function recordFailedPushes(
  log: EventLog,
  actorId: string,
  ticketId: string,
  results: readonly LandPushRemoteResult[],
): void {
  const failed = results.filter((result) => !result.ok);
  if (failed.length === 0) return;
  commentTicket(log, {
    ticketId,
    actorId,
    body: [
      `dual-remote push: ${failed.length}/${results.length} remote(s) failed after land (FR-I2).`,
      ...failed.map((result) => `- ${result.remote}: ${result.detail}`),
    ].join('\n'),
  });
}
