import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendEvent,
  createIdentity,
  listEvents,
  openEventLog,
  type EventLog,
} from '@dokima/events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  startRunHeartbeat,
  type HeartbeatWire,
  type RunHeartbeat,
} from './run-heartbeat.js';

/**
 * Review R1: the `loop.heartbeat` producer. Every case writes the event log
 * DIRECTLY — the way the land loop, a berth and a gateway session do — and
 * reads only what reaches the hub. No model is called anywhere here: the
 * producer reads ledger rows, and the rows are written by the test.
 */
describe('run heartbeat producer (review R1)', () => {
  const dirs: string[] = [];
  const logs: EventLog[] = [];
  const beats: RunHeartbeat[] = [];
  const T0 = Date.parse('2026-10-15T10:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  afterEach(async () => {
    vi.useRealTimers();
    for (const beat of beats.splice(0)) beat.stop();
    for (const log of logs.splice(0)) log.close();
    for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
  });

  async function scenario(runId = 'run-hb') {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-heartbeat-'));
    dirs.push(dir);
    const log = openEventLog(path.join(dir, 'state.db'));
    logs.push(log);
    createIdentity(log, { id: 'agent', name: 'agent', kind: 'machine' });
    const published: { sub: string; type: string; data: unknown }[] = [];
    const hub = {
      publish: (sub: string, type: string, data: unknown) =>
        published.push({ sub, type, data }),
    };
    const at = () => new Date(Date.now()).toISOString();
    const append = (
      eventType: string,
      ticketId: string,
      payload: Record<string, unknown> = {},
      run: string | null = runId,
    ) =>
      appendEvent(
        log,
        { eventType, actorId: 'agent', ticketId, runId: run, payload },
        { now: at },
      );
    const beat = startRunHeartbeat({ log, runId, hub });
    beats.push(beat);
    const heartbeats = () =>
      published
        .filter((p) => p.type === 'loop.heartbeat')
        .map((p) => p.data as HeartbeatWire);
    return { log, published, append, beat, heartbeats };
  }

  it('publishes the phase, berth, model and step the ledger states, on run:{id}', async () => {
    const s = await scenario();
    s.append('ticket.claimed', 'T-1');
    s.append('berths.ticket_admitted', 'T-1', { berthId: 'berth-2' });
    vi.advanceTimersByTime(1_000);
    expect(s.heartbeats().at(-1)).toMatchObject({
      ticket: 'T-1',
      run: 'run-hb',
      phase: 'claiming',
      berth: 'berth-2',
    });
    expect(s.published.every((p) => p.sub === 'run:run-hb')).toBe(true);

    s.append('session.turn_started', 'T-1', { model: 'fake-model' });
    vi.advanceTimersByTime(1_000);
    expect(s.heartbeats().at(-1)).toMatchObject({
      phase: 'waiting_on_model',
      model: 'fake-model',
    });

    s.append('session.producing', 'T-1', { model: 'fake-model', tool: 'write_file' });
    vi.advanceTimersByTime(1_000);
    const last = s.heartbeats().at(-1)!;
    expect(last).toMatchObject({
      phase: 'working',
      step: 'write_file',
      age_s: 1,
      elapsed_s: 3,
    });
    // Nothing the ledger did not say: no rung was ever stated.
    expect(last).not.toHaveProperty('rung');
    expect(last).not.toHaveProperty('pass');
  });

  it('sends a phase change on the next tick and repeats an unchanged ticket every 5s', async () => {
    const s = await scenario();
    s.append('ticket.claimed', 'T-1');
    vi.advanceTimersByTime(1_000);
    expect(s.heartbeats()).toHaveLength(1);
    vi.advanceTimersByTime(3_000);
    expect(s.heartbeats()).toHaveLength(1); // quiet ticket, interval not due
    vi.advanceTimersByTime(2_000);
    expect(s.heartbeats()).toHaveLength(2); // 5s since the last beat
    expect(s.heartbeats()[1]).toMatchObject({ phase: 'claiming', age_s: 6 });
    s.append('escalation.rung_advanced', 'T-1', { fromRung: 'R0', toRung: 'R1' }, null);
    vi.advanceTimersByTime(1_000);
    expect(s.heartbeats()).toHaveLength(3);
    expect(s.heartbeats()[2]).toMatchObject({ phase: 'escalating', rung: 'R1' });
  });

  it('ignores other runs and ends a ticket when its work ends', async () => {
    const s = await scenario();
    s.append('ticket.claimed', 'T-9', {}, 'run-other');
    s.append('ticket.claimed', 'T-1');
    vi.advanceTimersByTime(1_000);
    expect(s.heartbeats().map((h) => h.ticket)).toEqual(['T-1']);
    s.append('ticket.closed', 'T-1');
    vi.advanceTimersByTime(1_000);
    expect(s.published.at(-1)).toMatchObject({
      type: 'loop.heartbeat_ended',
      data: { ticket: 'T-1', reason: 'ticket.closed' },
    });
    const count = s.heartbeats().length;
    vi.advanceTimersByTime(20_000);
    expect(s.heartbeats()).toHaveLength(count);
  });

  it('stops on run end: one loop.run_ended, then silence', async () => {
    const s = await scenario();
    s.append('ticket.claimed', 'T-1');
    vi.advanceTimersByTime(1_000);
    s.beat.stop();
    s.beat.stop();
    expect(s.published.filter((p) => p.type === 'loop.run_ended')).toEqual([
      { sub: 'run:run-hb', type: 'loop.run_ended', data: { run: 'run-hb' } },
    ]);
    const count = s.published.length;
    s.append('session.producing', 'T-1');
    vi.advanceTimersByTime(30_000);
    expect(s.published).toHaveLength(count);
  });

  it('is telemetry: never writes the event log (Law 4/7)', async () => {
    const s = await scenario();
    s.append('ticket.claimed', 'T-1');
    const before = listEvents(s.log).length;
    vi.advanceTimersByTime(30_000);
    s.beat.stop();
    expect(listEvents(s.log)).toHaveLength(before);
    expect(s.heartbeats().length).toBeGreaterThan(1);
  });
});
