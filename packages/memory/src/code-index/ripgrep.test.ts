import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ExecFileFn, ExecFileResult } from './ripgrep.js';
import { listProjectFiles, ripgrepSearch } from './ripgrep.js';

const cleanupDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function makeProject(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'code-index-rg-test-'));
  cleanupDirs.push(dir);
  await mkdir(path.join(dir, 'src'), { recursive: true });
  await writeFile(
    path.join(dir, 'src', 'a.ts'),
    'export function frobnicate() { return 1; }\n',
  );
  await writeFile(path.join(dir, 'README.md'), '# hello world\n');
  return dir;
}

describe('listProjectFiles (real rg binary)', () => {
  it('lists every file under the project root', async () => {
    const dir = await makeProject();
    const files = await listProjectFiles(dir);
    expect(files).not.toBeNull();
    expect(files).toEqual(expect.arrayContaining(['src/a.ts', 'README.md']));
  });
});

describe('ripgrepSearch (real rg binary)', () => {
  it('returns exact matches with file:line', async () => {
    const dir = await makeProject();
    const matches = await ripgrepSearch(dir, 'frobnicate');
    expect(matches).toEqual([
      { path: 'src/a.ts', line: 1, text: 'export function frobnicate() { return 1; }' },
    ]);
  });

  it('returns an empty array (not an error) when nothing matches', async () => {
    const dir = await makeProject();
    const matches = await ripgrepSearch(dir, 'no_such_token_anywhere');
    expect(matches).toEqual([]);
  });
});

const missingBinary: ExecFileFn = () => {
  const error = new Error('spawn rg ENOENT') as Error & { code: string };
  error.code = 'ENOENT';
  return Promise.reject(error);
};

const realError: ExecFileFn = () => {
  const error = new Error('rg: bad pattern') as Error & { code: number };
  error.code = 2;
  return Promise.reject(error);
};

describe('honest-absent degrade when rg is not installed', () => {
  it('listProjectFiles returns null on ENOENT', async () => {
    expect(
      await listProjectFiles('/irrelevant', { execFileImpl: missingBinary }),
    ).toBeNull();
  });

  it('ripgrepSearch returns null on ENOENT', async () => {
    expect(
      await ripgrepSearch('/irrelevant', 'x', { execFileImpl: missingBinary }),
    ).toBeNull();
  });

  it('a real rg error (exit code 2) is rethrown, not swallowed as absence', async () => {
    await expect(
      ripgrepSearch('/irrelevant', 'x', { execFileImpl: realError }),
    ).rejects.toThrow('bad pattern');
  });

  it('exit code 1 (no matches) resolves to an empty array via the injected exec', async () => {
    const noMatches: ExecFileFn = () => {
      const error = new Error('no matches') as Error & { code: number };
      error.code = 1;
      return Promise.reject(error);
    };
    expect(await ripgrepSearch('/irrelevant', 'x', { execFileImpl: noMatches })).toEqual(
      [],
    );
    expect(await listProjectFiles('/irrelevant', { execFileImpl: noMatches })).toEqual(
      [],
    );
  });

  it('a custom execFileImpl can also resolve successfully', async () => {
    const fake: ExecFileFn = (): Promise<ExecFileResult> =>
      Promise.resolve({ stdout: 'a.ts\nb.ts\n', stderr: '' });
    expect(await listProjectFiles('/irrelevant', { execFileImpl: fake })).toEqual([
      'a.ts',
      'b.ts',
    ]);
  });
});
