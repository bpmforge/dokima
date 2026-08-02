import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { classifyManifestFile, classifyManifestFiles } from './scope.js';

describe('classifyManifestFiles', () => {
  let worktreeRoot: string | undefined;
  let extraTempDirs: string[] = [];

  afterEach(async () => {
    if (worktreeRoot) await fs.rm(worktreeRoot, { recursive: true, force: true });
    worktreeRoot = undefined;
    await Promise.all(
      extraTempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
    extraTempDirs = [];
  });

  it('classifies a file that exists inside the worktree as ok', async () => {
    worktreeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-scope-'));
    await fs.mkdir(path.join(worktreeRoot, 'packages', 'example'), { recursive: true });
    await fs.writeFile(
      path.join(worktreeRoot, 'packages/example/file.ts'),
      'export {};\n',
    );

    const result = await classifyManifestFiles(worktreeRoot, [
      'packages/example/file.ts',
    ]);
    expect(result).toEqual({ missing: [], symlinkEscapes: [] });
  });

  it('classifies a file that does not exist as missing', async () => {
    worktreeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-scope-'));

    const result = await classifyManifestFiles(worktreeRoot, [
      'packages/example/never-existed.ts',
    ]);
    expect(result).toEqual({
      missing: ['packages/example/never-existed.ts'],
      symlinkEscapes: [],
    });
  });

  it('refuses a symlink whose leaf resolves outside the worktree (acceptance 1)', async () => {
    worktreeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-scope-'));
    const outsideDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'dokima-scope-outside-'),
    );
    extraTempDirs.push(outsideDir);

    const outsideFile = path.join(outsideDir, 'secret.txt');
    await fs.writeFile(outsideFile, 'not yours\n');
    await fs.mkdir(path.join(worktreeRoot, 'packages', 'example'), { recursive: true });
    const linkPath = path.join(worktreeRoot, 'packages/example/escape.txt');
    await fs.symlink(outsideFile, linkPath);

    const result = await classifyManifestFiles(worktreeRoot, [
      'packages/example/escape.txt',
    ]);
    expect(result).toEqual({
      missing: [],
      symlinkEscapes: ['packages/example/escape.txt'],
    });
  });

  it('refuses a symlinked ancestor directory even when the leaf itself does not exist', async () => {
    worktreeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-scope-'));
    const outsideDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'dokima-scope-outside-'),
    );
    extraTempDirs.push(outsideDir);

    await fs.mkdir(path.join(worktreeRoot, 'packages'), { recursive: true });
    const linkPath = path.join(worktreeRoot, 'packages/escape-dir');
    await fs.symlink(outsideDir, linkPath);

    const result = await classifyManifestFiles(worktreeRoot, [
      'packages/escape-dir/never-existed.ts',
    ]);
    expect(result).toEqual({
      missing: [],
      symlinkEscapes: ['packages/escape-dir/never-existed.ts'],
    });
  });

  it('does not misclassify an in-worktree symlink that resolves back inside the root', async () => {
    worktreeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-scope-'));
    await fs.mkdir(path.join(worktreeRoot, 'packages', 'example'), { recursive: true });
    await fs.writeFile(
      path.join(worktreeRoot, 'packages/example/real.ts'),
      'export const x = 1;\n',
    );
    const linkPath = path.join(worktreeRoot, 'packages/example/alias.ts');
    await fs.symlink(path.join(worktreeRoot, 'packages/example/real.ts'), linkPath);

    const result = await classifyManifestFiles(worktreeRoot, [
      'packages/example/alias.ts',
    ]);
    expect(result).toEqual({ missing: [], symlinkEscapes: [] });
  });
});

