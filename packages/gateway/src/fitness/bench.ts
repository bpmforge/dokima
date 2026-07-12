/**
 * Orchestrates the bench run for one (model, role): sends each fixed
 * oracle task's prompt to the supplied ModelClient, scores the response,
 * and mints the resulting FitnessCard (BLUEPRINT §12.1).
 */

import { loadFixtureTasksForRole } from './fixtures.js';
import { scoreTask } from './scoring.js';
import {
  FITNESS_HARNESS_VERSION,
  type AgentRole,
  type BenchTaskResult,
  type FitnessCard,
  type FitnessTask,
  type FitnessVerdict,
  type ModelClient,
} from './types.js';

export class NoFixtureTasksError extends Error {
  constructor(public readonly role: AgentRole) {
    super(`no fitness fixture tasks found for role '${role}'`);
    this.name = 'NoFixtureTasksError';
  }
}

export interface RunFitnessBenchOptions {
  readonly model: string;
  readonly role: AgentRole;
  readonly client: ModelClient;
  /** Defaults to every fixture task for `role` under e2e/fitness-fixtures/; override in tests to run a synthetic task set. */
  readonly tasks?: readonly FitnessTask[];
  readonly harnessVersion?: string;
  readonly now?: () => string;
}

/** fit = every task passed; unfit = every task failed; marginal = anything in between. */
export function verdictFor(results: readonly BenchTaskResult[]): FitnessVerdict {
  if (results.length === 0)
    throw new Error('cannot compute a verdict from zero task results');
  const passCount = results.filter((r) => r.passed).length;
  if (passCount === results.length) return 'fit';
  if (passCount === 0) return 'unfit';
  return 'marginal';
}

export async function runFitnessBench(
  options: RunFitnessBenchOptions,
): Promise<FitnessCard> {
  const tasks = options.tasks ?? loadFixtureTasksForRole(options.role);
  if (tasks.length === 0) throw new NoFixtureTasksError(options.role);

  const results: BenchTaskResult[] = [];
  for (const task of tasks) {
    const output = await options.client.respond(task.prompt);
    results.push(scoreTask(task, output));
  }

  const now = options.now ?? (() => new Date().toISOString());
  return {
    model: options.model,
    role: options.role,
    verdict: verdictFor(results),
    harnessVersion: options.harnessVersion ?? FITNESS_HARNESS_VERSION,
    taskResults: results,
    runAt: now(),
  };
}
