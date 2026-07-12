/**
 * Loads the fixed oracle task set from e2e/fitness-fixtures/ (this
 * ticket's other write_scope root, sibling to packages/, not test/fitness/
 * as docs/TESTING.md §8 names it — same kind of doc-vs-plan.json path
 * deviation W2-01 documented for test/providers*; plan.json's write_scope
 * is what actually governs). Fixtures are plain JSON data files (no code,
 * matching the content/ "code never imports it as logic" ethos in
 * CLAUDE.md law 6) read at runtime via fs, not a TS import graph that
 * would reach outside packages/gateway's own tsconfig root.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { AgentRole } from '../routing/types.js';
import type { FitnessTask } from './types.js';

const FIXTURES_DIR = fileURLToPath(
  new URL('../../../../e2e/fitness-fixtures', import.meta.url),
);

export class FitnessFixtureError extends Error {
  constructor(
    public readonly file: string,
    cause: unknown,
  ) {
    super(
      `invalid fitness fixture '${file}': ${(cause as Error)?.message ?? String(cause)}`,
    );
    this.name = 'FitnessFixtureError';
  }
}

function parseFixture(file: string, raw: string): FitnessTask {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new FitnessFixtureError(file, cause);
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).id !== 'string' ||
    typeof (parsed as Record<string, unknown>).role !== 'string' ||
    typeof (parsed as Record<string, unknown>).prompt !== 'string' ||
    typeof (parsed as Record<string, unknown>).oracle !== 'object'
  ) {
    throw new FitnessFixtureError(
      file,
      new Error('missing required field(s): id, role, prompt, oracle'),
    );
  }
  return parsed as FitnessTask;
}

/** Reads every *.json fixture in e2e/fitness-fixtures/, sorted by filename for a deterministic bench order. */
export function loadFixtureTasks(dir: string = FIXTURES_DIR): FitnessTask[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  return files.map((f) => parseFixture(f, readFileSync(path.join(dir, f), 'utf8')));
}

export function loadFixtureTasksForRole(
  role: AgentRole,
  dir: string = FIXTURES_DIR,
): FitnessTask[] {
  return loadFixtureTasks(dir).filter((t) => t.role === role);
}
