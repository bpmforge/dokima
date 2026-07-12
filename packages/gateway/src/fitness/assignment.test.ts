import { describe, expect, it } from 'vitest';
import { UnfitAssignmentRefusedError, guardFitAssignment } from './assignment.js';
import { createInMemoryFitnessEventSink } from './events.js';
import { FitnessCardStore } from './store.js';
import type { FitnessCard } from './types.js';

function card(overrides: Partial<FitnessCard> = {}): FitnessCard {
  return {
    model: 'qwen2.5-coder-7b-instruct',
    role: 'challenger',
    verdict: 'unfit',
    harnessVersion: '1.0.0',
    taskResults: [
      { taskId: 'challenge.uncited-benchmark-claim', passed: false, reason: 'missed it' },
    ],
    runAt: '2026-07-12T00:00:00.000Z',
    ...overrides,
  };
}

describe('guardFitAssignment (FR-G6: "assigning an unfit pair warns with the card; proceeding requires explicit ack event")', () => {
  it('passes through silently when no card is on file (never benched)', async () => {
    const store = new FitnessCardStore();
    const result = await guardFitAssignment({
      model: 'unbenched-model',
      role: 'coding-agent',
      store,
      harnessVersion: '1.0.0',
      actorId: 'harbormaster',
    });
    expect(result).toEqual({ card: undefined });
  });

  it('passes through and surfaces the card when the verdict is fit', async () => {
    const store = new FitnessCardStore();
    const fitCard = card({ verdict: 'fit' });
    store.put(fitCard);
    const result = await guardFitAssignment({
      model: fitCard.model,
      role: fitCard.role,
      store,
      harnessVersion: '1.0.0',
      actorId: 'harbormaster',
    });
    expect(result).toEqual({ card: fitCard });
  });

  it('refuses an unfit pair with no ack, carrying the card on the error', async () => {
    const store = new FitnessCardStore();
    const unfitCard = card({ verdict: 'unfit' });
    store.put(unfitCard);
    const request = {
      model: unfitCard.model,
      role: unfitCard.role,
      store,
      harnessVersion: '1.0.0',
      actorId: 'harbormaster',
    };

    await expect(guardFitAssignment(request)).rejects.toThrow(
      UnfitAssignmentRefusedError,
    );

    const error: UnfitAssignmentRefusedError = await guardFitAssignment(request).catch(
      (err) => err,
    );
    expect(error).toBeInstanceOf(UnfitAssignmentRefusedError);
    expect(error.card).toEqual(unfitCard);
  });

  it('refuses a marginal pair the same way as unfit', async () => {
    const store = new FitnessCardStore();
    const marginalCard = card({ verdict: 'marginal' });
    store.put(marginalCard);
    await expect(
      guardFitAssignment({
        model: marginalCard.model,
        role: marginalCard.role,
        store,
        harnessVersion: '1.0.0',
        actorId: 'harbormaster',
      }),
    ).rejects.toThrow(UnfitAssignmentRefusedError);
  });

  it('proceeds past an unfit pair with an explicit ack and mints an event', async () => {
    const store = new FitnessCardStore();
    const unfitCard = card({ verdict: 'unfit' });
    store.put(unfitCard);
    const sink = createInMemoryFitnessEventSink();

    const result = await guardFitAssignment({
      model: unfitCard.model,
      role: unfitCard.role,
      store,
      harnessVersion: '1.0.0',
      ack: true,
      actorId: 'user:founder',
      sink,
      now: () => '2026-07-12T00:00:01.000Z',
    });

    expect(result.card).toEqual(unfitCard);
    expect(result.ackEvent).toEqual({
      type: 'fitness.unfit_ack',
      model: unfitCard.model,
      role: unfitCard.role,
      verdict: 'unfit',
      card: unfitCard,
      actorId: 'user:founder',
      occurredAt: '2026-07-12T00:00:01.000Z',
    });
    expect(sink.events).toEqual([result.ackEvent]);
  });

  it('an ack without a sink still returns the event to the caller', async () => {
    const store = new FitnessCardStore();
    const unfitCard = card({ verdict: 'unfit' });
    store.put(unfitCard);
    const result = await guardFitAssignment({
      model: unfitCard.model,
      role: unfitCard.role,
      store,
      harnessVersion: '1.0.0',
      ack: true,
      actorId: 'harbormaster',
    });
    expect(result.ackEvent?.type).toBe('fitness.unfit_ack');
  });

  it('is scoped per harnessVersion — a stale card under an old version does not gate a new one', async () => {
    const store = new FitnessCardStore();
    store.put(card({ verdict: 'unfit', harnessVersion: '1.0.0' }));
    const result = await guardFitAssignment({
      model: 'qwen2.5-coder-7b-instruct',
      role: 'challenger',
      store,
      harnessVersion: '2.0.0',
      actorId: 'harbormaster',
    });
    expect(result).toEqual({ card: undefined });
  });
});
