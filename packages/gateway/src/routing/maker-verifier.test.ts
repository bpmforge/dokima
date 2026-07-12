import { describe, expect, it } from 'vitest';
import {
  SameModelRefusedError,
  createInMemoryRoutingEventSink,
  guardMakerVerifierDistinct,
  isVerifierRole,
  noopRoutingEventSink,
} from './maker-verifier.js';
import type { ScopedOverrideSettings } from './types.js';

describe('isVerifierRole', () => {
  it('is true only for code-reviewer and challenger', () => {
    expect(isVerifierRole('code-reviewer')).toBe(true);
    expect(isVerifierRole('challenger')).toBe(true);
    expect(isVerifierRole('coding-agent')).toBe(false);
    expect(isVerifierRole('test-engineer')).toBe(false);
    expect(isVerifierRole('default')).toBe(false);
  });
});

describe("guardMakerVerifierDistinct (FR-G2: reviewer/challenger roles refuse the maker's model by default)", () => {
  it('does not check non-verifier roles even when the model matches the maker', async () => {
    const result = await guardMakerVerifierDistinct({
      verifierRole: 'test-engineer',
      makerRole: 'coding-agent',
      taskType: 'code',
      verifierModel: 'same-model',
      makerModel: 'same-model',
      actorId: 'harbormaster',
    });
    expect(result).toBeUndefined();
  });

  it('allows a verifier role that resolves to a different model than the maker', async () => {
    const result = await guardMakerVerifierDistinct({
      verifierRole: 'code-reviewer',
      makerRole: 'coding-agent',
      taskType: 'code',
      verifierModel: 'claude-opus-4-8',
      makerModel: 'qwen2.5-coder-7b-instruct',
      actorId: 'harbormaster',
    });
    expect(result).toBeUndefined();
  });

  it('refuses a verifier role landing on the maker model with no override', async () => {
    await expect(
      guardMakerVerifierDistinct({
        verifierRole: 'code-reviewer',
        makerRole: 'coding-agent',
        taskType: 'code',
        verifierModel: 'same-model',
        makerModel: 'same-model',
        actorId: 'harbormaster',
      }),
    ).rejects.toThrow(SameModelRefusedError);
  });

  it('refuses when the override setting is explicitly false', async () => {
    const overrideSettings: ScopedOverrideSettings = {
      global: { 'code-reviewer': false },
    };
    await expect(
      guardMakerVerifierDistinct({
        verifierRole: 'code-reviewer',
        makerRole: 'coding-agent',
        taskType: 'code',
        verifierModel: 'same-model',
        makerModel: 'same-model',
        actorId: 'harbormaster',
        overrideSettings,
      }),
    ).rejects.toThrow(SameModelRefusedError);
  });

  it('allows the collision and mints an event when the override is explicitly true', async () => {
    const overrideSettings: ScopedOverrideSettings = { project: { challenger: true } };
    const sink = createInMemoryRoutingEventSink();

    const event = await guardMakerVerifierDistinct({
      verifierRole: 'challenger',
      makerRole: 'coding-agent',
      taskType: 'verification',
      verifierModel: 'same-model',
      makerModel: 'same-model',
      actorId: 'user:founder',
      overrideSettings,
      sink,
    });

    expect(event).toEqual({
      type: 'routing.maker_verifier_override',
      verifierRole: 'challenger',
      makerRole: 'coding-agent',
      taskType: 'verification',
      model: 'same-model',
      scope: 'project',
      actorId: 'user:founder',
      occurredAt: expect.any(String),
    });
    expect(sink.events).toEqual([event]);
  });

  it('respects run > project > global precedence for the override flag itself', async () => {
    const overrideSettings: ScopedOverrideSettings = {
      global: { 'code-reviewer': true },
      project: { 'code-reviewer': false },
    };
    // project (false) wins over global (true) — still refused.
    await expect(
      guardMakerVerifierDistinct({
        verifierRole: 'code-reviewer',
        makerRole: 'coding-agent',
        taskType: 'code',
        verifierModel: 'same-model',
        makerModel: 'same-model',
        actorId: 'harbormaster',
        overrideSettings,
      }),
    ).rejects.toThrow(SameModelRefusedError);
  });

  it('allows the collision without a sink — the event is still returned to the caller', async () => {
    const event = await guardMakerVerifierDistinct({
      verifierRole: 'code-reviewer',
      makerRole: 'coding-agent',
      taskType: 'code',
      verifierModel: 'same-model',
      makerModel: 'same-model',
      actorId: 'harbormaster',
      overrideSettings: { global: { 'code-reviewer': true } },
    });
    expect(event?.type).toBe('routing.maker_verifier_override');
  });

  it('noopRoutingEventSink.emit is a no-op callers can pass without an audit trail', () => {
    expect(() =>
      noopRoutingEventSink.emit({
        type: 'routing.maker_verifier_override',
        verifierRole: 'code-reviewer',
        makerRole: 'coding-agent',
        taskType: 'code',
        model: 'same-model',
        scope: 'global',
        actorId: 'harbormaster',
        occurredAt: new Date().toISOString(),
      }),
    ).not.toThrow();
  });
});
