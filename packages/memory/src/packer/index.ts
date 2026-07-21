/**
 * Local barrel for `packer/**` (FR-L5/FR-L8/BLUEPRINT §7.2). Not
 * re-exported from `packages/memory/src/index.ts` — that file is outside
 * this ticket's write_scope (`packages/memory/src/packer/**` only), same
 * honest gap as `code-index`'s own local barrel. A future ticket wires this
 * module into the package's public barrel and into
 * `packages/loop/src/handoff.ts`'s HANDOFF assembly; see this ticket's
 * HANDOFF note in `plan.json`.
 */
export * from './budget.js';
export * from './core-block.js';
export * from './emergency.js';
export * from './errors.js';
export * from './pack.js';
export * from './prune.js';
export * from './redact.js';
export * from './relevance.js';
export * from './repo-map.js';
