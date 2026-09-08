/**
 * Evidence keys and invalidation (W23-08, AB-08).
 *
 * THE QUESTION THIS ANSWERS is "may I reuse what I already know?", and every
 * wrong answer to it is the same shape: a result that was true about a
 * different world is presented as true about this one. A scanner ran before
 * the repair; a synthesis read findings that have since been fixed; a
 * CONFIRMED verdict was given to code that has been rewritten twice.
 *
 * SO A KEY COVERS EVERYTHING THAT COULD CHANGE THE ANSWER: the source tree,
 * the exact command and arguments, the tool version, the rule set, the
 * configuration, and the digests of every predecessor result the node read. A
 * missing version or digest is not a wildcard — it makes the key
 * unreusable, because "we do not know which rules ran" and "the same rules
 * ran" are different facts (AB-08 step 4).
 *
 * WHOLE-TREE, DELIBERATELY (IMPLEMENTATION_PLAN §7). The source component is a
 * digest of the whole relevant tree rather than of the files a check "should"
 * depend on. Fine-grained affected-file caching means asking a cheap analysis
 * to infer a perfect dependency graph across arbitrary languages, and the
 * failure mode is silent: a check that skips because a file it secretly
 * depended on was not in its list. First release buys correctness with
 * re-runs.
 *
 * AND MODEL PROSE IS NEVER REUSABLE AS A SCANNER PASS. Only evidence the
 * runtime produced — a tool's own exit code and artifact — can be reused, and
 * only when the artifact is still there and still hashes to what was recorded.
 */

export interface EvidenceKeyParts {
  readonly checkId: string;
  /** Digest of the whole relevant source tree at the time this ran. */
  readonly sourceDigest: string;
  /** Digest of the exact executable + arguments. */
  readonly commandDigest: string;
  /** Null means unknown, which makes the key unreusable rather than wild. */
  readonly toolVersion: string | null;
  readonly ruleDigest: string | null;
  readonly configDigest: string | null;
  /** Digests of the predecessor results this node actually read, in dependency order. */
  readonly predecessorDigests: readonly string[];
}

/**
 * The key, as a single comparable string. Assembled rather than hashed so a
 * mismatch is READABLE: when a reuse decision is wrong, the reason is the
 * whole debugging story, and a sha256 of everything tells you only that
 * something differed.
 */
export function evidenceKeyOf(parts: EvidenceKeyParts): string {
  return [
    parts.checkId,
    `src=${parts.sourceDigest}`,
    `cmd=${parts.commandDigest}`,
    `tool=${parts.toolVersion ?? 'unknown'}`,
    `rules=${parts.ruleDigest ?? 'unknown'}`,
    `config=${parts.configDigest ?? 'unknown'}`,
    `pred=${parts.predecessorDigests.join(',') || 'none'}`,
  ].join(' ');
}

/** True when any component the key depends on is unknown — such a key can be recorded, never reused. */
export function keyIsComplete(parts: EvidenceKeyParts): boolean {
  return (
    parts.toolVersion !== null &&
    parts.ruleDigest !== null &&
    parts.configDigest !== null &&
    parts.sourceDigest.length > 0 &&
    parts.commandDigest.length > 0
  );
}

export interface StoredEvidence {
  readonly key: string;
  readonly parts: EvidenceKeyParts;
  /** Only a runtime-owned tool status may be reused. Model-originated evidence is marked and refused. */
  readonly origin: 'tool' | 'model';
  readonly status: 'passed' | 'findings' | 'error' | 'unavailable' | 'not_applicable';
  readonly artifactDigest: string | null;
}

export interface ReuseDecision {
  readonly reusable: boolean;
  readonly reason: string;
}

/**
 * Whether stored evidence may stand in for running the check again.
 *
 * Ordered so the refusals that are about TRUST come before the ones about
 * freshness: reusing a model's prose as a scanner result is a different kind
 * of mistake from reusing a stale scan, and the reason string should say which
 * happened.
 */
export function decideReuse(
  stored: StoredEvidence | undefined,
  current: EvidenceKeyParts,
  artifact: { readonly present: boolean; readonly digest: string | null },
): ReuseDecision {
  if (!stored) return { reusable: false, reason: 'no previous evidence for this check' };

  if (stored.origin !== 'tool') {
    return {
      reusable: false,
      reason:
        'the stored evidence came from a model, and model prose is never a scanner pass',
    };
  }

  if (stored.status !== 'passed' && stored.status !== 'findings') {
    return {
      reusable: false,
      reason: `the stored evidence is ${stored.status} — only a check that actually ran may be reused`,
    };
  }

  if (!keyIsComplete(current) || !keyIsComplete(stored.parts)) {
    return {
      reusable: false,
      reason:
        'the tool version, rule set or configuration is unknown, so nothing can be proven identical',
    };
  }

  const currentKey = evidenceKeyOf(current);
  if (stored.key !== currentKey) {
    return {
      reusable: false,
      reason: `the key changed: ${diffKeys(stored.key, currentKey)}`,
    };
  }

  if (!artifact.present) {
    return { reusable: false, reason: 'the recorded artifact is gone' };
  }
  if (stored.artifactDigest !== null && artifact.digest !== stored.artifactDigest) {
    return {
      reusable: false,
      reason: 'the artifact no longer hashes to what was recorded',
    };
  }

  return { reusable: true, reason: 'same key, artifact present and unchanged' };
}

/** Names the first differing component, so a reuse miss reads as a cause rather than a mood. */
function diffKeys(a: string, b: string): string {
  const left = a.split(' ');
  const right = b.split(' ');
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i] !== right[i])
      return `${left[i] ?? '(absent)'} -> ${right[i] ?? '(absent)'}`;
  }
  return 'unknown component';
}

export interface DependencyEdge {
  readonly id: string;
  readonly dependsOn: readonly string[];
}

/**
 * Every node that transitively depends on one of `changed` — what a retry must
 * throw away.
 *
 * TRANSITIVE, NOT ONE HOP. If the SAST tool re-runs, the specialist that reads
 * it is stale; so is the attack-chain synthesis that read the specialist; so is
 * the threat-model refresh that read the synthesis. Invalidating one hop leaves
 * a synthesis whose conclusions cite findings that no longer exist, which is
 * worse than no synthesis because it is specific.
 *
 * `changed` itself is NOT included: the caller is re-running those already, and
 * folding them in makes it impossible to distinguish "re-run because it failed"
 * from "re-run because something upstream moved".
 */
export function invalidatedDescendants(
  nodes: readonly DependencyEdge[],
  changed: Iterable<string>,
): ReadonlySet<string> {
  const dependents = new Map<string, string[]>();
  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      const list = dependents.get(dep) ?? [];
      list.push(node.id);
      dependents.set(dep, list);
    }
  }

  const invalid = new Set<string>();
  const queue = [...changed];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const dependent of dependents.get(current) ?? []) {
      if (invalid.has(dependent)) continue;
      invalid.add(dependent);
      queue.push(dependent);
    }
  }
  for (const id of changed) invalid.delete(id);
  return invalid;
}
