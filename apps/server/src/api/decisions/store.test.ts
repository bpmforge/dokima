import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createIdentity,
  listEvents,
  openEventLog,
  type EventLog,
} from '@dokima/events';

/**
 * SEC TRIAGE (sec/ledger-atomicity): lets one test force `appendEvent` to
 * throw *after* `decideSlate` has already run `writeLedgerSync` — isolating
 * "does an event-log append failure leave an orphaned ledger row behind"
 * from "does an FK-invalid actor get rejected earlier at the UPDATE step"
 * (it does; see store.ts's decided_by FK, which fires before the ledger
 * write and so can't reach this window). Defaults to passing through to
 * the real implementation; only the one test below flips the flag.
 */
let forceAppendEventFailure = false;
vi.mock('@dokima/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dokima/events')>();
  return {
    ...actual,
    appendEvent: (...args: Parameters<typeof actual.appendEvent>) => {
      if (forceAppendEventFailure) {
        throw new Error('simulated event-log append failure (post-ledger-write)');
      }
      return actual.appendEvent(...args);
    },
  };
});

import { createSlate, decideSlate, listDecisions, listSlates } from './store.js';
import {
  InvalidChoiceError,
  SlateAlreadyDecidedError,
  SlateNotFoundError,
} from './types.js';

const NOW = () => '2026-07-19T12:00:00.000Z';
const ACTOR = 'operator';

async function tmpProject(): Promise<{
  projectPath: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-decisions-'));
  return {
    projectPath: dir,
    cleanup: () => fs.rm(dir, { recursive: true, force: true }),
  };
}

function seedOperator(log: EventLog): void {
  createIdentity(log, { id: ACTOR, name: 'Operator', kind: 'human' }, { now: NOW });
}

const FOUNDER_INPUT = {
  title: 'Deployment shape',
  options: [
    { id: 'self-hosted', label: 'Self-hosted', tradeoffs: 'more control, more ops' },
    { id: 'managed', label: 'Managed', tradeoffs: 'less ops, vendor lock-in' },
  ],
  recommendedId: 'self-hosted',
  recommendedReasoning: 'matches C1 local-first',
} as const;

function founderLedger(projectPath: string): Promise<string> {
  return fs.readFile(path.join(projectPath, 'docs', 'DECISIONS.md'), 'utf8');
}

