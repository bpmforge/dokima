/**
 * Test-only handle factory for the playbook package. Same technique as
 * `../store/test-helpers.ts` (Node 22's builtin `node:sqlite`, schema
 * applied by reading migration files directly rather than going through
 * `@dokima/events`' migration runner) — extended to also apply
 * `010_playbook.sql`, since `consult.ts` needs both `facts` and `playbook`.
 * `migration.integration.test.ts`-style dynamic-import tests prove each
 * migration file also applies cleanly through the real runner.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type { SqliteHandle } from '../store/handle.js';

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'events',
  'migrations',
);

const MIGRATION_FILES = ['009_memory.sql', '010_playbook.sql'];

/** A fresh in-memory handle with the memory-service + playbook schema applied. */
export function createTestHandle(): SqliteHandle {
  const db = new DatabaseSync(':memory:');
  for (const file of MIGRATION_FILES) {
    db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db as unknown as SqliteHandle;
}
