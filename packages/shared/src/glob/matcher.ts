const REGEXP_SPECIAL = new Set([
  '.',
  '+',
  '^',
  '$',
  '{',
  '}',
  '(',
  ')',
  '|',
  '[',
  ']',
  '\\',
]);

/**
 * Minimal glob matcher for write_scope patterns: `*` (single segment),
 * `**` (any number of segments, including zero). No brace/extglob support —
 * write_scope globs are a closed, reviewed vocabulary (plan.json), not user input.
 *
 * Canonical dialect implementation (G-20): git, loop, and tickets all import
 * this instead of hand-rolling their own copy — a previously silent-divergence
 * hazard on security-sensitive scope logic.
 */
export function globToRegExp(pattern: string): RegExp {
  let source = '^';
  let i = 0;
  while (i < pattern.length) {
    const char = pattern[i];
    if (
      char === '/' &&
      pattern[i + 1] === '*' &&
      pattern[i + 2] === '*' &&
      i + 3 === pattern.length
    ) {
      // Trailing `/**` also matches the bare prefix (zero extra segments) —
      // consistent with a mid-pattern `**/` (branch below), which already
      // treats `**` as zero-or-more segments via an optional group.
      source += '(?:/.*)?';
      i = pattern.length;
    } else if (char === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          source += '(?:.*/)?';
          i += 3;
        } else {
          source += '.*';
          i += 2;
        }
      } else {
        source += '[^/]*';
        i += 1;
      }
    } else if (char === '?') {
      source += '[^/]';
      i += 1;
    } else if (char !== undefined && REGEXP_SPECIAL.has(char)) {
      source += `\\${char}`;
      i += 1;
    } else {
      source += char;
      i += 1;
    }
  }
  source += '$';
  return new RegExp(source);
}

export function matchesGlob(relPath: string, pattern: string): boolean {
  return globToRegExp(pattern).test(relPath);
}

export function matchesAnyGlob(relPath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesGlob(relPath, pattern));
}
