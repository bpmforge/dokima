/**
 * Proves `preparePlaybookPromotion` produces a payload the REAL
 * `@shipwright/events` global-scope promotion accepts (DATABASE.md §7,
 * FR-F5) — dynamically imported by absolute `file://` URL, same technique
 * as `../store/migration.integration.test.ts`, since `packages/memory`
 * can't statically depend on `@shipwright/events`.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { insertPlaybookEntry } from './playbook.js';
import { MissingPromotionActorError, preparePlaybookPromotion } from './promote.js';
import { createTestHandle } from './test-helpers.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
);

interface GlobalDbLike {
  readonly db: unknown;
  close(): void;
}

interface GlobalDbModule {
  openGlobalDb(dbPath: string): GlobalDbLike;
}

interface GlobalPlaybookModule {
  promoteGlobalPlaybookEntry(
    global: GlobalDbLike,
    input: unknown,
    now?: () => string,
  ): unknown;
  listGlobalPlaybook(global: GlobalDbLike): Array<Record<string, unknown>>;
}

async function loadGlobalDb(): Promise<GlobalDbModule & GlobalPlaybookModule> {
  const [dbMod, playbookMod] = await Promise.all([
    import(
      pathToFileURL(
        path.join(repoRoot, 'packages', 'events', 'src', 'global-db', 'db.ts'),
      ).href
    ),
    import(
      pathToFileURL(
        path.join(
          repoRoot,
          'packages',
          'events',
          'src',
          'global-db',
          'global-playbook.ts',
        ),
      ).href
    ),
  ]);
  return {
    openGlobalDb: (dbMod as GlobalDbModule).openGlobalDb,
    promoteGlobalPlaybookEntry: (playbookMod as GlobalPlaybookModule)
      .promoteGlobalPlaybookEntry,
    listGlobalPlaybook: (playbookMod as GlobalPlaybookModule).listGlobalPlaybook,
  };
}

const NOW = () => '2026-07-20T12:00:00.000Z';

describe('preparePlaybookPromotion -> the real @shipwright/events global_playbook (FR-F5)', () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
  });

  it('an explicit, provenance-carrying promotion lands in the real global table', async () => {
    const handle = createTestHandle();
    const entry = insertPlaybookEntry(
      handle,
      {
        taskClass: 'flaky-timeout-fix',
        entry: 'retry with backoff',
        verifiedBy: 'challenger',
      },
      NOW,
    );

    const payload = preparePlaybookPromotion(handle, {
      entryId: entry.id,
      promotedFromProject: 'proj-a',
      promotedBy: 'human-brad',
    });

    const { openGlobalDb, promoteGlobalPlaybookEntry, listGlobalPlaybook } =
      await loadGlobalDb();
    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'shipwright-playbook-promote-test-'),
    );
    cleanup = () => fs.rm(dir, { recursive: true, force: true });
    const global = openGlobalDb(path.join(dir, 'global.db'));
    try {
      promoteGlobalPlaybookEntry(global, payload, NOW);
      const rows = listGlobalPlaybook(global);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        taskClass: 'flaky-timeout-fix',
        entry: 'retry with backoff',
        verifiedBy: 'challenger',
        promotedFromProject: 'proj-a',
        sourceEntryId: entry.id,
        promotedBy: 'human-brad',
      });
    } finally {
      global.close();
    }
  });

  it('refuses to prepare a promotion with no explicit actor — never automatic', () => {
    const handle = createTestHandle();
    const entry = insertPlaybookEntry(
      handle,
      { taskClass: 'x', entry: 'y', verifiedBy: 'tool' },
      NOW,
    );
    expect(() =>
      preparePlaybookPromotion(handle, {
        entryId: entry.id,
        promotedFromProject: 'p',
        promotedBy: '',
      }),
    ).toThrow(MissingPromotionActorError);
  });

  it('refuses to prepare a promotion for a nonexistent entry', () => {
    const handle = createTestHandle();
    expect(() =>
      preparePlaybookPromotion(handle, {
        entryId: 9999,
        promotedFromProject: 'p',
        promotedBy: 'human-brad',
      }),
    ).toThrow(/no playbook entry/);
  });

  it('ordinary insert never touches the global scope — promotion is only reachable explicitly', async () => {
    const handle = createTestHandle();
    insertPlaybookEntry(
      handle,
      { taskClass: 'never-promoted', entry: 'local only', verifiedBy: 'tool' },
      NOW,
    );

    const { openGlobalDb, listGlobalPlaybook } = await loadGlobalDb();
    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'shipwright-playbook-promote-test-'),
    );
    cleanup = () => fs.rm(dir, { recursive: true, force: true });
    const global = openGlobalDb(path.join(dir, 'global.db'));
    try {
      expect(listGlobalPlaybook(global)).toHaveLength(0);
    } finally {
      global.close();
    }
  });
});
