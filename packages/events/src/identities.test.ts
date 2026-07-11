import { afterEach, describe, expect, it } from 'vitest';
import { openEventLog } from './db.js';
import { createIdentity, getIdentity } from './identities.js';
import { createTempDbPath, type TempDb } from './test-helpers.js';

describe('identities', () => {
  let temp: TempDb;

  afterEach(async () => {
    await temp?.cleanup();
  });

  it('round-trips a machine identity with auth_provider (D-005)', async () => {
    temp = await createTempDbPath();
    const log = openEventLog(temp.dbPath);
    const created = createIdentity(
      log,
      {
        id: 'shipwright-maker',
        name: 'Shipwright Maker',
        kind: 'machine',
        authProvider: 'local',
        role: 'maker',
        modelHint: 'sonnet',
      },
      { now: () => '2026-07-11T00:00:00.000Z' },
    );
    expect(created).toEqual({
      id: 'shipwright-maker',
      name: 'Shipwright Maker',
      kind: 'machine',
      authProvider: 'local',
      role: 'maker',
      modelHint: 'sonnet',
      createdAt: '2026-07-11T00:00:00.000Z',
    });
    expect(getIdentity(log, 'shipwright-maker')).toEqual(created);
    log.close();
  });

  it('defaults optional fields to null and returns undefined for unknown ids', async () => {
    temp = await createTempDbPath();
    const log = openEventLog(temp.dbPath);
    createIdentity(log, { id: 'human-1', name: 'Operator', kind: 'human' });
    expect(getIdentity(log, 'human-1')).toMatchObject({
      authProvider: null,
      role: null,
      modelHint: null,
    });
    expect(getIdentity(log, 'nobody')).toBeUndefined();
    log.close();
  });
});
