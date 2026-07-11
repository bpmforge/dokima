import type { EventLog, IdentityInput, IdentityRecord } from './types.js';

interface IdentityRow {
  id: string;
  name: string;
  kind: 'human' | 'machine';
  auth_provider: string | null;
  role: string | null;
  model_hint: string | null;
  created_at: string;
}

function rowToRecord(row: IdentityRow): IdentityRecord {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    authProvider: row.auth_provider,
    role: row.role,
    modelHint: row.model_hint,
    createdAt: row.created_at,
  };
}

export interface CreateIdentityOptions {
  now?: () => string;
}

export function createIdentity(
  log: EventLog,
  input: IdentityInput,
  opts: CreateIdentityOptions = {},
): IdentityRecord {
  const now = opts.now ?? (() => new Date().toISOString());
  const createdAt = now();
  const authProvider = input.authProvider ?? null;
  const role = input.role ?? null;
  const modelHint = input.modelHint ?? null;
  log.db
    .prepare(
      `INSERT INTO identities (id, name, kind, auth_provider, role, model_hint, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(input.id, input.name, input.kind, authProvider, role, modelHint, createdAt);
  return {
    id: input.id,
    name: input.name,
    kind: input.kind,
    authProvider,
    role,
    modelHint,
    createdAt,
  };
}

export function getIdentity(log: EventLog, id: string): IdentityRecord | undefined {
  const row = log.db
    .prepare<[string], IdentityRow>('SELECT * FROM identities WHERE id = ?')
    .get(id);
  return row ? rowToRecord(row) : undefined;
}
