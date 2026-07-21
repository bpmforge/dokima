/**
 * Minimal glob matcher for `code_search`'s `path_filter` (FR-M4). No new
 * dependency (micromatch/minimatch aren't in `packages/memory/package.json`
 * and this ticket's write_scope can't edit it) — supports the two globstar
 * primitives callers actually need: `*` (any run of characters except `/`)
 * and `**` (any run of characters including `/`).
 */

function globToRegExp(glob: string): RegExp {
  let pattern = '';
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === '*') {
      if (glob[i + 1] === '*') {
        pattern += '.*';
        i += 1;
        // `**/` also matches zero directories (e.g. `src/**/*.ts` must match
        // `src/store.ts`, not just `src/a/store.ts`) — absorb the slash so
        // `.*` alone spans the boundary instead of requiring a literal `/`.
        if (glob[i + 1] === '/') {
          i += 1;
        }
      } else {
        pattern += '[^/]*';
      }
    } else if ('.+^${}()|[]\\'.includes(char as string)) {
      pattern += `\\${char}`;
    } else {
      pattern += char;
    }
  }
  return new RegExp(`^${pattern}$`);
}

/**
 * `undefined`/empty filter matches everything. A filter with no glob
 * metacharacter is treated as a path prefix (the common "just this
 * directory" case), matching `docs/**`'s established alwaysOk-glob spirit
 * elsewhere in this repo's own tooling.
 */
export function matchesPathFilter(
  path: string,
  filter: string | undefined | null,
): boolean {
  if (!filter) {
    return true;
  }
  if (!filter.includes('*')) {
    return (
      path === filter || path.startsWith(filter.endsWith('/') ? filter : `${filter}/`)
    );
  }
  return globToRegExp(filter).test(path);
}
