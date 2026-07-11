import type { EventRecord } from './types.js';

/** A registered reducer (DATABASE.md §3): pure fold from the log to a state shape. */
export interface Projection<S> {
  readonly name: string;
  initial(): S;
  reduce(state: S, event: EventRecord): S;
}

/** Rebuild-from-zero: folds the full ordered log through a projection. */
export function rebuildProjection<S>(
  events: readonly EventRecord[],
  projection: Projection<S>,
): S {
  return events.reduce(
    (state, event) => projection.reduce(state, event),
    projection.initial(),
  );
}

/**
 * Holds live projection state, updated incrementally as events are
 * appended. `rebuild()` recomputes from a full log fetch and must always
 * equal the state reached by folding `apply()` over the same events in
 * order (property-tested in projection.property.test.ts).
 */
export class ProjectionRegistry {
  private readonly projections = new Map<string, Projection<unknown>>();
  private readonly state = new Map<string, unknown>();

  register<S>(projection: Projection<S>): void {
    this.projections.set(projection.name, projection as Projection<unknown>);
    this.state.set(projection.name, projection.initial());
  }

  apply(event: EventRecord): void {
    for (const [name, projection] of this.projections) {
      this.state.set(name, projection.reduce(this.state.get(name), event));
    }
  }

  rebuild(events: readonly EventRecord[]): void {
    for (const [name, projection] of this.projections) {
      this.state.set(name, rebuildProjection(events, projection));
    }
  }

  get<S>(name: string): S {
    return this.state.get(name) as S;
  }
}
