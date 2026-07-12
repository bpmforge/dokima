/**
 * Barrel for the fitness module (BLUEPRINT §12.1, FR-G6). NOTE: not
 * re-exported from packages/gateway/src/index.ts — that file is out of
 * this ticket's write_scope (packages/gateway/src/fitness/**,
 * e2e/fitness-fixtures/** only), same gap every prior gateway ticket
 * (W2-01/02/04/05/06/07) left for its own module. Tests are co-located
 * `*.test.ts` per docs/TESTING.md §2.
 *
 * Two HANDOFFs for future tickets:
 * (1) guardFitAssignment (assignment.ts) is the mechanism "assigning an
 *     unfit pair warns + requires ack" — it is not yet called from
 *     routing/router.ts's route(), because packages/gateway/src/routing/**
 *     is outside this ticket's write_scope. A future routing ticket
 *     should call it (looking up the card via FitnessCardStore) the same
 *     way route() already calls guardMakerVerifierDistinct.
 * (2) FitnessCardStore (store.ts) is in-memory only; a future ticket
 *     owning the global (non-project) SQLite DB should back it with
 *     docs/DATABASE.md §7's model_fitness table (PK model/role/harness_version).
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
