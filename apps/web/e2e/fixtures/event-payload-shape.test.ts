/**
 * RED FIXTURE (W10-41): every event a fixture seeds must carry a payload
 * that is a subset of what its real production appender/type actually
 * writes — never an invented key, and never a differently-shaped one
 * (docs/TESTING.md §7's fixture-honesty rule). The "allowed keys" per
 * event type below are derived by calling the real appender (`mintReceipt`)
 * or driving the real escalation emitter (`runEscalationLadder`) at test
 * time — never a hand-maintained list — so this test starts asserting
 * against the current real shape automatically the moment either changes,
 * instead of silently rotting.
 *
 * Same absolute-path dynamic import as `seed-board-tickets.mjs`/
 * `seed-tour-trace.mjs`: apps/web has no dependency path to `@dokima/events`
 * or `@dokima/gateway` (pnpm strict mode), so their `src/` is imported
 * directly by `file://` URL and run through `tsx`.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const TSX_BIN = path.join(repoRoot, 'apps', 'server', 'node_modules', '.bin', 'tsx');
const SEED_BOARD_SCRIPT = path.join(here, 'seed-board-tickets.mjs');
const SEED_TOUR_SCRIPT = path.join(
  repoRoot,
  'apps',
  'web',
  'scripts',
  'seed-tour-trace.mjs',
);

async function loadPkgSrc(pkg: string, subpath = 'index') {
  const url = pathToFileURL(
    path.join(repoRoot, 'packages', pkg, 'src', `${subpath}.ts`),
  ).href;
  return import(url);
}

const { openEventLog, createIdentity, listEvents, mintReceipt } =
  await loadPkgSrc('events');
const { runEscalationLadder, createInMemoryEscalationEventSink } = await loadPkgSrc(
  'gateway',
  'escalation/index',
);

const tempDirs: string[] = [];
async function tempDbPath(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  tempDirs.push(dir);
  return path.join(dir, 'state.db');
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

/** The real payload keys `mintReceipt` (packages/events/src/receipts.ts) anchors a `gate.*` event with. */
async function realReceiptPayloadKeys(): Promise<Set<string>> {
  const dbPath = await tempDbPath('dokima-shape-receipt');
  const log = openEventLog(dbPath);
  try {
    createIdentity(log, { id: 'probe-actor', name: 'Probe', kind: 'machine' });
    mintReceipt(
      log,
      {
        id: 'shape-probe-receipt',
        kind: 'gate',
        projectId: 'shape-probe',
        ticketId: 'shape-probe-ticket',
        validators: [{ name: 'lint', exitCode: 0, gapCount: 0 }],
        inputFiles: [],
        actorId: 'probe-actor',
      },
      { signingKey: 'shape-probe-signing-key-not-a-secret' },
    );
    const event = listEvents(log).find(
      (e: { eventType: string }) => e.eventType === 'gate.receipt_minted',
    );
    if (!event) throw new Error('mintReceipt did not anchor a gate.receipt_minted event');
    return new Set(Object.keys(event.payload as object));
  } finally {
    log.close();
  }
}

/**
 * `EscalationEvent`'s fields once you subtract the envelope fields
 * `appendEvent` already carries outside `payload` (`type`→eventType maps to
 * the row's own event_type column, `ticketId`/`actorId` are columns,
 * `occurredAt`→createdAt). This subtraction list only ever *widens* what a
 * fixture is allowed to seed (removing a real field from consideration
 * never manufactures a false pass for an invented payload key), so
 * hand-maintaining it can't mask a fabrication the way a hand-maintained
 * *allow-list* would.
 */
const ESCALATION_ENVELOPE_FIELDS = new Set(['type', 'ticketId', 'actorId', 'occurredAt']);

