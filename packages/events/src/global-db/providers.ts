import type { GlobalDb } from './db.js';

export interface ProviderRecord {
  readonly id: string;
  readonly kind: string;
  readonly baseUrl: string | null;
  readonly project: string | null;
  readonly location: string | null;
  readonly credentialRef: string | null;
  readonly status: string;
  readonly createdAt: string;
}

export interface RegisterProviderInput {
  readonly id: string;
  readonly kind: string;
  readonly baseUrl?: string | null;
  readonly project?: string | null;
  readonly location?: string | null;
  /** Keychain entry name (FR-S2, law #8) — never a literal secret. */
  readonly credentialRef?: string | null;
  readonly status: string;
}

interface ProviderRow {
  id: string;
  kind: string;
  base_url: string | null;
  project: string | null;
  location: string | null;
  credential_ref: string | null;
  status: string;
  created_at: string;
}

function rowToRecord(row: ProviderRow): ProviderRecord {
  return {
    id: row.id,
    kind: row.kind,
    baseUrl: row.base_url,
    project: row.project,
    location: row.location,
    credentialRef: row.credential_ref,
    status: row.status,
    createdAt: row.created_at,
  };
}

/** Registers a non-secret provider entry (FR-F3) — register once, use everywhere. */
export function registerProvider(
  global: GlobalDb,
  input: RegisterProviderInput,
  now: () => string = () => new Date().toISOString(),
): ProviderRecord {
  const createdAt = now();
  const baseUrl = input.baseUrl ?? null;
  const project = input.project ?? null;
  const location = input.location ?? null;
  const credentialRef = input.credentialRef ?? null;
  global.db
    .prepare(
      `INSERT INTO providers (id, kind, base_url, project, location, credential_ref, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.kind,
      baseUrl,
      project,
      location,
      credentialRef,
      input.status,
      createdAt,
    );
  return {
    id: input.id,
    kind: input.kind,
    baseUrl,
    project,
    location,
    credentialRef,
    status: input.status,
    createdAt,
  };
}

export function listProviders(global: GlobalDb): ProviderRecord[] {
  const rows = global.db
    .prepare<[], ProviderRow>('SELECT * FROM providers ORDER BY created_at')
    .all();
  return rows.map(rowToRecord);
}

export function getProvider(global: GlobalDb, id: string): ProviderRecord | undefined {
  const row = global.db
    .prepare<[string], ProviderRow>('SELECT * FROM providers WHERE id = ?')
    .get(id);
  return row ? rowToRecord(row) : undefined;
}
