// Red fixture (W3-10, ARCHITECTURE.md §4 law 4): only packages/events opens the DB
// write path — packages/gateway may not import better-sqlite3. Verified failing via
// `pnpm lint:boundary-fixtures`.
import Database from 'better-sqlite3';

export const violation = Database;
