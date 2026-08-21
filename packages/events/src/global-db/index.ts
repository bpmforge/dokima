/**
 * Barrel for the fleet-scope registry (DATABASE.md §7, D-013):
 * `~/.dokima/global.db`, same WAL/single-writer/migration discipline as
 * a project's `state.db`. Re-exported from `../index.ts` — `@dokima/*`
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

// W19-03: getProject/listProjects/setProjectArchived/touchProjectLastOpened
// deleted — the live fleet registry is apps/server's file-based one
// (api/projects/registry-store.ts); this parallel per-row registry had no
// caller. registerProject stays: the single-writer fixture exercises the
// schema through it.
export { registerProject } from './projects.js';
export type { ProjectRecord, RegisterProjectInput } from './projects.js';

// W19-03: getProvider/registerProvider deleted — same superseded-registry
// class; providers-store.ts (settings file) is the live provider source.
export { listProviders } from './providers.js';
export type { ProviderRecord, RegisterProviderInput } from './providers.js';
