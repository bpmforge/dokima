import { describe, expect, it } from 'vitest';
import { extractFunctionSource, scoreTask } from './scoring.js';
import type { FitnessTask } from './types.js';

function keywordTask(overrides: Partial<FitnessTask> = {}): FitnessTask {
  return {
    id: 'kw-task',
    role: 'challenger',
    description: 'd',
    prompt: 'p',
    oracle: {
      kind: 'keyword',
      requireAll: ['citation'],
      forbidAny: ['confirmed accurate'],
    },
    ...overrides,
  };
}

function functionTask(overrides: Partial<FitnessTask> = {}): FitnessTask {
  return {
    id: 'fn-task',
    role: 'coding-agent',
    description: 'd',
    prompt: 'p',
    oracle: {
      kind: 'function-behavior',
      functionName: 'sumRange',
      cases: [
        { args: [1, 5], expected: 15 },
        { args: [0, 0], expected: 0 },
      ],
    },
    ...overrides,
  };
}

describe('scoreTask — keyword oracle', () => {
  it('passes when every required signal is present and no forbidden signal is', () => {
    const result = scoreTask(
      keywordTask(),
      'This needs a citation before we can rely on it.',
    );
    expect(result).toEqual({
      taskId: 'kw-task',
      passed: true,
      reason: expect.any(String),
    });
  });

  it('fails when a required signal is missing', () => {
    const result = scoreTask(keywordTask(), 'Sounds plausible, ship it.');
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('citation');
  });

  it('fails when a forbidden signal is present even if required signals are too', () => {
    const result = scoreTask(
      keywordTask(),
      'No citation needed, confirmed accurate already.',
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('confirmed accurate');
  });

  it('matches case-insensitively', () => {
    const result = scoreTask(keywordTask(), 'We need a CITATION for this.');
    expect(result.passed).toBe(true);
  });
});

describe('extractFunctionSource', () => {
  it('extracts a balanced function definition by name', () => {
    const output =
      'Here is the fix:\n\nfunction sumRange(a, b) {\n  if (a) { return 1; }\n  return 0;\n}\n\nDone.';
    const extracted = extractFunctionSource(output, 'sumRange');
    expect(extracted).toBe(
      'function sumRange(a, b) {\n  if (a) { return 1; }\n  return 0;\n}',
    );
  });

  it('returns undefined when the function name is absent', () => {
    expect(extractFunctionSource('no function here', 'sumRange')).toBeUndefined();
  });

  it('returns undefined when braces never close', () => {
    expect(
      extractFunctionSource('function sumRange(a, b) { return a', 'sumRange'),
    ).toBeUndefined();
  });
});

describe('scoreTask — function-behavior oracle', () => {
  it('passes when every case matches', () => {
    const output =
      'function sumRange(a, b) { let t = 0; for (let i = a; i <= b; i++) t += i; return t; }';
    const result = scoreTask(functionTask(), output);
    expect(result).toEqual({
      taskId: 'fn-task',
      passed: true,
      reason: expect.any(String),
    });
  });

  it('fails when a case mismatches (the classic off-by-one)', () => {
    const output =
      'function sumRange(a, b) { let t = 0; for (let i = a; i < b; i++) t += i; return t; }';
    const result = scoreTask(functionTask(), output);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('case 0');
  });

  it('fails when the model returns no function at all', () => {
    const result = scoreTask(
      functionTask(),
      'I think the loop bound is wrong somewhere.',
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('no ');
  });

  it('fails, not throws, when the extracted source throws at call time', () => {
    const output = 'function sumRange(a, b) { throw new Error("boom"); }';
    const result = scoreTask(functionTask(), output);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('threw');
  });

  it('bounds an infinite loop in the returned function instead of hanging (the call happens inside the timed vm.Script)', () => {
    const output = 'function sumRange(a, b) { while (true) {} }';
    const start = Date.now();
    const result = scoreTask(functionTask(), output);
    expect(Date.now() - start).toBeLessThan(5000);
    expect(result.passed).toBe(false);
    expect(result.reason.toLowerCase()).toContain('timed out');
  }, 10000);
});
