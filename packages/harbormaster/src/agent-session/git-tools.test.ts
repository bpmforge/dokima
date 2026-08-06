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

  describe(
    '(W11-03 acceptance 2, SC-01) files are placed on disk directly via ' +
      "node:fs — bypassing fs-tools.ts's write/edit pre-check entirely, as " +
      'if it had a bug or never ran — and commitTool still refuses them, ' +
      "proving SC-01's own check (packages/git's checkWriteScope, unchanged " +
      'by this ticket) is independently authoritative, never redundant',
    () => {
      it('refuses a hard-excluded path (`.github/workflows/**`) even though the pre-check never touched it', async () => {
        const dir = await tmpRepo();
        await fs.mkdir(path.join(dir, '.github', 'workflows'), { recursive: true });
        await fs.writeFile(
          path.join(dir, '.github', 'workflows', 'ci.yml'),
          'evil: true\n',
        );

        const result = (await commitTool(dir, ['.github/workflows/**'], {
          files: ['.github/workflows/ci.yml'],
          message: 'ci: sneak a workflow edit past write_scope',
        })) as { ok: boolean };

        expect(result.ok).toBe(false);
        const { stdout: log } = await git(dir, ['log', '--oneline']);
        expect(log).not.toContain('sneak');
      });

      it('refuses a hard-excluded path (`.dokima/**`) even though the pre-check never touched it', async () => {
        const dir = await tmpRepo();
        await fs.mkdir(path.join(dir, '.dokima'), { recursive: true });
        await fs.writeFile(path.join(dir, '.dokima', 'state.db'), 'tampered');

        const result = (await commitTool(dir, ['.dokima/**'], {
          files: ['.dokima/state.db'],
          message: 'chore: sneak a state.db edit past write_scope',
        })) as { ok: boolean };

        expect(result.ok).toBe(false);
        const { stdout: log } = await git(dir, ['log', '--oneline']);
        expect(log).not.toContain('sneak');
      });

      it(
        'refuses a symlink escape even when the literal path matches write_scope ' +
          '(a leaf symlink, not a symlinked ancestor dir — `git add` refuses to stage ' +
          'a path that traverses a symlinked ancestor at all ("pathspec ... is beyond ' +
          'a symbolic link"), so the shape that actually reaches checkWriteScope\'s own ' +
          'realpath check is the leaf itself being a symlink)',
        async () => {
          const dir = await tmpRepo();
          const outsideDir = await fs.mkdtemp(
            path.join(os.tmpdir(), 'dokima-agent-git-outside-'),
          );
          try {
            await fs.writeFile(path.join(outsideDir, 'leak.ts'), 'secret\n');
            await fs.symlink(path.join(outsideDir, 'leak.ts'), path.join(dir, 'evil.ts'));

            const result = (await commitTool(dir, ['evil.ts'], {
              files: ['evil.ts'],
              message: 'feat: sneak a symlink escape past write_scope',
            })) as { ok: boolean };

            expect(result.ok).toBe(false);
            const { stdout: log } = await git(dir, ['log', '--oneline']);
            expect(log).not.toContain('sneak');
          } finally {
            await fs.rm(outsideDir, { recursive: true, force: true });
          }
        },
      );
    },
  );

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
