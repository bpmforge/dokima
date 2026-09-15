/**
 * The bounded-group scheduler (W23-07, AB-07) — IMPLEMENTATION_PLAN §5's
 * algorithm, and nothing above it.
 *
 * IT KNOWS NOTHING ABOUT SECURITY, MODELS OR ROUTING. It takes nodes with
 * dependencies and an `execute` callback, because model routing lives in
 * `apps/server` and a package may never import an app. The security graph it
 * is pointed at is `@dokima/pipeline`'s `SECURITY_PLAN`, handed in by the
 * caller that owns both.
 *
 * THE FOUR RULES THAT MAKE CONCURRENCY SAFE HERE, each of which is a way this
 * goes wrong quietly if you skip it:
 *
 * 1. **A node is handed an immutable copy of its predecessors, never the live
 *    result map.** The serial executor could pass `{ ...cache }` and be right
 *    by accident, because nothing else was writing. With N workers in flight,
 *    handing out the shared map means a node's inputs change under it
 *    mid-execution and nobody can reproduce the result.
 * 2. **A failure stops its dependents, not the world.** Synthesis over partial
 *    evidence is worse than no synthesis, because it comes with a conclusion.
 *    Independent nodes finish — their evidence is real and worth collecting.
 * 3. **Stop schedules nothing new and awaits what started.** Returning while
 *    workers are still running leaves orphan promises writing into a run that
 *    has been declared over, which is how a "stopped" run keeps appending.
 * 4. **The source snapshot is checked at the end.** A run whose tree moved
 *    under it did not produce evidence about any one tree, and it says so
 *    rather than returning results that look complete.
 *
 * AND IT NEVER CONVERTS A FAILURE INTO AN EMPTY RESULT. `status` is explicit:
 * `complete`, `incomplete` or `failed`. An empty finding list from a scanner
 * that crashed and an empty finding list from a clean scan are the same JSON
 * and opposite facts.
 */

export interface SchedulableNode {
  readonly id: string;
  readonly dependsOn: readonly string[];
}

export type NodeOutcome = 'completed' | 'failed' | 'skipped' | 'not_started';

export interface NodeRecord {
  readonly nodeId: string;
  readonly outcome: NodeOutcome;
  readonly reason: string | null;
}

export type SchedulerEvent =
  | { readonly kind: 'node-started'; readonly nodeId: string }
  | { readonly kind: 'node-completed'; readonly nodeId: string }
  | { readonly kind: 'node-failed'; readonly nodeId: string; readonly reason: string };

export interface ScheduleOptions<T> {
  readonly nodes: readonly SchedulableNode[];
  /** Finite, and finite on purpose: an unbounded fan-out is not concurrency, it is a denial of service against your own laptop. */
  readonly workerLimit: number;
  /** Runs one node. Receives an immutable snapshot of its predecessors' results. */
  readonly execute: (
    node: SchedulableNode,
    predecessors: ReadonlyMap<string, T>,
  ) => Promise<T>;
  /**
   * A node that need not run and whose absence still satisfies its dependents
   * — a documented NOT_APPLICABLE. Only this may substitute for a result; an
   * UNRESOLVED node is required and must actually run.
   */
  readonly isSkippable?: (nodeId: string) => boolean;
  /** Emitted as work happens. The CALLER persists these, through its own single writer. */
  readonly onEvent?: (event: SchedulerEvent) => void;
  readonly stopRequested?: () => boolean;
  /** The tree this run is about. */
  readonly sourceDigest: string;
  /** Re-read at the end. A tree that moved means the evidence is about no single snapshot. */
  readonly currentSourceDigest?: () => string | Promise<string>;
}

export interface ScheduleResult<T> {
  readonly status: 'complete' | 'incomplete' | 'failed';
  /** Stable PLAN order, never completion order — a caller pairing results with nodes must not see a race. */
  readonly records: readonly NodeRecord[];
  readonly results: ReadonlyMap<string, T>;
  readonly reason: string | null;
}

/**
 * Runs the graph. Assumes the graph is already structurally valid — cycles,
 * dangling predecessors and shared outputs are `validateSecurityPlan`'s job,
 * and doing it twice in two places is how the two answers drift apart.
 */
