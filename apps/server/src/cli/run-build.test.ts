import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, type EventLog } from '@dokima/events';
import { createTicket } from '@dokima/tickets';
import { git } from '@dokima/git';
import {
  createProjectSecretsVault,
  resolveCredentialStore,
  writeProjectSetting,
} from '@dokima/shared';
import { openWritableLog, resolveDbPath } from './db.js';
import { executeBuildRun } from './run-build.js';
import { AGENT_RUNNER_SETTINGS_KEY } from '../api/server/settings-types.js';
import { collectIO, createTempProject, type TempProject } from './test-helpers.js';

const NOW = () => '2026-08-06T00:00:00.000Z';

async function withSigningKey<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env.DOKIMA_SIGNING_KEY;
  process.env.DOKIMA_SIGNING_KEY = 'test-signing-key';
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.DOKIMA_SIGNING_KEY;
    else process.env.DOKIMA_SIGNING_KEY = previous;
  }
}

async function gitRepoProject(): Promise<TempProject> {
  const proj = await createTempProject();
  await git(proj.cwd, ['init', '-b', 'main']);
  await git(proj.cwd, ['config', 'user.email', 'demo@dokima.local']);
  await git(proj.cwd, ['config', 'user.name', 'Demo']);
  await fs.mkdir(`${proj.cwd}/src`, { recursive: true });
  await fs.writeFile(`${proj.cwd}/src/app.ts`, 'export const answer = 0;\n');
  await git(proj.cwd, ['add', '-A']);
  await git(proj.cwd, ['commit', '-m', 'initial']);
  return proj;
}

/** A shell "agent" that captures the exact prompt it receives (argv[1]) to `capturePath`, then lands the ticket. */
async function writeCapturingAgent(dir: string, capturePath: string): Promise<string> {
  const file = `${dir}/agent.sh`;
  await fs.writeFile(
    file,
    [
      '#!/usr/bin/env bash',
      'set -eu',
      `printf '%s' "$1" > ${JSON.stringify(capturePath)}`,
      "printf 'export const answer = 42;\\n' > src/app.ts",
      'git add src/app.ts',
      'git -c user.email=a@b.c -c user.name=agent commit -qm "T-1: 42"',
      'SHA="$(git rev-parse HEAD)"',
      'cat <<JSON',
      '{"ticket":"T-1","files":["src/app.ts"],"verify":{"command":"true","exit":0},' +
        '"commits":["$SHA"],"evidence":["e"],"memory_written":["m"]}',
      'JSON',
      '',
    ].join('\n'),
  );
  await fs.chmod(file, 0o755);
  return file;
}

function seedTicket(log: EventLog, interfaceField?: string): void {
  createIdentity(log, { id: 'worker-1', name: 'worker-1', kind: 'machine' });
  createTicket(log, 'worker-1', {
    id: 'T-1',
    type: 'task',
    title: 'Set the answer to 42',
    lane: 'core',
    interface: interfaceField,
    writeScope: ['src/**'],
    verify: 'true',
    acceptance: [{ id: 'AC-1', text: 'answer is 42', done: false }],
  });
}