describe('classifyManifestFile — read', () => {
  let worktreeRoot: string | undefined;
  let extraTempDirs: string[] = [];

  afterEach(async () => {
    if (worktreeRoot) await fs.rm(worktreeRoot, { recursive: true, force: true });
    worktreeRoot = undefined;
    await Promise.all(
      extraTempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
    extraTempDirs = [];
  });

  it('reads file content from the same fd used for the containment check', async () => {
    worktreeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-scope-'));
    await fs.mkdir(path.join(worktreeRoot, 'packages', 'example'), { recursive: true });
    await fs.writeFile(
      path.join(worktreeRoot, 'packages/example/file.ts'),
      'export const x = 1;\n',
    );
    const realRoot = await fs.realpath(worktreeRoot);

    const result = await classifyManifestFile(
      worktreeRoot,
      realRoot,
      'packages/example/file.ts',
    );
    expect(result).toEqual({ status: 'ok', content: 'export const x = 1;\n' });
  });

  it('never returns content for a missing file', async () => {
    worktreeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-scope-'));
    const realRoot = await fs.realpath(worktreeRoot);

    const result = await classifyManifestFile(
      worktreeRoot,
      realRoot,
      'packages/example/never-existed.ts',
    );
    expect(result).toEqual({ status: 'missing', content: null });
  });

  it('never returns content for a symlink escape', async () => {
    worktreeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-scope-'));
    const outsideDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'dokima-scope-outside-'),
    );
    extraTempDirs.push(outsideDir);
    const outsideFile = path.join(outsideDir, 'secret.txt');
    await fs.writeFile(outsideFile, 'TOP-SECRET-NEVER-READ\n');
    await fs.mkdir(path.join(worktreeRoot, 'packages', 'example'), { recursive: true });
    const linkPath = path.join(worktreeRoot, 'packages/example/escape.txt');
    await fs.symlink(outsideFile, linkPath);
    const realRoot = await fs.realpath(worktreeRoot);

    const result = await classifyManifestFile(
      worktreeRoot,
      realRoot,
      'packages/example/escape.txt',
    );
    expect(result).toEqual({ status: 'symlink-escape', content: null });
  });

  it(
    'RED FIXTURE (TOCTOU, acceptance 3): a leaf swapped for an escaping ' +
      'symlink in the exact window between the realpath containment check ' +
      'and the fd open is refused, never read',
    async () => {
      worktreeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-scope-'));
      const outsideDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'dokima-scope-outside-'),
      );
      extraTempDirs.push(outsideDir);
      const outsideSecret = path.join(outsideDir, 'secret.txt');
      await fs.writeFile(outsideSecret, 'TOP-SECRET-NEVER-READ\n');

      await fs.mkdir(path.join(worktreeRoot, 'packages', 'example'), { recursive: true });
      // The manifest-claimed path is an ORDINARY regular file (not a
      // symlink at all) at the moment of the initial realpath check — this
      // mirrors the described attack, where the ticket's own untrusted
      // verify command replaces a real committed file with a symlink mid-
      // race. The swap happens after the check but before the fd is
      // opened, in the exact window this function's single-fd design is
      // meant to close.
      const filePath = path.join(worktreeRoot, 'packages/example/file.ts');
      await fs.writeFile(filePath, 'export const x = 1;\n');
      const realRoot = await fs.realpath(worktreeRoot);

      const result = await classifyManifestFile(
        worktreeRoot,
        realRoot,
        'packages/example/file.ts',
        {
          afterRealpathBeforeOpen: async () => {
            await fs.rm(filePath, { force: true });
            await fs.symlink(outsideSecret, filePath);
          },
        },
      );

      expect(result).toEqual({ status: 'symlink-escape', content: null });
    },
  );

  it(
    'RED FIXTURE (TOCTOU, acceptance 3): an ANCESTOR directory swapped for ' +
      'a symlink in the window between the containment check and the fd ' +
      'open is refused, never read — O_NOFOLLOW on the leaf alone cannot ' +
      'catch this, only fdStillWithinRoot can',
    async () => {
      worktreeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-scope-'));
      const outsideDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'dokima-scope-outside-'),
      );
      extraTempDirs.push(outsideDir);
      // The outside directory has a REAL (non-symlink) file at the same
      // leaf name, so once the ancestor is swapped, the open call — which
      // re-resolves the whole `real` string, ancestor included — succeeds
      // and follows straight through to it; O_NOFOLLOW never trips because
      // the leaf itself was never a symlink.
      const outsideSecret = path.join(outsideDir, 'file.ts');
      await fs.writeFile(outsideSecret, 'TOP-SECRET-NEVER-READ\n');

      await fs.mkdir(path.join(worktreeRoot, 'packages', 'example'), { recursive: true });
      const filePath = path.join(worktreeRoot, 'packages/example/file.ts');
      await fs.writeFile(filePath, 'export const x = 1;\n');
      const ancestorDir = path.join(worktreeRoot, 'packages/example');
      const realRoot = await fs.realpath(worktreeRoot);

      const result = await classifyManifestFile(
        worktreeRoot,
        realRoot,
        'packages/example/file.ts',
        {
          afterRealpathBeforeOpen: async () => {
            await fs.rm(ancestorDir, { recursive: true, force: true });
            await fs.symlink(outsideDir, ancestorDir);
          },
        },
      );

      expect(result).toEqual({ status: 'symlink-escape', content: null });
    },
  );

  it(
    'RED FIXTURE (TOCTOU, acceptance 3): an ancestor swapped to an ' +
      'escaping symlink for the open, then swapped BACK before the ' +
      'post-open containment walk runs, is still refused via the fd ' +
      'fstat/lstat identity mismatch — the ancestor walk alone would see ' +
      'a restored, unescaped directory and miss it',
    async () => {
      worktreeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-scope-'));
      const outsideDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'dokima-scope-outside-'),
      );
      extraTempDirs.push(outsideDir);
      const outsideSecret = path.join(outsideDir, 'file.ts');
      await fs.writeFile(outsideSecret, 'TOP-SECRET-NEVER-READ\n');

      await fs.mkdir(path.join(worktreeRoot, 'packages', 'example'), { recursive: true });
      const filePath = path.join(worktreeRoot, 'packages/example/file.ts');
      await fs.writeFile(filePath, 'export const x = 1;\n');
      const ancestorDir = path.join(worktreeRoot, 'packages/example');
      const realRoot = await fs.realpath(worktreeRoot);

      const result = await classifyManifestFile(
        worktreeRoot,
        realRoot,
        'packages/example/file.ts',
        {
          // Swap the ancestor out BEFORE the open, so the open lands
          // mid-escape and the fd is pinned to the OUTSIDE secret.
          afterRealpathBeforeOpen: async () => {
            await fs.rm(ancestorDir, { recursive: true, force: true });
            await fs.symlink(outsideDir, ancestorDir);
          },
          // Then restore the ancestor to a normal, unescaped directory
          // BEFORE fdStillWithinRoot's ancestor walk runs — a walk alone
          // would see nothing wrong here. Only the fd, pinned at open time
          // to the outside file, still disagrees with the now-restored path.
          afterOpenBeforeContainmentRecheck: async () => {
            await fs.rm(ancestorDir, { force: true });
            await fs.mkdir(ancestorDir, { recursive: true });
            await fs.writeFile(filePath, 'export const x = 1;\n');
          },
        },
      );

      expect(result).toEqual({ status: 'symlink-escape', content: null });
    },
  );

  it(
    'adversarial race: content is never leaked across many concurrent ' +
      'symlink swaps racing the containment check (acceptance 3)',
    async () => {
      worktreeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-scope-'));
      const outsideDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'dokima-scope-outside-'),
      );
      extraTempDirs.push(outsideDir);
      const outsideSecret = path.join(outsideDir, 'secret.txt');
      await fs.writeFile(outsideSecret, 'TOP-SECRET-NEVER-READ\n');

      await fs.mkdir(path.join(worktreeRoot, 'packages', 'example'), { recursive: true });
      const linkPath = path.join(worktreeRoot, 'packages/example/file.ts');
      const restore = async () => {
        await fs.rm(linkPath, { force: true });
        await fs.writeFile(linkPath, 'export const x = 1;\n');
      };
      await restore();
      const realRoot = await fs.realpath(worktreeRoot);

      let racing = true;
      const swapLoop = (async () => {
        while (racing) {
          try {
            await fs.rm(linkPath, { force: true });
            await fs.symlink(outsideSecret, linkPath);
            await restore();
          } catch {
            // benign — the read loop below may be mid-open
          }
        }
      })();

      const results = await Promise.all(
        Array.from({ length: 100 }, () =>
          classifyManifestFile(worktreeRoot!, realRoot, 'packages/example/file.ts'),
        ),
      );
      racing = false;
      await swapLoop;

      for (const result of results) {
        expect(result.content ?? '').not.toContain('TOP-SECRET-NEVER-READ');
        if (result.status === 'ok') {
          expect(result.content).toBe('export const x = 1;\n');
        }
      }
    },
  );
});
