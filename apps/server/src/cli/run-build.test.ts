import { promises as fs } from 'node:fs';
import http from 'node:http';
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
import { executeBuildRun, tokenizeAgentCommand } from './run-build.js';
import { resolvePolicyScope } from './run-build-policy.js';
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

  it(
    'W12-04 RED FIXTURE: the packed context reaches the prompt a real run hands to ' +
      'the agent — proving executeBuildRun installs the packed builder, not that ' +
      'constructing one fails to throw (the W11-04 lesson)',
    async () => {
      project = await gitRepoProject();
      const log = openWritableLog(resolveDbPath(project.cwd));
      seedTicket(log);
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
        const captured = await fs.readFile(capturePath, 'utf8');

        // The pinned invariants and a real repo map — neither of which the
        // pre-W12-04 `defaultHandoffBuilder()` path could ever have produced.
        expect(captured).toContain('PROJECT INVARIANTS');
        expect(captured).toContain('Stay inside WRITE-SCOPE');
        expect(captured).toContain('REPO MAP');
        expect(captured).toContain('src/app.ts');
        expect(captured).toContain('TICKET: T-1');
        // The ticket seeded here has no `interface`, so before this ticket the
        // whole CONTEXT was the bare title.
        expect(captured).not.toMatch(/CONTEXT: Set the answer to 42\n/);
      } finally {
        log.close();
      }
    },
    30_000,
  );

  it(
    'W12-03 RED FIXTURE (the CALL SITE, not just the helper): an external agent ' +
      'whose PATH CONTAINS A SPACE actually spawns and lands the ticket. The unit ' +
      'tests below pass against the old whitespace split too, because they call ' +
      'the tokenizer directly — only this one proves executeBuildRun USES it.',
    async () => {
      project = await gitRepoProject();
      const spacedDir = `${project.cwd}/My Agent Dir`;
      await fs.mkdir(spacedDir, { recursive: true });
      const log = openWritableLog(resolveDbPath(project.cwd));
      seedTicket(log);
      const agent = await writeCapturingAgent(spacedDir, `${project.cwd}/captured.txt`);
      const io = collectIO();
      try {
        const code = await withSigningKey(() =>
          executeBuildRun(
            log,
            { projectId: 'p', actorId: 'worker-1', agentCommand: `"${agent}"` },
            'run-1',
            { cwd: project.cwd, ...io.io, now: NOW },
          ),
        );
        expect(code).toBe(0);
        expect(io.stdout.join('\n')).toContain('T-1: landed');
      } finally {
        log.close();
      }
    },
    30_000,
  );

  it('RED FIXTURE (W11-18, FR-H6): an empty external command (misconfigured setting) refuses rather than spawning nothing', async () => {
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
      // A `kind: 'external'` row is a choice that was made explicitly —
      // `parseAgentRunnerSetting` no longer degrades its empty `command` to
      // the built-in default (that degrade was a silent substitution of a
      // different agent than the one picked, W11-18). It refuses instead,
      // matching the W10-77 contract for a genuinely misconfigured runner —
      // distinct from a project with NO agentRunner setting at all, which
      // still runs built-in per W11-04 (see the RED FIXTURE above).
      expect(code).toBe(2);
      expect(io.stderr.join('\n')).toMatch(/misconfigured.*command is empty/i);
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

  it('W12-02 RED FIXTURE: refuses when the secrets vault is unreadable, instead of running with a redaction layer that has nothing to redact', async () => {
    // The reachable path is NOT "a machine that never had a store" — on such
    // a machine nothing could have been registered, which is the argument the
    // old `EMPTY_VAULT` degradation rested on. It is: an operator registers
    // secrets on Linux via DOKIMA_NO_KEYCHAIN + DOKIMA_VAULT_KEY (P-003), so
    // ~/.dokima/vault.json and the project's name index persist on disk, and
    // a LATER run carries neither variable — a service unit, a cron entry, a
    // different shell. That run used to degrade silently and hand
    // collectSecretValues an empty list while the secrets were still
    // registered. Simulated by taking the platform off the one adapter that
    // exists with DOKIMA_NO_KEYCHAIN unset, which is exactly the state such a
    // run is in.
    project = await gitRepoProject();
    const log = openWritableLog(resolveDbPath(project.cwd));
    const realPlatform = process.platform;
    const previousNoKeychain = process.env.DOKIMA_NO_KEYCHAIN;
    delete process.env.DOKIMA_NO_KEYCHAIN;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const io = collectIO();
    try {
      const code = await withSigningKey(() =>
        executeBuildRun(log, { projectId: 'p', actorId: 'worker-1' }, 'run-1', {
          cwd: project.cwd,
          ...io.io,
          now: NOW,
        }),
      );
      expect(code).toBe(2);
      const err = io.stderr.join('\n');
      // The refusal must say what was at risk and how to fix it, not just fail.
      expect(err).toMatch(/unredacted/i);
      expect(err).toContain('DOKIMA_NO_KEYCHAIN');
      expect(err).toContain('DOKIMA_VAULT_KEY');
      expect(err).toMatch(/nothing was claimed/i);
    } finally {
      Object.defineProperty(process, 'platform', {
        value: realPlatform,
        configurable: true,
      });
      if (previousNoKeychain !== undefined)
        process.env.DOKIMA_NO_KEYCHAIN = previousNoKeychain;
      log.close();
    }
  });

  it('W12-02: the encrypted-file fallback is a working store, not a refusal — the supported non-macOS path still runs', async () => {
    // Guards the refusal from becoming "Linux cannot run builds at all". With
    // both P-003 variables set, resolveCredentialStore returns a real store,
    // so the run proceeds past the vault check and fails later (or not) for
    // its own reasons — never with the W12-02 message.
    project = await gitRepoProject();
    const log = openWritableLog(resolveDbPath(project.cwd));
    const realPlatform = process.platform;
    const prevNo = process.env.DOKIMA_NO_KEYCHAIN;
    const prevKey = process.env.DOKIMA_VAULT_KEY;
    process.env.DOKIMA_NO_KEYCHAIN = '1';
    process.env.DOKIMA_VAULT_KEY = 'test-vault-key';
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const io = collectIO();
    try {
      await withSigningKey(() =>
        executeBuildRun(log, { projectId: 'p', actorId: 'worker-1' }, 'run-1', {
          cwd: project.cwd,
          ...io.io,
          now: NOW,
        }),
      );
      expect(io.stderr.join('\n')).not.toMatch(/unredacted/i);
    } finally {
      Object.defineProperty(process, 'platform', {
        value: realPlatform,
        configurable: true,
      });
      if (prevNo === undefined) delete process.env.DOKIMA_NO_KEYCHAIN;
      else process.env.DOKIMA_NO_KEYCHAIN = prevNo;
      if (prevKey === undefined) delete process.env.DOKIMA_VAULT_KEY;
      else process.env.DOKIMA_VAULT_KEY = prevKey;
      log.close();
    }
  });

  it('SMOKE TEST: the built-in agent actually reaches a real model call, not just past the CLI refusal', async () => {
    // A local, OpenAI-compatible HTTP fixture standing in for the model
    // endpoint (Law 9 — never a live third-party network call). This proves
    // the whole chain actually executes: resolveModelTarget's env fallback,
    // providerForConfig building a real oai-compat Provider, the minimal
    // matrix resolving through route() rather than throwing
    // RoutingUnresolvedError, resolveProvider being called, and
    // ensureAgentSessionToolsRegistered running — none of which the
    // empty-board tests above exercise, since runLandLoop goes idle before
    // attemptOnce ever calls spawn.
    let chatCompletionsHit = 0;
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        if (req.url?.endsWith('/models')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ data: [] }));
          return;
        }
        chatCompletionsHit += 1;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'chatcmpl-smoke',
            model: 'local-model',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'no manifest here' },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not bind');
    const previousBaseUrl = process.env.DOKIMA_MODEL_BASE_URL;
    process.env.DOKIMA_MODEL_BASE_URL = `http://127.0.0.1:${address.port}/v1`;

    project = await gitRepoProject();
    const log = openWritableLog(resolveDbPath(project.cwd));
    seedTicket(log);
    const io = collectIO();
    try {
      const code = await withSigningKey(() =>
        executeBuildRun(log, { projectId: 'p', actorId: 'worker-1' }, 'run-1', {
          cwd: project.cwd,
          ...io.io,
          now: NOW,
        }),
      );
      // Not asserting `landed` — a plain-text reply with no Completion
      // Manifest parks the ticket, and that's fine (see the block comment
      // above): what this proves is that the model endpoint was actually
      // called, not that the built-in agent can finish a ticket unassisted.
      expect(code).toBe(0);
      expect(chatCompletionsHit).toBeGreaterThan(0);
    } finally {
      if (previousBaseUrl === undefined) delete process.env.DOKIMA_MODEL_BASE_URL;
      else process.env.DOKIMA_MODEL_BASE_URL = previousBaseUrl;
      log.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 30_000);
});

