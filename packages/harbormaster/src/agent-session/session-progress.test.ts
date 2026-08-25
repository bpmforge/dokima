/**
 * W17-01: the budget that earns itself — code-observed signals only, the
 * T-27 ceiling never moves, spinning stops before the cap.
 */
import { describe, expect, it } from 'vitest';
import {
  budgetExhaustedStderr,
  createSessionProgressBudget,
  earlyStopStderr,
  measuredTurnsMultiplier,
  REPEATED_CALL_LIMIT,
} from './session-progress.js';

const write = (path: string) => ({
  name: 'write',
  argsJson: JSON.stringify({ path }),
  resultText: `TOOL_RESULT x (write): {"written":"${path}"}`,
});
const read = (path: string) => ({
  name: 'read',
  argsJson: JSON.stringify({ path }),
  resultText: `TOOL_RESULT x (read): {"content":"..."}`,
});
const refusedWrite = (path: string) => ({
  name: 'write',
  argsJson: JSON.stringify({ path }),
  resultText: `TOOL_RESULT x (write): {"reason":"outside write scope"}`,
});

describe('createSessionProgressBudget (W17-01)', () => {
  it('a progressing session earns one window at the wall, repeatedly, up to the ceiling — and never past it', () => {
    const budget = createSessionProgressBudget({ base: 8, ceiling: 16, windowSize: 4 });
    expect(budget.budget()).toBe(8);
    for (let i = 1; i <= 8; i += 1) {
      budget.noteIteration({ iteration: i, toolCalls: [write(`f${i}.ts`)] });
    }
    // Extended at iteration 8 (the wall), not at 4 (still room).
    expect(budget.budget()).toBe(12);
    for (let i = 9; i <= 16; i += 1) {
      budget.noteIteration({ iteration: i, toolCalls: [write(`f${i}.ts`)] });
    }
    expect(budget.budget()).toBe(16);
    const extensions = budget.entries().filter((e) => e.kind === 'extended');
    expect(extensions.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...extensions.map((e) => (e as { to: number }).to))).toBe(16);
  });

  it('a window with only reads and refused writes earns NOTHING — the budget stays put', () => {
    const budget = createSessionProgressBudget({ base: 4, ceiling: 12, windowSize: 4 });
    for (let i = 1; i <= 4; i += 1) {
      budget.noteIteration({
        iteration: i,
        toolCalls: [read(`f${i}.ts`), refusedWrite('outside.ts')],
      });
    }
    expect(budget.budget()).toBe(4);
    expect(budget.entries()).toEqual([]);
  });

  it('a verify exit that improves counts as progress; one that stays bad does not', () => {
    const improving = createSessionProgressBudget({
      base: 4,
      ceiling: 12,
      windowSize: 4,
    });
    improving.noteIteration({ iteration: 1, toolCalls: [], verifyExit: 2 });
    improving.noteIteration({ iteration: 2, toolCalls: [], verifyExit: 1 });
    improving.noteIteration({ iteration: 3, toolCalls: [], verifyExit: 1 });
    improving.noteIteration({ iteration: 4, toolCalls: [], verifyExit: 1 });
    expect(improving.budget()).toBe(8);

    const flat = createSessionProgressBudget({ base: 4, ceiling: 12, windowSize: 4 });
    for (let i = 1; i <= 4; i += 1) {
      flat.noteIteration({ iteration: i, toolCalls: [], verifyExit: 2 });
    }
    expect(flat.budget()).toBe(4);
  });

  it(
    `RED FIXTURE: the same call repeated ${REPEATED_CALL_LIMIT}x with identical arguments stops the ` +
      'session EARLY with the no-progress reason — never billed to the numeric cap',
    () => {
      const budget = createSessionProgressBudget({
        base: 12,
        ceiling: 40,
        windowSize: 4,
      });
      for (let i = 1; i <= REPEATED_CALL_LIMIT; i += 1) {
        budget.noteIteration({ iteration: i, toolCalls: [read('same.ts')] });
      }
      const stop = budget.earlyStop();
      expect(stop).not.toBeNull();
      expect(stop!.reason).toMatch(/repeated 3 times/);
      expect(earlyStopStderr(3, stop!.reason)).toMatch(/stopped early at turn 3/);
    },
  );

  it('the same tool with DIFFERENT arguments is not spinning', () => {
    const budget = createSessionProgressBudget({ base: 12, ceiling: 40 });
    for (let i = 1; i <= 6; i += 1) {
      budget.noteIteration({ iteration: i, toolCalls: [read(`f${i}.ts`)] });
    }
    expect(budget.earlyStop()).toBeNull();
  });

  it('the exhausted message names the FINAL budget and the earned extensions', () => {
    const budget = createSessionProgressBudget({ base: 4, ceiling: 8, windowSize: 4 });
    for (let i = 1; i <= 4; i += 1) {
      budget.noteIteration({ iteration: i, toolCalls: [write(`f${i}.ts`)] });
    }
    const message = budgetExhaustedStderr(budget.budget(), budget.entries());
    expect(message).toContain('(8');
    expect(message).toMatch(/earned 1 extension/);
    expect(message).toContain('raise maxToolIterations');
  });
});

