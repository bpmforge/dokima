import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openEventLog } from '@dokima/events';
import { createTicket } from '@dokima/tickets';
import { ensureActorIdentity } from '../cli/identity.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveProjectPaths } from './config.js';
import { runPackagedCli, type CliIO } from './cli.js';

describe('runPackagedCli', () => {
  const scratchDirs: string[] = [];

  afterEach(async () => {
    for (const dir of scratchDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  async function scratchProject(): Promise<{ projectDir: string; io: CliIO }> {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-cli-'));
    scratchDirs.push(projectDir);
    return {
      projectDir,
      io: {
        stdout: vi.fn(),
        stderr: vi.fn(),
        cwd: projectDir,
        env: {},
      },
    };
  }

  function fakeBootResult(projectDir: string) {
    const paths = resolveProjectPaths(projectDir);
    const log = openEventLog(':memory:');
    return {
      log,
      report: {
        paths,
        backupPath: null,
        orphaned: [],
        tailCheck: {
          valid: true,
          checkedFrom: null,
          checkedTo: null,
          brokenAtSeq: null,
          reason: null,
        },
        highWater: { truncated: false, recordedSeq: 0, currentSeq: 0 },
      },
    };
  }

  /**
   * W10-44. Every test here asserts an ABSENCE — no boot, no browser, no port
   * probe — because the defect was never a wrong message, it was a fall-through
   * to `runServerBoot`. Asserting only on stdout would pass against the bug.
   */
  function noSideEffectDeps() {
    return {
      runBootSequence: vi.fn(),
      detectRunningCore: vi.fn(),
      openBrowser: vi.fn(),
      buildApiServer: vi.fn(),
      listenLocalhost: vi.fn(),
      ensureAuthToken: vi.fn(),
      packsUpdate: vi.fn(),
    };
  }

  function expectNothingHappened(deps: ReturnType<typeof noSideEffectDeps>) {
    expect(deps.detectRunningCore).not.toHaveBeenCalled();
    expect(deps.runBootSequence).not.toHaveBeenCalled();
    expect(deps.openBrowser).not.toHaveBeenCalled();
    expect(deps.buildApiServer).not.toHaveBeenCalled();
    expect(deps.listenLocalhost).not.toHaveBeenCalled();
    expect(deps.ensureAuthToken).not.toHaveBeenCalled();
  }

  it.each(['--help', '-h'])(
    'RED FIXTURE: `%s` prints usage and exits 0 without booting, probing a port, or opening a browser',
    async (flag) => {
      const { io } = await scratchProject();
      const deps = noSideEffectDeps();
      // Against pre-W10-44 code this printed nothing and started a server.
      expect(await runPackagedCli([flag], io, deps)).toBe(0);
      expectNothingHappened(deps);
      expect(io.stderr).not.toHaveBeenCalled();
      const printed = (io.stdout as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => String(c[0]))
        .join('\n');
      expect(printed).toContain('usage:');
      expect(printed).toContain('dokima doctor');
      expect(printed).toContain('DOKIMA_PORT');
    },
  );

  it.each(['--version', '-V'])(
    '`%s` prints a bare version and exits 0, with no side effects',
    async (flag) => {
      const { io } = await scratchProject();
      const deps = noSideEffectDeps();
      expect(await runPackagedCli([flag], io, deps)).toBe(0);
      expectNothingHappened(deps);
      const printed = (io.stdout as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => String(c[0]))
        .join('\n');
      // The real manifest version, resolved through the distribution root.
      expect(printed.trim()).toMatch(/^\d+\.\d+\.\d+/);
    },
  );

  it('RED FIXTURE: a mistyped command exits NON-ZERO with usage on stderr, never booting', async () => {
    const { io } = await scratchProject();
    const deps = noSideEffectDeps();
    // `dokma`-style typos, and a plausible-but-wrong subcommand.
    expect(await runPackagedCli(['docter'], io, deps)).toBe(2);
    expectNothingHappened(deps);
    const errs = (io.stderr as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => String(c[0]))
      .join('\n');
    expect(errs).toContain("unknown command 'docter'");
    expect(errs).toContain('usage:');
    // Exiting 0 here would leave a script unable to tell a typo from a real run.
    expect(io.stdout).not.toHaveBeenCalled();
  });

  it('refuses an incomplete known command rather than falling through to a boot', async () => {
    const { io } = await scratchProject();
    const deps = noSideEffectDeps();
    // `packs` and `providers` used to require an exact second token and
    // silently booted the server when it was missing or wrong.
    expect(await runPackagedCli(['packs'], io, deps)).toBe(2);
    expect(await runPackagedCli(['packs', 'instal'], io, deps)).toBe(2);
    expect(await runPackagedCli(['providers'], io, deps)).toBe(2);
    expect(deps.packsUpdate).not.toHaveBeenCalled();
    expectNothingHappened(deps);
  });

  it('dispatches to packsUpdate for `packs update`', async () => {
    const { io } = await scratchProject();
    const packsUpdate = vi.fn().mockResolvedValue({
      manifestValid: true,
      licenseAllowlisted: true,
      verifiedFiles: ['a.sh'],
      rejectedFiles: [],
      manifest: {},
      installedTo: '/fake/packs/first-party',
    });

    const code = await runPackagedCli(['packs', 'update'], io, { packsUpdate });
    expect(code).toBe(0);
    expect(packsUpdate).toHaveBeenCalled();
    expect(io.stdout).toHaveBeenCalledWith(expect.stringContaining('1 file(s) verified'));
  });

  it('reports failure when packs update rejects the signature', async () => {
    const { io } = await scratchProject();
    const packsUpdate = vi.fn().mockResolvedValue({
      manifestValid: false,
      licenseAllowlisted: false,
      verifiedFiles: [],
      rejectedFiles: [{ path: 'a.sh', reason: 'file-hash-mismatch' }],
      manifest: {},
      installedTo: '/fake',
    });

    const code = await runPackagedCli(['packs', 'update'], io, { packsUpdate });
    expect(code).toBe(1);
    expect(io.stderr).toHaveBeenCalledWith(expect.stringContaining('refused'));
  });

  it('detects an already-running core and opens the Canvas without rebinding', async () => {
    const { projectDir, io } = await scratchProject();
    const boot = fakeBootResult(projectDir);
    const runBootSequence = vi.fn().mockResolvedValue(boot);
    const detectRunningCore = vi.fn().mockResolvedValue(true);
    const openBrowser = vi.fn();
    const buildApiServer = vi.fn();
    const listenLocalhost = vi.fn();

    const code = await runPackagedCli([], io, {
      runBootSequence,
      detectRunningCore,
      openBrowser,
      buildApiServer,
      listenLocalhost,
    });

    expect(code).toBe(0);
    expect(openBrowser).toHaveBeenCalledWith('http://127.0.0.1:4317');
    expect(runBootSequence).not.toHaveBeenCalled();
    expect(buildApiServer).not.toHaveBeenCalled();
    expect(listenLocalhost).not.toHaveBeenCalled();
    expect(io.stdout).toHaveBeenCalledWith(expect.stringContaining('already running'));
  });

  it('binds a fresh server + opens the Canvas when nothing is running yet', async () => {
    const { projectDir, io } = await scratchProject();
    await fs.mkdir(resolveProjectPaths(projectDir).dokimaDir, { recursive: true });
    const boot = fakeBootResult(projectDir);
    const runBootSequence = vi.fn().mockResolvedValue(boot);
    const detectRunningCore = vi.fn().mockResolvedValue(false);
    const openBrowser = vi.fn();
    const addHook = vi.fn();
    const buildApiServer = vi.fn().mockResolvedValue({ app: { addHook }, wsHub: {} });
    const listenLocalhost = vi.fn().mockResolvedValue(undefined);
    const ensureAuthToken = vi
      .fn()
      .mockResolvedValue({ token: 'tok', tokenPath: '/fake/token' });

    const code = await runPackagedCli([], io, {
      runBootSequence,
      detectRunningCore,
      openBrowser,
      buildApiServer,
      listenLocalhost,
      ensureAuthToken,
    });

    expect(code).toBe(0);
    expect(buildApiServer).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'tok', port: 4317 }),
    );
    expect(listenLocalhost).toHaveBeenCalled();
    expect(openBrowser).toHaveBeenCalledWith('http://127.0.0.1:4317');
    expect(addHook).toHaveBeenCalledWith('onClose', expect.any(Function));
  });

  it('honors DOKIMA_PORT', async () => {
    const { projectDir, io } = await scratchProject();
    io.env.DOKIMA_PORT = '5555';
    const boot = fakeBootResult(projectDir);
    const runBootSequence = vi.fn().mockResolvedValue(boot);
    const detectRunningCore = vi.fn().mockResolvedValue(true);
    const openBrowser = vi.fn();

    await runPackagedCli([], io, { runBootSequence, detectRunningCore, openBrowser });
    expect(detectRunningCore).toHaveBeenCalledWith({ port: 5555 });
    expect(openBrowser).toHaveBeenCalledWith('http://127.0.0.1:5555');
  });

  it('reports a boot-sequence refusal (e.g. downgrade) as a failure, never booting past it', async () => {
    const { io } = await scratchProject();
    const runBootSequence = vi
      .fn()
      .mockRejectedValue(new Error('refusing to open: downgrade'));
    const detectRunningCore = vi.fn().mockResolvedValue(false);

    const code = await runPackagedCli([], io, { runBootSequence, detectRunningCore });
    expect(code).toBe(1);
    expect(detectRunningCore).toHaveBeenCalled();
    expect(io.stderr).toHaveBeenCalledWith(expect.stringContaining('downgrade'));
  });

  it('skips the boot sequence entirely when a core is already running (no double-bind, no false orphan sweep)', async () => {
    const { io } = await scratchProject();
    const runBootSequence = vi.fn().mockRejectedValue(new Error('should not be called'));
    const detectRunningCore = vi.fn().mockResolvedValue(true);
    const openBrowser = vi.fn();

    const code = await runPackagedCli([], io, {
      runBootSequence,
      detectRunningCore,
      openBrowser,
    });

    expect(code).toBe(0);
    expect(runBootSequence).not.toHaveBeenCalled();
    expect(openBrowser).toHaveBeenCalledWith('http://127.0.0.1:4317');
  });

  it('dispatches `backup` to the backup command with its own deps', async () => {
    const { io } = await scratchProject();
    const createOnlineBackup = vi.fn().mockResolvedValue('/fake/backups/online-1.db');
    const pruneBackups = vi.fn().mockResolvedValue({ kept: [], pruned: [] });

    const code = await runPackagedCli(['backup'], io, {
      backup: { createOnlineBackup, pruneBackups },
    });

    expect(code).toBe(0);
    expect(createOnlineBackup).toHaveBeenCalled();
  });

  it('dispatches `doctor` to the doctor command with its own deps', async () => {
    const { io } = await scratchProject();
    const detectRunningCoreForDoctor = vi.fn().mockResolvedValue(false);

    const code = await runPackagedCli(['doctor'], io, {
      doctor: {
        detectRunningCore: detectRunningCoreForDoctor,
        resolveCredentialStore: () => ({
          get: vi.fn().mockResolvedValue('ok'),
          set: vi.fn().mockResolvedValue(undefined),
          delete: vi.fn().mockResolvedValue(undefined),
        }),
        loadConfiguredProviders: vi.fn().mockResolvedValue([]),
      },
    });

    expect(code).toBe(0);
    expect(detectRunningCoreForDoctor).toHaveBeenCalled();
    expect(io.stdout).toHaveBeenCalledWith(expect.stringContaining('doctor: OK'));
  });

  it('dispatches `service <subcommand>` to the service command, refusing an unknown subcommand', async () => {
    const { io } = await scratchProject();
    const exec = vi
      .fn()
      .mockResolvedValue({ stdout: 'active\n', stderr: '', exitCode: 0 });

    const code = await runPackagedCli(['service', 'status'], io, {
      service: { platform: 'linux', exec },
    });
    expect(code).toBe(0);
    expect(exec).toHaveBeenCalled();

    const badCode = await runPackagedCli(['service', 'bogus'], io);
    expect(badCode).toBe(2);
    expect(io.stderr).toHaveBeenCalledWith(
      expect.stringContaining('usage: dokima service'),
    );
  });

  it('dispatches `providers refresh` to the providers-refresh command with its own deps', async () => {
    const { io } = await scratchProject();
    const loadConfiguredProviders = vi.fn().mockResolvedValue([]);

    const code = await runPackagedCli(['providers', 'refresh'], io, {
      providersRefresh: { loadConfiguredProviders },
    });

    expect(code).toBe(0);
    expect(loadConfiguredProviders).toHaveBeenCalled();
    expect(io.stdout).toHaveBeenCalledWith(expect.stringContaining('nothing to refresh'));
  });

  /**
   * W10-74. The lifecycle verbs were fully implemented in `cli/run.ts` and
   * reachable from nothing: `build.mjs` bundles only `bootstrap/main.ts`, no
   * package.json declared a bin for `cli/index.ts` (an orphan since deleted in
   * W22-05), and this dispatch answered `unknown command` for every one of them. An installed user could create a
   * board through the product and never advance a single ticket on it.
   *
   * Reachability alone is not the fix, so this asserts the JOURNEY: address a
   * project the way the Fleet names it (`--project <id>`, resolved through the
   * registry) from a cwd that is NOT the project, and check the ticket really
   * moved. A `--db <path>` an installed user cannot guess would pass a
   * reachability test and still leave them stuck.
   */
  it('RED FIXTURE: the ticket lifecycle is reachable from the PACKAGED cli and addressable by project id', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-cli-home-'));
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-cli-proj-'));
    const elsewhere = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-cli-cwd-'));
    scratchDirs.push(home, projectDir, elsewhere);

    const projectId = 'proj-w10-74';
    await fs.writeFile(
      path.join(home, 'fleet.json'),
      JSON.stringify([{ id: projectId, path: projectDir, name: 'Packaged CLI E2E' }]),
    );

    await fs.mkdir(path.join(projectDir, '.dokima'), { recursive: true });
    const log = openEventLog(path.join(projectDir, '.dokima', 'state.db'));
    ensureActorIdentity(log, 'operator');
    createTicket(log, 'operator', {
      id: 'T-1',
      type: 'task',
      title: 'A ticket the packaged binary must be able to move',
      lane: 'lane-a',
      writeScope: ['src/**'],
      dependsOn: [],
      acceptance: [{ id: 'AC-1', text: 'it moves', done: false }],
    });
    log.close();

    const stdout: string[] = [];
    const stderr: string[] = [];
    // cwd is deliberately NOT the project: only --project can find it.
    const io: CliIO = {
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
      cwd: elsewhere,
      env: { DOKIMA_HOME: home },
    };

    expect(await runPackagedCli(['board', '--project', projectId], io)).toBe(0);
    expect(stdout.join('\n')).toContain('T-1');

    expect(
      await runPackagedCli(
        ['claim', 'T-1', '--actor', 'maker-1', '--project', projectId],
        io,
      ),
    ).toBe(0);
    expect(stdout.join('\n')).toContain('T-1 claim -> claimed');

    expect(
      await runPackagedCli(
        ['start', 'T-1', '--actor', 'maker-1', '--project', projectId],
        io,
      ),
    ).toBe(0);

    // The refusals survive the new route, which is the half that matters:
    // reachability must not have opened a door around the trust boundary.
    expect(
      await runPackagedCli(
        [
          'close',
          'T-1',
          '--actor',
          'maker-1',
          '--files',
          'src/a.ts',
          '--commits',
          'abc1234',
          '--verify-cmd',
          'pnpm test',
          '--verify-exit',
          '1',
          '--project',
          projectId,
        ],
        io,
      ),
    ).toBe(1);
    expect(stderr.join('\n')).toContain('MANIFEST_INVALID');

    expect(
      await runPackagedCli(
        [
          'close',
          'T-1',
          '--actor',
          'maker-1',
          '--files',
          'src/a.ts',
          '--commits',
          'abc1234',
          '--verify-cmd',
          'pnpm test',
          '--verify-exit',
          '0',
          '--project',
          projectId,
        ],
        io,
      ),
    ).toBe(0);
    expect(stdout.join('\n')).toContain('T-1 close -> in_review');

    // C-4: the maker cannot sign off their own work, even from here.
    expect(
      await runPackagedCli(
        ['accept', 'T-1', '--actor', 'maker-1', '--project', projectId],
        io,
      ),
    ).toBe(1);
    expect(stderr.join('\n')).toContain('SELF_ACCEPT');

    // ...and the ticket really reaches done for a distinct reviewer. Asserting
    // only that the command was FOUND would pass without this.
    expect(
      await runPackagedCli(
        ['accept', 'T-1', '--actor', 'reviewer-1', '--project', projectId],
        io,
      ),
    ).toBe(0);
    expect(stdout.join('\n')).toContain('T-1 accept -> done');
  });

  it('an unregistered project id is a usage refusal naming where real ids live, not a crash', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-cli-home-'));
    scratchDirs.push(home);
    await fs.writeFile(path.join(home, 'fleet.json'), '[]');
    const stderr: string[] = [];
    const io: CliIO = {
      stdout: vi.fn(),
      stderr: (line) => stderr.push(line),
      cwd: home,
      env: { DOKIMA_HOME: home },
    };

    expect(await runPackagedCli(['board', '--project', 'nope'], io)).toBe(2);
    expect(stderr.join('\n')).toContain('no project registered with id nope');
    expect(stderr.join('\n')).toContain('open the Fleet');
  });
});

describe('DEFAULT_PORT is declared once (W12-01)', () => {
  it(
    'RED FIXTURE: the port literal appears in exactly ONE source file. It was ' +
      'declared independently in bootstrap/cli.ts and api/main.ts, so changing ' +
      'the port was a two-file edit and the copy nobody edited kept working and ' +
      'stayed green — no test could see the disagreement',
    async () => {
      const { readFileSync } = await import('node:fs');
      const { fileURLToPath } = await import('node:url');
      const path = await import('node:path');
      const here = path.dirname(fileURLToPath(import.meta.url));
      const files = [
        path.join(here, 'cli.ts'),
        path.join(here, '..', 'api', 'main.ts'),
      ];
      const declaring = files.filter((f) => /\b4317\b/.test(readFileSync(f, 'utf8')));
      expect(declaring).toHaveLength(1);
      expect(declaring[0]).toContain('main.ts');
    },
  );

  it('the two modules agree, because there is only one value to agree about', async () => {
    const cli = await import('./cli.js');
    const api = await import('../api/index.js');
    expect(cli.DEFAULT_PORT).toBe(api.DEFAULT_PORT);
    expect(cli.DEFAULT_PORT).toBe(4317);
  });
});
