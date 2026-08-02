/**
 * Local barrel for `code-index/**` (FR-M4). Not re-exported from
 * `packages/memory/src/index.ts` — that file, and `package.json`'s
 * dependency list, are outside this ticket's write_scope
 * (`packages/memory/src/code-index/**` only). A future ticket wires this
 * module into the package's public barrel + declares `@dokima/events`
 * as a real dependency before any other package can import it; see this
 * ticket's HANDOFF note in `plan.json`.
 */
export * from './chunker.js';
export * from './embeddings.js';
export * from './events.js';
export * from './indexer.js';
export * from './path-filter.js';
export * from './ripgrep.js';
export * from './search.js';
export * from './store.js';
export * from './tool.js';
