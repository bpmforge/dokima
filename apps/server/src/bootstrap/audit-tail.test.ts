import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendEvent,
  computeEventHash,
  createIdentity,
  GENESIS_HASH,
  openEventLog,
  type EventLog,
} from '@shipwright/events';
import { afterEach, describe, expect, it } from 'vitest';
import { auditTailCheck, checkAndUpdateHighWater, currentMaxSeq } from './audit-tail.js';

describe('audit-tail', () => {
  const scratchDirs: string[] = [];
  let seq = 0;
  const clock = () => new Date(2026, 0, 1, 0, 0, ++seq).toISOString();

  afterEach(async () => {
    for (const dir of scratchDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  async function scratchDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-audit-tail-'));
    scratchDirs.push(dir);
    return dir;
  }

  function openSeededLog(dbPath: string, count: number): EventLog {
    const log = openEventLog(dbPath);
    createIdentity(
      log,
      { id: 'actor-1', name: 'actor-1', kind: 'human' },
      { now: clock },
    );
    for (let i = 0; i < count; i++) {
      appendEvent(
        log,
        { eventType: 'ticket.claimed', actorId: 'actor-1', payload: { i } },
        { now: clock },
      );
    }
    return log;
  }

  describe('auditTailCheck', () => {
    it('is valid (vacuously) with no events', () => {
      const log = openEventLog(':memory:');
      const result = auditTailCheck(log);
      expect(result.valid).toBe(true);
      expect(result.checkedFrom).toBeNull();
      log.close();
    });

    it('verifies the tail when the log is shorter than the tail window', () => {
      const log = openSeededLog(':memory:', 5);
      const result = auditTailCheck(log, 50);
      expect(result.valid).toBe(true);
      expect(result.checkedFrom).toBe(1);
      log.close();
    });

    it('verifies only the last N events, anchored to the row before the window', () => {
      const log = openSeededLog(':memory:', 200);
      const result = auditTailCheck(log, 10);
      expect(result.valid).toBe(true);
      expect(result.checkedTo).toBeGreaterThan(result.checkedFrom ?? 0);
      expect((result.checkedTo ?? 0) - (result.checkedFrom ?? 0)).toBe(9);
      log.close();
    });

    it('detects a tampered row inside the tail window', () => {
      // events are INSERT-only (no UPDATE/DELETE, DATABASE.md §2) — a
      // tamper attempt through this app would already be rejected by the
      // DB trigger. To exercise the *hash-check* path itself, this builds
      // the chain via raw INSERTs with row 15's payload deliberately not
      // matching its stored hash, simulating a file-level edit that
      // bypassed the app entirely (the real threat SC-11 defends against).
      const log = openEventLog(':memory:');
      createIdentity(
        log,
        { id: 'actor-1', name: 'actor-1', kind: 'human' },
        { now: clock },
      );
      let prevHash = GENESIS_HASH;
      for (let seqNum = 1; seqNum <= 20; seqNum++) {
        const payloadJson = JSON.stringify({ i: seqNum });
        const hash =
          seqNum === 15
            ? 'f'.repeat(64)
            : computeEventHash({
                prevHash,
                seq: seqNum,
                eventType: 'ticket.claimed',
                actorId: 'actor-1',
                payloadJson,
              });
        log.db
          .prepare(
            `INSERT INTO events (seq, event_type, actor_id, ticket_id, run_id, payload, created_at, prev_hash, hash)
             VALUES (?, 'ticket.claimed', 'actor-1', NULL, NULL, ?, ?, ?, ?)`,
          )
          .run(seqNum, payloadJson, clock(), prevHash, hash);
        prevHash = hash;
      }

      const result = auditTailCheck(log, 10);
      expect(result.valid).toBe(false);
      expect(result.brokenAtSeq).toBe(15);
      log.close();
    });
  });

  describe('checkAndUpdateHighWater', () => {
    it('records the current max seq on first boot (nothing recorded yet)', async () => {
      const home = await scratchDir();
      const log = openSeededLog(':memory:', 5);
      const result = await checkAndUpdateHighWater(log, home, '/proj/a', clock);
      expect(result.truncated).toBe(false);
      expect(result.recordedSeq).toBe(0);
      expect(result.currentSeq).toBe(currentMaxSeq(log));
      log.close();
    });

    it('advances the high-water mark across boots when the log only grows', async () => {
      const home = await scratchDir();
      const log = openSeededLog(':memory:', 5);
      await checkAndUpdateHighWater(log, home, '/proj/a', clock);
      appendEvent(
        log,
        { eventType: 'ticket.claimed', actorId: 'actor-1', payload: {} },
        { now: clock },
      );
      const second = await checkAndUpdateHighWater(log, home, '/proj/a', clock);
      expect(second.truncated).toBe(false);
      expect(second.recordedSeq).toBe(5);
      expect(second.currentSeq).toBe(6);
      log.close();
    });

    it('detects truncation when a stale copy of state.db replaces the real file', async () => {
      // events are INSERT-only — a truncation can't happen through this
      // app's own connection (DELETE is trigger-blocked). The real threat
      // SC-11 defends against is a file-level replacement: someone restores
      // an older backup, or a crash/rollback loses committed rows. Simulate
      // that by swapping in a fresh db (same path) with fewer events.
      const dir = await scratchDir();
      const home = await scratchDir();
      const dbPath = path.join(dir, 'state.db');

      const full = openSeededLog(dbPath, 10);
      await checkAndUpdateHighWater(full, home, dbPath, clock);
      full.close();

      await fs.rm(dbPath);
      const stale = openSeededLog(dbPath, 6);

      const result = await checkAndUpdateHighWater(stale, home, dbPath, clock);
      expect(result.truncated).toBe(true);
      expect(result.recordedSeq).toBe(10);
      expect(result.currentSeq).toBe(6);
      stale.close();
    });

    it('keeps separate high-water marks per project key', async () => {
      const home = await scratchDir();
      const logA = openSeededLog(':memory:', 3);
      const logB = openSeededLog(':memory:', 8);
      await checkAndUpdateHighWater(logA, home, '/proj/a', clock);
      const b = await checkAndUpdateHighWater(logB, home, '/proj/b', clock);
      expect(b.truncated).toBe(false);
      expect(b.recordedSeq).toBe(0);
      logA.close();
      logB.close();
    });
  });
});
