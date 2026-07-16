import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openGlobalDb, type GlobalDb } from './db.js';
import { promoteGlobalPlaybookEntry, listGlobalPlaybook } from './global-playbook.js';
import {
  getProject,
  listProjects,
  registerProject,
  setProjectArchived,
  touchProjectLastOpened,
} from './projects.js';
import { getProvider, listProviders, registerProvider } from './providers.js';

async function openTemp(): Promise<{ global: GlobalDb; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-registry-test-'));
  return {
    global: openGlobalDb(path.join(dir, 'global.db')),
    cleanup: () => fs.rm(dir, { recursive: true, force: true }),
  };
}

describe('projects (Fleet index)', () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
  });

  it('registers, lists, and reads back a project — never storing card stats', async () => {
    const t = await openTemp();
    cleanup = t.cleanup;
    const record = registerProject(
      t.global,
      { id: 'p1', path: '/repos/foo', name: 'foo' },
      () => '2026-07-16T00:00:00.000Z',
    );
    expect(record.archived).toBe(false);
    expect(getProject(t.global, 'p1')).toEqual(record);
    expect(listProjects(t.global)).toEqual([record]);
    t.global.close();
  });

  it('a duplicate path is rejected (UNIQUE constraint)', async () => {
    const t = await openTemp();
    cleanup = t.cleanup;
    registerProject(t.global, { id: 'p1', path: '/repos/foo', name: 'foo' });
    expect(() =>
      registerProject(t.global, { id: 'p2', path: '/repos/foo', name: 'foo-again' }),
    ).toThrow(/UNIQUE/i);
    t.global.close();
  });

  it('touchProjectLastOpened and setProjectArchived mutate in place', async () => {
    const t = await openTemp();
    cleanup = t.cleanup;
    registerProject(
      t.global,
      { id: 'p1', path: '/repos/foo', name: 'foo' },
      () => '2026-07-16T00:00:00.000Z',
    );
    touchProjectLastOpened(t.global, 'p1', () => '2026-07-17T00:00:00.000Z');
    setProjectArchived(t.global, 'p1', true);
    const record = getProject(t.global, 'p1');
    expect(record?.lastOpenedAt).toBe('2026-07-17T00:00:00.000Z');
    expect(record?.archived).toBe(true);
    t.global.close();
  });
});

describe('providers (non-secret registry)', () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
  });

  it('registers and reads back a provider with a credential ref, never a literal secret column', async () => {
    const t = await openTemp();
    cleanup = t.cleanup;
    const record = registerProvider(
      t.global,
      {
        id: 'copilot-1',
        kind: 'copilot',
        credentialRef: 'keychain:copilot-1',
        status: 'active',
      },
      () => '2026-07-16T00:00:00.000Z',
    );
    expect(record.credentialRef).toBe('keychain:copilot-1');
    expect(getProvider(t.global, 'copilot-1')).toEqual(record);
    expect(listProviders(t.global)).toEqual([record]);
    t.global.close();
  });
});

describe('global_playbook (promoted entries)', () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
  });

  it('promotes an entry with provenance and lists it', async () => {
    const t = await openTemp();
    cleanup = t.cleanup;
    const record = promoteGlobalPlaybookEntry(
      t.global,
      {
        taskClass: 'code-review',
        entry: 'always check null-safety on optional chains',
        version: 1,
        verifiedBy: 'challenger',
        promotedFromProject: '/repos/foo',
        sourceEntryId: 42,
        promotedBy: 'human-1',
      },
      () => '2026-07-16T00:00:00.000Z',
    );
    expect(record.id).toBeGreaterThan(0);
    expect(record.retiredAt).toBeNull();
    expect(listGlobalPlaybook(t.global)).toEqual([record]);
    t.global.close();
  });
});
