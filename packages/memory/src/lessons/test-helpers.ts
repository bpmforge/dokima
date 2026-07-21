/**
 * Test-only handle factory for the lessons package. Same technique as
 * `../playbook/test-helpers.ts` (Node 22's builtin `node:sqlite`, schema
 * applied by reading migration files directly rather than going through
 * `@shipwright/events`' migration runner) — `010_playbook.sql` is included
 * because `triage.ts` writes into the `playbook` table, and
 * `012_field_reports.sql`'s `resulting_playbook_entry_id` column references
 * it.
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

const MIGRATION_FILES = ['010_playbook.sql', '012_field_reports.sql'];

/** A fresh in-memory handle with the playbook + field-reports schema applied. */
export function createTestHandle(): SqliteHandle {
  const db = new DatabaseSync(':memory:');
  for (const file of MIGRATION_FILES) {
    db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db as unknown as SqliteHandle;
}
