import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  editTool,
  listTool,
  normalizeRelPath,
  readTool,
  resolveWithinWorktree,
  searchTool,
  writeTool,
  ToolPathEscapeError,
} from './fs-tools.js';

describe('agent-session fs-tools', () => {
  let cwd: string | undefined;
  let extraTempDirs: string[] = [];

  afterEach(async () => {
    if (cwd) await fs.rm(cwd, { recursive: true, force: true });
    cwd = undefined;
    await Promise.all(
      extraTempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
    extraTempDirs = [];
  });

  async function tmpWorktree(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-agent-fs-'));
    cwd = dir;
    return dir;
  }

  it('resolveWithinWorktree accepts a nested relative path and refuses a `..` escape', () => {
    expect(resolveWithinWorktree('/tmp/worktree', 'src/a.ts')).toBe(
      '/tmp/worktree/src/a.ts',
    );
    expect(() => resolveWithinWorktree('/tmp/worktree', '../outside.ts')).toThrow(
      ToolPathEscapeError,
    );
  });

  it('write then read round-trips file content', async () => {
    const dir = await tmpWorktree();
    const written = (await writeTool(dir, {
      path: 'src/a.ts',
      content: 'export const x = 1;\n',
    })) as { ok: boolean };
    expect(written.ok).toBe(true);

    const read = (await readTool(dir, { path: 'src/a.ts' })) as {
      ok: boolean;
      content: string;
    };
    expect(read.ok).toBe(true);
    expect(read.content).toBe('export const x = 1;\n');
  });

  it('read reports a missing file without throwing', async () => {
    const dir = await tmpWorktree();
    const result = (await readTool(dir, { path: 'nope.ts' })) as {
      ok: boolean;
      status: string;
    };
    expect(result).toEqual({ ok: false, status: 'missing', path: 'nope.ts' });
  });

  it('normalizeRelPath strips a leading ./ and normalizes backslash separators', () => {
    expect(normalizeRelPath('./packages/example/file.ts')).toBe(
      'packages/example/file.ts',
    );
    expect(normalizeRelPath('packages/example/file.ts')).toBe('packages/example/file.ts');
  });

  it('write refuses through a symlinked ancestor that escapes the worktree (SC-01 symlink-escape, the fourth Verify case)', async () => {
    const dir = await tmpWorktree();
    const outsideDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'dokima-agent-fs-outside-'),
    );
    extraTempDirs.push(outsideDir);
    await fs.symlink(outsideDir, path.join(dir, 'evil'));

    const result = (await writeTool(dir, {
      path: 'evil/leak.ts',
      content: 'exfiltrated',
    })) as { ok: boolean };

    expect(result.ok).toBe(false);
    await expect(fs.stat(path.join(outsideDir, 'leak.ts'))).rejects.toThrow();
  });

  it('edit refuses through a symlinked ancestor that escapes the worktree (SC-01 symlink-escape)', async () => {
    const dir = await tmpWorktree();
    const outsideDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'dokima-agent-fs-outside-'),
    );
    extraTempDirs.push(outsideDir);
    await fs.writeFile(path.join(outsideDir, 'leak.ts'), 'original\n');
    await fs.symlink(outsideDir, path.join(dir, 'evil'));

    const result = (await editTool(dir, {
      path: 'evil/leak.ts',
      oldString: 'original',
      newString: 'tampered',
    })) as { ok: boolean };

    expect(result.ok).toBe(false);
    await expect(fs.readFile(path.join(outsideDir, 'leak.ts'), 'utf8')).resolves.toBe(
      'original\n',
    );
  });

  it('write refuses a direct `.git` write (hard-excluded, SC-01)', async () => {
    const dir = await tmpWorktree();
    const result = (await writeTool(dir, {
      path: '.git/config',
      content: 'evil',
    })) as { ok: boolean; refused?: boolean };
    expect(result.ok).toBe(false);
    await expect(fs.stat(path.join(dir, '.git', 'config'))).rejects.toThrow();
  });

  it('edit refuses when oldString is not found', async () => {
    const dir = await tmpWorktree();
    await writeTool(dir, { path: 'a.ts', content: 'const x = 1;\n' });
    const result = (await editTool(dir, {
      path: 'a.ts',
      oldString: 'const y',
      newString: 'const z',
    })) as { ok: boolean; reason: string };
    expect(result).toEqual({
      ok: false,
      reason: 'oldString not found',
      occurrences: 0,
      path: 'a.ts',
    });
  });

  it('edit refuses an ambiguous (non-unique) oldString', async () => {
    const dir = await tmpWorktree();
    await writeTool(dir, { path: 'a.ts', content: 'x\nx\n' });
    const result = (await editTool(dir, {
      path: 'a.ts',
      oldString: 'x',
      newString: 'y',
    })) as { ok: boolean; reason: string; occurrences: number };
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('oldString is not unique');
    expect(result.occurrences).toBe(2);
  });

  it('edit replaces a unique occurrence', async () => {
    const dir = await tmpWorktree();
    await writeTool(dir, { path: 'a.ts', content: 'const x = 1;\n' });
    const result = (await editTool(dir, {
      path: 'a.ts',
      oldString: 'const x = 1;',
      newString: 'const x = 2;',
    })) as { ok: boolean };
    expect(result.ok).toBe(true);
    const content = await fs.readFile(path.join(dir, 'a.ts'), 'utf8');
    expect(content).toBe('const x = 2;\n');
  });

  it('list returns immediate directory entries', async () => {
    const dir = await tmpWorktree();
    await writeTool(dir, { path: 'src/a.ts', content: '' });
    await writeTool(dir, { path: 'b.ts', content: '' });
    const result = (await listTool(dir, {})) as {
      ok: boolean;
      entries: { name: string; type: string }[];
    };
    expect(result.ok).toBe(true);
    const names = result.entries.map((e) => e.name).sort();
    expect(names).toEqual(['b.ts', 'src']);
  });

  it('search finds a literal substring across files', async () => {
    const dir = await tmpWorktree();
    await writeTool(dir, { path: 'src/a.ts', content: 'export const NEEDLE = 1;\n' });
    await writeTool(dir, { path: 'src/b.ts', content: 'export const other = 2;\n' });
    const result = (await searchTool(dir, { pattern: 'NEEDLE' })) as {
      ok: boolean;
      matches: { file: string; line: number }[];
    };
    expect(result.ok).toBe(true);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.file).toBe('src/a.ts');
    expect(result.matches[0]!.line).toBe(1);
  });

  it('search excludes .git from its walk', async () => {
    const dir = await tmpWorktree();
    await fs.mkdir(path.join(dir, '.git'), { recursive: true });
    await fs.writeFile(path.join(dir, '.git', 'HEAD'), 'NEEDLE\n');
    const result = (await searchTool(dir, { pattern: 'NEEDLE' })) as {
      matches: unknown[];
    };
    expect(result.matches).toHaveLength(0);
  });
});
