/**
 * Event-payload upcasting (DATABASE.md §8: "each `event_type` payload schema
 * carries a `v` field; readers upcast old versions... the log is never
 * rewritten"). No `event_type` in this codebase has shipped a second payload
 * version yet (grep-verified across every producer) — production upcasting
 * belongs in `packages/events`' own readers (out of this ticket's
 * write_scope) once a real schema bump happens. This proves the *mechanism*
 * against a synthetic fixture ahead of that.
 *
 * Each event type versions independently (DATABASE.md §8's wording, not one
 * global version): `registry[eventType]` is an ordered list of steps, where
 * `steps[i]` upcasts a version-`i+1` payload to version `i+2`. A payload with
 * no `v` field is assumed already current — true for every real payload
 * today, since no producer writes `v` at all yet.
 */

export type UpcastStep = (payload: Record<string, unknown>) => Record<string, unknown>;

export type UpcastRegistry = Record<string, UpcastStep[]>;

function currentVersionFor(eventType: string, registry: UpcastRegistry): number {
  return (registry[eventType]?.length ?? 0) + 1;
}

/** Applies registered steps in order until the payload reaches its type's current version. */
export function upcastPayload(
  eventType: string,
  payload: unknown,
  registry: UpcastRegistry = {},
): unknown {
  if (payload === null || typeof payload !== 'object') return payload;
  const steps = registry[eventType] ?? [];
  const current = currentVersionFor(eventType, registry);

  let value = payload as Record<string, unknown>;
  let version = typeof value.v === 'number' ? value.v : current;
  while (version < current) {
    const step = steps[version - 1];
    if (!step) break;
    value = step(value);
    version += 1;
  }
  return value;
}
