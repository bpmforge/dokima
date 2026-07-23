/**
 * Appends session-trace run events for the tour capture
 * (`capture-tour.mjs`) onto a DB already seeded by
 * `e2e/fixtures/seed-board-tickets.mjs`'s `basic` scenario — that fixture's
 * scenarios each call `createIdentity` and so can't be layered onto one DB.
 * Same real-primitives discipline: events go through `@shipwright/events`'
 * `appendEvent`, never raw SQL. Usage: seed-tour-trace.mjs <dbPath>
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const eventsUrl = pathToFileURL(
  path.join(repoRoot, 'packages', 'events', 'src', 'index.ts'),
).href;
const { openEventLog, appendEvent } = await import(eventsUrl);

const [, , dbPath] = process.argv;
if (!dbPath) {
  console.error('usage: seed-tour-trace.mjs <dbPath>');
  process.exit(1);
}

const log = openEventLog(dbPath);
try {
  appendEvent(log, {
    eventType: 'loop.pass',
    actorId: 'agent-1',
    ticketId: 'E2E-1',
    runId: 'run-tour-1',
    payload: { pass: 1 },
  });
  appendEvent(log, {
    eventType: 'gate.receipt_minted',
    actorId: 'agent-1',
    ticketId: 'E2E-1',
    runId: 'run-tour-1',
    payload: { validators: [{ name: 'lint', exitCode: 0, gapCount: 0 }] },
  });
  appendEvent(log, {
    eventType: 'escalation.rung_advanced',
    actorId: 'agent-1',
    ticketId: 'E2E-1',
    runId: 'run-tour-1',
    payload: { fromRung: 'R0', toRung: 'R1', reason: 'validator gap persisted' },
  });
} finally {
  log.close?.();
}
