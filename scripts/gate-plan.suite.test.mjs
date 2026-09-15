/**
 * W23-15. `gate-plan.test.mjs` is a `node:test` file (AB-15's focused
 * verification runs it with `node --test`), which vitest cannot execute. This
 * runs it as a child so it fails with `pnpm test` too — a check that only runs
 * when someone remembers the command is the exact decay L-46/L-47 name, and
 * this repo has been bitten by it twice.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('the node:test gate-plan suite runs inside the ordinary test run', () => {
  it('passes, and its output is carried here rather than summarised away', () => {
    const result = spawnSync('node', ['--test', 'scripts/gate-plan.test.mjs'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    expect(output).toMatch(/# fail 0/);
    expect(result.status, output.slice(-2000)).toBe(0);
  });
});
