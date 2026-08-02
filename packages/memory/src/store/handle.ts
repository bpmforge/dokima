/**
 * Structural DB handle for the memory store (ARCHITECTURE.md §4 law 4: only
 * `packages/events` opens a writable connection; `packages/memory` never
 * imports `better-sqlite3` or `node:sqlite` in production code, and can't
 * import `@dokima/events` either — this ticket's write_scope has no
 * `package.json` to declare it under). Every function in this module
 * operates on an already-open handle the caller supplies. `better-sqlite3`'s
 * `Database` and Node's builtin `node:sqlite` `DatabaseSync` both satisfy
 * this shape (`.exec`/`.prepare().run/get/all` — verified directly against
 * both engines), so a real caller elsewhere in the codebase (e.g.
 * `@dokima/events`' `openEventLog(...).db`, the sanctioned single
 * writer) can hand either one in with zero adapter code.
 */

export interface SqliteRunResult {
  readonly changes: number;
  readonly lastInsertRowid: number | bigint;
}

export interface SqliteStatement<Row = unknown> {
  run(...params: readonly unknown[]): SqliteRunResult;
  get(...params: readonly unknown[]): Row | undefined;
  all(...params: readonly unknown[]): Row[];
}

export interface SqliteHandle {
  exec(sql: string): void;
  prepare<Row = unknown>(sql: string): SqliteStatement<Row>;
}
