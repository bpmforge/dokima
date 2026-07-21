/**
 * Repo-map skeleton (BLUEPRINT §7.2 item 1). FR-M4 deliberately keeps "no
 * repo-map" out of the code index itself (R-J1: relevance packets + search
 * instead of a repo-map) — this is the Context Packer's own skeleton, built
 * from whatever set of indexed paths the caller supplies (typically every
 * path the W7-06 code index has chunks for), never a fresh filesystem walk
 * from this package.
 */

export interface RepoMapOptions {
  readonly maxEntries?: number;
}

const DEFAULT_MAX_ENTRIES = 200;

/** A deterministic, deduped, sorted skeleton — same input paths always render the same text (stable-prefix ordering). */
export function buildRepoMapSkeleton(
  paths: readonly string[],
  options: RepoMapOptions = {},
): string {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const sorted = [...new Set(paths)].sort((a, b) => a.localeCompare(b));
  const shown = sorted.slice(0, maxEntries);
  const lines = ['REPO MAP:', ...shown.map((p) => `  ${p}`)];
  if (sorted.length > shown.length) {
    lines.push(
      `  ...and ${sorted.length - shown.length} more paths (truncated for budget)`,
    );
  }
  return lines.join('\n');
}
