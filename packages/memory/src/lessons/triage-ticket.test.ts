/**
 * Proves `prepareValidatorFixTicket`'s payload is accepted by the REAL
 * `@dokima/tickets` `createTicket` (`packages/tickets/src/create.ts`,
 * `CreateTicketInput`) — dynamically imported by absolute `file://` URL,
 * same technique as `../playbook/promote.test.ts`, since `packages/memory`
 * can't statically depend on `@dokima/tickets` (ARCHITECTURE §4, this
 * ticket's write_scope has no `package.json` to declare it under).
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fileFieldReport } from './report.js';
import { createTestHandle } from './test-helpers.js';
import { prepareValidatorFixTicket } from './triage.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
);

interface TempDb {
  dbPath: string;
  cleanup: () => Promise<void>;
}

interface EventLogLike {
  close(): void;
}

interface TicketsModules {
  openEventLog(dbPath: string): EventLogLike;
  createTempDbPath(): Promise<TempDb>;
  createIdentity(log: EventLogLike, input: Record<string, unknown>): unknown;
  createTicket(
    log: EventLogLike,
    actorId: string,
    input: unknown,
    opts?: { now?: () => string },
  ): { id: string; type: string; title: string; lane: string; writeScope: string[] };
  getTicket(log: EventLogLike, id: string): unknown;
}

async function loadTicketsPackage(): Promise<TicketsModules> {
  const [dbMod, identitiesMod, testHelpersMod, createMod, queryMod] = await Promise.all([
    import(pathToFileURL(path.join(repoRoot, 'packages', 'events', 'src', 'db.ts')).href),
    import(
      pathToFileURL(path.join(repoRoot, 'packages', 'events', 'src', 'identities.ts'))
        .href
    ),
    import(
      pathToFileURL(path.join(repoRoot, 'packages', 'events', 'src', 'test-helpers.ts'))
        .href
    ),
    import(
      pathToFileURL(path.join(repoRoot, 'packages', 'tickets', 'src', 'create.ts')).href
    ),
    import(
      pathToFileURL(path.join(repoRoot, 'packages', 'tickets', 'src', 'query.ts')).href
    ),
  ]);
  return {
    openEventLog: (dbMod as TicketsModules).openEventLog,
    createTempDbPath: (testHelpersMod as TicketsModules).createTempDbPath,
    createIdentity: (identitiesMod as TicketsModules).createIdentity,
    createTicket: (createMod as TicketsModules).createTicket,
    getTicket: (queryMod as TicketsModules).getTicket,
  };
}

const NOW = () => '2026-07-20T12:00:00.000Z';

describe('prepareValidatorFixTicket -> the real @dokima/tickets createTicket', () => {
  it('a prepared payload creates a real bug ticket with the field report evidence in acceptance', async () => {
    const handle = createTestHandle();
    const report = fileFieldReport(
      handle,
      {
        ticketId: 'W1-01',
        source: 'trace',
        whatHappened: 'validate-plan.mjs did not catch a leading-wildcard glob overlap.',
        expected: 'validate-plan.mjs should flag the overlap.',
        filedBy: 'human-brad',
      },
      NOW,
    );

    const { payload } = prepareValidatorFixTicket(
      handle,
      {
        reportId: report.id,
        triagedBy: 'challenger-1',
        ticketId: 'W9-42',
        title: 'validate-plan.mjs misses leading-wildcard glob overlaps',
        lane: 'core',
        writeScope: ['scripts/validate-plan.mjs'],
      },
      NOW,
    );

    const { openEventLog, createTempDbPath, createIdentity, createTicket, getTicket } =
      await loadTicketsPackage();
    const temp = await createTempDbPath();
    const log = openEventLog(temp.dbPath);
    try {
      createIdentity(log, {
        id: 'challenger-1',
        name: 'Challenger One',
        kind: 'machine',
      });
      const created = createTicket(log, 'challenger-1', payload, { now: NOW });

      expect(created.id).toBe('W9-42');
      expect(created.type).toBe('bug');
      expect(created.lane).toBe('core');
      expect(created.writeScope).toEqual(['scripts/validate-plan.mjs']);
      expect(getTicket(log, 'W9-42')).toMatchObject({ id: 'W9-42' });
    } finally {
      log.close();
      await temp.cleanup();
    }
  });
});
