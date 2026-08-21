import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, listEvents, openEventLog, type EventLog } from '@dokima/events';
import { insertFact, markFactVerified } from '@dokima/memory';
import {
  parseConsolidationEnabled,
  runPostRunConsolidation,
} from './consolidation.js';

const dirs: string[] = [];
let openLog: EventLog | undefined;
afterEach(async () => {
  openLog?.close();
  openLog = undefined;
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function makeLog(): Promise<EventLog> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-consolidation-'));
  dirs.push(dir);
  const log = openEventLog(path.join(dir, 'state.db'));
  openLog = log;
  createIdentity(log, { id: 'operator', name: 'Operator', kind: 'human' });
  const now = () => '2026-08-20T00:00:00.000Z';
  const fact = insertFact(
    log.db,
    {
      kind: 'error_solution',
      content: 'PARKED (no_progress): verify failed twice on the same symptom',
      confidence: 1,
      ticketId: 'T-1',
    },
    now,
  );
  markFactVerified(log.db, fact.id);
  return log;
}

describe('post-run sleep consolidation (W14-06)', () => {
  it('RED FIXTURE: a finished run consolidates — exactly one memory.consolidated event, and the morning pre-brief lands as a Review card carrying the lead facts', async () => {
    const log = await makeLog();
    const report = runPostRunConsolidation({
      log,
      actorId: 'operator',
      runId: 'run-1',
      enabled: true,
      now: () => '2026-08-21T06:00:00.000Z',
    });

    expect(report.skipped).toBe(false);
    const events = listEvents(log).filter((e) => e.eventType === 'memory.consolidated');
    expect(events).toHaveLength(1);

    // W15-04: the pre-brief COALESCES into the review digest (UX_SPEC §7)
    // instead of a freeform body that rendered as '0 items batched'.
    const row = log.db
      .prepare<[string], { tier: string; kind: string; body: string }>(
        'SELECT tier, kind, body FROM notifications WHERE id = ?',
      )
      .get('pre-brief-run-1');
    expect(row?.tier).toBe('review');
    expect(row?.kind).toBe('digest');
    const body = JSON.parse(row!.body) as {
      items: { title: string; summary: string }[];
    };
    expect(body.items[0]!.title).toContain('Morning pre-brief');
    expect(body.items[0]!.summary).toContain('the lead lesson: PARKED (no_progress)');
    expect(body.items[0]!.summary).toMatch(/duplicate fact/);
  });

  it('RED FIXTURE: the same flow with the setting off produces neither — no event, no card, no writes', async () => {
    const log = await makeLog();
    const report = runPostRunConsolidation({
      log,
      actorId: 'operator',
      runId: 'run-1',
      enabled: false,
    });

    expect(report.skipped).toBe(true);
    expect(listEvents(log).some((e) => e.eventType === 'memory.consolidated')).toBe(false);
    expect(
      log.db.prepare('SELECT COUNT(*) AS n FROM notifications').get() as { n: number },
    ).toEqual({ n: 0 });
  });

  it('a malformed toggle falls back to ON with a stderr note — a cleanup setting must not fail a finished run', () => {
    const lines: string[] = [];
    expect(parseConsolidationEnabled('yes please', (l) => lines.push(l))).toBe(true);
    expect(lines[0]).toContain('memoryConsolidationEnabled');
    expect(parseConsolidationEnabled(false, () => {})).toBe(false);
    expect(parseConsolidationEnabled(undefined, () => {})).toBe(true);
  });
});
