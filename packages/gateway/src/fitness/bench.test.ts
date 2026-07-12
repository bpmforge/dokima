/**
 * The red-fixture proof for this gate (docs/TESTING.md §8, PLAYBOOK.md
 * "red fixtures are acceptance"): CI never talks to a real model, so what
 * proves the *harness* works is that a scripted "strong" fake passes and
 * a scripted "weak" fake fails, per role, against the real fixture set
 * under e2e/fitness-fixtures/ — not a synthetic task list.
 */

import { describe, expect, it } from 'vitest';
import { NoFixtureTasksError, runFitnessBench, verdictFor } from './bench.js';
import type { AgentRole, ModelClient } from './types.js';

const STRONG_RESPONSES: Record<string, string> = {
  'coding-agent':
    'function sumRange(a, b) { let total = 0; for (let i = a; i <= b; i++) total += i; return total; }',
  'code-reviewer':
    'Confirmed: FIT-DEFECT-1 is a real defect — the var declaration leaks past its block.',
  challenger:
    'That figure has no citation. Ask for the source dataset before it goes in the doc.',
};

const WEAK_RESPONSES: Record<string, string> = {
  'coding-agent':
    'function sumRange(a, b) { let total = 0; for (let i = a; i < b; i++) total += i; return total; }',
  'code-reviewer': 'Looks good to me, no issues found.',
  challenger: 'Sounds impressive — confirmed accurate, no need to verify further.',
};

function clientFor(role: AgentRole, responses: Record<string, string>): ModelClient {
  return {
    async respond() {
      return responses[role] ?? '';
    },
  };
}

describe('runFitnessBench (BLUEPRINT §12.1 harness proof)', () => {
  const roles: AgentRole[] = ['coding-agent', 'code-reviewer', 'challenger'];

  for (const role of roles) {
    it(`mints a 'fit' card for role '${role}' against a strong scripted fake`, async () => {
      const card = await runFitnessBench({
        model: 'strong-model',
        role,
        client: clientFor(role, STRONG_RESPONSES),
        now: () => '2026-07-12T00:00:00.000Z',
      });
      expect(card.verdict).toBe('fit');
      expect(card.model).toBe('strong-model');
      expect(card.role).toBe(role);
      expect(card.taskResults.every((r) => r.passed)).toBe(true);
      expect(card.taskResults.length).toBeGreaterThan(0);
    });

    it(`mints an 'unfit' card for role '${role}' against a weak scripted fake`, async () => {
      const card = await runFitnessBench({
        model: 'weak-model',
        role,
        client: clientFor(role, WEAK_RESPONSES),
        now: () => '2026-07-12T00:00:00.000Z',
      });
      expect(card.verdict).toBe('unfit');
      expect(card.taskResults.every((r) => !r.passed)).toBe(true);
    });
  }

  it('throws NoFixtureTasksError for a role with no fixture task and no override', async () => {
    await expect(
      runFitnessBench({
        model: 'any-model',
        role: 'test-engineer',
        client: clientFor('test-engineer', {}),
      }),
    ).rejects.toThrow(NoFixtureTasksError);
  });

  it('defaults harnessVersion and stamps runAt from the injected clock', async () => {
    const card = await runFitnessBench({
      model: 'strong-model',
      role: 'challenger',
      client: clientFor('challenger', STRONG_RESPONSES),
      now: () => '2026-01-01T00:00:00.000Z',
    });
    expect(card.harnessVersion).toBe('1.0.0');
    expect(card.runAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('verdictFor', () => {
  it('is fit when every result passed', () => {
    expect(
      verdictFor([
        { taskId: 'a', passed: true, reason: '' },
        { taskId: 'b', passed: true, reason: '' },
      ]),
    ).toBe('fit');
  });

  it('is unfit when every result failed', () => {
    expect(
      verdictFor([
        { taskId: 'a', passed: false, reason: '' },
        { taskId: 'b', passed: false, reason: '' },
      ]),
    ).toBe('unfit');
  });

  it('is marginal when results are mixed', () => {
    expect(
      verdictFor([
        { taskId: 'a', passed: true, reason: '' },
        { taskId: 'b', passed: false, reason: '' },
      ]),
    ).toBe('marginal');
  });

  it('throws on an empty result set rather than guessing a verdict', () => {
    expect(() => verdictFor([])).toThrow();
  });
});
