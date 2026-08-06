import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import type { Handoff } from './handoff.js';
import {
  createChildProcessSpawn,
  runSession,
  type SpawnSessionOutput,
} from './session.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd });
}

interface TempRepo {
  repoRoot: string;
  cleanup: () => Promise<void>;
}

async function createTempRepo(): Promise<TempRepo> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-loop-session-test-'));
  await git(repoRoot, ['init', '-b', 'main']);
  await git(repoRoot, ['config', 'user.name', 'Dokima Test']);
  await git(repoRoot, ['config', 'user.email', 'test@dokima.invalid']);
  await fs.mkdir(path.join(repoRoot, 'packages', 'loop', 'src'), { recursive: true });
  await fs.writeFile(path.join(repoRoot, 'README.md'), '# fixture\n');
  await git(repoRoot, ['add', '--', 'README.md']);
  await git(repoRoot, ['commit', '-m', 'chore: initial commit']);
  return { repoRoot, cleanup: () => fs.rm(repoRoot, { recursive: true, force: true }) };
}

const HANDOFF: Handoff = {
  role: 'coding-agent',
  mission: 'implement the ticket',
  ticket: { id: 'W1-06', title: 'HANDOFF contract + agent session runner' },
  context: 'context packet',
  writeScope: ['packages/loop/src/session*'],
  produce: ['acceptance criterion'],
  verify: 'pnpm test --filter loop',
};

const MANIFEST_JSON = JSON.stringify({
  ticket: 'W1-06',
  files: ['packages/loop/src/session.ts'],
  verify: { command: 'pnpm test --filter loop', exit: 0 },
  commits: ['a1b2c3d'],
  evidence: ['evidence line'],
});

describe('runSession', () => {
  let repo: TempRepo | undefined;

  afterEach(async () => {
    await repo?.cleanup();
    repo = undefined;
  });

  it('renders the HANDOFF as the prompt and runs inside the worktree cwd', async () => {
    repo = await createTempRepo();
    let seenPrompt = '';
    let seenCwd = '';
    await runSession({
      handoff: HANDOFF,
      cwd: repo.repoRoot,
      spawn: async (input) => {
        seenPrompt = input.prompt;
        seenCwd = input.cwd;
        return { stdout: MANIFEST_JSON, stderr: '', exitCode: 0 };
      },
    });
    expect(seenCwd).toBe(repo.repoRoot);
    expect(seenPrompt).toContain('ROLE: coding-agent — implement the ticket');
    expect(seenPrompt).toContain('TICKET: W1-06 HANDOFF contract + agent session runner');
  });

  it("pattern-only redacts: an exact vault-shaped secret with no SECRET_PATTERNS shape reaches spawn (W11-04, FR-S2 — exact-value redaction is the caller's job via a wrapped spawn, not this function's)", async () => {
    repo = await createTempRepo();
    let seenPrompt = '';
    await runSession({
      handoff: { ...HANDOFF, context: 'uses totally-plain-secret-9f2c for auth' },
      cwd: repo.repoRoot,
      spawn: async (input) => {
        seenPrompt = input.prompt;
        return { stdout: MANIFEST_JSON, stderr: '', exitCode: 0 };
      },
    });
    expect(seenPrompt).toContain('totally-plain-secret-9f2c');
  });

  it('parses a Completion Manifest from stdout (tier contract)', async () => {
    repo = await createTempRepo();
    const result = await runSession({
      handoff: HANDOFF,
      cwd: repo.repoRoot,
      spawn: async () => ({ stdout: MANIFEST_JSON, stderr: '', exitCode: 0 }),
    });
    expect(result.manifestParseTier).toBe('contract');
    expect(result.manifest?.ticket).toBe('W1-06');
    expect(result.exitCode).toBe(0);
  });

  it('strips <think> reasoning blocks from the returned output', async () => {
    repo = await createTempRepo();
    const result = await runSession({
      handoff: HANDOFF,
      cwd: repo.repoRoot,
      spawn: async () => ({
        stdout: `<think>internal reasoning nobody should see</think>${MANIFEST_JSON}`,
        stderr: '',
        exitCode: 0,
      }),
    });
    expect(result.output).not.toContain('<think>');
    expect(result.output).not.toContain('internal reasoning');
    expect(result.manifest?.ticket).toBe('W1-06');
  });

  it('reports no scope violations when the session only touches in-scope files', async () => {
    repo = await createTempRepo();
    const result = await runSession({
      handoff: HANDOFF,
      cwd: repo.repoRoot,
      spawn: async (input) => {
        await fs.writeFile(
          path.join(input.cwd, 'packages', 'loop', 'src', 'session.ts'),
          'export {};\n',
        );
        return { stdout: MANIFEST_JSON, stderr: '', exitCode: 0 };
      },
    });
    expect(result.scopeViolations).toEqual([]);
  });

  it('detects a real write-scope violation from a session that edits an out-of-scope file', async () => {
    repo = await createTempRepo();
    const result = await runSession({
      handoff: HANDOFF,
      cwd: repo.repoRoot,
      spawn: async (input) => {
        await fs.writeFile(path.join(input.cwd, 'README.md'), '# session edited this\n');
        return { stdout: MANIFEST_JSON, stderr: '', exitCode: 0 };
      },
    });
    expect(result.scopeViolations).toEqual(['README.md']);
  });

  it('returns a null manifest and null tier when output is unparseable, without throwing', async () => {
    repo = await createTempRepo();
    const result = await runSession({
      handoff: HANDOFF,
      cwd: repo.repoRoot,
      spawn: async () => ({
        stdout: 'I made the changes but forgot the manifest.',
        stderr: '',
        exitCode: 0,
      }),
    });
    expect(result.manifest).toBeNull();
    expect(result.manifestParseTier).toBeNull();
  });

  it('diffs against a custom baseRef when provided', async () => {
    repo = await createTempRepo();
    await git(repo.repoRoot, ['checkout', '-b', 'sw/w1-06-test']);
    await fs.writeFile(
      path.join(repo.repoRoot, 'packages', 'loop', 'src', 'session.ts'),
      'export {};\n',
    );
    await git(repo.repoRoot, ['add', '--', 'packages/loop/src/session.ts']);
    await git(repo.repoRoot, ['commit', '-m', 'feat: add session.ts']);
    const result = await runSession({
      handoff: HANDOFF,
      cwd: repo.repoRoot,
      baseRef: 'main',
      spawn: async () => ({ stdout: MANIFEST_JSON, stderr: '', exitCode: 0 }),
    });
    expect(result.scopeViolations).toEqual([]);
  });
});

