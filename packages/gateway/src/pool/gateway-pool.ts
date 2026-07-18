/**
 * Process-wide per-endpoint request pool (FR-F3, ARCHITECTURE §6, D-013):
 * "one core process serves N registered projects" and the Model Gateway is
 * a single process-wide pool — every project's calls to the same endpoint
 * share one `FairScheduler`, so a burst from one project's autorun cannot
 * starve another's request stream at that endpoint (FR-G1's
 * one-at-a-time-by-default local endpoint behavior still holds; it is now
 * shared fairly across the whole process, not just within a project).
 *
 * "Process-wide" here means "one `GatewayPool` instance, constructed once
 * by the composition root and shared by every project's gateway calls" —
 * this module provides the class; wiring a shared instance into
 * `apps/server` is outside this ticket's write_scope
 * (`packages/gateway/src/pool/**`), same drop-in-unit posture left by prior
 * gateway/harbormaster tickets (see `pool/index.ts`).
 */

import { FairScheduler } from './fair-scheduler.js';

export interface GatewayPoolOptions {
  /** Concurrency for an endpoint with no entry in `endpointConcurrency`. Defaults to 1 (FR-G1: local endpoints serve one request at a time). */
  readonly defaultConcurrency?: number;
  /** Per-endpoint concurrency overrides, keyed by endpoint id. */
  readonly endpointConcurrency?: Readonly<Record<string, number>>;
}

export class GatewayPool {
  private readonly schedulers = new Map<string, FairScheduler>();
  private readonly defaultConcurrency: number;
  private readonly endpointConcurrency: Readonly<Record<string, number>>;

  constructor(options: GatewayPoolOptions = {}) {
    this.defaultConcurrency = options.defaultConcurrency ?? 1;
    this.endpointConcurrency = options.endpointConcurrency ?? {};
  }

  /** Runs `task` through the given endpoint's process-wide queue, fair across `projectId`s (FR-F3). */
  run<T>(endpointId: string, projectId: string, task: () => Promise<T>): Promise<T> {
    return this.schedulerFor(endpointId).run(projectId, task);
  }

  activeCount(endpointId: string): number {
    return this.schedulers.get(endpointId)?.activeCount ?? 0;
  }

  queuedCount(endpointId: string): number {
    return this.schedulers.get(endpointId)?.queuedCount ?? 0;
  }

  private schedulerFor(endpointId: string): FairScheduler {
    let scheduler = this.schedulers.get(endpointId);
    if (!scheduler) {
      const concurrency = this.endpointConcurrency[endpointId] ?? this.defaultConcurrency;
      scheduler = new FairScheduler(concurrency);
      this.schedulers.set(endpointId, scheduler);
    }
    return scheduler;
  }
}
