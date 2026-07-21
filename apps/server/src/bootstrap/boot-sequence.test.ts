import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendEvent, createIdentity, openEventLog } from '@shipwright/events';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveProjectPaths } from './config.js';
import { DowngradeRefusedError, latestKnownSchemaVersion } from './migrate-guard.js';
import { TruncatedLogError, runBootSequence } from './boot-sequence.js';

describe('runBootSequence', () => {
  const scratchDirs: string[] = [];
  let seq = 0;
  const clock = () => new Date(2026, 0, 1, 0, 0, ++seq).toISOString();

  afterEach(async () => {
    for (const dir of scratchDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  async function scratchProject(): Promise<{ projectDir: string; home: string }> {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-boot-project-'));
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-boot-home-'));
    scratchDirs.push(projectDir, home);
    return { projectDir, home };
  }

  it('boots a fresh project cleanly: dirs created, no backup, no orphans, tail valid', async () => {
    const { projectDir, home } = await scratchProject();
    const { log, report } = await runBootSequence({
      projectDir,
      env: { SHIPWRIGHT_HOME: home },
      now: clock,
    });
    expect(report.backupPath).toBeNull();
    expect(report.orphaned).toEqual([]);
    expect(report.tailCheck.valid).toBe(true);
    expect(report.highWater.truncated).toBe(false);
    await expect(fs.stat(report.paths.shipwrightDir)).resolves.toBeDefined();
    log.close();
  });

  it('resolves an unresolved <op>.started event as orphaned on the next boot', async () => {
    const { projectDir, home } = await scratchProject();
    const paths = resolveProjectPaths(projectDir);
    await fs.mkdir(paths.shipwrightDir, { recursive: true });

    const seedLog = openEventLog(paths.dbPath);
    createIdentity(
      seedLog,
      { id: 'actor-1', name: 'actor-1', kind: 'human' },
      { now: clock },
    );
    appendEvent(
      seedLog,
      {
        eventType: 'ticket.claim.started',
        actorId: 'actor-1',
        ticketId: 'W1-01',
        payload: {},
      },
      { now: clock },
    );
    seedLog.close();

    const { log, report } = await runBootSequence({
      projectDir,
      env: { SHIPWRIGHT_HOME: home },
      now: clock,
    });
    expect(report.orphaned).toHaveLength(1);
    expect(report.orphaned[0]?.eventType).toBe('ticket.claim.orphaned');
    log.close();
  });

  it('backs up state.db before applying a pending migration', async () => {
    const { projectDir, home } = await scratchProject();
    const paths = resolveProjectPaths(projectDir);
    await fs.mkdir(paths.shipwrightDir, { recursive: true });

    // Roll the db back to a genuinely-valid prior schema version, not just a
    // rewound pragma: drop what the latest migration (012_field_reports.sql)
    // added, so `runBootSequence`'s real `openEventLog` call can legitimately
    // re-apply it (CREATE TABLE would otherwise fail with "already exists").
    const seedLog = openEventLog(paths.dbPath);
    seedLog.db.exec('DROP TABLE field_reports');
    const priorVersion = latestKnownSchemaVersion() - 1;
    seedLog.db.pragma(`user_version = ${priorVersion}`);
    seedLog.close();

    const { log, report } = await runBootSequence({
      projectDir,
      env: { SHIPWRIGHT_HOME: home },
      now: clock,
    });
    expect(report.backupPath).not.toBeNull();
    await expect(fs.stat(report.backupPath as string)).resolves.toBeDefined();
    log.close();
  });

  it('refuses to boot a db newer than this binary knows (downgrade)', async () => {
    const { projectDir, home } = await scratchProject();
    const paths = resolveProjectPaths(projectDir);
    await fs.mkdir(paths.shipwrightDir, { recursive: true });

    const seedLog = openEventLog(paths.dbPath);
    seedLog.db.pragma(`user_version = ${latestKnownSchemaVersion() + 1}`);
    seedLog.close();

    await expect(
      runBootSequence({ projectDir, env: { SHIPWRIGHT_HOME: home }, now: clock }),
    ).rejects.toThrow(DowngradeRefusedError);
  });

  it('refuses to boot when the log was truncated since the last high-water mirror', async () => {
    const { projectDir, home } = await scratchProject();

    const first = await runBootSequence({
      projectDir,
      env: { SHIPWRIGHT_HOME: home },
      now: clock,
    });
    createIdentity(
      first.log,
      { id: 'actor-1', name: 'actor-1', kind: 'human' },
      { now: clock },
    );
    for (let i = 0; i < 10; i++) {
      appendEvent(
        first.log,
        { eventType: 'ticket.claimed', actorId: 'actor-1', payload: { i } },
        { now: clock },
      );
    }
    const dbPath = first.report.paths.dbPath;
    first.log.close();

    // A second real boot mirrors the high-water seq (10) to disk — the
    // first boot's own mirror write happened before these events existed.
    const second = await runBootSequence({
      projectDir,
      env: { SHIPWRIGHT_HOME: home },
      now: clock,
    });
    expect(second.report.highWater.currentSeq).toBe(10);
    second.log.close();

    await fs.rm(dbPath);
    const staleLog = openEventLog(dbPath);
    createIdentity(
      staleLog,
      { id: 'actor-1', name: 'actor-1', kind: 'human' },
      { now: clock },
    );
    appendEvent(
      staleLog,
      { eventType: 'ticket.claimed', actorId: 'actor-1', payload: {} },
      { now: clock },
    );
    staleLog.close();

    await expect(
      runBootSequence({ projectDir, env: { SHIPWRIGHT_HOME: home }, now: clock }),
    ).rejects.toThrow(TruncatedLogError);
  });
});
