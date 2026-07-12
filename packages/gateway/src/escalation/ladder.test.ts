import { describe, expect, it } from 'vitest';
import type { ScopedRoleMatrix } from '../routing/types.js';
import { createInMemoryEscalationEventSink } from './events.js';
import {
  MissingFailureEvidenceError,
  isMonotonicRungSequence,
  runEscalationLadder,
  type AttemptRunner,
  type RungAttemptRecord,
} from './ladder.js';
import type { FailureReceipt, GateOutcome } from './types.js';

const matrix: ScopedRoleMatrix = {
  global: {
    'coding-agent': {
      default: {
        model: 'qwen2.5-coder-7b-instruct',
        fallbackChain: ['qwen2.5-coder-32b-instruct'],
      },
      taskTypes: {
        escalation: { model: 'claude-opus-4-8', fallbackChain: [] },
      },
    },
  },
};

const receipt = (name = 'gate'): FailureReceipt => ({
  name,
  exitCode: 1,
  gapCount: 1,
  gaps: [`${name} gap`],
});

/** Fails every rung up to (not including) `passAt`, then passes; `passAt: undefined` means always fail (drives the R4 path). */
function scriptedAttemptRunner(passAt: 'R1' | 'R2' | 'R3' | undefined): AttemptRunner {
  return ({ rung }) => {
    const outcome: GateOutcome =
      rung === passAt
        ? { passed: true, receipts: [] }
        : { passed: false, receipts: [receipt(rung)] };
    return outcome;
  };
}

function rungsOf(attempts: readonly RungAttemptRecord[]): string[] {
  return attempts.map((a) => a.rung);
}

