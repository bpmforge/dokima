/**
 * Fleet registry + project cards (FR-F1/F2, DATABASE.md §7, UX_SPEC §2/§2b).
 *
 * DATABASE.md §7 specs the registry as `~/.dokima/global.db` (SQLite,
 * same engine/discipline as a project's `state.db`). `better-sqlite3` is
 * only reachable through `@dokima/events`'s own migration-managed
 * connection (`openEventLog`), which applies *that package's* per-project
 * schema (events/identities/receipts) — wrong shape for a directory index,
 * and `better-sqlite3` itself isn't a declared dependency of
 * `apps/server` (adding one means editing `apps/server/package.json`,
 * outside this ticket's write_scope). The registry is a JSON file instead,
 * `<DOKIMA_HOME>/fleet.json`, following the exact read/write shape
 * `@dokima/shared`'s `loadGlobalConfig`/`saveGlobalConfig` already use
 * for `config.json` in the same directory. Card *stats* are never cached
 * in the registry (DATABASE.md §7's "can't lie about a project it hasn't
 * opened") — every read opens the project's own `.dokima/state.db`
 * fresh via `openEventLogReader` (read-only, WAL-safe alongside a live
 * writer — never contends with the single-writer law, C6).
 *
 * Several card fields have no producer anywhere in the codebase yet
 * (grep-verified): running berths/heartbeats land with W3-04, the Decide
 * queue with W4-07, a persisted spend ledger with the gateway budget work,
 * and the project-level phase machine with W5-01. Faking those numbers
 * would violate local-first honesty (C-1) — they report zero/null until
 * their owning tickets land, never a plausible-looking guess.
 *
 * W10-48: this file was 433 lines, over the 400-line CODE_BOOK_PROTOCOL cap.
 * Types, registry file I/O, the registry verbs, stats, card assembly and the
 * routes now live in `projects/` chapters; this file is a re-export barrel.
 * It keeps this exact path because server.ts imports `./projects.js` by name
 * and ESM has no directory-index resolution.
 */

export type {
  ProjectMode,
  ProjectRecord,
  ProjectBoardStats,
  ProjectCard,
} from './projects/types.js';
export { ProjectDirectoryError, ProjectNotFoundError } from './projects/types.js';
export { computeFleetRegistryPath } from './projects/registry-store.js';
export {
  registerProject,
  archiveProject,
  removeProject,
  type RegisterProjectInput,
} from './projects/registry-verbs.js';
export { listProjectCards } from './projects/cards.js';
export { registerProjectRoutes, type ProjectRoutesOptions } from './projects/routes.js';
