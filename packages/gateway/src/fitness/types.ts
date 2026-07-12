/**
 * Model fitness bench types (BLUEPRINT §12.1, FR-G6): a planted-defect
 * harness that runs a model through fixed oracle tasks per role and mints
 * a fitness card. Reuses the role vocabulary from ../routing/types.js
 * (packages/gateway/src/escalation/ladder.ts already imports across this
 * same module boundary, so this is an established pattern, not a new
 * one) rather than redefining role strings in a second place.
 */

export type { AgentRole } from '../routing/types.js';
import type { AgentRole } from '../routing/types.js';

/** Bumped whenever the fixture task set or scoring semantics change meaningfully — a new version invalidates prior cards (docs/DATABASE.md's model_fitness PK includes harness_version). */
export const FITNESS_HARNESS_VERSION = '1.0.0';

export type FitnessVerdict = 'fit' | 'unfit' | 'marginal';

/** requireAll/forbidAny substrings are matched case-insensitively against the raw model response (review/challenge tasks are text-reasoning tasks — there is no executable oracle for "did it catch the planted issue"). */
export interface KeywordOracle {
  readonly kind: 'keyword';
  readonly requireAll: readonly string[];
  readonly forbidAny?: readonly string[];
}

/** The one task shape with a real executable oracle ("a bug with a failing test", TESTING.md §8): the model's response must contain a function definition whose behavior matches every case. */
export interface FunctionBehaviorOracle {
  readonly kind: 'function-behavior';
  readonly functionName: string;
  readonly cases: readonly {
    readonly args: readonly unknown[];
    readonly expected: unknown;
  }[];
}

export type TaskOracle = KeywordOracle | FunctionBehaviorOracle;

export interface FitnessTask {
  readonly id: string;
  readonly role: AgentRole;
  readonly description: string;
  readonly prompt: string;
  readonly oracle: TaskOracle;
}

export interface BenchTaskResult {
  readonly taskId: string;
  readonly passed: boolean;
  readonly reason: string;
}

/** Per (model, role) verdict, stored keyed by (model, role, harnessVersion) per docs/DATABASE.md §7. */
export interface FitnessCard {
  readonly model: string;
  readonly role: AgentRole;
  readonly verdict: FitnessVerdict;
  readonly harnessVersion: string;
  readonly taskResults: readonly BenchTaskResult[];
  readonly runAt: string;
}

/** The bench only needs a model that can answer a prompt with text — the real chat wiring (packages/gateway/src/providers) is a caller concern; CI supplies a scripted fake (docs/TESTING.md §8), never a live provider. */
export interface ModelClient {
  respond(prompt: string): Promise<string>;
}
