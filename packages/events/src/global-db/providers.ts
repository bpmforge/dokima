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


export function listProviders(global: GlobalDb): ProviderRecord[] {
  const rows = global.db
    .prepare<[], ProviderRow>('SELECT * FROM providers ORDER BY created_at')
    .all();
  return rows.map(rowToRecord);
}

