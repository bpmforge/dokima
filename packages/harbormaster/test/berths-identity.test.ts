import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openEventLog, type EventLog } from '@shipwright/events';
import { berthIdentityId, ensureBerthIdentities } from '../src/berths-identity.js';

const NOW = () => '2026-07-18T00:00:00.000Z';

async function setup(): Promise<{ log: EventLog; dir: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-berths-identity-'));
  const log = openEventLog(path.join(dir, 'state.db'));
  return { log, dir };
}

describe('ensureBerthIdentities (DATABASE.md §2, D-010: one machine identity per berth)', () => {
  let log: EventLog | undefined;
  let dir: string | undefined;

  afterEach(async () => {
    log?.close();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
    log = undefined;
    dir = undefined;
  });

  it('mints one distinct machine identity per berth, in berth order', async () => {
    ({ log, dir } = await setup());
    const identities = ensureBerthIdentities(log, 'run-1', 3, { now: NOW });

    expect(identities).toHaveLength(3);
    expect(identities.map((i) => i.id)).toEqual([
      berthIdentityId('run-1', 1),
      berthIdentityId('run-1', 2),
      berthIdentityId('run-1', 3),
    ]);
    for (const identity of identities) {
      expect(identity.kind).toBe('machine');
      expect(identity.role).toBe('berth');
      expect(identity.createdAt).toBe(NOW());
    }
    // distinct ids
    expect(new Set(identities.map((i) => i.id)).size).toBe(3);
  });

  it('is idempotent: re-resolving the same run reuses the same rows, never duplicates', async () => {
    ({ log, dir } = await setup());
    const first = ensureBerthIdentities(log, 'run-1', 2, { now: NOW });
    const second = ensureBerthIdentities(log, 'run-1', 2, {
      now: () => '2099-01-01T00:00:00.000Z',
    });
    expect(second).toEqual(first);
  });

  it('growing berth count for the same run adds only the new identities', async () => {
    ({ log, dir } = await setup());
    const first = ensureBerthIdentities(log, 'run-1', 2, { now: NOW });
    const grown = ensureBerthIdentities(log, 'run-1', 4, { now: NOW });

    expect(grown.slice(0, 2)).toEqual(first);
    expect(grown).toHaveLength(4);
  });

  it('different runs never share a berth identity id', async () => {
    ({ log, dir } = await setup());
    const runA = ensureBerthIdentities(log, 'run-a', 2, { now: NOW });
    const runB = ensureBerthIdentities(log, 'run-b', 2, { now: NOW });
    const ids = new Set([...runA, ...runB].map((i) => i.id));
    expect(ids.size).toBe(4);
  });
});
