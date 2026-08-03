/**
 * Appends session-trace run events for the tour capture
 * (`capture-tour/`) onto a DB already seeded by
 * `e2e/fixtures/seed-board-tickets.mjs`'s `basic` scenario — that fixture's
 * scenarios each call `createIdentity` and so can't be layered onto one DB.
 * Same real-primitives discipline: events go through `@dokima/events`'
 * `appendEvent`, never raw SQL. Usage: seed-tour-trace.mjs <dbPath>
 *
 * Payloads below are shaped to match their real production appenders
 * exactly (W10-41 — a prior version invented a `payload.validators` on the
 * gate event and a `payload.reason` on the escalation event, neither of
 * which any real appender writes):
 *
 * - `gate.receipt_minted` is anchored only by `mintReceipt`
 *   (packages/events/src/receipts.ts) with `payload: { receiptId, kind,
 *   contentMac }`. `mintReceipt` itself is not called here — it never
 *   threads a `runId` onto its anchoring event, and every event in this
 *   trace must share `runId: 'run-tour-1'` for the trace view's per-run
 *   filter (`GET /runs/:id/trace`) to group them together. `contentMac` is
 *   omitted rather than faked with an invented signing key over a receipt
 *   that was never actually minted (no row in `receipts`) — TESTING.md's
 *   rule is "less than production, never more", and nothing reads
 *   `contentMac` or looks up the receipt by id from the trace view.
 * - `escalation.rung_advanced` mirrors `EscalationEvent`
 *   (packages/gateway/src/escalation/events.ts): of its fields, `type`,
 *   `ticketId`, `actorId`, `occurredAt` are envelope fields `appendEvent`
 *   already carries outside `payload`; `fromRung`/`toRung`/`receipts` are
 *   the real remaining payload. `receipts` — the failure evidence that
 *   actually triggers an escalation (ladder.ts's `emit`) — replaces the
 *   invented `reason` string.
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
    payload: { receiptId: 'receipt-tour-1', kind: 'gate' },
  });
  appendEvent(log, {
    eventType: 'escalation.rung_advanced',
    actorId: 'agent-1',
    ticketId: 'E2E-1',
    runId: 'run-tour-1',
    payload: {
      fromRung: 'R0',
      toRung: 'R1',
      receipts: [{ name: 'lint', exitCode: 1, gapCount: 1 }],
    },
  });
} finally {
  log.close?.();
}