export async function runCheckSchedule<T>(
  options: ScheduleOptions<T>,
): Promise<ScheduleResult<T>> {
  const byId = new Map(options.nodes.map((node) => [node.id, node]));
  const results = new Map<string, T>();
  const outcome = new Map<string, NodeOutcome>();
  const reasonFor = new Map<string, string>();
  const inFlight = new Set<Promise<void>>();
  /**
   * Nodes that have been HANDED to a worker. Distinct from `outcome`, which is
   * only set when a node settles — without this, a node still in flight has no
   * outcome, reads as ready on the next pass, and is started a second time.
   * Found by the worker-limit test, which saw ['a','b','b'].
   */
  const started = new Set<string>();

  let failed = false;
  let stopped = false;

  const isSkippable = options.isSkippable ?? (() => false);
  const satisfied = (id: string): boolean =>
    outcome.get(id) === 'completed' || outcome.get(id) === 'skipped';

  // Skips are decided up front so a dependent can be released immediately
  // rather than waiting for a node that will never run.
  for (const node of options.nodes) {
    if (isSkippable(node.id)) {
      outcome.set(node.id, 'skipped');
      reasonFor.set(node.id, 'not applicable for this project');
    }
  }

  const blocked = (node: SchedulableNode): boolean =>
    node.dependsOn.some((dep) => {
      const dependencyOutcome = outcome.get(dep);
      return dependencyOutcome === 'failed' || dependencyOutcome === 'not_started';
    });

  const ready = (): SchedulableNode[] =>
    options.nodes.filter(
      (node) =>
        !outcome.has(node.id) &&
        !started.has(node.id) &&
        !blocked(node) &&
        node.dependsOn.every(satisfied) &&
        byId.has(node.id),
    );

  const start = (node: SchedulableNode): void => {
    // THE COPY IS THE POINT (rule 1). A new Map per node, holding only that
    // node's declared predecessors — not the live map, and not every result
    // that happens to exist by now.
    const predecessors = new Map<string, T>();
    for (const dep of node.dependsOn) {
      const value = results.get(dep);
      if (value !== undefined) predecessors.set(dep, value);
    }

    started.add(node.id);
    options.onEvent?.({ kind: 'node-started', nodeId: node.id });
    const promise = options
      .execute(node, predecessors)
      .then((value) => {
        results.set(node.id, value);
        outcome.set(node.id, 'completed');
        options.onEvent?.({ kind: 'node-completed', nodeId: node.id });
      })
      .catch((err: unknown) => {
        const reason = err instanceof Error ? err.message : String(err);
        outcome.set(node.id, 'failed');
        reasonFor.set(node.id, reason);
        failed = true;
        options.onEvent?.({ kind: 'node-failed', nodeId: node.id, reason });
      })
      .finally(() => {
        // Released in `finally` so a throw cannot leak a worker slot — the
        // same discipline the plan asks for and the pool already keeps.
        inFlight.delete(promise);
      });
    inFlight.add(promise);
  };

  // The loop: fill to the worker limit, then wait for the FIRST completion
  // rather than for all of them, so a fast node's dependents start while a
  // slow sibling is still running.
  for (;;) {
    if (options.stopRequested?.() === true) stopped = true;

    if (!stopped) {
      for (const node of ready()) {
        if (inFlight.size >= options.workerLimit) break;
        start(node);
      }
    }

    if (inFlight.size === 0) break;
    await Promise.race(inFlight);
  }

  // Rule 3: everything that started has now settled — `Promise.race` above
  // only returns when one finishes, and the loop exits only on an empty set.

  for (const node of options.nodes) {
    if (!outcome.has(node.id)) {
      outcome.set(node.id, 'not_started');
      reasonFor.set(
        node.id,
        stopped
          ? 'the run was stopped before this node started'
          : 'a predecessor did not produce a result',
      );
    }
  }

  let status: ScheduleResult<T>['status'] = failed
    ? 'failed'
    : stopped || options.nodes.some((n) => outcome.get(n.id) === 'not_started')
      ? 'incomplete'
      : 'complete';
  let reason: string | null = failed
    ? `${[...outcome].filter(([, o]) => o === 'failed').length} node(s) failed`
    : stopped
      ? 'stopped before every node ran'
      : status === 'incomplete'
        ? 'at least one node never started'
        : null;

  // Rule 4, and it can only DEGRADE the answer: a moved tree never turns a
  // failure into a success.
  const current = await options.currentSourceDigest?.();
  if (current !== undefined && current !== options.sourceDigest) {
    status = status === 'failed' ? 'failed' : 'incomplete';
    reason =
      'the source changed while the checks were running, so these results are ' +
      'not about any one snapshot';
  }

  return {
    status,
    records: options.nodes.map((node) => ({
      nodeId: node.id,
      outcome: outcome.get(node.id) ?? 'not_started',
      reason: reasonFor.get(node.id) ?? null,
    })),
    results,
    reason,
  };
}