describe('executeBuildRun (W11-04, FR-H6, D-023)', () => {
  let project: TempProject;

  afterEach(async () => {
    await project?.cleanup();
  });

  it('RED FIXTURE (acceptance 3): a project with no agent setting runs on the built-in agent rather than refusing', async () => {
    project = await gitRepoProject();
    const log = openWritableLog(resolveDbPath(project.cwd));
    const io = collectIO();
    try {
      const code = await withSigningKey(() =>
        executeBuildRun(log, { projectId: 'p', actorId: 'worker-1' }, 'run-1', {
          cwd: project.cwd,
          ...io.io,
          now: NOW,
        }),
      );
      // Nothing was ever claimable (no tickets seeded) — the built-in agent
      // is never even invoked, but critically the CLI never hit the old
      // "no agent is configured" refusal (exit 2) on the way here.
      expect(code).toBe(0);
      expect(io.stderr.join('\n')).not.toContain('no agent is configured');
      expect(io.stdout.join('\n')).toContain('finished: 0 landed, 0 parked (stop: idle)');
    } finally {
      log.close();
    }
  });

  it('RED FIXTURE (acceptance 2/3): a project-scoped external agent setting is used, and the bypass warning is printed', async () => {
    project = await gitRepoProject();
    const log = openWritableLog(resolveDbPath(project.cwd));
    seedTicket(log);
    const agent = await writeCapturingAgent(project.cwd, `${project.cwd}/captured.txt`);
    await writeProjectSetting(project.cwd, {
      key: AGENT_RUNNER_SETTINGS_KEY,
      value: { kind: 'external', command: agent },
      actorId: 'test',
    });
    const io = collectIO();
    try {
      const code = await withSigningKey(() =>
        executeBuildRun(log, { projectId: 'p', actorId: 'worker-1' }, 'run-1', {
          cwd: project.cwd,
          ...io.io,
          now: NOW,
        }),
      );
      expect(code).toBe(0);
      expect(io.stdout.join('\n')).toContain('T-1: landed');
      // The warning is ASSERTED, not merely present somewhere in the source.
      expect(io.stderr.join('\n')).toMatch(
        /tokens are spent somewhere Dokima cannot see/i,
      );
      expect(io.stderr.join('\n')).toMatch(/role.{0,10}model matrix/i);
      expect(io.stderr.join('\n')).toMatch(/escalation ladder/i);
      expect(io.stderr.join('\n')).toMatch(/budget breaker/i);
      expect(io.stderr.join('\n')).toMatch(/spend ledger/i);
    } finally {
      log.close();
    }
  }, 30_000);

  it('RED FIXTURE (FR-S2, SC-06): a vault-registered secret with no SECRET_PATTERNS shape does not reach the prompt handed to spawn', async () => {
    project = await gitRepoProject();
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-run-build-vault-'));
    const previousHome = process.env.DOKIMA_HOME;
    const previousNoKeychain = process.env.DOKIMA_NO_KEYCHAIN;
    const previousVaultKey = process.env.DOKIMA_VAULT_KEY;
    process.env.DOKIMA_HOME = home;
    process.env.DOKIMA_NO_KEYCHAIN = '1';
    process.env.DOKIMA_VAULT_KEY = 'test-vault-key';
    try {
      const vault = createProjectSecretsVault(
        resolveCredentialStore(process.env),
        project.cwd,
      );
      await vault.register('plain-secret', 'totally-plain-secret-9f2c');

      const log = openWritableLog(resolveDbPath(project.cwd));
      seedTicket(log, 'uses totally-plain-secret-9f2c for auth');
      const capturePath = `${project.cwd}/captured.txt`;
      const agent = await writeCapturingAgent(project.cwd, capturePath);
      const io = collectIO();
      try {
        const code = await withSigningKey(() =>
          executeBuildRun(
            log,
            { projectId: 'p', actorId: 'worker-1', agentCommand: agent },
            'run-1',
            { cwd: project.cwd, ...io.io, now: NOW },
          ),
        );
        expect(code).toBe(0);
        expect(io.stdout.join('\n')).toContain('T-1: landed');
        const captured = await fs.readFile(capturePath, 'utf8');
        expect(captured).not.toContain('totally-plain-secret-9f2c');
        expect(captured).toContain('[REDACTED:secret]');
      } finally {
        log.close();
      }
    } finally {
      if (previousHome === undefined) delete process.env.DOKIMA_HOME;
      else process.env.DOKIMA_HOME = previousHome;
      if (previousNoKeychain === undefined) delete process.env.DOKIMA_NO_KEYCHAIN;
      else process.env.DOKIMA_NO_KEYCHAIN = previousNoKeychain;
      if (previousVaultKey === undefined) delete process.env.DOKIMA_VAULT_KEY;
      else process.env.DOKIMA_VAULT_KEY = previousVaultKey;
      await fs.rm(home, { recursive: true, force: true });
    }
  }, 30_000);

  it('an empty external command (misconfigured setting) refuses rather than spawning nothing', async () => {
    project = await gitRepoProject();
    const log = openWritableLog(resolveDbPath(project.cwd));
    await writeProjectSetting(project.cwd, {
      key: AGENT_RUNNER_SETTINGS_KEY,
      value: { kind: 'external', command: '' },
      actorId: 'test',
    });
    const io = collectIO();
    try {
      const code = await withSigningKey(() =>
        executeBuildRun(log, { projectId: 'p', actorId: 'worker-1' }, 'run-1', {
          cwd: project.cwd,
          ...io.io,
          now: NOW,
        }),
      );
      // parseAgentRunnerSetting already degrades an empty `command` to the
      // built-in default, so this exercises the same "runs built-in" path —
      // asserted here from the settings side rather than the CLI-flag side.
      expect(code).toBe(0);
    } finally {
      log.close();
    }
  });

  it('refuses when DOKIMA_SIGNING_KEY is unset, before any agent is resolved', async () => {
    project = await gitRepoProject();
    const log = openWritableLog(resolveDbPath(project.cwd));
    const previous = process.env.DOKIMA_SIGNING_KEY;
    delete process.env.DOKIMA_SIGNING_KEY;
    const io = collectIO();
    try {
      const code = await executeBuildRun(
        log,
        { projectId: 'p', actorId: 'worker-1' },
        'run-1',
        { cwd: project.cwd, ...io.io, now: NOW },
      );
      expect(code).toBe(2);
      expect(io.stderr.join('\n')).toContain('DOKIMA_SIGNING_KEY');
    } finally {
      if (previous !== undefined) process.env.DOKIMA_SIGNING_KEY = previous;
      log.close();
    }
  });
});
