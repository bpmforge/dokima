import { afterEach, describe, expect, it } from 'vitest';
import {
  appendEvent,
  createIdentity,
  listChainRows,
  openEventLog,
  verifyChain,
} from './index.js';
import { createTempDbPath, type TempDb } from './test-helpers.js';

describe('@shipwright/events public API', () => {
  let temp: TempDb;

  afterEach(async () => {
    await temp?.cleanup();
  });

  it('opens a log, appends events through an identity, and verifies the chain', async () => {
    temp = await createTempDbPath();
    const log = openEventLog(temp.dbPath);
    createIdentity(log, { id: 'human-1', name: 'Operator', kind: 'human' });
    appendEvent(log, {
      eventType: 'ticket.created',
      actorId: 'human-1',
      payload: { id: 'W0-01' },
    });
    appendEvent(log, {
      eventType: 'ticket.claimed',
      actorId: 'human-1',
      payload: { id: 'W0-01' },
    });
    const result = verifyChain(listChainRows(log));
    expect(result.valid).toBe(true);
    log.close();
  });
});