describe('tokenizeAgentCommand (W12-03)', () => {
  it(
    'RED FIXTURE: a quoted path containing spaces spawns the intended binary — ' +
      "`.split(' ')` truncated it to `/Applications/My` plus bogus args, and the " +
      'operator saw a failure naming a path that was never configured',
    () => {
      expect(tokenizeAgentCommand('"/Applications/My Agent/bin/agent" --flag')).toEqual([
        '/Applications/My Agent/bin/agent',
        '--flag',
      ]);
      expect(tokenizeAgentCommand("'/opt/my agent/run' --mode fast")).toEqual([
        '/opt/my agent/run',
        '--mode',
        'fast',
      ]);
    },
  );

  it('an argument needing internal spaces survives as ONE argument', () => {
    expect(tokenizeAgentCommand('agent --prompt "do the thing" -v')).toEqual([
      'agent',
      '--prompt',
      'do the thing',
      '-v',
    ]);
  });

  it(
    'W11-04 REGRESSION GUARD: an ordinary multi-arg command with no spaces in the ' +
      'path still round-trips exactly as it did under the old split',
    () => {
      expect(tokenizeAgentCommand('claude -p --dangerously-skip-permissions')).toEqual([
        'claude',
        '-p',
        '--dangerously-skip-permissions',
      ]);
      expect(tokenizeAgentCommand('  agent   --flag  ')).toEqual(['agent', '--flag']);
      // Still empty, so `executeBuildRun`'s named misconfiguration refusal
      // (W11-18) fires exactly as before rather than spawning nothing.
      expect(tokenizeAgentCommand('   ')).toEqual([]);
    },
  );

  it('an unterminated quote yields the token as typed rather than throwing', () => {
    expect(tokenizeAgentCommand('agent "unclosed')).toEqual(['agent', 'unclosed']);
  });
});

