import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendEvent, createIdentity, openEventLog } from '@dokima/events';
import { resolveSastRules } from '@dokima/harbormaster';
import { createInMemoryCredentialStore, type CredentialStore } from '@dokima/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CliIO } from '../../bootstrap/cli.js';
import { resolveProjectPaths } from '../../bootstrap/config.js';
import { defaultFirstPartyPackSource } from '../../bootstrap/packs-update.js';
import { runDoctor, runDoctorCommand } from './doctor.js';
import { checkDependencyAudit, checkSast, type SastProbe } from './doctor-sast.js';

const SAST_READY: SastProbe = async () => ({
  opengrepInstalled: true,
  rules: {
    root: '/rules/packs',
    configPaths: ['/rules/packs/owasp'],
    digest: `sha256:${'a'.repeat(64)}`,
    ruleFileCount: 3,
  },
});

describe('runDoctor', () => {
  const scratchDirs: string[] = [];

  afterEach(async () => {
    for (const dir of scratchDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  async function scratchIo(): Promise<CliIO> {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-doctor-'));
    scratchDirs.push(projectDir);
    return { stdout: vi.fn(), stderr: vi.fn(), cwd: projectDir, env: {} };
  }

  function fakeStore(): () => CredentialStore {
    const store = createInMemoryCredentialStore();
    return () => store;
  }

  const realPackSource = defaultFirstPartyPackSource();

  it('reports every check green on a fresh, unconfigured project', async () => {
    const io = await scratchIo();

    const report = await runDoctor(io, {
      detectRunningCore: vi.fn().mockResolvedValue(false),
      resolveCredentialStore: fakeStore(),
      loadConfiguredProviders: vi.fn().mockResolvedValue([]),
      packSource: realPackSource,
      sastProbe: SAST_READY,
    });

    expect(report.ok).toBe(true);
    // W23-56: a fresh project has made no network choice, which reads as
    // local-only — so its dependency audit is honestly a WARNING, not OK.
    expect(
      report.checks
        .filter((c) => c.name !== 'dependency-audit')
        .every((c) => c.status === 'ok'),
    ).toBe(true);
    const find = (name: string) => report.checks.find((c) => c.name === name);
    expect(find('dependency-audit')?.status).toBe('warn');
    expect(find('port')?.status).toBe('ok');
    expect(find('db-integrity')).toEqual({
      name: 'db-integrity',
      status: 'ok',
      detail: 'no state.db yet (fresh project)',
    });
    expect(find('keychain')?.status).toBe('ok');
    expect(find('providers')).toEqual({
      name: 'providers',
      status: 'ok',
      detail: 'no providers configured',
    });
    expect(find('pack-signatures')?.status).toBe('ok');
    expect(find('worktree-orphans')).toEqual({
      name: 'worktree-orphans',
      status: 'ok',
      detail: 'no worktrees directory yet',
    });
  });

  it('passes db-integrity on a real seeded event log', async () => {
    const io = await scratchIo();
    const paths = resolveProjectPaths(io.cwd);
    await fs.mkdir(paths.dokimaDir, { recursive: true });
    const log = openEventLog(paths.dbPath);
    createIdentity(log, { id: 'human-1', name: 'Operator', kind: 'human' });
    appendEvent(log, { eventType: 'ticket.commented', actorId: 'human-1', payload: {} });
    log.close();

    const report = await runDoctor(io, {
      detectRunningCore: vi.fn().mockResolvedValue(false),
      resolveCredentialStore: fakeStore(),
      loadConfiguredProviders: vi.fn().mockResolvedValue([]),
      packSource: realPackSource,
    });

    const dbCheck = report.checks.find((c) => c.name === 'db-integrity');
    expect(dbCheck?.status).toBe('ok');
  });

  it('fails db-integrity when the chain is broken', async () => {
    const io = await scratchIo();
    const paths = resolveProjectPaths(io.cwd);
    await fs.mkdir(paths.dokimaDir, { recursive: true });
    const log = openEventLog(paths.dbPath);
    createIdentity(log, { id: 'human-1', name: 'Operator', kind: 'human' });
    // events are INSERT-only (no UPDATE, DATABASE.md §2) — a tamper attempt
    // through appendEvent would already be rejected by the DB trigger. To
    // exercise the hash-check path itself (audit-tail.test.ts's pattern),
    // insert the row raw with a deliberately wrong hash, simulating a
    // file-level edit that bypassed the app entirely (SC-11's threat model).
    log.db
      .prepare(
        `INSERT INTO events (seq, event_type, actor_id, ticket_id, run_id, payload, created_at, prev_hash, hash)
         VALUES (1, 'ticket.commented', 'human-1', NULL, NULL, '{}', '2026-07-21T00:00:00.000Z', ?, ?)`,
      )
      .run('0'.repeat(64), 'f'.repeat(64));
    log.close();

    const report = await runDoctor(io, {
      detectRunningCore: vi.fn().mockResolvedValue(false),
      resolveCredentialStore: fakeStore(),
      loadConfiguredProviders: vi.fn().mockResolvedValue([]),
      packSource: realPackSource,
    });

    expect(report.ok).toBe(false);
    const dbCheck = report.checks.find((c) => c.name === 'db-integrity');
    expect(dbCheck?.status).toBe('fail');
    expect(dbCheck?.detail).toContain('audit tail broken');
  });

  it('flags an unreachable configured provider as a warning, not a failure', async () => {
    const io = await scratchIo();
    const fakeProvider = {
      id: 'ollama',
      chat: vi.fn(),
      listModels: vi.fn(),
      getContextLength: vi.fn(),
      health: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      warmUp: vi.fn(),
      queueStats: vi.fn(),
    };

    const report = await runDoctor(io, {
      detectRunningCore: vi.fn().mockResolvedValue(false),
      resolveCredentialStore: fakeStore(),
      loadConfiguredProviders: vi
        .fn()
        .mockResolvedValue([{ id: 'ollama', kind: 'ollama' }]),
      buildProvider: vi.fn().mockReturnValue(fakeProvider),
      packSource: realPackSource,
    });

    expect(report.ok).toBe(true); // warn, not fail
    const providersCheck = report.checks.find((c) => c.name === 'providers');
    expect(providersCheck?.status).toBe('warn');
    expect(providersCheck?.detail).toContain('ollama');
  });

  it('flags an orphaned worktree directory with no in_progress ticket', async () => {
    const io = await scratchIo();
    const paths = resolveProjectPaths(io.cwd);
    await fs.mkdir(path.join(paths.worktreesDir, 'W1-99'), { recursive: true });

    const report = await runDoctor(io, {
      detectRunningCore: vi.fn().mockResolvedValue(false),
      resolveCredentialStore: fakeStore(),
      loadConfiguredProviders: vi.fn().mockResolvedValue([]),
      packSource: realPackSource,
    });

    const worktreeCheck = report.checks.find((c) => c.name === 'worktree-orphans');
    expect(worktreeCheck?.status).toBe('warn');
    expect(worktreeCheck?.detail).toContain('W1-99');
  });

  it(
    'RED FIXTURE (W22-14): a stale base probe is named as one, not reported as a ' +
      'ticket whose record vanished',
    async () => {
      // loop-gates-unfalsifiable makes a throwaway checkout of the ticket's
      // BASE and names it <ticketId>--base-probe. That is never an in_progress
      // ticket, so a leftover one already appeared here — as a bare directory,
      // sending anyone who read it looking for a ticket that never existed.
      const io = await scratchIo();
      const paths = resolveProjectPaths(io.cwd);
      await fs.mkdir(path.join(paths.worktreesDir, 'W1-99--base-probe'), {
        recursive: true,
      });

      const report = await runDoctor(io, {
        detectRunningCore: vi.fn().mockResolvedValue(false),
        resolveCredentialStore: fakeStore(),
        loadConfiguredProviders: vi.fn().mockResolvedValue([]),
        packSource: realPackSource,
      });

      const check = report.checks.find((c) => c.name === 'worktree-orphans');
      expect(check?.status).toBe('warn');
      expect(check?.detail).toContain('stale base-probe worktree');
      expect(check?.detail).toContain('safe to delete');
      // And it is NOT described as a ticket orphan.
      expect(check?.detail).not.toContain('no in_progress ticket');
    },
  );

  it('reports a real ticket orphan and a stale probe distinctly, in one check', async () => {
    const io = await scratchIo();
    const paths = resolveProjectPaths(io.cwd);
    await fs.mkdir(path.join(paths.worktreesDir, 'W1-98'), { recursive: true });
    await fs.mkdir(path.join(paths.worktreesDir, 'W1-99--base-probe'), {
      recursive: true,
    });

    const report = await runDoctor(io, {
      detectRunningCore: vi.fn().mockResolvedValue(false),
      resolveCredentialStore: fakeStore(),
      loadConfiguredProviders: vi.fn().mockResolvedValue([]),
      packSource: realPackSource,
    });

    const check = report.checks.find((c) => c.name === 'worktree-orphans');
    expect(check?.detail).toContain('no in_progress ticket: W1-98');
    expect(check?.detail).toContain('W1-99--base-probe');
  });

  it('fails pack-signatures when the manifest signature does not verify', async () => {
    const io = await scratchIo();

    const report = await runDoctor(io, {
      detectRunningCore: vi.fn().mockResolvedValue(false),
      resolveCredentialStore: fakeStore(),
      loadConfiguredProviders: vi.fn().mockResolvedValue([]),
      verifyPack: vi.fn().mockResolvedValue({
        manifestValid: false,
        licenseAllowlisted: false,
        verifiedFiles: [],
        rejectedFiles: [],
        manifest: { license: 'MIT' } as never,
      }),
    });

    expect(report.ok).toBe(false);
    const packCheck = report.checks.find((c) => c.name === 'pack-signatures');
    expect(packCheck?.status).toBe('fail');
  });

  it('fails the keychain check loudly instead of swallowing the error', async () => {
    const io = await scratchIo();

    const report = await runDoctor(io, {
      detectRunningCore: vi.fn().mockResolvedValue(false),
      resolveCredentialStore: () => {
        throw new Error('no OS keychain adapter for platform "linux" yet');
      },
      loadConfiguredProviders: vi.fn().mockResolvedValue([]),
      packSource: realPackSource,
    });

    expect(report.ok).toBe(false);
    const keychainCheck = report.checks.find((c) => c.name === 'keychain');
    expect(keychainCheck?.status).toBe('fail');
    expect(keychainCheck?.detail).toContain('no OS keychain adapter');
  });
});

/**
 * W23-45: doctor must actually load the native module and open a database.
 *
 * LIVE, 2026-09-23: the packed 1.0.1 tarball installed with
 * `npm install --ignore-scripts` has no better-sqlite3 binary at all, and
 * `dokima doctor` printed six OKs and `doctor: OK` — better-sqlite3 loads its
 * binding lazily inside `new Database`, and on a fresh home doctor's only DB
 * check returns "no state.db yet" without opening anything.
 */
describe('native-db (W23-45)', () => {
  const scratchDirs: string[] = [];
  afterEach(async () => {
    for (const dir of scratchDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  async function freshIo(): Promise<CliIO> {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-doctor-native-'));
    scratchDirs.push(projectDir);
    return { stdout: vi.fn(), stderr: vi.fn(), cwd: projectDir, env: {} };
  }

  const baseDeps = {
    detectRunningCore: vi.fn().mockResolvedValue(false),
    resolveCredentialStore: () => createInMemoryCredentialStore(),
    loadConfiguredProviders: vi.fn().mockResolvedValue([]),
    packSource: defaultFirstPartyPackSource(),
  };

  // The exact message better-sqlite3 throws from `new Database` when the
  // install skipped its build (captured from the ignore-scripts install).
  const missingBinding = () => {
    throw new Error(
      'Could not locate the bindings file. Tried:\n → /x/node_modules/better-sqlite3/build/better_sqlite3.node',
    );
  };

  it('RED FIXTURE: an install with no native binary is FAILED, naming the cause and the fix — not "doctor: OK"', async () => {
    const io = await freshIo();
    const code = await runDoctorCommand(io, { ...baseDeps, openProbeDb: missingBinding });

    expect(code).toBe(1);
    const printed = vi
      .mocked(io.stdout)
      .mock.calls.map((c) => String(c[0]))
      .join('\n');
    expect(printed).toContain('doctor: FAILED');
    expect(printed).toMatch(/\[FAIL\] native-db: .*native binary is missing/);
    expect(printed).toContain('ignore-scripts');
    expect(printed).toContain('npm rebuild better-sqlite3');
  });

  it("an ABI mismatch is named with the bootstrap's own wording, not a second copy", async () => {
    const io = await freshIo();
    const report = await runDoctor(io, {
      ...baseDeps,
      openProbeDb: () => {
        throw new Error(
          'The module was compiled against a different Node.js version using\n' +
            'NODE_MODULE_VERSION 127. This version of Node.js requires\nNODE_MODULE_VERSION 137.',
        );
      },
    });
    const check = report.checks.find((c) => c.name === 'native-db');
    expect(check?.status).toBe('fail');
    expect(check?.detail).toContain('this Node cannot load the bundled native modules');
  });

  it('on a fresh home it really opens (and then removes) a throwaway database', async () => {
    const io = await freshIo();
    const opened: string[] = [];
    const report = await runDoctor(io, {
      ...baseDeps,
      openProbeDb: (dbPath: string) => {
        opened.push(dbPath);
        return openEventLog(dbPath);
      },
    });
    expect(opened).toHaveLength(1);
    expect(report.checks.find((c) => c.name === 'native-db')?.status).toBe('ok');
    // The project was not touched, and the probe did not outlive the check.
    await expect(fs.stat(path.join(io.cwd, '.dokima'))).rejects.toThrow();
    await expect(fs.stat(path.dirname(opened[0]!))).rejects.toThrow();
  });

  it('the default probe opens a real database with the product migrations', async () => {
    const report = await runDoctor(await freshIo(), baseDeps);
    expect(report.checks.find((c) => c.name === 'native-db')).toEqual({
      name: 'native-db',
      status: 'ok',
      detail: 'better-sqlite3 loaded; a throwaway database was opened and migrated',
    });
  });
});

describe('runDoctorCommand', () => {
  const scratchDirs: string[] = [];

  afterEach(async () => {
    for (const dir of scratchDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('exits 0 and prints the report when every check is green', async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-doctor-cmd-'));
    scratchDirs.push(projectDir);
    const io: CliIO = { stdout: vi.fn(), stderr: vi.fn(), cwd: projectDir, env: {} };
    const store = createInMemoryCredentialStore();

    const code = await runDoctorCommand(io, {
      detectRunningCore: vi.fn().mockResolvedValue(false),
      resolveCredentialStore: () => store,
      loadConfiguredProviders: vi.fn().mockResolvedValue([]),
      packSource: defaultFirstPartyPackSource(),
      sastProbe: SAST_READY,
    });

    expect(code).toBe(0);
    expect(io.stdout).toHaveBeenCalledWith(expect.stringContaining('doctor: OK'));
  });
});

describe('sast (W23-51)', () => {
  const io = (env: NodeJS.ProcessEnv = {}): CliIO => ({
    stdout: vi.fn(),
    stderr: vi.fn(),
    cwd: '/tmp',
    env,
  });

  it('RED FIXTURE: a host without opengrep is a WARNING that names the official installer', async () => {
    const check = await checkSast(io(), {
      sastProbe: async () => ({
        opengrepInstalled: false,
        rules: (await SAST_READY({})).rules,
      }),
    });
    expect(check.status).toBe('warn');
    expect(check.detail).toMatch(/opengrep is not installed/);
    expect(check.detail).toContain('opengrep/opengrep/main/install.sh');
    expect(check.detail).toMatch(/NOT RUN/);
  });

  it('a host with no pinned ruleset is a WARNING naming where it looked and DOKIMA_SAST_RULES', async () => {
    const check = await checkSast(io({ DOKIMA_SAST_RULES: '/nowhere/packs' }), {
      sastProbe: async () => ({ opengrepInstalled: true, rules: null }),
    });
    expect(check.status).toBe('warn');
    expect(check.detail).toContain('/nowhere/packs');
    expect(check.detail).toMatch(/DOKIMA_SAST_RULES/);
    expect(check.detail).toMatch(/Registry rules are never used/);
  });

  it('ready: names the rule count, the root and the digest prefix', async () => {
    const check = await checkSast(io(), { sastProbe: SAST_READY });
    expect(check).toMatchObject({ name: 'sast', status: 'ok' });
    expect(check.detail).toMatch(/3 rule file\(s\) from \/rules\/packs \(sha256:aaaa/);
  });
});

/**
 * W23-60 — with nothing configured, the bundled open baseline is the ruleset.
 * Hermetic: the probe resolves with its own empty HOME and no
 * DOKIMA_SAST_RULES, never this machine's ~/.dokima/rules/sast.
 */
describe('sast on the bundled baseline (W23-60)', () => {
  const homes: string[] = [];
  afterEach(async () => {
    await Promise.all(
      homes.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
    );
  });

  async function bundledProbe(): Promise<{ io: CliIO; probe: SastProbe }> {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-doctor-sast-home-'));
    homes.push(home);
    const env = { HOME: home };
    return {
      io: { stdout: vi.fn(), stderr: vi.fn(), cwd: '/tmp', env },
      probe: async (e) => ({ opengrepInstalled: true, rules: await resolveSastRules(e) }),
    };
  }

  it('is OK, not a warning, names the baseline as the active ruleset, and says a richer pack can be plugged in', async () => {
    const { io, probe } = await bundledProbe();
    const check = await checkSast(io, { sastProbe: probe });
    expect(check.status).toBe('ok');
    expect(check.detail).toContain('the bundled open baseline');
    expect(check.detail).toContain(path.join('rules', 'sast-baseline'));
    expect(check.detail).toMatch(/richer rule pack can be plugged in/);
    expect(check.detail).toMatch(/DOKIMA_SAST_RULES/);
    expect(check.detail).toContain('~/.dokima/rules/sast');
  });

  it('a pack the user plugged in is named, with no richer-pack hint', async () => {
    const { io } = await bundledProbe();
    const pack = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-doctor-sast-pack-'));
    homes.push(pack);
    await fs.writeFile(path.join(pack, 'mine.yaml'), 'rules: []');
    const env = { ...io.env, DOKIMA_SAST_RULES: pack };
    const check = await checkSast(
      { ...io, env },
      {
        sastProbe: async (e) => ({
          opengrepInstalled: true,
          rules: await resolveSastRules(e),
        }),
      },
    );
    expect(check.status).toBe('ok');
    expect(check.detail).toContain(`${pack} (DOKIMA_SAST_RULES)`);
    expect(check.detail).not.toMatch(/richer rule pack/);
  });
});

/**
 * W23-56 — doctor says what the dependency audit can do for THIS project.
 * A local-only project cannot run `npm audit`; before this nothing told the
 * user so until a ticket sat in review with tool-deps NOT RUN.
 */
describe('dependency-audit (W23-56)', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
    );
  });

  async function project(settings: Record<string, unknown> | null): Promise<CliIO> {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-doctor-deps-'));
    dirs.push(cwd);
    if (settings) {
      await fs.mkdir(path.join(cwd, '.dokima'));
      await fs.writeFile(
        path.join(cwd, '.dokima', 'settings.json'),
        JSON.stringify(settings),
      );
    }
    return { stdout: vi.fn(), stderr: vi.fn(), cwd, env: {} };
  }

  it('RED: local-only with the default policy is a WARNING that names both ways out', async () => {
    const check = await checkDependencyAudit(
      await project({ 'modelPolicy.localOnly': true }),
    );
    expect(check).toMatchObject({ name: 'dependency-audit', status: 'warn' });
    expect(check.detail).toMatch(/local-only/);
    expect(check.detail).toMatch(/changes? (its|a) dependenc/);
    expect(check.detail).toMatch(/security\.unauditedDependencies/);
    expect(check.detail).toMatch(/modelPolicy\.localOnly/);
  });

  it('local-only with "allow" is a WARNING that says changes are accepted without an audit', async () => {
    const check = await checkDependencyAudit(
      await project({
        'modelPolicy.localOnly': true,
        'security.unauditedDependencies': 'allow',
      }),
    );
    expect(check.status).toBe('warn');
    expect(check.detail).toMatch(/accepted without a dependency audit/);
  });

  it('a network-allowed project is OK: npm audit reaches its registry', async () => {
    const check = await checkDependencyAudit(
      await project({ 'modelPolicy.localOnly': false }),
    );
    expect(check).toMatchObject({ name: 'dependency-audit', status: 'ok' });
  });

  it('no settings file reads as local-only (the conservative first-run answer), not as OK', async () => {
    expect((await checkDependencyAudit(await project(null))).status).toBe('warn');
  });
});