describe('createChildProcessSpawn', () => {
  let repo: TempRepo | undefined;

  afterEach(async () => {
    await repo?.cleanup();
    repo = undefined;
  });

  it('actually runs a child process and captures stdout/stderr/exitCode', async () => {
    repo = await createTempRepo();
    const spawn = createChildProcessSpawn({ command: 'node', args: ['-e'] });
    const result: SpawnSessionOutput = await spawn({
      prompt: "console.log('hello from child'); console.error('err from child');",
      cwd: repo.repoRoot,
    });
    expect(result.stdout).toContain('hello from child');
    expect(result.stderr).toContain('err from child');
    expect(result.exitCode).toBe(0);
  });

  it('reports a non-zero exit code', async () => {
    repo = await createTempRepo();
    const spawn = createChildProcessSpawn({ command: 'node', args: ['-e'] });
    const result = await spawn({ prompt: 'process.exit(3);', cwd: repo.repoRoot });
    expect(result.exitCode).toBe(3);
  });

  it('does not leak the parent process env into the session by default (SC-03/SC-07)', async () => {
    repo = await createTempRepo();
    process.env.DOKIMA_TEST_PLANTED_SECRET = 'sk-should-not-leak';
    try {
      const spawn = createChildProcessSpawn({ command: 'node', args: ['-e'] });
      const result = await spawn({
        prompt: 'console.log(JSON.stringify(process.env));',
        cwd: repo.repoRoot,
      });
      const childEnv = JSON.parse(result.stdout) as Record<string, string | undefined>;
      expect(childEnv.DOKIMA_TEST_PLANTED_SECRET).toBeUndefined();
      expect(childEnv.PATH).toBe(process.env.PATH);
      // Only the OS/runtime may inject entries (e.g. macOS's __CF_USER_TEXT_ENCODING);
      // nothing else from the parent process.env may pass through implicitly.
      const unexpected = Object.keys(childEnv).filter(
        (key) => key !== 'PATH' && !key.startsWith('__CF_'),
      );
      expect(unexpected).toEqual([]);
    } finally {
      delete process.env.DOKIMA_TEST_PLANTED_SECRET;
    }
  });

  it('honors an explicitly passed env instead of the minimal default', async () => {
    repo = await createTempRepo();
    const spawn = createChildProcessSpawn({
      command: 'node',
      args: ['-e'],
      env: { PATH: process.env.PATH, CUSTOM_VAR: 'present' },
    });
    const result = await spawn({
      prompt: 'console.log(process.env.CUSTOM_VAR ?? "missing");',
      cwd: repo.repoRoot,
    });
    expect(result.stdout).toContain('present');
  });
});
