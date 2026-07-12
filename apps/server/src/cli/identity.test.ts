import { afterEach, describe, expect, it } from 'vitest';
import { getIdentity, type EventLog } from '@shipwright/events';
import { ensureActorIdentity } from './identity.js';
import { openWritableLog, resolveDbPath } from './db.js';
import { createTempProject, type TempProject } from './test-helpers.js';

const NOW = () => '2026-07-11T00:00:00.000Z';

describe('ensureActorIdentity', () => {
  let project: TempProject;
  let log: EventLog;

  afterEach(async () => {
    log?.close();
    await project?.cleanup();
  });

  it('provisions a human identity for a fresh actor id', async () => {
    project = await createTempProject();
    log = openWritableLog(resolveDbPath(project.cwd));

    expect(getIdentity(log, 'maker-1')).toBeUndefined();
    ensureActorIdentity(log, 'maker-1', NOW);
    expect(getIdentity(log, 'maker-1')).toMatchObject({
      id: 'maker-1',
      kind: 'human',
      createdAt: NOW(),
    });
  });

  it('is idempotent for an actor id that already exists', async () => {
    project = await createTempProject();
    log = openWritableLog(resolveDbPath(project.cwd));

    ensureActorIdentity(log, 'maker-1', NOW);
    const first = getIdentity(log, 'maker-1');
    expect(() => ensureActorIdentity(log, 'maker-1', NOW)).not.toThrow();
    expect(getIdentity(log, 'maker-1')).toEqual(first);
  });
});
