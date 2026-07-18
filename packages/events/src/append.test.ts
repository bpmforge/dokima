import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  collectSecretValues,
  createInMemoryCredentialStore,
  createProjectSecretsVault,
} from '@shipwright/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { appendEvent } from './append.js';
import { openEventLog } from './db.js';
import { createIdentity } from './identities.js';
import { createTempDbPath, type TempDb } from './test-helpers.js';

describe('appendEvent', () => {
  let temp: TempDb;

  afterEach(async () => {
    await temp?.cleanup();
  });

  it('stores the payload verbatim when no secretValues are supplied and nothing matches a known pattern', async () => {
    temp = await createTempDbPath();
    const log = openEventLog(temp.dbPath);
    createIdentity(log, { id: 'human-1', name: 'Operator', kind: 'human' });

    const record = appendEvent(log, {
      eventType: 'ticket.created',
      actorId: 'human-1',
      payload: { note: 'ordinary payload text' },
    });

    expect(record.payload).toEqual({ note: 'ordinary payload text' });
    const row = log.db
      .prepare<[number], { payload: string }>('SELECT payload FROM events WHERE seq = ?')
      .get(record.seq);
    expect(row?.payload).toContain('ordinary payload text');
    log.close();
  });

  it('redacts a planted vault-registered and .env-sourced secret before hashing/persisting (SC-06)', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-append-test-home-'));
    const projectDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'shipwright-append-test-project-'),
    );
    try {
      const vault = createProjectSecretsVault(
        createInMemoryCredentialStore(),
        projectDir,
        {
          SHIPWRIGHT_HOME: home,
        },
      );
      await vault.register('forge-token', 'vault-planted-value');
      await fs.writeFile(
        path.join(projectDir, '.env'),
        'DB_PASSWORD=env-planted-value\n',
      );
      const secretValues = await collectSecretValues(vault, projectDir);

      temp = await createTempDbPath();
      const log = openEventLog(temp.dbPath);
      createIdentity(log, { id: 'human-1', name: 'Operator', kind: 'human' });

      const record = appendEvent(
        log,
        {
          eventType: 'ticket.created',
          actorId: 'human-1',
          payload: {
            summary: 'used vault-planted-value and env-planted-value during setup',
          },
        },
        { secretValues },
      );

      // Zero plaintext in the returned record...
      expect(JSON.stringify(record.payload)).not.toContain('vault-planted-value');
      expect(JSON.stringify(record.payload)).not.toContain('env-planted-value');
      expect(JSON.stringify(record.payload)).toContain('[REDACTED:secret]');

      // ...and zero plaintext in the raw stored row (queried directly, not
      // through listEvents, so this proves what actually persisted).
      const row = log.db
        .prepare<[number], { payload: string }>(
          'SELECT payload FROM events WHERE seq = ?',
        )
        .get(record.seq);
      expect(row?.payload).not.toContain('vault-planted-value');
      expect(row?.payload).not.toContain('env-planted-value');
      expect(row?.payload).toContain('[REDACTED:secret]');

      // The hash was computed over the redacted payload, so the chain is
      // still internally consistent (the row's own hash matches its own
      // stored payload).
      expect(row?.payload).toBe(JSON.stringify(record.payload));

      log.close();
    } finally {
      await fs.rm(home, { recursive: true, force: true });
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });
});
