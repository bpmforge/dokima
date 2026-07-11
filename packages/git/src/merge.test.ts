import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mergeLocal } from './merge.js';
import { commitWithScopeCheck } from './commit.js';
import { createWorktree, destroyWorktree, type WorktreeHandle } from './worktree.js';
import { git } from './git-cli.js';
import { createTempRepo, type TempRepo } from './test-helpers.js';

describe('mergeLocal', () => {
  let repo: TempRepo | undefined;
  let handle: WorktreeHandle | undefined;

  afterEach(async () => {
    if (handle)
      await destroyWorktree(handle, { deleteBranch: true }).catch(() => undefined);
    await repo?.cleanup();
    repo = undefined;
    handle = undefined;
  });

  it('merges a ticket branch into main with --no-ff, producing a merge commit', async () => {
    repo = await createTempRepo();
    handle = await createWorktree({
      repoRoot: repo.repoRoot,
      ticketId: 'W0-06',
      slug: 'git worktree service',
    });

    const filePath = path.join(handle.path, 'packages', 'git', 'src', 'feature.ts');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, 'export const feature = true;\n');
    const result = await commitWithScopeCheck(handle, {
      paths: ['packages/git/src/feature.ts'],
      message: 'feat(W0-06): add feature',
      writeScope: ['packages/git/**'],
    });
    expect(result.committed).toBe(true);

    await mergeLocal({
      repoRoot: repo.repoRoot,
      targetBranch: 'main',
      sourceBranch: handle.branch,
    });

    const { stdout: parentCount } = await git(repo.repoRoot, [
      'rev-list',
      '--parents',
      '-1',
      'HEAD',
    ]);
    // "<commit> <parent1> <parent2>" — 3 tokens only for a merge commit.
    expect(parentCount.trim().split(' ')).toHaveLength(3);

    const { stdout: log } = await git(repo.repoRoot, ['log', '-1', '--pretty=%s']);
    expect(log).toContain(handle.branch);

    const merged = await fs.readFile(
      path.join(repo.repoRoot, 'packages', 'git', 'src', 'feature.ts'),
      'utf8',
    );
    expect(merged).toContain('feature');
  });

  it('refuses to merge when repoRoot is not on the target branch', async () => {
    repo = await createTempRepo();
    handle = await createWorktree({
      repoRoot: repo.repoRoot,
      ticketId: 'W0-06',
      slug: 'git worktree service',
    });
    await git(repo.repoRoot, ['checkout', '-b', 'other']);

    await expect(
      mergeLocal({
        repoRoot: repo.repoRoot,
        targetBranch: 'main',
        sourceBranch: handle.branch,
      }),
    ).rejects.toThrow(/expected target branch 'main'/);
  });
});
