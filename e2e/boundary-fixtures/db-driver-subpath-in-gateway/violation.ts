// Red fixture (W3-10, ARCHITECTURE.md §4 law 4): only packages/events opens the DB
// write path. A bare-specifier ban alone ('better-sqlite3') is bypassable via a real
// subpath ('better-sqlite3/lib/database.js', verified present in
// node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3/lib/database.js) —
// this must fail lint too. Verified failing via `pnpm lint:boundary-fixtures`.
import Database from 'better-sqlite3/lib/database.js';

export const violation = Database;
