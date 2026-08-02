import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendEvent,
  createIdentity,
  listEvents,
  openEventLog,
  ProjectionRegistry,
  type EventLog,
} from '@dokima/events';
import {
  buildAgentHistory,
  rosterHistoryProjection,
  summarizeAgentHistory,
  type RosterHistoryState,
} from './roster-history.js';

const tmpDirs: string[] = [];
async function tmpLog(): Promise<EventLog> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-roster-history-'));
  tmpDirs.push(dir);
  return openEventLog(path.join(dir, 'state.db'));
}

afterEach(async () => {
  await Promise.all(
    tmpDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

function mapToObject<V>(map: ReadonlyMap<string, V>): Record<string, V> {
  return Object.fromEntries(map.entries());
}

describe('rosterHistoryProjection — classification', () => {
  it('buckets ticket.claimed/started as handoff, closed/accepted/released as outcome', async () => {
    const log = await tmpLog();
    createIdentity(log, {
      id: 'security-auditor',
      name: 'Security Auditor',
      kind: 'machine',
    });
    appendEvent(log, {
      eventType: 'ticket.claimed',
      actorId: 'security-auditor',
      ticketId: 'T-1',
      payload: {},
    });
    appendEvent(log, {
      eventType: 'ticket.started',
      actorId: 'security-auditor',
      ticketId: 'T-1',
      payload: {},
    });
    appendEvent(log, {
      eventType: 'ticket.closed',
      actorId: 'security-auditor',
      ticketId: 'T-1',
      payload: {},
    });
    appendEvent(log, {
      eventType: 'ticket.accepted',
      actorId: 'security-auditor',
      ticketId: 'T-1',
      payload: {},
    });

    const history = buildAgentHistory(listEvents(log), 'security-auditor');
    expect(history.handoffsRun).toBe(2);
    expect(history.outcomes).toBe(2);
    log.close();
  });

  it('buckets escalation.* and verdict/spend-shaped payloads honestly (empty today, forward-compatible)', async () => {
    const log = await tmpLog();
    createIdentity(log, { id: 'coding-agent', name: 'Coding Agent', kind: 'machine' });
    appendEvent(log, {
      eventType: 'escalation.rung_advanced',
      actorId: 'coding-agent',
      ticketId: 'T-2',
      payload: { fromRung: 'R1', toRung: 'R2' },
    });
    appendEvent(log, {
      eventType: 'fitness.ack',
      actorId: 'coding-agent',
      ticketId: 'T-2',
      payload: { verdict: 'marginal' },
    });
    appendEvent(log, {
      eventType: 'gateway.call_completed',
      actorId: 'coding-agent',
      ticketId: 'T-2',
      payload: { cost_usd: 0.05 },
    });

    const history = buildAgentHistory(listEvents(log), 'coding-agent');
    expect(history.escalations).toBe(1);
    expect(history.verdictScores).toBe(1);
    expect(history.spend).toBe(1);
    log.close();
  });

  it('an agent with no events resolves to zero counts (C-1 honesty, not an error)', async () => {
    const log = await tmpLog();
    const history = buildAgentHistory(listEvents(log), 'nobody-home');
    expect(history).toEqual({
      agentId: 'nobody-home',
      entries: [],
      handoffsRun: 0,
      outcomes: 0,
      verdictScores: 0,
      spend: 0,
      escalations: 0,
    });
    log.close();
  });
});

describe('rosterHistoryProjection — incremental apply matches rebuild-from-zero (projection-rebuild test)', () => {
  it('folding events one at a time through ProjectionRegistry.apply equals rebuildProjection over the full log', async () => {
    const log = await tmpLog();
    createIdentity(log, { id: 'test-engineer', name: 'Test Engineer', kind: 'machine' });
    createIdentity(log, { id: 'code-reviewer', name: 'Code Reviewer', kind: 'machine' });

    const registry = new ProjectionRegistry();
    registry.register(rosterHistoryProjection);

    const inputs = [
      {
        eventType: 'ticket.claimed',
        actorId: 'test-engineer',
        ticketId: 'T-9',
        payload: {},
      },
      {
        eventType: 'ticket.started',
        actorId: 'test-engineer',
        ticketId: 'T-9',
        payload: {},
      },
      {
        eventType: 'ticket.claimed',
        actorId: 'code-reviewer',
        ticketId: 'T-10',
        payload: {},
      },
      {
        eventType: 'ticket.closed',
        actorId: 'test-engineer',
        ticketId: 'T-9',
        payload: {},
      },
      {
        eventType: 'escalation.blocked',
        actorId: 'code-reviewer',
        ticketId: 'T-10',
        payload: { fromRung: 'R3', toRung: 'R4' },
      },
    ] as const;

    for (const input of inputs) {
      const record = appendEvent(log, input);
      registry.apply(record);
    }

    const incremental = registry.get<RosterHistoryState>('roster-history');

    // Rebuild from zero over the full persisted log — must land on the same state.
    registry.rebuild(listEvents(log));
    const rebuiltState = registry.get<RosterHistoryState>('roster-history');

    expect(mapToObject(incremental)).toEqual(mapToObject(rebuiltState));
    expect(summarizeAgentHistory('test-engineer', rebuiltState)).toEqual({
      agentId: 'test-engineer',
      entries: incremental.get('test-engineer'),
      handoffsRun: 2,
      outcomes: 1,
      verdictScores: 0,
      spend: 0,
      escalations: 0,
    });
    expect(summarizeAgentHistory('code-reviewer', rebuiltState).escalations).toBe(1);

    log.close();
  });
});
