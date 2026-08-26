/**
 * worktree-harness-paths.ts — which files in a ticket worktree belong to the
 * PRODUCT rather than to the agent (W21-28, W21-29).
 *
 * Split out of worktree-provision.ts at the 400-line CODE_BOOK_PROTOCOL cap,
 * and the seam is real rather than arithmetic: provisioning decides what a
 * worktree needs and installs it; this decides what the harness may claim
 * authorship of. Two modules now import the answer — the provisioner, to
 * commit its own leavings, and the out-of-session scope sweep, to avoid
 * blaming the agent for them.
 */
import { git } from '@dokima/git';

/**
 * W21-28: paths the HARNESS owns in a ticket worktree.
 *
 * Live evidence, run 9: after a founder widened the scope, the agent did the
 * work and was then refused twice by the out-of-session SC-01 sweep for three
 * paths — ".gitignore", "package-lock.json" and "docs/work/telemetry.jsonl" —
 * not one of which it wrote. The first two are this module's own provisioning;
 * the third is written by the close gate's validators. The product was
 * mutating the agent's worktree and then blaming the agent for the difference.
 *
 * Adding a third ignore list would have been the third patch of this shape.
 * The invariant instead: the worktree a session receives has no uncommitted
 * harness changes in it. Committing them under the harness's own message keeps
 * the change attributable in git history rather than invisible, and leaves the
 * session diff containing only what the agent did.
 *
 * ONLY these paths, never `git add -A`: sweeping up a parked session's
 * uncommitted work under a harness commit would misattribute the agent's work,
 * which is worse than the bug being fixed.
 *
 * Exported because W21-29 needs the SAME list at the point where attribution
 * matters — the out-of-session scope sweep. A path the harness owns is not the
 * agent's change by construction, so the check that judges the agent must not
 * count it. One list, two uses; a second list would drift.
 *
 * `docs/work/telemetry.jsonl` earns its place here for a reason worth knowing:
 * content/validators/_lib.sh appends a verdict row to `${ROOT}/docs/work/` on
 * every validator run, so the close gate dirties the worktree AFTER
 * provisioning has committed. The better fix is for that telemetry to land in
 * `.dokima/` (already hard-excluded) instead of inside the audited project —
 * but content/ is a SIGNED pack (content/manifest.json carries per-file
 * sha256 hashes and a signature), so changing it there needs a re-sign with a
 * key held outside this repo.
 */
export const HARNESS_OWNED_PATHS = [
  '.gitignore',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'docs/work/telemetry.jsonl',
];

/**
 * Commit whatever the harness changed, so the next session's diff is only the
 * agent's. Returns the paths committed; empty when the worktree was already
 * clean of harness changes.
 */
export async function commitHarnessChanges(worktreePath: string): Promise<string[]> {
  /**
   * Best-effort tidying, never a gate. A directory that is not a git worktree
   * (tests, and any future caller) must not turn provisioning into a failure —
   * the worst case of not committing here is the pre-existing behaviour.
   */
  try {
    return await commitHarnessChangesUnsafe(worktreePath);
  } catch {
    return [];
  }
}

async function commitHarnessChangesUnsafe(worktreePath: string): Promise<string[]> {
  const status = await git(worktreePath, ['status', '--porcelain']);
  const dirty = status.stdout
    .split('\n')
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
  const toCommit = HARNESS_OWNED_PATHS.filter((owned) => dirty.includes(owned));
  if (toCommit.length === 0) return [];
  await git(worktreePath, ['add', '--', ...toCommit]);
  await git(worktreePath, [
    'commit',
    '--no-verify',
    '-m',
    'chore(harness): provision worktree\n\nWritten by Dokima itself, not by the agent — dependency install and\nvalidator telemetry. Committed so the session diff contains only the\nagent\'s work (W21-28).',
    '--',
    ...toCommit,
  ]);
  return toCommit;
}


/**
 * The subset of `paths` the AGENT is answerable for (W21-31).
 *
 * Three checks ask this question — the out-of-session scope sweep, the close
 * gate's commit-set check, and the provisioner deciding what it may commit —
 * and they must not drift, because drift here means either the agent blamed
 * for the product's changes or a real violation missed.
 *
 * The close gate needs it because W21-28 changed what "committed" means. That
 * check deliberately reads the real commit set rather than the working tree,
 * so the gate's own telemetry and build artifacts could not cause false
 * positives — and then the harness started COMMITTING its files so the session
 * diff would be clean, which put them in the very set the check trusted. The
 * first Completion Manifest the product ever produced was refused for
 * `.gitignore` and `package-lock.json`, neither of which the agent wrote.
 */
export function agentAuthoredPaths(paths: readonly string[]): string[] {
  return paths.filter((p) => !(HARNESS_OWNED_PATHS as readonly string[]).includes(p));
}
