/**
 * Barrel for the fitness module (BLUEPRINT §12.1, FR-G6). NOTE: not
 * re-exported from packages/gateway/src/index.ts — that file is out of
 * this ticket's write_scope (packages/gateway/src/fitness/**,
 * e2e/fitness-fixtures/** only), same gap every prior gateway ticket
 * (W2-01/02/04/05/06/07) left for its own module. Tests are co-located
 * `*.test.ts` per docs/TESTING.md §2.
 *
 * W4-09 closed both HANDOFFs W2-08 left open here: (1) guardFitAssignment
 * is now called unconditionally inside routing/router.ts's route() (a
 * required `fitnessStore` field on RouteRequest, same structural-guard
 * shape as guardMakerVerifierDistinct); (2) FitnessCardStore (store.ts) is
 * backed by docs/DATABASE.md §7's model_fitness table
 * (`@shipwright/events`'s global-db module) when constructed with a
 * `GlobalDb` handle — falls back to in-memory when constructed with none.
 */

export { FITNESS_HARNESS_VERSION } from './types.js';
export type {
  AgentRole,
  BenchTaskResult,
  FitnessCard,
  FitnessTask,
  FitnessVerdict,
  FunctionBehaviorOracle,
  KeywordOracle,
  ModelClient,
  TaskOracle,
} from './types.js';

export {
  FitnessFixtureError,
  loadFixtureTasks,
  loadFixtureTasksForRole,
} from './fixtures.js';

export { extractFunctionSource, scoreTask } from './scoring.js';

export { NoFixtureTasksError, runFitnessBench, verdictFor } from './bench.js';
export type { RunFitnessBenchOptions } from './bench.js';

export { FitnessCardStore } from './store.js';

export { createInMemoryFitnessEventSink, noopFitnessEventSink } from './events.js';
export type { FitnessAckEvent, FitnessEventSink } from './events.js';

export { UnfitAssignmentRefusedError, guardFitAssignment } from './assignment.js';
export type { GuardFitAssignmentInput, GuardFitAssignmentResult } from './assignment.js';
