/**
 * Canonical contract shapes for the event log and identity model
 * (DATABASE.md §2, ARCHITECTURE.md §3, DECISIONS.md D-005). `packages/shared`
 * cannot depend on `packages/events` (only `events` touches the DB write
 * path — ARCHITECTURE §4 law 4), so this module is the boundary-object home
 * for the envelope and identity shapes; `packages/events` owns the runtime
 * (SQLite rows, hash chain, migrations) that produces values of this shape.
 */

import type { JsonValue } from '../config/settings.js';

export type IdentityKind = 'human' | 'machine';

export interface IdentityContract {
  id: string;
  name: string;
  kind: IdentityKind;
  authProvider: string | null;
  role: string | null;
  modelHint: string | null;
  createdAt: string;
}

export interface EventEnvelopeContract {
  seq: number;
  eventType: string;
  actorId: string;
  ticketId: string | null;
  runId: string | null;
  payload: JsonValue;
  createdAt: string;
  prevHash: string;
  hash: string;
}

export function isIdentityKind(value: unknown): value is IdentityKind {
  return value === 'human' || value === 'machine';
}
