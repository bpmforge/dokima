/**
 * Forge adapter parity validator (docs/design/CONTRACTS.md §2 Proof: "one
 * contract suite runs against GitHub + Gitea fixtures; parity validator red
 * on induced divergence").
 *
 * Two adapters fed semantically-equivalent (not byte-identical — different
 * base URLs, different fixture repos) inputs must still return the same
 * *shape* for every `ForgeAdapter` operation: same key set, same nesting.
 * A chapter that silently drops, renames, or nests a contract field
 * differently than its sibling adapter is caught here rather than only
 * failing downstream, far from its source. This does not (and cannot)
 * assert value equality — adapter-specific values (URLs, titles, SHAs) are
 * expected to differ; only structure is compared.
 */
import type { ForgeAdapter, RepoRef } from './types.js';

export interface ParityDifference {
  operation: string;
  onlyInA: string[];
  onlyInB: string[];
}

export interface ParityResult {
  diverged: boolean;
  differences: ParityDifference[];
}

function keyPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) {
    return value.length === 0 ? [] : keyPaths(value[0], `${prefix}[]`);
  }
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    const childPaths = keyPaths(nested, path);
    return [path, ...childPaths];
  });
}

function diffShape(operation: string, a: unknown, b: unknown): ParityDifference | null {
  const keysA = keyPaths(a).sort();
  const keysB = keyPaths(b).sort();
  const onlyInA = keysA.filter((k) => !keysB.includes(k));
  const onlyInB = keysB.filter((k) => !keysA.includes(k));
  if (onlyInA.length === 0 && onlyInB.length === 0) return null;
  return { operation, onlyInA, onlyInB };
}

/** The slice of `ForgeAdapter` the parity check actually exercises. */
export type ParityCheckedAdapter = Pick<ForgeAdapter, 'capabilities' | 'getRepo'>;

/**
 * Runs the same read-only `ForgeAdapter` operations against two adapters
 * already primed (via each adapter's own fixtures) with equivalent — not
 * identical — data, and flags any operation whose result shape diverged.
 */
export async function checkForgeAdapterParity(
  a: ParityCheckedAdapter,
  b: ParityCheckedAdapter,
  ref: RepoRef,
): Promise<ParityResult> {
  const differences: ParityDifference[] = [];

  const capDiff = diffShape('capabilities', a.capabilities(), b.capabilities());
  if (capDiff) differences.push(capDiff);

  const [repoA, repoB] = await Promise.all([a.getRepo(ref), b.getRepo(ref)]);
  const repoDiff = diffShape('getRepo', repoA, repoB);
  if (repoDiff) differences.push(repoDiff);

  return { diverged: differences.length > 0, differences };
}
