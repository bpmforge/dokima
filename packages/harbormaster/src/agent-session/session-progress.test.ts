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
    // W21-16 changed the advice here on purpose: this session EARNED budget
    // and still parked, so telling the reader to raise the ceiling was wrong
    // in exactly the case it fired most. It still names maxToolIterations —
    // to say it will not help.
    expect(message).toContain('will not help');
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

describe('the park advice stops being wrong in its commonest case (W21-16)', () => {
  it('RED FIXTURE: a session that EARNED budget and still parked is not told to raise the budget', () => {
    const entries = [
      { kind: 'extended' as const, atIteration: 12, to: 16, signal: 'commit changed the worktree' },
    ];
    const text = budgetExhaustedStderr(16, entries);
    // The live park said exactly this while holding four unused iterations.
    expect(text).not.toContain('raise maxToolIterations — chatty');
    expect(text).toContain('will not help');
    expect(text).toContain('what it spent those turns on');
  });

  it('a session that never grew its budget IS told to raise it — that advice is right there', () => {
    const text = budgetExhaustedStderr(12, []);
    expect(text).toContain('raise maxToolIterations');
    expect(text).toContain('without a Completion Manifest');
  });
});

/**
 * W21-53. Run 34 hit the ceiling twice with extensions at every window
 * boundary — 16, 20, 24, 28, 32, 36, each "write changed the worktree" — and
 * was told raising maxToolIterations would not help. That is the failure
 * W17-01's header exists to prevent: honest work, cut off mid-stride.
 *
 * An earlier attempt reasoned from the EXTENSION ledger and had to be
 * reverted: extensions are only ever granted at the wall, so every extension
 * is a final-window extension by construction. The per-window progress signal
 * answers it; the extension list cannot.
 */
describe('cut off mid-stride is not the same as stalled (W21-53)', () => {
  const extended = (atIteration: number, to: number) => ({
    kind: 'extended' as const,
    atIteration,
    to,
    signal: 'write changed the worktree',
  });

  it('RED FIXTURE: run 34 — still writing in the final window, so the CEILING stopped it', () => {
    const text = budgetExhaustedStderr(
      40,
      [extended(32, 36), extended(36, 40)],
      'write changed the worktree',
    );
    expect(text).toContain('STILL MAKING PROGRESS');
    // W21-56 split this into its own sentence, so it capitalises.
    expect(text).toContain('Raising maxToolIterations is the right response');
    expect(text).not.toContain('will not help');
  });

  it('W21-16’s case is untouched: earned budget, then nothing in the final window', () => {
    const text = budgetExhaustedStderr(16, [extended(12, 16)], null);
    expect(text).toContain('will not help');
    expect(text).toContain('what it spent those turns on');
    expect(text).not.toContain('STILL MAKING PROGRESS');
  });

  it('a caller with no window signal falls back to W21-16’s wording — no silent change', () => {
    const text = budgetExhaustedStderr(16, [extended(12, 16)]);
    expect(text).toContain('will not help');
  });

  it('a session that never grew its budget is still told to raise it', () => {
    expect(budgetExhaustedStderr(12, [], 'write changed the worktree')).toContain(
      'raise maxToolIterations',
    );
  });

  it('the budget remembers its last completed window rather than discarding it', () => {
    const toolCall = (name: string, argsJson: string, resultText: string) => ({
      name,
      argsJson,
      resultText,
    });
    const budget = createSessionProgressBudget({ base: 4, ceiling: 12, windowSize: 2 });
    budget.noteIteration({ iteration: 1, toolCalls: [toolCall('write', '{}', 'ok')] });
    budget.noteIteration({ iteration: 2, toolCalls: [] });
    expect(budget.lastWindowProgress()).toBe('write changed the worktree');
    // A window with no mutation clears it — that is the "stalled" signal.
    budget.noteIteration({ iteration: 3, toolCalls: [toolCall('read', '{"p":"a"}', 'A')] });
    budget.noteIteration({ iteration: 4, toolCalls: [] });
    expect(budget.lastWindowProgress()).toBeNull();
  });
});

/**
 * W21-56. W21-53's new branch told the founder to raise maxToolIterations —
 * and MAX_TOOL_ITERATIONS_CEILING is a hardcoded 40, which run 34 and run 39
 * had both already reached. Advice that names a lever with nothing left in it
 * is worse than none, and I shipped it before checking the ceiling was
 * reachable.
 */
describe('advice must name a lever that still has room (W21-56)', () => {
  const extended = (atIteration: number, to: number) => ({
    kind: 'extended' as const,
    atIteration,
    to,
    signal: 'write changed the worktree',
  });

  it('RED FIXTURE: at the hard ceiling, it says SPLIT rather than raise', () => {
    const text = budgetExhaustedStderr(40, [extended(36, 40)], 'write changed the worktree', 40);
    expect(text).toContain('HARD CEILING');
    expect(text).toContain('splitting it is the move');
    expect(text).not.toContain('Raising maxToolIterations is the right response');
  });

  it('below the ceiling, raising it IS the right advice', () => {
    const text = budgetExhaustedStderr(20, [extended(16, 20)], 'write changed the worktree', 40);
    expect(text).toContain('Raising maxToolIterations is the right response');
    expect(text).not.toContain('HARD CEILING');
  });

  it('a caller that does not know the ceiling keeps the plain advice', () => {
    const text = budgetExhaustedStderr(40, [extended(36, 40)], 'write changed the worktree');
    expect(text).toContain('Raising maxToolIterations is the right response');
  });

  it('a stalled session is unaffected by the ceiling — it had budget it did not use', () => {
    const text = budgetExhaustedStderr(40, [extended(12, 16)], null, 40);
    expect(text).toContain('will not help');
    expect(text).not.toContain('HARD CEILING');
  });
});

/**
 * W21-61. W21-56 put the ceiling check INSIDE the extensions branch — and a
 * session that starts at the ceiling can never earn an extension, so the check
 * never ran for the exact case it was built for.
 *
 * Found live: I raised the vault project's maxToolIterations to 40, its hard
 * ceiling. Run 46's sessions used all 40 turns, earned zero extensions (no
 * headroom to grant), and were told "raise maxToolIterations".
 */
describe('starting AT the ceiling earns no extensions, and must still be told (W21-61)', () => {
  it('RED FIXTURE: run 46 — budget 40, ceiling 40, no extensions, do NOT say raise it', () => {
    const text = budgetExhaustedStderr(40, [], null, 40);
    expect(text).toContain('HARD CEILING');
    expect(text).not.toContain('raise maxToolIterations — chatty');
  });

  it('and it names the right next move: re-run first, split if commits stop', () => {
    const text = budgetExhaustedStderr(40, [], null, 40);
    expect(text).toContain('re-run it first');
    expect(text).toContain('worktree keeps whatever this session committed');
    expect(text).toContain('split it if successive runs stop adding commits');
  });

  it('below the ceiling with no extensions still says raise it — that advice is right there', () => {
    const text = budgetExhaustedStderr(12, [], null, 40);
    expect(text).toContain('raise maxToolIterations');
    expect(text).not.toContain('HARD CEILING');
  });

  it('a caller that does not know the ceiling is unchanged', () => {
    expect(budgetExhaustedStderr(40, [], null)).toContain('raise maxToolIterations');
  });
});
