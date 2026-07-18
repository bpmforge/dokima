/**
 * Idempotency-Key replay store (API_DESIGN §1/§5): "Keys are stored with
 * the resulting event seq; replay returns the original response
 * (crash-safe clients + at-least-once CLI scripting)." Callers key entries
 * by whatever composite string disambiguates their route (e.g.
 * `${verb}:${ticketId}:${idempotencyKey}` in `server/board-routes.ts`) —
 * this store is a plain keyed cache, not opinionated about request shape.
 *
 * In-memory, per-process, bounded (oldest-first eviction) — matches every
 * other piece of server state in this codebase that isn't the event log
 * itself (WsHub's per-subscription replay buffer is the same pattern). A
 * restart drops in-flight replay history; callers whose clients need
 * crash-safety across a server restart already rely on `state.db`'s own
 * idempotent verb checks (ticket lifecycle transitions refuse an
 * already-applied verb on their own, per FR-T1) as the second line of
 * defense — this store only saves a duplicate mutation call the trip to
 * re-derive that refusal.
 */

export interface StoredIdempotentResponse {
  status: number;
  body: unknown;
  headers: Readonly<Record<string, string>>;
}

const DEFAULT_MAX_ENTRIES = 1000;

export class IdempotencyStore {
  private readonly entries = new Map<string, StoredIdempotentResponse>();
  private readonly maxEntries: number;

  constructor(opts: { maxEntries?: number } = {}) {
    this.maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): StoredIdempotentResponse | undefined {
    return this.entries.get(key);
  }

  put(key: string, response: StoredIdempotentResponse): void {
    if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) this.entries.delete(oldestKey);
    }
    this.entries.set(key, response);
  }
}

/** `Idempotency-Key` header, case-insensitive per HTTP (Fastify already lower-cases). */
export function extractIdempotencyKey(
  headers: Record<string, string | string[] | undefined>,
): string | undefined {
  const value = headers['idempotency-key'];
  if (typeof value === 'string' && value.length > 0) return value;
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].length > 0) {
    return value[0];
  }
  return undefined;
}
