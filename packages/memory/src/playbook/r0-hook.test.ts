/**
 * Proves `createPlaybookMemoryConsultHook` is a real, working R0 rung for
 * the escalation ladder (BLUEPRINT §3.3, FR-M2/FR-G3) — not just a
 * structurally-typed guess. `packages/memory` can't statically import
 * `@shipwright/gateway` (no workspace dependency declared in this ticket's
 * write_scope, same constraint gateway's own `memory-hook.ts` documents in
 * reverse), so this dynamically imports the REAL, unmodified
 * `runEscalationLadder` by absolute `file://` URL — same technique as
 * `../store/anti-jarvis-gap.test.ts` / `manifest-gap.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInMemoryPlaybookConsultSink } from './events.js';
import { insertPlaybookEntry } from './playbook.js';
import { createPlaybookMemoryConsultHook } from './r0-hook.js';
import { createTestHandle } from './test-helpers.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
);

// Structural stand-ins for packages/gateway's real types (memory can't
// import gateway statically, so there's no compile-time type to import
// either — deliberately minimal, just what this test calls).
interface GateOutcomeLike {
  readonly passed: boolean;
  readonly receipts: readonly unknown[];
}

interface EscalationLadderOutcomeLike {
  readonly status: 'resolved' | 'blocked';
  readonly finalRung: 'R0' | 'R1' | 'R2' | 'R3' | 'R4';
  readonly resolvedBy?: 'memory' | 'model';
}

interface RunEscalationLadderInput {
  readonly ticketId: string;
  readonly criterion: string;
  readonly actorId: string;
  readonly matrix: unknown;
  readonly runAttempt: (context: unknown) => GateOutcomeLike | Promise<GateOutcomeLike>;
  readonly memoryHook: {
    consult(input: { ticketId: string; criterion: string }):
      | { answered: boolean; findingId?: string; summary?: string }
      | Promise<{
          answered: boolean;
          findingId?: string;
          summary?: string;
        }>;
  };
}

interface EscalationLadderModule {
  runEscalationLadder(
    input: RunEscalationLadderInput,
  ): Promise<EscalationLadderOutcomeLike>;
}

async function loadEscalationLadder(): Promise<EscalationLadderModule> {
  return import(
    pathToFileURL(
      path.join(repoRoot, 'packages', 'gateway', 'src', 'escalation', 'ladder.ts'),
    ).href
  ) as Promise<EscalationLadderModule>;
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

describe('createPlaybookMemoryConsultHook wired into the real R0-R4 escalation ladder', () => {
  it('a confirmed playbook entry answers R0 for free — zero model calls, one hit event', async () => {
    const { runEscalationLadder } = await loadEscalationLadder();
    const handle = createTestHandle();
    insertPlaybookEntry(
      handle,
      {
        taskClass: 'the thing works',
        entry: 'known fix: restart the daemon',
        verifiedBy: 'tool',
      },
      NOW,
    );
    const sink = createInMemoryPlaybookConsultSink();
    const hook = createPlaybookMemoryConsultHook(handle, { sink, now: NOW });

    let attemptCalls = 0;
    const outcome = await runEscalationLadder({
      ticketId: 't-1',
      criterion: 'the thing works',
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
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]?.type).toBe('playbook.r0_hit');
  });

  it('no playbook/fact match -> ladder proceeds past R0 to a real model attempt', async () => {
    const { runEscalationLadder } = await loadEscalationLadder();
    const handle = createTestHandle();
    const sink = createInMemoryPlaybookConsultSink();
    const hook = createPlaybookMemoryConsultHook(handle, { sink, now: NOW });

    let attemptCalls = 0;
    const outcome = await runEscalationLadder({
      ticketId: 't-2',
      criterion: 'a task never seen before',
      actorId: 'harbormaster',
      matrix: MATRIX,
      runAttempt: () => {
        attemptCalls += 1;
        return { passed: true, receipts: [] };
      },
      memoryHook: hook,
    });

    expect(outcome.finalRung).toBe('R1');
    expect(outcome.resolvedBy).toBe('model');
    expect(attemptCalls).toBe(1);
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]?.type).toBe('playbook.r0_miss');
  });
});
