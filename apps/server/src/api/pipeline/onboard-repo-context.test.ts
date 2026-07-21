import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { gatherOnboardRepoContext } from './onboard-repo-context.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd });
}

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

async function mkTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('gatherOnboardRepoContext (W8-09 fix — real repo material for the single-turn specialist)', () => {
  it('reads the directory listing, commit log, and key file contents from a real git repo', async () => {
    const repoRoot = await mkTempDir('shipwright-onboard-repo-context-git-');
    await git(repoRoot, ['init', '-b', 'main']);
    await git(repoRoot, ['config', 'user.name', 'Shipwright Test']);
    await git(repoRoot, ['config', 'user.email', 'test@shipwright.invalid']);
    await fs.writeFile(path.join(repoRoot, 'README.md'), '# fixture repo\n');
    await fs.mkdir(path.join(repoRoot, 'src'));
    await fs.writeFile(path.join(repoRoot, 'src', 'index.ts'), 'export const x = 1;\n');
    await git(repoRoot, ['add', '--', 'README.md', 'src/index.ts']);
    await git(repoRoot, ['commit', '-m', 'chore: initial commit']);

    const ctx = await gatherOnboardRepoContext(repoRoot);

    expect(ctx.repoRoot).toBe(repoRoot);
    expect(ctx.isGitRepo).toBe(true);
    expect(ctx.directoryListing).toEqual(['README.md', 'src/index.ts']);
    expect(ctx.directoryListingTruncated).toBe(false);
    expect(ctx.recentCommits).toHaveLength(1);
    expect(ctx.recentCommits[0]?.subject).toBe('chore: initial commit');
    expect(ctx.keyFiles['README.md']).toBe('# fixture repo\n');
    expect(ctx.keyFiles['package.json']).toBeUndefined();
    expect(ctx.sourceSamples['src/index.ts']).toBe('export const x = 1;\n');
    expect(ctx.sourceSamplesTruncated).toBe(false);
  });

  it('samples real source-file contents (bounded, deterministic, never test files)', async () => {
    const repoRoot = await mkTempDir('shipwright-onboard-repo-context-samples-');
    await git(repoRoot, ['init', '-b', 'main']);
    await git(repoRoot, ['config', 'user.name', 'Shipwright Test']);
    await git(repoRoot, ['config', 'user.email', 'test@shipwright.invalid']);
    await fs.mkdir(path.join(repoRoot, 'src'));
    for (let i = 0; i < 14; i += 1) {
      await fs.writeFile(
        path.join(repoRoot, 'src', `mod-${String(i).padStart(2, '0')}.ts`),
        `export const mod${i} = ${i};\n`,
      );
    }
    await fs.writeFile(
      path.join(repoRoot, 'src', 'mod-00.test.ts'),
      'import { expect } from "vitest";\n',
    );
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'chore: add sources']);

    const ctx = await gatherOnboardRepoContext(repoRoot);

    expect(Object.keys(ctx.sourceSamples)).toHaveLength(12);
    expect(ctx.sourceSamplesTruncated).toBe(true);
    expect(ctx.sourceSamples['src/mod-00.ts']).toBe('export const mod0 = 0;\n');
    expect(Object.keys(ctx.sourceSamples)).not.toContain('src/mod-00.test.ts');
  });

  it('falls back to a filesystem walk and yields empty commits/keyFiles for a non-git directory', async () => {
    const root = await mkTempDir('shipwright-onboard-repo-context-nogit-');
    await fs.writeFile(path.join(root, 'notes.txt'), 'hello\n');
    await fs.mkdir(path.join(root, 'node_modules'));
    await fs.writeFile(path.join(root, 'node_modules', 'ignored.js'), 'x\n');

    const ctx = await gatherOnboardRepoContext(root);

    expect(ctx.isGitRepo).toBe(false);
    expect(ctx.directoryListing).toEqual(['notes.txt']);
    expect(ctx.recentCommits).toEqual([]);
    expect(ctx.keyFiles).toEqual({});
    expect(ctx.sourceSamples).toEqual({});
  });

  it('truncates an oversized key file and flags a large directory listing as truncated', async () => {
    const repoRoot = await mkTempDir('shipwright-onboard-repo-context-trunc-');
    await git(repoRoot, ['init', '-b', 'main']);
    await git(repoRoot, ['config', 'user.name', 'Shipwright Test']);
    await git(repoRoot, ['config', 'user.email', 'test@shipwright.invalid']);
    await fs.writeFile(path.join(repoRoot, 'README.md'), 'x'.repeat(5000));
    const names = ['README.md'];
    for (let i = 0; i < 401; i += 1) {
      const name = `file-${i}.txt`;
      names.push(name);
      await fs.writeFile(path.join(repoRoot, name), 'x');
    }
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'chore: bulk add']);

    const ctx = await gatherOnboardRepoContext(repoRoot);

    expect(ctx.directoryListingTruncated).toBe(true);
    expect(ctx.directoryListing.length).toBe(400);
    expect(ctx.keyFiles['README.md']?.endsWith('...[truncated]')).toBe(true);
    expect(ctx.keyFiles['README.md']?.length).toBeLessThan(5000);
  });
});
