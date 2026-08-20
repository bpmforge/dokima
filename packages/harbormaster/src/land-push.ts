/**
 * Dual-remote push after a successful land (FR-I2). Split out of
 * `loop-land.ts` per CODE_BOOK_PROTOCOL.md's 400-line file cap: inlining
 * this step in `loop-land.ts` pushed it to 420 lines.
 *
 * Structurally mirrors `@dokima/forge`'s real `pushToRemotes` rather
 * than importing it directly — `packages/harbormaster/package.json`
 * declares no `@dokima/forge` dependency, and this ticket's
 * `write_scope` doesn't grant editing it (no `package.json` glob), so the
 * caller injects the real implementation (the same seam `spawn`/
 * `SpawnSession` already uses for `@dokima/loop`).
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

import { git } from '@dokima/git';
import { commentTicket } from '@dokima/tickets';
import type { EventLog } from '@dokima/events';

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
  try {
    return await pushToRemotes({ cwd: worktreePath, remotes: targets, ref: branch });
  } catch (err) {
    /**
     * W13-46: a push implementation that THROWS is turned into a recorded
     * failure, because by the time we get here the land has already happened.
     *
     * The promise one line up — "a failed remote is recorded, not fatal" — was
     * only true for an implementation that resolves with per-remote results.
     * `apps/server` injects `localFirstPushToRemotes`, which throws on purpose
     * ("refusing loudly is correct: silently returning success would report a
     * push that never happened") — and that throw escaped the land loop
     * entirely. Measured: a fixture repo with one remote crashed the run for a
     * ticket that had reached `in_review` with its manifest and receipt
     * already written. Every existing test missed it because fixture repos
     * have zero remotes, so this call is skipped outright.
     *
     * Refusing loudly stays right. Losing a completed land because the
     * announcement failed does not: durable state was written, and reporting
     * the run as a crash would be reporting a lie about it.
     */
    const detail = err instanceof Error ? err.message : String(err);
    return targets.map((remote) => ({ remote, ok: false, detail }));
  }
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