describe('runEscalationLadder', () => {
  it('R0: a confirmed memory/playbook answer resolves for free, no model call, no events', async () => {
    let attemptCalls = 0;
    const outcome = await runEscalationLadder({
      ticketId: 't-1',
      criterion: 'the thing works',
      actorId: 'harbormaster',
      matrix,
      runAttempt: () => {
        attemptCalls += 1;
        return { passed: true, receipts: [] };
      },
      memoryHook: { consult: () => ({ answered: true, findingId: 'f-1' }) },
    });
    expect(outcome.status).toBe('resolved');
    expect(outcome.finalRung).toBe('R0');
    expect(outcome.resolvedBy).toBe('memory');
    expect(outcome.events).toHaveLength(0);
    expect(attemptCalls).toBe(0);
  });

  it('FR-G3: a passing ticket can never emit an escalation event', async () => {
    const sink = createInMemoryEscalationEventSink();
    const outcome = await runEscalationLadder({
      ticketId: 't-2',
      criterion: 'the thing works',
      actorId: 'harbormaster',
      matrix,
      runAttempt: scriptedAttemptRunner('R1'),
      sink,
    });
    expect(outcome.status).toBe('resolved');
    expect(outcome.finalRung).toBe('R1');
    expect(outcome.resolvedBy).toBe('model');
    expect(outcome.model).toBe('qwen2.5-coder-7b-instruct');
    expect(outcome.events).toHaveLength(0);
    expect(sink.events).toHaveLength(0);
  });

  it('FR-G3: a simulated R1 gate failure escalates to R2 with the failure receipt attached', async () => {
    const sink = createInMemoryEscalationEventSink();
    const outcome = await runEscalationLadder({
      ticketId: 't-3',
      criterion: 'the thing works',
      actorId: 'harbormaster',
      matrix,
      runAttempt: scriptedAttemptRunner('R2'),
      sink,
      now: () => '2026-07-12T00:00:00.000Z',
    });
    expect(outcome.status).toBe('resolved');
    expect(outcome.finalRung).toBe('R2');
    expect(outcome.model).toBe('qwen2.5-coder-32b-instruct');
    expect(outcome.events).toHaveLength(1);
    expect(sink.events).toHaveLength(1);
    const [event] = outcome.events;
    expect(event).toMatchObject({
      type: 'escalation.rung_advanced',
      ticketId: 't-3',
      fromRung: 'R1',
      toRung: 'R2',
      actorId: 'harbormaster',
      occurredAt: '2026-07-12T00:00:00.000Z',
    });
    expect(event!.receipts).toEqual([receipt('R1')]);
  });

  it('R2 "one rung up" degenerates to R1\'s model when the matrix defines no fallback', async () => {
    const noFallbackMatrix: ScopedRoleMatrix = {
      global: {
        'coding-agent': {
          default: { model: 'solo-model', fallbackChain: [] },
        },
      },
    };
    const outcome = await runEscalationLadder({
      ticketId: 't-4',
      criterion: 'x',
      actorId: 'harbormaster',
      matrix: noFallbackMatrix,
      runAttempt: scriptedAttemptRunner('R2'),
    });
    expect(outcome.status).toBe('resolved');
    expect(outcome.model).toBe('solo-model');
  });

  it('R3 resolves the frontier model via the escalation task type, distinct from R1/R2', async () => {
    const calls: string[] = [];
    const runAttempt: AttemptRunner = ({ rung, modelChain }) => {
      calls.push(`${rung}:${modelChain[0]}`);
      return rung === 'R3'
        ? { passed: true, receipts: [] }
        : { passed: false, receipts: [receipt(rung)] };
    };
    const outcome = await runEscalationLadder({
      ticketId: 't-5',
      criterion: 'x',
      actorId: 'harbormaster',
      matrix,
      runAttempt,
    });
    expect(outcome.status).toBe('resolved');
    expect(outcome.finalRung).toBe('R3');
    expect(outcome.model).toBe('claude-opus-4-8');
    expect(calls).toEqual([
      'R1:qwen2.5-coder-7b-instruct',
      'R2:qwen2.5-coder-32b-instruct',
      'R3:claude-opus-4-8',
    ]);
  });

  it('R4: three consecutive gate failures block the ticket with evidence attached; rungs stay monotonic', async () => {
    const sink = createInMemoryEscalationEventSink();
    const outcome = await runEscalationLadder({
      ticketId: 't-6',
      criterion: 'x',
      actorId: 'harbormaster',
      matrix,
      runAttempt: scriptedAttemptRunner(undefined),
      sink,
    });
    expect(outcome.status).toBe('blocked');
    expect(outcome.finalRung).toBe('R4');
    expect(rungsOf(outcome.attempts)).toEqual(['R0', 'R1', 'R2', 'R3']);
    expect(isMonotonicRungSequence(outcome.attempts)).toBe(true);

    expect(outcome.events.map((e) => `${e.fromRung}->${e.toRung}`)).toEqual([
      'R1->R2',
      'R2->R3',
      'R3->R4',
    ]);
    // "R4 always carries evidence" (TESTING.md §3).
    const blockedEvent = outcome.events.at(-1)!;
    expect(blockedEvent.type).toBe('escalation.blocked');
    expect(blockedEvent.receipts.length).toBeGreaterThan(0);
    expect(sink.events).toHaveLength(3);
  });

  it('refuses to advance on a failure reported with no receipts (evidence-triggered, never vibes-triggered)', async () => {
    const runAttempt: AttemptRunner = () => ({ passed: false, receipts: [] });
    await expect(
      runEscalationLadder({
        ticketId: 't-7',
        criterion: 'x',
        actorId: 'harbormaster',
        matrix,
        runAttempt,
      }),
    ).rejects.toThrow(MissingFailureEvidenceError);
  });

  it('defaults role to coding-agent and taskType to code when omitted', async () => {
    const calls: Array<{ role: string; taskType: string }> = [];
    const outcome = await runEscalationLadder({
      ticketId: 't-8',
      criterion: 'x',
      actorId: 'harbormaster',
      matrix,
      runAttempt: (ctx) => {
        calls.push({ role: ctx.role, taskType: ctx.taskType });
        return { passed: true, receipts: [] };
      },
    });
    expect(outcome.status).toBe('resolved');
    expect(calls).toEqual([{ role: 'coding-agent', taskType: 'code' }]);
  });
});

describe('isMonotonicRungSequence', () => {
  it('rejects a repeated or out-of-order rung', () => {
    expect(
      isMonotonicRungSequence([
        { rung: 'R0', status: 'no_memory_hit', receipts: [] },
        { rung: 'R1', status: 'failed', receipts: [receipt()] },
        { rung: 'R1', status: 'failed', receipts: [receipt()] },
      ]),
    ).toBe(false);
    expect(
      isMonotonicRungSequence([
        { rung: 'R1', status: 'failed', receipts: [receipt()] },
        { rung: 'R0', status: 'no_memory_hit', receipts: [] },
      ]),
    ).toBe(false);
  });

  it('accepts the straight-line R0..R4 order', () => {
    expect(
      isMonotonicRungSequence([
        { rung: 'R0', status: 'no_memory_hit', receipts: [] },
        { rung: 'R1', status: 'failed', receipts: [receipt()] },
        { rung: 'R2', status: 'failed', receipts: [receipt()] },
        { rung: 'R3', status: 'failed', receipts: [receipt()] },
      ]),
    ).toBe(true);
  });
});
