import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { git } from '@dokima/git';

const sandbox = vi.hoisted(() => ({ available: true }));
vi.mock('@dokima/harbormaster', async (importOriginal) => {
  const real = await importOriginal<typeof import('@dokima/harbormaster')>();
  return {
    ...real,
    isSandboxProfileAvailable: (profile: 'process' | 'container') =>
      sandbox.available && real.isSandboxProfileAvailable(profile),
  };
});

const { measureCloseEvidence, projectRootFor } = await import('./close-evidence.js');

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-close-evidence-'));
  dirs.push(dir);
  return dir;
}

async function repoWithFile(): Promise<{ root: string; sha: string }> {
  const root = await tempDir();
  await git(root, ['init', '-q']);
  await git(root, ['config', 'user.email', 'maker@example.test']);
  await git(root, ['config', 'user.name', 'Maker']);
  await fs.writeFile(path.join(root, 'x.txt'), 'x\n');
  await git(root, ['add', 'x.txt']);
  await git(root, ['commit', '-q', '-m', 'x']);
  return { root, sha: (await git(root, ['rev-parse', 'HEAD'])).stdout.trim() };
}

afterEach(async () => {
  sandbox.available = true;
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

describe('projectRootFor (W23-42)', () => {
  it('is the directory holding .dokima/ when the log lives there, else cwd', () => {
    expect(projectRootFor('/p/app/.dokima/state.db', '/elsewhere')).toBe('/p/app');
    expect(projectRootFor('/tmp/custom.db', '/work')).toBe('/work');
  });
});

describe('measureCloseEvidence (W23-42)', () => {
  it('a tree SHA is not a commit — resolving to SOME object is not enough', async () => {
    const { root } = await repoWithFile();
    const tree = (await git(root, ['rev-parse', 'HEAD^{tree}'])).stdout.trim();

    const result = await measureCloseEvidence(
      root,
      { verify: null },
      { files: ['x.txt'], commits: [tree], verifyCommand: 'true' },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons.join('\n')).toContain(tree);
  });

  it('a SHA spelled like a flag is a SHA to look up, never an option to git', async () => {
    const { root } = await repoWithFile();

    const result = await measureCloseEvidence(
      root,
      { verify: null },
      { files: ['x.txt'], commits: ['--all'], verifyCommand: 'true' },
    );

    expect(result.ok).toBe(false);
  });

  it('refuses a claimed file that escapes the project through a symlink', async () => {
    const { root, sha } = await repoWithFile();
    const outside = await tempDir();
    await fs.writeFile(path.join(outside, 'secret.txt'), 's\n');
    await fs.symlink(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'));

    const result = await measureCloseEvidence(
      root,
      { verify: null },
      { files: ['link.txt'], commits: [sha], verifyCommand: 'true' },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons.join('\n')).toMatch(/symlink.*link\.txt/);
  });

  it('files are checked AFTER verify runs — a verify that deletes the file cannot leave a receipt for it', async () => {
    const { root, sha } = await repoWithFile();

    const result = await measureCloseEvidence(
      root,
      { verify: null },
      { files: ['x.txt'], commits: [sha], verifyCommand: 'rm x.txt' },
    );

    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.reasons.join('\n')).toContain('not found in the project: x.txt');
  });

  it('a host that cannot sandbox refuses by name and runs nothing', async () => {
    const { root, sha } = await repoWithFile();
    sandbox.available = false;

    const result = await measureCloseEvidence(
      root,
      { verify: null },
      { files: ['x.txt'], commits: [sha], verifyCommand: 'touch ran.txt' },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons[0]).toMatch(/cannot sandbox a verify run/);
    await expect(fs.stat(path.join(root, 'ran.txt'))).rejects.toThrow();
  });

  it("records whose verify ran: the ticket's own when it declares one", async () => {
    const { root, sha } = await repoWithFile();

    const result = await measureCloseEvidence(
      root,
      { verify: 'test -s x.txt' },
      { files: ['x.txt'], commits: [sha], verifyCommand: 'false' },
    );

    expect(result).toEqual({
      ok: true,
      verify: { command: 'test -s x.txt', exitCode: 0 },
      evidence: {
        verify: 'ran',
        verifySource: 'ticket',
        files: 'verified',
        commits: 'verified',
        sandbox: 'isolated',
      },
    });
  });

  it('RED FIXTURE (W23-44): with the waiver, a host that cannot sandbox CLOSES, and the receipt says the verify ran unsandboxed', async () => {
    const { root, sha } = await repoWithFile();
    sandbox.available = false;

    const result = await measureCloseEvidence(
      root,
      { verify: null },
      {
        files: ['x.txt'],
        commits: [sha],
        verifyCommand: 'true',
        unsandboxedWaiver: true,
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.evidence.sandbox).toBe('waived');
  });

  it('W23-44: without the waiver the refusal names the variable that would lift it', async () => {
    const { root, sha } = await repoWithFile();
    sandbox.available = false;
    const result = await measureCloseEvidence(
      root,
      { verify: null },
      { files: ['x.txt'], commits: [sha], verifyCommand: 'true' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.reasons[0]).toContain('DOKIMA_ALLOW_UNSANDBOXED_VERIFY');
  });

  it('RED FIXTURE (W23-57): a project whose settings choose `sandbox: container` is refused with the reason, and its verify never runs under the process profile', async () => {
    const { root, sha } = await repoWithFile();
    await fs.mkdir(path.join(root, '.dokima'), { recursive: true });
    await fs.writeFile(
      path.join(root, '.dokima', 'settings.json'),
      JSON.stringify({ sandbox: 'container' }),
    );

    const result = await measureCloseEvidence(
      root,
      { verify: null },
      { files: ['x.txt'], commits: [sha], verifyCommand: 'touch ran.txt' },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons.join('\n')).toMatch(/sandbox: container/);
    // The silent-process-profile run is exactly what this refuses.
    await expect(fs.stat(path.join(root, 'ran.txt'))).rejects.toThrow();
  });

  it('W23-57: `sandbox: process` is the default spelled out, and closes as before', async () => {
    const { root, sha } = await repoWithFile();
    await fs.mkdir(path.join(root, '.dokima'), { recursive: true });
    await fs.writeFile(
      path.join(root, '.dokima', 'settings.json'),
      JSON.stringify({ sandbox: 'process' }),
    );
    const result = await measureCloseEvidence(
      root,
      { verify: null },
      { files: ['x.txt'], commits: [sha], verifyCommand: 'true' },
    );
    expect(result.ok).toBe(true);
  });
});