describe('decision slate store', () => {
  const dirs: Array<() => Promise<void>> = [];
  const logs: EventLog[] = [];

  afterEach(async () => {
    forceAppendEventFailure = false;
    await Promise.all(logs.splice(0).map((log) => log.close()));
    await Promise.all(dirs.splice(0).map((cleanup) => cleanup()));
  });

  async function boot(): Promise<{ log: EventLog; projectPath: string }> {
    const { projectPath, cleanup } = await tmpProject();
    dirs.push(cleanup);
    const log = openEventLog(path.join(projectPath, 'state.db'));
    logs.push(log);
    seedOperator(log);
    return { log, projectPath };
  }

  it('creates a founder slate as open, validated through @dokima/pipeline', async () => {
    const { log } = await boot();
    const created = createSlate(
      log,
      { kind: 'founder', founder: FOUNDER_INPUT },
      { actorId: ACTOR, now: NOW },
    );
    expect(created.status).toBe('open');
    expect(created.slate.kind).toBe('founder');
    expect(created.dId).toBeNull();

    const events = listEvents(log);
    expect(events.map((e) => e.eventType)).toContain('decision.slate_created');
  });

  it('rejects a malformed founder slate (FR-P6 2-4 options)', async () => {
    const { log } = await boot();
    expect(() =>
      createSlate(
        log,
        {
          kind: 'founder',
          founder: { ...FOUNDER_INPUT, options: [FOUNDER_INPUT.options[0]!] },
        },
        { actorId: ACTOR, now: NOW },
      ),
    ).toThrow(/2.4/);
  });

  it('lists slates filtered by status', async () => {
    const { log } = await boot();
    createSlate(
      log,
      { kind: 'founder', founder: FOUNDER_INPUT },
      { actorId: ACTOR, now: NOW },
    );
    expect(listSlates(log, { status: 'open' })).toHaveLength(1);
    expect(listSlates(log, { status: 'decided' })).toHaveLength(0);
  });

  it('decides a slate: assigns the next D-ID, appends docs/DECISIONS.md, updates the row', async () => {
    const { log, projectPath } = await boot();
    const created = createSlate(
      log,
      { kind: 'founder', founder: FOUNDER_INPUT },
      { actorId: ACTOR, now: NOW },
    );

    const decision = decideSlate(
      log,
      { slateId: created.id, chosen: 'self-hosted', rationale: 'fastest to ship' },
      { projectPath, actorId: ACTOR, now: NOW },
    );

    expect(decision.id).toBe('D-001');
    expect(decision.rationale).toBe('fastest to ship');

    const [decided] = listSlates(log, { status: 'decided' });
    expect(decided!.dId).toBe('D-001');
    expect(decided!.chosen).toBe('self-hosted');
    expect(decided!.status).toBe('decided');

    const ledger = await founderLedger(projectPath);
    expect(ledger).toContain('| D-001 |');
    expect(ledger).toContain('fastest to ship');

    const events = listEvents(log);
    expect(events.map((e) => e.eventType)).toContain('decision.chosen');
  });

  it('bootstraps docs/DECISIONS.md from scratch when the project has no ledger yet', async () => {
    const { log, projectPath } = await boot();
    const created = createSlate(
      log,
      { kind: 'founder', founder: FOUNDER_INPUT },
      { actorId: ACTOR, now: NOW },
    );
    await expect(founderLedger(projectPath)).rejects.toThrow();

    decideSlate(
      log,
      { slateId: created.id, chosen: 'managed' },
      { projectPath, actorId: ACTOR, now: NOW },
    );

    const ledger = await founderLedger(projectPath);
    expect(ledger).toContain('| ID | Date | Decision | Options considered | Rationale |');
    expect(ledger).toContain('| D-001 |');
  });

  it('assigns sequential D-IDs across multiple decided slates', async () => {
    const { log, projectPath } = await boot();
    const first = createSlate(
      log,
      { kind: 'founder', founder: FOUNDER_INPUT },
      { actorId: ACTOR, now: NOW },
    );
    decideSlate(
      log,
      { slateId: first.id, chosen: 'self-hosted' },
      { projectPath, actorId: ACTOR, now: NOW },
    );

    const second = createSlate(
      log,
      { kind: 'founder', founder: FOUNDER_INPUT },
      { actorId: ACTOR, now: NOW },
    );
    const decision = decideSlate(
      log,
      { slateId: second.id, chosen: 'managed' },
      { projectPath, actorId: ACTOR, now: NOW },
    );

    expect(decision.id).toBe('D-002');
  });

  /**
   * ID-DERIVATION FIX (W5-13 acceptance #2, sticky across earlier attempts):
   * a ledger whose free-text (rationale/options) contains a D-shaped
   * substring like "D-999" must not advance the next assigned ID — the ID
   * comes only from `@dokima/pipeline`'s hardened `nextDecisionId`,
   * routed through `decideSlate`'s real ledger-read path, not tested
   * against `nextDecisionId` directly.
   */
  it('a ledger row whose free-text contains "D-999" still yields the correct sequential next ID', async () => {
    const { log, projectPath } = await boot();
    const docsDir = path.join(projectPath, 'docs');
    await fs.mkdir(docsDir, { recursive: true });
    await fs.writeFile(
      path.join(docsDir, 'DECISIONS.md'),
      '# Decisions\n\n' +
        '| ID | Date | Decision | Options considered | Rationale |\n' +
        '|---|---|---|---|---|\n' +
        '| D-001 | 2026-07-10 | Name | A, B | see D-999 for context, not a real decision |\n',
      'utf8',
    );

    const slate = createSlate(
      log,
      { kind: 'founder', founder: FOUNDER_INPUT },
      { actorId: ACTOR, now: NOW },
    );
    const decision = decideSlate(
      log,
      { slateId: slate.id, chosen: 'managed' },
      { projectPath, actorId: ACTOR, now: NOW },
    );

    expect(decision.id).toBe('D-002');
  });

  it('refuses to decide a slate that does not exist', async () => {
    const { log, projectPath } = await boot();
    expect(() =>
      decideSlate(
        log,
        { slateId: 'missing', chosen: 'x' },
        { projectPath, actorId: ACTOR, now: NOW },
      ),
    ).toThrow(SlateNotFoundError);
  });

  it('refuses to decide an already-decided slate', async () => {
    const { log, projectPath } = await boot();
    const created = createSlate(
      log,
      { kind: 'founder', founder: FOUNDER_INPUT },
      { actorId: ACTOR, now: NOW },
    );
    decideSlate(
      log,
      { slateId: created.id, chosen: 'self-hosted' },
      { projectPath, actorId: ACTOR, now: NOW },
    );

    expect(() =>
      decideSlate(
        log,
        { slateId: created.id, chosen: 'managed' },
        { projectPath, actorId: ACTOR, now: NOW },
      ),
    ).toThrow(SlateAlreadyDecidedError);
  });

  it('refuses a choice that is not one of the slate options', async () => {
    const { log, projectPath } = await boot();
    const created = createSlate(
      log,
      { kind: 'founder', founder: FOUNDER_INPUT },
      { actorId: ACTOR, now: NOW },
    );
    expect(() =>
      decideSlate(
        log,
        { slateId: created.id, chosen: 'nope' },
        { projectPath, actorId: ACTOR, now: NOW },
      ),
    ).toThrow(InvalidChoiceError);
  });

  it('listDecisions returns only decided slates, D-ID ledger shape', async () => {
    const { log, projectPath } = await boot();
    const open = createSlate(
      log,
      { kind: 'founder', founder: FOUNDER_INPUT },
      { actorId: ACTOR, now: NOW },
    );
    const toDecide = createSlate(
      log,
      { kind: 'founder', founder: FOUNDER_INPUT },
      { actorId: ACTOR, now: NOW },
    );
    decideSlate(
      log,
      { slateId: toDecide.id, chosen: 'self-hosted' },
      { projectPath, actorId: ACTOR, now: NOW },
    );

    const decisions = listDecisions(log);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.id).toBe(toDecide.id);
    expect(decisions[0]!.dId).toBe('D-001');
    void open;
  });

  /**
   * SEC TRIAGE (sec/ledger-atomicity, 2026-07-27): 11 dogfood specialists
   * independently claimed "decision ledger writes are not atomic across
   * concurrent requests" and asked for a test that fires concurrent
   * `decideSlate`-class calls and asserts the ledger ends up with exactly
   * one clean row per call, no interleaved/duplicate D-IDs. This is that
   * test, run against the real route-handler shape: each "request" is an
   * async wrapper around the synchronous `decideSlate` critical section
   * (matches routes.ts, which calls it un-awaited-through from an async
   * Fastify handler) so Promise.all fires them the same way concurrent
   * HTTP requests would land on Node's single event-loop thread.
   *
   * `decideSlate` is deliberately NOT declared `async` (see its doc
   * comment) specifically so no `await` can be inserted between its
   * ledger read and ledger write — the whole read-compute-write section
   * runs as one synchronous call-stack frame, which Node's single-threaded
   * event loop cannot preempt mid-frame. This test pins that guarantee
   * rather than just asserting it in prose.
   */
  it('N concurrent decideSlate calls on N different open slates each get exactly one clean ledger row, sequential D-IDs, no interleaving', async () => {
    const { log, projectPath } = await boot();
    const N = 8;
    const slates = Array.from({ length: N }, () =>
      createSlate(
        log,
        { kind: 'founder', founder: FOUNDER_INPUT },
        { actorId: ACTOR, now: NOW },
      ),
    );

    // Each "request" is async (like the Fastify handler in routes.ts) but
    // decideSlate itself is the synchronous critical section under test.
    async function decideAsRequest(slateId: string) {
      return decideSlate(
        log,
        { slateId, chosen: 'self-hosted', rationale: `rationale for ${slateId}` },
        { projectPath, actorId: ACTOR, now: NOW },
      );
    }

    const results = await Promise.all(slates.map((s) => decideAsRequest(s.id)));

    const ids = results.map((r) => r.id);
    expect(new Set(ids).size).toBe(N); // no duplicate D-IDs
    expect([...ids].sort()).toEqual(
      Array.from({ length: N }, (_, i) => `D-${String(i + 1).padStart(3, '0')}`),
    );

    const ledger = await founderLedger(projectPath);
    const rows = ledger.split('\n').filter((line) => /^\|\s*D-\d+\s*\|/.test(line));
    expect(rows).toHaveLength(N); // one clean row per call, nothing torn or merged
    for (const id of ids) {
      expect(ledger).toContain(`| ${id} |`);
    }

    // Every decided slate's DB row agrees with its ledger row (log and
    // projection never disagree).
    const decided = listSlates(log, { status: 'decided' });
    expect(decided).toHaveLength(N);
    for (const d of decided) {
      expect(ids).toContain(d.dId);
    }
  });

  it('the same slate decided twice "concurrently" resolves exactly once — the loser sees SlateAlreadyDecidedError, not a torn or duplicated ledger row', async () => {
    const { log, projectPath } = await boot();
    const created = createSlate(
      log,
      { kind: 'founder', founder: FOUNDER_INPUT },
      { actorId: ACTOR, now: NOW },
    );

    async function decideAsRequest(chosen: string) {
      return decideSlate(
        log,
        { slateId: created.id, chosen },
        { projectPath, actorId: ACTOR, now: NOW },
      );
    }

    const outcomes = await Promise.allSettled([
      decideAsRequest('self-hosted'),
      decideAsRequest('managed'),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      SlateAlreadyDecidedError,
    );

    const ledger = await founderLedger(projectPath);
    const rows = ledger.split('\n').filter((line) => /^\|\s*D-\d+\s*\|/.test(line));
    expect(rows).toHaveLength(1); // exactly one row — no interleaved/duplicate D-ID
  });

  /**
   * SEC TRIAGE follow-up (sec/ledger-atomicity): the concurrent-request
   * framing above is refuted, but 6 of the 11 findings ask for something
   * narrower — "ensure each decision write commits the ledger row and its
   * anchoring event together." store.ts's decideSlate (line ~202) calls
   * `writeLedgerSync` (plain synchronous `node:fs` I/O) *inside* the
   * `log.db.transaction()` callback, ahead of `appendEvent`. SQLite's
   * transaction rollback has no power over an fs write that already
   * happened — only the DB side rolls back.
   *
   * First attempt at forcing this used an actor id with no `identities`
   * row, expecting the FK on `appendEvent`'s `events.actor_id` to fail
   * post-write. It didn't reach that window: `decisions.decided_by` is
   * ALSO FK'd to `identities` and is written earlier in the same UPDATE
   * (before `writeLedgerSync`), so an invalid actor is rejected there
   * first — no file write happens at all in that path (verified: that
   * variant threw ENOENT reading the ledger, proving the file was never
   * created). That is in fact a second, independent finding: the specific
   * "invalid actor" failure mode this triage first reached for is safe.
   *
   * To reach the real window, `appendEvent` is mocked to throw
   * deterministically on the second call — the first call (inside
   * `createSlate`, `decision.slate_created`) passes through untouched, so
   * the slate exists and its actor is valid; only the `decision.chosen`
   * append inside `decideSlate`, which runs after `writeLedgerSync`, fails.
   */
  it('REGRESSION: an event-log append failure rolls back the DB AND leaves the ledger file untouched — the file is never ahead of the log', async () => {
    const { log, projectPath } = await boot();
    const created = createSlate(
      log,
      { kind: 'founder', founder: FOUNDER_INPUT },
      { actorId: ACTOR, now: NOW },
    );

    forceAppendEventFailure = true;
    expect(() =>
      decideSlate(
        log,
        { slateId: created.id, chosen: 'self-hosted', rationale: 'r' },
        { projectPath, actorId: ACTOR, now: NOW },
      ),
    ).toThrow(/simulated event-log append failure/);
    forceAppendEventFailure = false;

    // DB side rolled back cleanly: slate is still open, no decision.chosen event.
    expect(listSlates(log, { status: 'open' })).toHaveLength(1);
    expect(listSlates(log, { status: 'decided' })).toHaveLength(0);
    expect(listEvents(log).map((e) => e.eventType)).not.toContain('decision.chosen');

    // File side is now clean too: writeLedgerSync runs AFTER the transaction
    // commits, so a throw inside it never reaches the file at all — on a first
    // decision docs/DECISIONS.md is not even created. Previously this asserted
    // the opposite: the file existed holding an orphaned `| D-001 |` with no DB
    // row and no event behind it. Asserting non-existence (rather than absence
    // of the row) is the sharper check — it fails loudly if the write ever
    // creeps back inside the transaction.
    await expect(founderLedger(projectPath)).rejects.toThrow(/ENOENT/);

    // The compounding harm is gone: a retry is the FIRST decision to reach the
    // ledger, so it takes D-001 rather than skipping to D-002. The ledger and
    // the log agree on how many decisions exist — no ghost rows, no gap in the
    // D-ID sequence.
    const retried = decideSlate(
      log,
      { slateId: created.id, chosen: 'self-hosted', rationale: 'retry' },
      { projectPath, actorId: ACTOR, now: NOW },
    );
    expect(retried.id).toBe('D-001');
    const decidedEvents = listEvents(log).filter(
      (e) => e.eventType === 'decision.chosen',
    );
    expect(decidedEvents).toHaveLength(1);
    // Ledger and log now agree: one decision, same id, on both sides.
    const finalLedger = await founderLedger(projectPath);
    expect(finalLedger).toContain('| D-001 |');
    expect(finalLedger).not.toContain('| D-002 |');
    expect(decidedEvents[0]?.payload).toMatchObject({ dId: 'D-001' });
  });
});
