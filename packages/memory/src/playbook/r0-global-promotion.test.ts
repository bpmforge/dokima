/**
 * FR-F5's own acceptance sketch, proven end-to-end: "Unpromoted lesson
 * invisible to a second project; promotion requires an explicit gated
 * action and stamps provenance; promoted entry then hits at R0 in another
 * project ($0 ledger row)." `promote.test.ts` proves the provenance half;
 * this file proves the R0-visibility half, wired through the REAL
 * escalation ladder (`packages/gateway/src/escalation/ladder.ts`) and the
 * REAL global playbook (`packages/events/src/global-db/global-playbook.ts`)
 * — both dynamically imported by absolute `file://` URL, same technique as
 * `promote.test.ts`/`r0-hook.test.ts`, since `packages/memory` can't
 * statically depend on either package.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { insertPlaybookEntry } from './playbook.js';
import { preparePlaybookPromotion } from './promote.js';
import { createPlaybookMemoryConsultHook } from './r0-hook.js';
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

interface EventsGlobalModule {
  openGlobalDb(dbPath: string): GlobalDbLike;
  promoteGlobalPlaybookEntry(
    global: GlobalDbLike,
    input: unknown,
    now?: () => string,
  ): unknown;
  listGlobalPlaybook(global: GlobalDbLike): Array<{
    id: number;
    taskClass: string;
    entry: string;
    retiredAt: string | null;
  }>;
}

async function loadEventsGlobal(): Promise<EventsGlobalModule> {
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
    openGlobalDb: (dbMod as EventsGlobalModule).openGlobalDb,
    promoteGlobalPlaybookEntry: (playbookMod as EventsGlobalModule)
      .promoteGlobalPlaybookEntry,
    listGlobalPlaybook: (playbookMod as EventsGlobalModule).listGlobalPlaybook,
  };
}

interface GateOutcomeLike {
  readonly passed: boolean;
  readonly receipts: readonly unknown[];
}

interface EscalationLadderOutcomeLike {
  readonly status: 'resolved' | 'blocked';
  readonly finalRung: 'R0' | 'R1' | 'R2' | 'R3' | 'R4';
  readonly resolvedBy?: 'memory' | 'model';
}

interface GatewayLadderModule {
  runEscalationLadder(input: {
    ticketId: string;
    criterion: string;
    actorId: string;
    matrix: unknown;
    runAttempt: (context: unknown) => GateOutcomeLike | Promise<GateOutcomeLike>;
    memoryHook: {
      consult(input: { ticketId: string; criterion: string }): unknown;
    };
  }): Promise<EscalationLadderOutcomeLike>;
}

async function loadGatewayLadder(): Promise<GatewayLadderModule> {
  return import(
    pathToFileURL(
      path.join(repoRoot, 'packages', 'gateway', 'src', 'escalation', 'ladder.ts'),
    ).href
  ) as Promise<GatewayLadderModule>;
}

const NOW = () => '2026-07-20T12:00:00.000Z';
const MATRIX = {
  global: {
    'coding-agent': {
      default: { model: 'qwen2.5-coder-7b-instruct', fallbackChain: [] },
    },
    challenger: { default: { model: 'claude-opus-4-8', fallbackChain: [] } },
  },
};

describe('FR-F5: a promoted lesson hits at R0 in a second project; an unpromoted one stays invisible', () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
  });

  it('project B, no promotion yet: R0 misses and a real model attempt runs', async () => {
    const { runEscalationLadder } = await loadGatewayLadder();
    const projectBHandle = createTestHandle(); // fresh, empty local playbook
    const hook = createPlaybookMemoryConsultHook(projectBHandle, {
      now: NOW,
      globalEntries: [], // nothing promoted yet
    });

    let attemptCalls = 0;
    const outcome = await runEscalationLadder({
      ticketId: 'proj-b-t1',
      criterion: 'flaky timeout fix',
      actorId: 'harbormaster',
      matrix: MATRIX,
      runAttempt: () => {
        attemptCalls += 1;
        return { passed: true, receipts: [] };
      },
      memoryHook: hook,
    });

    expect(outcome.finalRung).toBe('R1');
    expect(attemptCalls).toBe(1);
  });

  it('project A promotes; project B (a different, empty local playbook) then hits at R0 for free', async () => {
    // Project A: insert + explicitly promote.
    const projectAHandle = createTestHandle();
    const entry = insertPlaybookEntry(
      projectAHandle,
      {
        taskClass: 'flaky timeout fix',
        entry: 'retry with exponential backoff',
        verifiedBy: 'challenger',
      },
      NOW,
    );
    const payload = preparePlaybookPromotion(projectAHandle, {
      entryId: entry.id,
      promotedFromProject: 'proj-a',
      promotedBy: 'human-brad',
    });

    const { openGlobalDb, promoteGlobalPlaybookEntry, listGlobalPlaybook } =
      await loadEventsGlobal();
    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'dokima-r0-global-promotion-test-'),
    );
    cleanup = () => fs.rm(dir, { recursive: true, force: true });
    const global = openGlobalDb(path.join(dir, 'global.db'));
    let globalEntries;
    try {
      promoteGlobalPlaybookEntry(global, payload, NOW);
      globalEntries = listGlobalPlaybook(global);
    } finally {
      global.close();
    }
    expect(globalEntries).toHaveLength(1);

    // Project B: a completely separate, empty local playbook/fact store —
    // the only thing it has is the globally-promoted rows a real caller
    // would have loaded from the shared global.db.
    const { runEscalationLadder } = await loadGatewayLadder();
    const projectBHandle = createTestHandle();
    const hook = createPlaybookMemoryConsultHook(projectBHandle, {
      now: NOW,
      globalEntries,
    });

    let attemptCalls = 0;
    const outcome = await runEscalationLadder({
      ticketId: 'proj-b-t2',
      criterion: 'flaky timeout fix',
      actorId: 'harbormaster',
      matrix: MATRIX,
      runAttempt: () => {
        attemptCalls += 1;
        return { passed: true, receipts: [] };
      },
      memoryHook: hook,
    });

    expect(outcome.status).toBe('resolved');
    expect(outcome.finalRung).toBe('R0');
    expect(outcome.resolvedBy).toBe('memory');
    expect(attemptCalls).toBe(0);
  });
});
