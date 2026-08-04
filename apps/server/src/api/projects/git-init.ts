/**
 * projects/git-init.ts — a new product is a git repository (W10-79).
 *
 * `New Product` used to create a bare directory with a `.dokima/` in it. That
 * was invisible until W10-77 landed the agentic loop, which claims a ticket
 * into a real git worktree (`ClaimLoopOptions.repoRoot`, `createWorktree`) —
 * so every product the Fleet created would have failed on its first claim.
 * Measured: the loop only ran this session against a repo initialised by hand.
 *
 * THREE DECISIONS, RECORDED because the ticket asked for them:
 *
 *  - ALREADY A REPO ROOT -> left alone. Re-registering a directory someone
 *    already version-controls must not rewrite their history or their
 *    `.gitignore`.
 *  - INSIDE SOMEONE ELSE'S REPO -> still initialised, as its own repo. The
 *    alternative is adopting the parent, which would put `sw/<ticket>` branches
 *    and agent commits somewhere the founder never pointed at — a far worse
 *    surprise than a nested repository.
 *  - GIT MISSING OR FAILING -> throws. The product's core loop cannot run
 *    without git, and a project created now that silently cannot be worked
 *    later is exactly the class of defect this ticket came from.
 *
 * The first commit carries a `.gitignore` rather than being empty: the loop
 * branches from a fork point, and the event log must not become tracked
 * content that an agent session could commit.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { git } from '@dokima/git';

/** The event log's directory — ignored, never tracked content an agent could commit. */
const PROJECT_STATE_DIR_NAME = '.dokima';

const GITIGNORE_BODY = `${PROJECT_STATE_DIR_NAME}/\n`;

export class ProjectGitInitError extends Error {
  constructor(projectPath: string, cause: string) {
    super(
      `could not make ${projectPath} a git repository, and a product must be one ` +
        `for tickets to be worked (each ticket runs in its own worktree): ${cause}`,
    );
    this.name = 'ProjectGitInitError';
  }
}

/**
 * SYMLINK-SAFE ON PURPOSE (the W3-09 lesson, hit again here). `git rev-parse
 * --show-toplevel` reports the REAL path, while the caller's path may run
 * through a symlink — every macOS temp dir does (`/var` -> `/private/var`), and
 * so does any project under one. Comparing the two as written would decide a
 * repository was not its own root and re-initialise it, destroying the "leave
 * an existing repo alone" guarantee exactly where it matters most.
 */
async function isRepoRoot(dir: string): Promise<boolean> {
  try {
    const { stdout } = await git(dir, ['rev-parse', '--show-toplevel']);
    const [top, here] = await Promise.all([
      fs.realpath(stdout.trim()),
      fs.realpath(dir),
    ]);
    return top === here;
  } catch {
    return false;
  }
}

/**
 * Makes `projectPath` a git repository with one commit, unless it already is
 * a repository root. Idempotent: safe to call on every registration.
 */
export async function ensureGitRepo(projectPath: string): Promise<void> {
  if (await isRepoRoot(projectPath)) return;

  try {
    await git(projectPath, ['init', '-b', 'main']);

    const gitignorePath = path.join(projectPath, '.gitignore');
    let existing = '';
    try {
      existing = await fs.readFile(gitignorePath, 'utf8');
    } catch {
      existing = '';
    }
    if (!existing.split('\n').includes(`${PROJECT_STATE_DIR_NAME}/`)) {
      await fs.writeFile(
        gitignorePath,
        existing.length > 0
          ? `${existing.replace(/\n*$/, '\n')}${GITIGNORE_BODY}`
          : GITIGNORE_BODY,
      );
    }

    // Committer identity is set ON THIS REPO rather than assumed: a machine
    // with no global git config (a fresh CI container, a new laptop) would
    // otherwise fail the commit with "Please tell me who you are", turning
    // "create a product" into an error about git configuration.
    await git(projectPath, ['config', 'user.email', 'dokima@localhost']);
    await git(projectPath, ['config', 'user.name', 'Dokima']);

    await git(projectPath, ['add', '.gitignore']);
    await git(projectPath, ['commit', '-m', 'chore: initialise product']);
  } catch (err) {
    throw new ProjectGitInitError(
      projectPath,
      err instanceof Error ? err.message : String(err),
    );
  }
}
