import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openGlobalDb, type GlobalDb } from './db.js';
import { promoteGlobalPlaybookEntry, listGlobalPlaybook } from './global-playbook.js';
import { registerProject } from './projects.js';

async function openTemp(): Promise<{ global: GlobalDb; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-registry-test-'));
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

  // W19-03: the read/mutate half of this registry (getProject, listProjects,
  // touchProjectLastOpened, setProjectArchived) and the provider register/get
  // pair were deleted — no production caller ever existed; the live fleet
  // registry is apps/server's file-based one. registerProject stays as the
  // schema exerciser the single-writer fixture drives.
  it('registers a project — never storing card stats', async () => {
    const t = await openTemp();
    cleanup = t.cleanup;
    const record = registerProject(
      t.global,
      { id: 'p1', path: '/repos/foo', name: 'foo' },
      () => '2026-07-16T00:00:00.000Z',
    );
    expect(record.archived).toBe(false);
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
