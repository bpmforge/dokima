import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkWriteScope } from './scope.js';
import { createTempRepo, type TempRepo } from './test-helpers.js';

describe('checkWriteScope', () => {
  let repo: TempRepo | undefined;

  afterEach(async () => {
    await repo?.cleanup();
    repo = undefined;
  });

  it('allows paths inside the write_scope globs', async () => {
    repo = await createTempRepo();
    const violations = await checkWriteScope(
      ['packages/git/src/index.ts', 'packages/git/test/foo.test.ts'],
      ['packages/git/**'],
      repo.repoRoot,
    );
    expect(violations).toEqual([]);
  });

  it('refuses paths outside the write_scope globs', async () => {
    repo = await createTempRepo();
    const violations = await checkWriteScope(
      ['packages/events/src/index.ts'],
      ['packages/git/**'],
      repo.repoRoot,
    );
    expect(violations).toEqual([
      { path: 'packages/events/src/index.ts', reason: 'outside-scope' },
    ]);
  });

  it.each([
    ['.git/hooks/pre-commit'],
    ['.github/workflows/ci.yml'],
    ['.shipwright/settings.json'],
  ])(
    'refuses hard-excluded path %s even when write_scope would otherwise allow it',
    async (hardExcluded) => {
      repo = await createTempRepo();
      const violations = await checkWriteScope([hardExcluded], ['**'], repo.repoRoot);
      expect(violations).toEqual([{ path: hardExcluded, reason: 'hard-excluded' }]);
    },
  );

  it('refuses a symlink that resolves outside the worktree', async () => {
    repo = await createTempRepo();
    const outsideDir = await fs.mkdtemp(
      path.join(path.dirname(repo.repoRoot), 'outside-'),
    );
    try {
      const outsideFile = path.join(outsideDir, 'secret.txt');
      await fs.writeFile(outsideFile, 'not yours\n');
      const linkPath = path.join(repo.repoRoot, 'packages', 'git', 'escape.txt');
      await fs.mkdir(path.dirname(linkPath), { recursive: true });
      await fs.symlink(outsideFile, linkPath);

      const violations = await checkWriteScope(
        ['packages/git/escape.txt'],
        ['packages/git/**'],
        repo.repoRoot,
      );
      expect(violations).toEqual([
        { path: 'packages/git/escape.txt', reason: 'symlink-escape' },
      ]);
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });
});
