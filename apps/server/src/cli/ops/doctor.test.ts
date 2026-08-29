import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendEvent, createIdentity, openEventLog } from '@dokima/events';
import { createInMemoryCredentialStore, type CredentialStore } from '@dokima/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CliIO } from '../../bootstrap/cli.js';
import { resolveProjectPaths } from '../../bootstrap/config.js';
import { defaultFirstPartyPackSource } from '../../bootstrap/packs-update.js';
import { runDoctor, runDoctorCommand } from './doctor.js';

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
    });

    expect(report.ok).toBe(true);
    expect(report.checks.every((c) => c.status === 'ok')).toBe(true);
    const find = (name: string) => report.checks.find((c) => c.name === name);
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
      await fs.mkdir(path.join(paths.worktreesDir, 'W1-99--base-probe'), { recursive: true });

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
    await fs.mkdir(path.join(paths.worktreesDir, 'W1-99--base-probe'), { recursive: true });

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
    });

    expect(code).toBe(0);
    expect(io.stdout).toHaveBeenCalledWith(expect.stringContaining('doctor: OK'));
  });
});
