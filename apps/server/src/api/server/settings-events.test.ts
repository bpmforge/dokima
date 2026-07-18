import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listEvents, openEventLog } from '@shipwright/events';
import {
  appendCopilotConsentAck,
  appendModelMatrixChanged,
  appendRuleStateChanged,
  DEFAULT_ACTOR_ID,
} from './settings-events.js';
import { stateDbPath } from './settings-db.js';

async function tmpProjectDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-settings-events-'));
}

describe('settings-events', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
    );
  });

  it('appendCopilotConsentAck lands a real copilot.consent_ack event in the hash-chained log (D-019/FR-G6)', async () => {
    const dir = await tmpProjectDir();
    dirs.push(dir);

    const event = appendCopilotConsentAck(dir, 'account may be banned');

    const log = openEventLog(stateDbPath(dir));
    try {
      const events = listEvents(log);
      expect(events).toHaveLength(1);
      expect(events[0]?.eventType).toBe('copilot.consent_ack');
      expect(events[0]?.actorId).toBe(DEFAULT_ACTOR_ID);
      expect(events[0]?.payload).toMatchObject({
        type: 'copilot.consent_ack',
        acknowledgedRisk: 'account may be banned',
        occurredAt: event.occurredAt,
      });
    } finally {
      log.close();
    }
  });

  it('appendRuleStateChanged lands a real rule.state_changed event in the hash-chained log (D-014/DATABASE.md §5b)', async () => {
    const dir = await tmpProjectDir();
    dirs.push(dir);

    const event = appendRuleStateChanged(dir, 'R-01', 'proposed', 'shadow');

    const log = openEventLog(stateDbPath(dir));
    try {
      const events = listEvents(log);
      expect(events).toHaveLength(1);
      expect(events[0]?.eventType).toBe('rule.state_changed');
      expect(events[0]?.actorId).toBe(DEFAULT_ACTOR_ID);
      expect(events[0]?.payload).toMatchObject({
        type: 'rule.state_changed',
        ruleId: 'R-01',
        fromState: 'proposed',
        toState: 'shadow',
        occurredAt: event.occurredAt,
      });
    } finally {
      log.close();
    }
  });

  it('appendModelMatrixChanged lands a real settings.changed event in the hash-chained log (DATABASE.md §6/§8, FR-S3)', async () => {
    const dir = await tmpProjectDir();
    dirs.push(dir);
    const before = [
      {
        role: 'coding-agent',
        taskType: 'code' as const,
        model: 'local/a',
        fallback: [],
        updatedAt: '2026-07-15T00:00:00.000Z',
      },
    ];
    const after = [
      {
        role: 'coding-agent',
        taskType: 'code' as const,
        model: 'local/b',
        fallback: ['local/a'],
        updatedAt: '2026-07-16T00:00:00.000Z',
      },
    ];

    const event = appendModelMatrixChanged(dir, before, after);

    const log = openEventLog(stateDbPath(dir));
    try {
      const events = listEvents(log);
      expect(events).toHaveLength(1);
      expect(events[0]?.eventType).toBe('settings.changed');
      expect(events[0]?.actorId).toBe(DEFAULT_ACTOR_ID);
      expect(events[0]?.payload).toMatchObject({
        type: 'settings.changed',
        scope: 'project',
        key: 'model_matrix',
        previousValue: [
          { role: 'coding-agent', task_type: 'code', model: 'local/a', fallback: [] },
        ],
        nextValue: [
          {
            role: 'coding-agent',
            task_type: 'code',
            model: 'local/b',
            fallback: ['local/a'],
          },
        ],
        occurredAt: event.occurredAt,
      });
    } finally {
      log.close();
    }
  });
});
