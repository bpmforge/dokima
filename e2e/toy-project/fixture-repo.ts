/**
 * A real, throwaway git worktree standing in for a ticket's checkout
 * (BLUEPRINT §3.9) — same pattern as packages/loop/src/session.test.ts's
 * createTempRepo, duplicated here rather than imported because this
 * directory is outside packages/loop's write_scope (W1-07 plan.json).
 */

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

export interface FixtureRepo {
  readonly repoRoot: string;
  readonly cleanup: () => Promise<void>;
}

export async function createFixtureRepo(): Promise<FixtureRepo> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-toy-project-'));
  await git(repoRoot, ['init', '-b', 'main']);
  await git(repoRoot, ['config', 'user.name', 'Shipwright Toy Project']);
  await git(repoRoot, ['config', 'user.email', 'toy-project@shipwright.invalid']);
  await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });
  await fs.writeFile(path.join(repoRoot, 'README.md'), '# toy project fixture\n');
  await git(repoRoot, ['add', '--', 'README.md']);
  await git(repoRoot, ['commit', '-m', 'chore: initial commit']);
  return {
    repoRoot,
    cleanup: () => fs.rm(repoRoot, { recursive: true, force: true }),
  };
}
