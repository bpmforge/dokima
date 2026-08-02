/**
 * Test-only handle factory. Uses Node 22's builtin `node:sqlite`
 * (`DatabaseSync`) — no `package.json` dependency edit needed, unlike a real
 * npm package (see `handle.ts`'s header). Applies `009_memory.sql` directly
 * by reading it off disk, rather than going through `@dokima/events`'
 * migration runner (that would need a static import of a package this
 * ticket's write_scope can't declare a dependency on) — the migration file
 * itself is proven to apply cleanly through the real runner in
 * `migration.integration.test.ts`, which dynamically imports
 * `@dokima/events` by absolute `file://` URL instead.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type { SqliteHandle } from './handle.js';

const MIGRATION_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'events',
  'migrations',
  '009_memory.sql',
);

/** A fresh in-memory handle with the memory-service schema applied. */
export function createTestHandle(): SqliteHandle {
  const db = new DatabaseSync(':memory:');
  const sql = readFileSync(MIGRATION_PATH, 'utf8');
  db.exec(sql);
  return db as unknown as SqliteHandle;
}
