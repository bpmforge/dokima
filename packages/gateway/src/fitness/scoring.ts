/**
 * Scores one model response against a FitnessTask's oracle (BLUEPRINT
 * §12.1: "small fixed tasks with known oracles"). Two oracle kinds:
 * keyword (review/challenge — text-reasoning tasks with no executable
 * check for "did it catch the planted issue") and function-behavior
 * (coding — TESTING.md §8's "bug with a failing test as oracle": the
 * response's function is actually invoked and its output compared).
 *
 * function-behavior uses node:vm, not new Function/eval, and — this is
 * the part that's easy to get wrong — the function *call* happens inside
 * the same timed vm.Script as the definition, not on a callable handed
 * back to the host and invoked afterward. Verified empirically 2026-07-12:
 * `script.runInContext(ctx, {timeout}).call(...)` does NOT bound the
 * later call (an infinite-loop candidate hangs the process), because the
 * timeout only covers the script's own synchronous evaluation. Wrapping
 * `(source)(...args)` as one script text is what actually gets bounded.
 * This still only needs to be safe against the deterministic scripted
 * fakes docs/TESTING.md §8 mandates for CI — scripts/fitness-live.mjs
 * (out of this ticket's scope, not run in CI) is where a real model's
 * code gets evaluated, and needs stronger isolation (separate process)
 * than an in-process vm context, which is not a real security sandbox.
 */

import vm from 'node:vm';
import type { BenchTaskResult, FitnessTask } from './types.js';

const FUNCTION_CALL_TIMEOUT_MS = 1000;

export function scoreTask(task: FitnessTask, output: string): BenchTaskResult {
  switch (task.oracle.kind) {
    case 'keyword':
      return scoreKeyword(task, output);
    case 'function-behavior':
      return scoreFunctionBehavior(task, output);
  }
}

function scoreKeyword(task: FitnessTask, output: string): BenchTaskResult {
  const oracle = task.oracle;
  if (oracle.kind !== 'keyword')
    throw new Error('scoreKeyword called with non-keyword oracle');
  const lower = output.toLowerCase();
  const missing = oracle.requireAll.filter((k) => !lower.includes(k.toLowerCase()));
  if (missing.length > 0) {
    return {
      taskId: task.id,
      passed: false,
      reason: `missing required signal(s): ${missing.join(', ')}`,
    };
  }
  const present = (oracle.forbidAny ?? []).filter((k) => lower.includes(k.toLowerCase()));
  if (present.length > 0) {
    return {
      taskId: task.id,
      passed: false,
      reason: `contains forbidden signal(s): ${present.join(', ')}`,
    };
  }
  return { taskId: task.id, passed: true, reason: 'all required signals present' };
}

/** Finds `function <name>(...) { ... }` in `output` via balanced-brace matching and returns the exact substring, or undefined if no balanced definition is found. */
export function extractFunctionSource(
  output: string,
  functionName: string,
): string | undefined {
  const marker = `function ${functionName}`;
  const start = output.indexOf(marker);
  if (start === -1) return undefined;
  const braceStart = output.indexOf('{', start);
  if (braceStart === -1) return undefined;
  let depth = 0;
  for (let i = braceStart; i < output.length; i++) {
    const char = output[i] as string;
    if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return output.slice(start, i + 1);
    }
  }
  return undefined;
}

function evaluateFunctionCase(functionSource: string, args: readonly unknown[]): unknown {
  const context = vm.createContext({ __fitnessArgs: args });
  const script = new vm.Script(`(${functionSource})(...__fitnessArgs)`);
  return script.runInContext(context, { timeout: FUNCTION_CALL_TIMEOUT_MS });
}

function scoreFunctionBehavior(task: FitnessTask, output: string): BenchTaskResult {
  const oracle = task.oracle;
  if (oracle.kind !== 'function-behavior') {
    throw new Error('scoreFunctionBehavior called with non-function-behavior oracle');
  }
  const source = extractFunctionSource(output, oracle.functionName);
  if (!source) {
    return {
      taskId: task.id,
      passed: false,
      reason: `no '${oracle.functionName}' function definition found in output`,
    };
  }
  for (let i = 0; i < oracle.cases.length; i++) {
    const testCase = oracle.cases[i]!;
    let actual: unknown;
    try {
      actual = evaluateFunctionCase(source, testCase.args);
    } catch (cause) {
      return {
        taskId: task.id,
        passed: false,
        reason: `case ${i} (${oracle.functionName}(${testCase.args.map((a) => JSON.stringify(a)).join(', ')})) threw: ${(cause as Error).message}`,
      };
    }
    if (JSON.stringify(actual) !== JSON.stringify(testCase.expected)) {
      return {
        taskId: task.id,
        passed: false,
        reason: `case ${i}: ${oracle.functionName}(${testCase.args.map((a) => JSON.stringify(a)).join(', ')}) = ${JSON.stringify(actual)}, expected ${JSON.stringify(testCase.expected)}`,
      };
    }
  }
  return {
    taskId: task.id,
    passed: true,
    reason: `all ${oracle.cases.length} case(s) passed`,
  };
}