describe('measuredTurnsMultiplier (W17-03)', () => {
  const obs = (turns: number, completed = true) => ({ model: 'm', turns, completed });

  it('under 3 completed samples = 1, never a guess; budget stops never count as completed evidence', () => {
    expect(measuredTurnsMultiplier([obs(30), obs(28)], 12).multiplier).toBe(1);
    expect(
      measuredTurnsMultiplier([obs(40, false), obs(40, false), obs(40, false)], 12)
        .multiplier,
    ).toBe(1);
  });

  it('a model whose completed sessions really need ~2x the default earns ~2x, clamped [1, 2.5]', () => {
    const doubled = measuredTurnsMultiplier([obs(24), obs(22), obs(26)], 12);
    expect(doubled.multiplier).toBeCloseTo(2, 1);
    expect(doubled.samples).toBe(3);
    // A fast model never shrinks the base here — that is calibration's job.
    expect(measuredTurnsMultiplier([obs(3), obs(4), obs(5)], 12).multiplier).toBe(1);
    expect(measuredTurnsMultiplier([obs(99), obs(99), obs(99)], 12).multiplier).toBe(2.5);
  });
});

/**
 * W21-10 — found in live UAT, not in review. The agent finished the work,
 * committed it, and then spun on a question it already had the answer to.
 * These fixtures pin the exact observed sequence and the two conditions that
 * keep the cumulative check from firing on honest work.
 */
describe('zero-information repeats (W21-10)', () => {
  const call = (name: string, argsJson: string, resultText: string) => ({
    name,
    argsJson,
    resultText,
  });
  const LIST_ARGS = '{"path":"."}';
  const LIST_RESULT = '{"files":["package.json","tsconfig.json"]}';

  it('RED FIXTURE: the exact live sequence — list, list, verify, list — stops the session', () => {
    const budget = createSessionProgressBudget({ base: 12, ceiling: 16 });
    // #70 and #72 in the Vault run: identical args, identical result.
    budget.noteIteration({
      iteration: 1,
      toolCalls: [call('list', LIST_ARGS, LIST_RESULT)],
    });
    budget.noteIteration({
      iteration: 2,
      toolCalls: [call('list', LIST_ARGS, LIST_RESULT)],
    });
    // #74: one verify between them. This is what reset the consecutive
    // counter and let the real session escape the guard.
    budget.noteIteration({
      iteration: 3,
      toolCalls: [call('verify', '{}', '{"exit":1}')],
      verifyExit: 1,
    });
    expect(budget.earlyStop(), 'must not have stopped yet').toBeNull();
    // #76: the third identical list.
    budget.noteIteration({
      iteration: 4,
      toolCalls: [call('list', LIST_ARGS, LIST_RESULT)],
    });
    const stop = budget.earlyStop();
    expect(stop).not.toBeNull();
    expect(stop!.reason).toContain('list');
    expect(stop!.reason).toContain('identical result');
    // The park evidence must carry it, so the ticket explains itself.
    expect(budget.entries().some((e) => e.kind === 'stopped_early')).toBe(true);
  });

  it('a repeated call whose RESULT CHANGED is real work and never counts', () => {
    const budget = createSessionProgressBudget({ base: 12, ceiling: 16 });
    for (let i = 1; i <= 6; i += 1) {
      budget.noteIteration({
        iteration: i,
        // Same tool, same arguments — but the world moved underneath it.
        toolCalls: [call('list', LIST_ARGS, `{"files":["f${i}.ts"]}`)],
      });
    }
    expect(budget.earlyStop()).toBeNull();
  });

  it('the CUMULATIVE rule excludes mutations — a write revisited between other work is not a spin', () => {
    const budget = createSessionProgressBudget({ base: 12, ceiling: 16 });
    // Interleaved, so only the cumulative rule is in play. Three identical
    // writes in a row would still stop — that is the consecutive rule, and it
    // is right: rewriting the same bytes three times running changes nothing.
    for (let i = 1; i <= 6; i += 1) {
      budget.noteIteration({
        iteration: i,
        toolCalls: [
          i % 2 === 1
            ? call('write', '{"path":"a.ts"}', '{"ok":true}')
            : call('read', `{"p":"f${i}"}`, `body-${i}`),
        ],
      });
    }
    expect(budget.earlyStop()).toBeNull();
  });

  it('two different zero-information calls do not add up into one spin', () => {
    const budget = createSessionProgressBudget({ base: 12, ceiling: 16 });
    budget.noteIteration({ iteration: 1, toolCalls: [call('list', LIST_ARGS, LIST_RESULT)] });
    budget.noteIteration({ iteration: 2, toolCalls: [call('read', '{"p":"a"}', 'A')] });
    budget.noteIteration({ iteration: 3, toolCalls: [call('list', LIST_ARGS, LIST_RESULT)] });
    budget.noteIteration({ iteration: 4, toolCalls: [call('read', '{"p":"a"}', 'A')] });
    // Each has been seen twice; neither has reached the limit.
    expect(budget.earlyStop()).toBeNull();
  });
});
