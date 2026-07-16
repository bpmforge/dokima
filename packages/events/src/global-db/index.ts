/**
 * Barrel for the fleet-scope registry (DATABASE.md §7, D-013):
 * `~/.shipwright/global.db`, same WAL/single-writer/migration discipline as
 * a project's `state.db`. Re-exported from `../index.ts` — `@shipwright/*`
 * packages export via their top-level `exports` map only (TECH_STACK.md),
 * so this is the only path consumers (e.g. packages/gateway) reach it
 * through.
 */

export { defaultGlobalDbPath, openGlobalDb, openGlobalDbReader } from './db.js';
export type { GlobalDb, OpenGlobalDbOptions } from './db.js';

export { promoteGlobalPlaybookEntry, listGlobalPlaybook } from './global-playbook.js';
export type {
  GlobalPlaybookRecord,
  PromoteGlobalPlaybookInput,
} from './global-playbook.js';

export { getModelFitness, listModelFitness, putModelFitness } from './model-fitness.js';
export type {
  ModelFitnessInput,
  ModelFitnessRecord,
  ModelFitnessVerdict,
} from './model-fitness.js';

export {
  getProject,
  listProjects,
  registerProject,
  setProjectArchived,
  touchProjectLastOpened,
} from './projects.js';
export type { ProjectRecord, RegisterProjectInput } from './projects.js';

export { getProvider, listProviders, registerProvider } from './providers.js';
export type { ProviderRecord, RegisterProviderInput } from './providers.js';
