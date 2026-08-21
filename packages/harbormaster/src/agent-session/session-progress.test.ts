/**
 * W17-01: the budget that earns itself — code-observed signals only, the
 * T-27 ceiling never moves, spinning stops before the cap.
 */
import { describe, expect, it } from 'vitest';
import {
  budgetExhaustedStderr,
  createSessionProgressBudget,
  earlyStopStderr,
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
