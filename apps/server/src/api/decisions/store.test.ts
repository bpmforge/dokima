import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createIdentity,
  listEvents,
  openEventLog,
  type EventLog,
} from '@shipwright/events';
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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-decisions-'));
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

  it('creates a founder slate as open, validated through @shipwright/pipeline', async () => {
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
   * comes only from `@shipwright/pipeline`'s hardened `nextDecisionId`,
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
});
