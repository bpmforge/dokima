import type Database from 'better-sqlite3';

export type IdentityKind = 'human' | 'machine';

export interface IdentityInput {
  id: string;
  name: string;
  kind: IdentityKind;
  authProvider?: string | null;
  role?: string | null;
  modelHint?: string | null;
}

export interface IdentityRecord {
  id: string;
  name: string;
  kind: IdentityKind;
  authProvider: string | null;
  role: string | null;
  modelHint: string | null;
  createdAt: string;
}

export interface EventInput {
  eventType: string;
  actorId: string;
  ticketId?: string | null;
  runId?: string | null;
  /** JSON-serializable; stored as TEXT (DATABASE.md §2). */
  payload: unknown;
}

export interface EventRecord {
  seq: number;
  eventType: string;
  actorId: string;
  ticketId: string | null;
  runId: string | null;
  payload: unknown;
  createdAt: string;
  prevHash: string;
  hash: string;
}

/** A single writable/readable connection to a project's `state.db` (C6). */
export interface EventLog {
  readonly db: Database.Database;
  readonly path: string;
  close(): void;
}
