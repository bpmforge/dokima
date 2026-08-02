/**
 * Global berth governor (FR-F3, ARCHITECTURE §6, D-013): a process-wide cap
 * on the *summed* active berths across every registered project. Each
 * project already has its own 1–N berths dial
 * (`packages/harbormaster/src/berths-dial.ts`, W3-04) — that dial decides
 * how many berths a single project is willing to run; this governor decides
 * how many berths the whole process is willing to run at once, across every
 * project, so a project's local dial can never push the machine (or a
 * shared host) past what the operator globally allows. Per-project dials
 * "allocate within the cap": a project may run up to its own dial's value,
 * but the governor's `FairScheduler` never admits more than N total,
 * fairly, across whichever projects are currently asking.
 *
 * The cap is a three-scope setting (`run > project > global`, FR-S1,
 * D-012) resolved the same way `berths-dial.ts` resolves the per-project
 * berths dial — a flat number per scope, highest-precedence defined value
 * wins outright (no merging). `packages/gateway` has no workspace
 * dependency on `@dokima/shared` within this ticket's write_scope
 * (`packages/gateway/src/pool/**`; the package's own `package.json` is out
 * of scope, so the dependency can't be declared) — same constraint W2-05's
 * routing module hit, so the precedence algorithm is reimplemented locally
 * here rather than imported.
 */

import { FairScheduler } from './fair-scheduler.js';

export type GovernorScope = 'run' | 'project' | 'global';

/** run > project > global (FR-S1). */
export const GOVERNOR_SCOPE_PRECEDENCE: readonly GovernorScope[] = [
  'run',
  'project',
  'global',
];

/** The global berth cap across the three settings scopes; an unset scope has no opinion. */
export interface ThreeScopeGovernorCap {
  readonly global?: number;
  readonly project?: number;
  readonly run?: number;
}

export interface ResolvedGovernorCap {
  readonly cap: number;
  /** The scope whose value won, or undefined when no scope set a cap (ungoverned). */
  readonly scope: GovernorScope | undefined;
}

/**
 * Resolves the effective global cap from the three scopes. Absent any
 * configured value, the governor is ungoverned (Infinity, i.e. it defers
 * entirely to each project's own per-project berths dial) — the operator
 * opts into a process-wide ceiling explicitly rather than one being
 * silently imposed.
 */
export function resolveGovernorCap(
  setting: ThreeScopeGovernorCap = {},
): ResolvedGovernorCap {
  for (const scope of GOVERNOR_SCOPE_PRECEDENCE) {
    const value = setting[scope];
    if (typeof value === 'number') {
      return { cap: Math.max(1, Math.trunc(value)), scope };
    }
  }
  return { cap: Number.POSITIVE_INFINITY, scope: undefined };
}

/**
 * Caps summed active berths across every project at the resolved cap,
 * fairly admitting whichever project is next in the round-robin when a
 * berth frees up (same `FairScheduler` primitive as the per-endpoint pool —
 * a berth slot and a request slot are the same shape of shared resource).
 */
export class GlobalBerthGovernor {
  private readonly scheduler: FairScheduler;

  constructor(setting: ThreeScopeGovernorCap = {}) {
    this.scheduler = new FairScheduler(resolveGovernorCap(setting).cap);
  }

  get cap(): number {
    return this.scheduler.capacity;
  }

  get activeCount(): number {
    return this.scheduler.activeCount;
  }

  queuedCountForProject(projectId: string): number {
    return this.scheduler.queuedCountFor(projectId);
  }

  /** Runs one berth's ticket work under the global cap, admitted fairly by `projectId`. */
  runBerth<T>(projectId: string, task: () => Promise<T>): Promise<T> {
    return this.scheduler.run(projectId, task);
  }
}