/** The real payload keys an `escalation.*` event carries, driven from the real ladder (packages/gateway/src/escalation/ladder.ts's `emit`). */
async function realEscalationPayloadKeys(): Promise<Set<string>> {
  const sink = createInMemoryEscalationEventSink();
  const matrix = {
    global: {
      'coding-agent': { default: { model: 'shape-probe-model', fallbackChain: [] } },
      challenger: { default: { model: 'shape-probe-frontier-model', fallbackChain: [] } },
    },
  };
  await runEscalationLadder({
    ticketId: 'shape-probe-ticket',
    criterion: 'shape probe',
    actorId: 'probe-actor',
    matrix,
    // Always fails, so the ladder is forced to emit a real rung-advance event.
    runAttempt: () => ({
      passed: false,
      receipts: [{ name: 'lint', exitCode: 1, gapCount: 1 }],
    }),
    sink,
  });
  const [event] = sink.events;
  if (!event) throw new Error('runEscalationLadder emitted no escalation event to probe');
  const keys = new Set(Object.keys(event));
  for (const field of ESCALATION_ENVELOPE_FIELDS) keys.delete(field);
  return keys;
}

/** Event types with no real production appender at all (apps/web/src/trace/classify.ts's own header) — excluded rather than silently passed or falsely failed. */
const NO_REAL_APPENDER = new Set(['loop.pass', 'gateway.call_completed']);

function allowedPayloadKeys(
  eventType: string,
  receiptKeys: Set<string>,
  escalationKeys: Set<string>,
): Set<string> | null {
  if (NO_REAL_APPENDER.has(eventType)) return null;
  if (eventType === 'gate.receipt_minted' || eventType === 'gate.waived')
    return receiptKeys;
  if (eventType.startsWith('escalation.')) return escalationKeys;
  return null;
}

function assertNoFabricatedKeys(
  eventType: string,
  payload: unknown,
  allowed: Set<string>,
): void {
  const actual = payload && typeof payload === 'object' ? Object.keys(payload) : [];
  const fabricated = actual.filter((key) => !allowed.has(key));
  expect(
    fabricated,
    `${eventType} payload has key(s) its real appender never writes: ${fabricated.join(', ')} ` +
      `(allowed: ${[...allowed].join(', ')})`,
  ).toEqual([]);
}

async function assertSeededEventsAreHonest(dbPath: string): Promise<void> {
  const receiptKeys = await realReceiptPayloadKeys();
  const escalationKeys = await realEscalationPayloadKeys();
  const log = openEventLog(dbPath);
  try {
    for (const event of listEvents(log) as Array<{
      eventType: string;
      payload: unknown;
    }>) {
      const allowed = allowedPayloadKeys(event.eventType, receiptKeys, escalationKeys);
      if (allowed) assertNoFabricatedKeys(event.eventType, event.payload, allowed);
    }
  } finally {
    log.close();
  }
}

describe('fixture event payloads match their real production appender shape (W10-41)', () => {
  it('stays red: a synthetic payload with a planted extra key is rejected', async () => {
    const receiptKeys = await realReceiptPayloadKeys();
    expect(() =>
      assertNoFabricatedKeys(
        'gate.receipt_minted',
        {
          receiptId: 'x',
          kind: 'gate',
          validators: [{ name: 'lint', exitCode: 0, gapCount: 0 }],
        },
        receiptKeys,
      ),
    ).toThrow(/validators/);

    const escalationKeys = await realEscalationPayloadKeys();
    expect(() =>
      assertNoFabricatedKeys(
        'escalation.rung_advanced',
        { fromRung: 'R0', toRung: 'R1', reason: 'invented' },
        escalationKeys,
      ),
    ).toThrow(/reason/);
  });

  it('seed-tour-trace.mjs seeds only real event-payload shapes', async () => {
    const dbPath = await tempDbPath('dokima-shape-tour');
    execFileSync(TSX_BIN, [SEED_BOARD_SCRIPT, dbPath, 'basic'], { stdio: 'inherit' });
    execFileSync(TSX_BIN, [SEED_TOUR_SCRIPT, dbPath], { stdio: 'inherit' });
    await assertSeededEventsAreHonest(dbPath);
  });

  it("seed-board-tickets.mjs's trace scenario seeds only real event-payload shapes", async () => {
    const dbPath = await tempDbPath('dokima-shape-board-trace');
    execFileSync(TSX_BIN, [SEED_BOARD_SCRIPT, dbPath, 'trace'], { stdio: 'inherit' });
    await assertSeededEventsAreHonest(dbPath);
  });
});
