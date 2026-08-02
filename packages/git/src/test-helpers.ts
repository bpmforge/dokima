import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git } from './git-cli.js';

export interface TempRepo {
  repoRoot: string;
  cleanup: () => Promise<void>;
}

/** A throwaway git repo (main branch, one commit, local identity) for tests. */
export async function createTempRepo(): Promise<TempRepo> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-git-test-'));
  await git(repoRoot, ['init', '-b', 'main']);
  await git(repoRoot, ['config', 'user.name', 'Dokima Test']);
  await git(repoRoot, ['config', 'user.email', 'test@dokima.invalid']);
  await fs.writeFile(path.join(repoRoot, 'README.md'), '# fixture\n');
  await git(repoRoot, ['add', '--', 'README.md']);
  await git(repoRoot, ['commit', '-m', 'chore: initial commit']);
  return {
    repoRoot,
    cleanup: () => fs.rm(repoRoot, { recursive: true, force: true }),
  };
}
