/**
 * Dual/multi-remote push (BLUEPRINT "Git service": "Dual-remote sync
 * supported natively (e.g., Gitea origin + GitHub), with a remote-parity
 * check as a validator", FR-I2, W6 roadmap item). Pushes one ref to N
 * configured remotes, isolating each remote's outcome: an unreachable
 * remote (e.g. a Gitea origin off-LAN per CLAUDE.md law 10) must never
 * block a reachable one, so every push runs independently via
 * `Promise.allSettled` and gets its own per-remote status back — never a
 * single all-or-nothing promise.
 *
 * Uses `node:child_process` directly rather than `@dokima/git`'s
 * execa-based `git()` helper: `packages/forge/package.json` declares zero
 * dependencies today (see `generic-git.ts`'s header comment, W6-02, which
 * flagged this same forge -> git gap as future work) and adding one is
 * outside this ticket's `write_scope` (no `package.json` glob granted).
 * ARCHITECTURE.md §4 already permits forge -> git, so a follow-up ticket
 * can route this through the shared helper instead — a HANDOFF, not a
 * blocker, since a builtin module needs no dependency addition at all.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface RemotePushResult {
  /** The `git remote` name pushed to (e.g. `origin`, `github`). */
  readonly remote: string;
  readonly ok: boolean;
  /** stdout+stderr tail from the push, trimmed — diagnostic detail, never a promise-token. */
  readonly detail: string;
}

export interface PushToRemotesOptions {
  /** Working directory of the git repo/worktree to push from. */
  readonly cwd: string;
  /** `git remote` names to push to, e.g. `['origin', 'github']`. */
  readonly remotes: readonly string[];
  /** Ref to push, typically the ticket branch name. */
  readonly ref: string;
}

/**
 * Pushes `ref` to every named remote independently. Returns one result per
 * remote, in the same order as `options.remotes` — a failure on one remote
 * never throws or short-circuits the others (per-remote status, acceptance
 * 1).
 */
export async function pushToRemotes(
  options: PushToRemotesOptions,
): Promise<RemotePushResult[]> {
  const { cwd, remotes, ref } = options;

  const settled = await Promise.allSettled(
    remotes.map((remote) => execFileAsync('git', ['push', remote, ref], { cwd })),
  );

  return remotes.map((remote, index): RemotePushResult => {
    const result = settled[index];
    if (result === undefined) {
      return { remote, ok: false, detail: 'push result missing (internal error)' };
    }
    if (result.status === 'fulfilled') {
      const detail = [result.value.stdout, result.value.stderr]
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        .join('\n')
        .trim();
      return { remote, ok: true, detail };
    }

    const reason = result.reason as { stderr?: unknown; message?: unknown } | undefined;
    const detail = String(
      reason?.stderr ?? reason?.message ?? reason ?? 'push failed',
    ).trim();
    return { remote, ok: false, detail };
  });
}
