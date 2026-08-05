import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  GENESIS_HASH,
  appendEvent,
  computeEventHash,
  createIdentity,
  openEventLog,
} from '@dokima/events';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveProjectPaths } from './config.js';
import { DowngradeRefusedError, latestKnownSchemaVersion } from './migrate-guard.js';
import {
  TamperedAuditTailError,
  TruncatedLogError,
  runBootSequence,
} from './boot-sequence.js';

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
      env: { DOKIMA_HOME: home },
      now: clock,
    });
    expect(report.backupPath).toBeNull();
    expect(report.orphaned).toEqual([]);
    expect(report.tailCheck.valid).toBe(true);
    expect(report.highWater.truncated).toBe(false);
    await expect(fs.stat(report.paths.dokimaDir)).resolves.toBeDefined();
    log.close();
  });

  it('resolves an unresolved <op>.started event as orphaned on the next boot', async () => {
    const { projectDir, home } = await scratchProject();
    const paths = resolveProjectPaths(projectDir);
    await fs.mkdir(paths.dokimaDir, { recursive: true });

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
      env: { DOKIMA_HOME: home },
      now: clock,
    });
    expect(report.orphaned).toHaveLength(1);
    expect(report.orphaned[0]?.eventType).toBe('ticket.claim.orphaned');
    log.close();
  });

  it('backs up state.db before applying a pending migration', async () => {
    const { projectDir, home } = await scratchProject();
    const paths = resolveProjectPaths(projectDir);
    await fs.mkdir(paths.dokimaDir, { recursive: true });

    // Roll the db back to a genuinely-valid prior schema version, not just a
    // rewound pragma: undo whatever the LATEST migration file added, so
    // `runBootSequence`'s real `openEventLog` call can legitimately re-apply
    // it (re-running a CREATE TABLE would otherwise fail with "already
    // exists"; re-running an ADD COLUMN would fail with "duplicate column
    // name"). This must track the actual newest migration, not a hardcoded
    // one: it broke silently-until-CI (W10-68) the first time a migration
    // after 012_field_reports.sql (013_model_matrix_provider.sql, an ADD
    // COLUMN) shipped, because the fixture only knew how to undo a CREATE
    // TABLE. Whoever adds migration 014 must update this again.
    const seedLog = openEventLog(paths.dbPath);
    seedLog.db.exec('ALTER TABLE model_matrix DROP COLUMN provider_id');
    const priorVersion = latestKnownSchemaVersion() - 1;
    seedLog.db.pragma(`user_version = ${priorVersion}`);
    seedLog.close();

    const { log, report } = await runBootSequence({
      projectDir,
      env: { DOKIMA_HOME: home },
      now: clock,
    });
    expect(report.backupPath).not.toBeNull();
    await expect(fs.stat(report.backupPath as string)).resolves.toBeDefined();
    log.close();
  });

  it('refuses to boot a db newer than this binary knows (downgrade)', async () => {
    const { projectDir, home } = await scratchProject();
    const paths = resolveProjectPaths(projectDir);
    await fs.mkdir(paths.dokimaDir, { recursive: true });

    const seedLog = openEventLog(paths.dbPath);
    seedLog.db.pragma(`user_version = ${latestKnownSchemaVersion() + 1}`);
    seedLog.close();

    await expect(
      runBootSequence({ projectDir, env: { DOKIMA_HOME: home }, now: clock }),
    ).rejects.toThrow(DowngradeRefusedError);
  });

  it('refuses to boot when the log was truncated since the last high-water mirror', async () => {
    const { projectDir, home } = await scratchProject();

    const first = await runBootSequence({
      projectDir,
      env: { DOKIMA_HOME: home },
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
      env: { DOKIMA_HOME: home },
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
      runBootSequence({ projectDir, env: { DOKIMA_HOME: home }, now: clock }),
    ).rejects.toThrow(TruncatedLogError);
  });

  it('refuses to boot when the audit tail check finds a hash-chain break (reviewer HIGH: tamper-evidence must be enforced, not just reported)', async () => {
    const { projectDir, home } = await scratchProject();
    const paths = resolveProjectPaths(projectDir);
    await fs.mkdir(paths.dokimaDir, { recursive: true });

    // events are INSERT-only (no UPDATE/DELETE, DATABASE.md §2) — a tamper
    // attempt through this app is already rejected by the DB trigger. To
    // simulate a file-level edit that bypassed the app entirely (the real
    // threat SC-11 defends against), this seeds the chain via raw INSERTs
    // with one event's stored hash deliberately wrong.
    const seedLog = openEventLog(paths.dbPath);
    createIdentity(
      seedLog,
      { id: 'actor-1', name: 'actor-1', kind: 'human' },
      { now: clock },
    );
    let prevHash = GENESIS_HASH;
    for (let seqNum = 1; seqNum <= 5; seqNum++) {
      const payloadJson = JSON.stringify({ i: seqNum });
      const hash =
        seqNum === 3
          ? 'f'.repeat(64)
          : computeEventHash({
              prevHash,
              seq: seqNum,
              eventType: 'ticket.claimed',
              actorId: 'actor-1',
              payloadJson,
            });
      seedLog.db
        .prepare(
          `INSERT INTO events (seq, event_type, actor_id, ticket_id, run_id, payload, created_at, prev_hash, hash)
           VALUES (?, 'ticket.claimed', 'actor-1', NULL, NULL, ?, ?, ?, ?)`,
        )
        .run(seqNum, payloadJson, clock(), prevHash, hash);
      prevHash = hash;
    }
    seedLog.close();

    await expect(
      runBootSequence({ projectDir, env: { DOKIMA_HOME: home }, now: clock }),
    ).rejects.toThrow(TamperedAuditTailError);

    // The high-water mirror must NOT advance past a refused boot — a
    // second, still-tampered boot must refuse again, not silently pass
    // because the mirror already "saw" this seq count once.
    const homeFile = path.join(home, 'audit-highwater.json');
    await expect(fs.stat(homeFile)).rejects.toThrow();
  });

  it('refuses to boot when the high-water mirror file is corrupted rather than treating it as first-boot', async () => {
    const { projectDir, home } = await scratchProject();

    // Establish a real mirror file first so there's a genuine baseline...
    const first = await runBootSequence({
      projectDir,
      env: { DOKIMA_HOME: home },
      now: clock,
    });
    first.log.close();

    // ...then corrupt it, simulating a crash mid-write (non-atomic write
    // would produce exactly this). A corrupted file must never be silently
    // read back as "nothing recorded yet" (seq 0) — that would disable
    // truncation detection for good (reviewer HIGH finding).
    const homeFile = path.join(home, 'audit-highwater.json');
    await fs.writeFile(homeFile, '{ not valid json');

    await expect(
      runBootSequence({ projectDir, env: { DOKIMA_HOME: home }, now: clock }),
    ).rejects.toThrow();
  });
});
