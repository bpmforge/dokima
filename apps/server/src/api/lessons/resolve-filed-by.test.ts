import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendEvent,
  createIdentity,
  openEventLog,
  type EventLog,
} from '@shipwright/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveFiledBy } from './resolve-filed-by.js';

describe('resolveFiledBy', () => {
  let dir: string;
  let log: EventLog;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-resolve-filed-by-'));
    log = openEventLog(path.join(dir, 'state.db'));
    createIdentity(log, { id: 'agent-w1-01', name: 'agent-w1-01', kind: 'machine' });
  });

  afterEach(async () => {
    log.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('resolves the actor of the exact trace event a sourceRef points at', () => {
    const event = appendEvent(log, {
      eventType: 'ticket.claimed',
      actorId: 'agent-w1-01',
      ticketId: 'W1-01',
      runId: 'run-9',
      payload: null,
    });
    expect(resolveFiledBy(log, 'trace', `trace:run-9:${event.seq}`)).toBe('agent-w1-01');
  });

  it('resolves a trace sourceRef with an "unknown" runId by seq alone', () => {
    const event = appendEvent(log, {
      eventType: 'ticket.claimed',
      actorId: 'agent-w1-01',
      payload: null,
    });
    expect(resolveFiledBy(log, 'trace', `trace:unknown:${event.seq}`)).toBe(
      'agent-w1-01',
    );
  });

  it('resolves the actor of the exact escalation event a sourceRef points at', () => {
    const event = appendEvent(log, {
      eventType: 'escalation.rung_advanced',
      actorId: 'agent-w1-01',
      ticketId: 'W1-01',
      payload: null,
    });
    expect(resolveFiledBy(log, 'escalation', `escalation:W1-01:${event.createdAt}`)).toBe(
      'agent-w1-01',
    );
  });

  it('returns undefined for a manual source', () => {
    expect(resolveFiledBy(log, 'manual', 'trace:run-9:1')).toBeUndefined();
  });

  it('returns undefined for a null sourceRef', () => {
    expect(resolveFiledBy(log, 'trace', null)).toBeUndefined();
  });

  it('returns undefined for a malformed trace sourceRef', () => {
    expect(resolveFiledBy(log, 'trace', 'trace:only-one-part')).toBeUndefined();
    expect(resolveFiledBy(log, 'trace', 'trace:run-9:not-a-number')).toBeUndefined();
  });

  it('returns undefined when the trace sourceRef does not match any logged event', () => {
    expect(resolveFiledBy(log, 'trace', 'trace:no-such-run:999')).toBeUndefined();
  });

  it('returns undefined when the escalation sourceRef does not match any logged event', () => {
    expect(
      resolveFiledBy(log, 'escalation', 'escalation:W1-01:2026-01-01T00:00:00.000Z'),
    ).toBeUndefined();
  });

  it('does not match a non-escalation-prefixed event at the same ticket/timestamp', () => {
    const event = appendEvent(log, {
      eventType: 'ticket.claimed',
      actorId: 'agent-w1-01',
      ticketId: 'W1-01',
      payload: null,
    });
    expect(
      resolveFiledBy(log, 'escalation', `escalation:W1-01:${event.createdAt}`),
    ).toBeUndefined();
  });
});
