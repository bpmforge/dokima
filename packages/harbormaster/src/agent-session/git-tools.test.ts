import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { git } from '@dokima/git';
import { commitTool, verifyTool } from './git-tools.js';

describe('agent-session git-tools', () => {
  let repoRoot: string | undefined;

  afterEach(async () => {
    if (repoRoot) await fs.rm(repoRoot, { recursive: true, force: true });
    repoRoot = undefined;
  });

  async function tmpRepo(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-agent-git-'));
    await git(dir, ['init', '-b', 'main']);
    await git(dir, ['config', 'user.name', 'Dokima Test']);
    await git(dir, ['config', 'user.email', 'test@dokima.invalid']);
    await fs.writeFile(path.join(dir, 'README.md'), '# fixture\n');
    await git(dir, ['add', '--', 'README.md']);
    await git(dir, ['commit', '-m', 'chore: initial commit']);
    repoRoot = dir;
    return dir;
  }

  it('commits an in-scope file', async () => {
    const dir = await tmpRepo();
    await fs.mkdir(path.join(dir, 'packages', 'example'), { recursive: true });
    await fs.writeFile(
      path.join(dir, 'packages/example/file.ts'),
      'export const x = 1;\n',
    );

    const result = (await commitTool(dir, ['packages/example/**'], {
      files: ['packages/example/file.ts'],
      message: 'feat: add file',
    })) as { ok: boolean; committed: boolean };

    expect(result).toEqual({
      ok: true,
      committed: true,
      files: ['packages/example/file.ts'],
    });
    const { stdout } = await git(dir, ['log', '--oneline', '-1']);
    expect(stdout).toContain('feat: add file');
  });

  it('refuses to commit a file outside write_scope, and leaves it uncommitted', async () => {
    const dir = await tmpRepo();
    await fs.writeFile(path.join(dir, 'outside.ts'), 'export const y = 1;\n');

    const result = (await commitTool(dir, ['packages/example/**'], {
      files: ['outside.ts'],
      message: 'feat: sneak one in',
    })) as { ok: boolean };

    expect(result.ok).toBe(false);
    const { stdout: log } = await git(dir, ['log', '--oneline']);
    expect(log).not.toContain('sneak');
    const { stdout: staged } = await git(dir, ['diff', '--cached', '--name-only']);
    expect(staged.trim()).toBe('');
  });

  it('refuses a commit call with no explicit files', async () => {
    const dir = await tmpRepo();
    const result = (await commitTool(dir, ['**'], { files: [], message: 'noop' })) as {
      ok: boolean;
    };
    expect(result.ok).toBe(false);
  });

  it('verify runs the given command in the worktree and reports its real exit code', async () => {
    const dir = await tmpRepo();
    const passing = (await verifyTool(dir, 'true', 5000)) as { exitCode: number };
    expect(passing.exitCode).toBe(0);

    const failing = (await verifyTool(dir, 'false', 5000)) as { exitCode: number };
    expect(failing.exitCode).not.toBe(0);
  });
});