describe('executeBuildRun policy wiring (W12-18)', () => {
  let project: TempProject;
  afterEach(async () => { await project?.cleanup(); });

  it(
    'W12-18 CALL-SITE FIXTURE: a stored PINNED policy refuses the real run with exit 2. ' +
      'The unit tests above only prove the resolver exists — reverting the call site ' +
      'leaves them green, so this is the one that proves executeBuildRun READS the setting.',
    async () => {
      project = await gitRepoProject();
      const log = openWritableLog(resolveDbPath(project.cwd));
      seedTicket(log);
      await writeProjectSetting(project.cwd, {
        key: 'escalationPolicy',
        value: { mode: 'pinned', model: 'gpt-5', tierKind: 'metered' },
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
        expect(code).toBe(2);
        expect(io.stderr.join('\n')).toContain('does not yet honour');
      } finally {
        log.close();
      }
    },
    30_000,
  );
});

describe('resolvePolicyScope (W12-18)', () => {
  it(
    'RED FIXTURE: a stored token-gated policy REACHES the run. Two UI surfaces ' +
      'have been persisting escalationPolicy and nothing read it — run-build.ts ' +
      'never passed policyScope, so loop-land resolved {} and every run took the ' +
      'ladder no matter what the user chose',
    () => {
      const result = resolvePolicyScope({ mode: 'token-gated', namedTier: 'R2' }, 'coding-agent');
      expect('refusal' in result).toBe(false);
      if ('refusal' in result) return;
      expect(result.scope.global?.['coding-agent']).toEqual({
        mode: 'token-gated',
        namedTier: 'R2',
      });
    },
  );

  it('locked carries its pinned tier and tier kind through', () => {
    const result = resolvePolicyScope(
      { mode: 'locked', pinnedTier: 'R1', tierKind: 'local' },
      'coding-agent',
    );
    expect('refusal' in result).toBe(false);
    if ('refusal' in result) return;
    expect(result.scope.global?.['coding-agent']).toEqual({
      mode: 'locked',
      pinnedTier: 'R1',
      tierKind: 'local',
    });
  });

  it(
    'applies to the MAKER ROLE ONLY, which keeps maker != verifier (C-4) true by ' +
      'construction rather than by a refusal discovered mid-run',
    () => {
      const result = resolvePolicyScope({ mode: 'token-gated', namedTier: 'R2' }, 'coding-agent');
      if ('refusal' in result) throw new Error('unexpected refusal');
      expect(Object.keys(result.scope.global ?? {})).toEqual(['coding-agent']);
      expect(result.scope.global?.['challenger']).toBeUndefined();
    },
  );

  it(
    'RED FIXTURE: a stored PINNED policy refuses by name rather than running as ' +
      'the ladder — silently substituting a different model is the one thing ' +
      'pinning promises will not happen',
    () => {
      const result = resolvePolicyScope(
        { mode: 'pinned', model: 'gpt-5', tierKind: 'metered' },
        'coding-agent',
      );
      expect('refusal' in result).toBe(true);
      if (!('refusal' in result)) return;
      expect(result.refusal).toContain('does not yet honour');
    },
  );

  it('an absent or unreadable setting takes the documented ladder default without throwing', () => {
    for (const raw of [undefined, null, 'nonsense', [], { mode: 'invented' }]) {
      const result = resolvePolicyScope(raw as never, 'coding-agent');
      expect('refusal' in result).toBe(false);
      if ('refusal' in result) continue;
      expect(result.scope).toEqual({});
    }
  });
});
