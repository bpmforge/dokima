/**
 * Minimal YAML-frontmatter parser for `content/experts/**\/*.md`
 * (docs/design/CONTRACTS.md's contract: "markdown + minimal frontmatter
 * (`description`, `mode: primary|subagent|all`, optional `disable`, optional
 * `metadata`)"). `content/` files are hand-authored data, not a place any
 * of this repo's packages already carry a YAML dependency for — adding
 * `js-yaml` means editing `apps/server/package.json`, outside this ticket's
 * write_scope (same class of constraint `matrix.ts`/`session-scope.ts`
 * document for their own local reimplementations). The frontmatter
 * vocabulary actually in use (verified against all 88 files under
 * `content/experts/`) is flat `key: value` pairs plus one level of nesting
 * (`metadata:` / `  type: ...`) — no block scalars, no lists — so a full
 * YAML parser would be solving a problem this content doesn't have.
 */

export type FrontmatterValue = string | boolean | Record<string, string | boolean>;
export type Frontmatter = Record<string, FrontmatterValue>;

export interface ParsedMarkdown {
  readonly frontmatter: Frontmatter;
  readonly body: string;
}

const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/;
const NESTED_KEY_LINE = /^[ \t]{2,}([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/;

/** Un-escapes YAML single-quoted (`''` -> `'`) and double-quoted (`\"` -> `"`, `\\` -> `\`) scalars; bare scalars pass through trimmed. */
function parseScalar(raw: string): string | boolean {
  const trimmed = raw.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return trimmed;
}

/**
 * Splits a file into its leading `---`-delimited frontmatter block and the
 * remaining body. Files without a frontmatter block (or whose first line
 * isn't exactly `---`) parse to an empty frontmatter and the full text as
 * body — the caller decides whether that's acceptable for its use.
 */
export function parseMarkdown(raw: string): ParsedMarkdown {
  const lines = raw.split('\n').map((line) => line.replace(/\r$/, ''));
  if (lines[0]?.trim() !== '---') {
    return { frontmatter: {}, body: raw };
  }
  const closeIndex = lines.slice(1).findIndex((line) => line.trim() === '---');
  if (closeIndex === -1) {
    return { frontmatter: {}, body: raw };
  }
  const frontmatterLines = lines.slice(1, closeIndex + 1);
  const bodyLines = lines.slice(closeIndex + 2);

  const frontmatter: Frontmatter = {};
  for (let i = 0; i < frontmatterLines.length; i += 1) {
    const line = frontmatterLines[i]!;
    const match = KEY_LINE.exec(line);
    if (!match) continue;
    const [, key, rest] = match;
    if (rest !== '' && rest !== undefined) {
      frontmatter[key!] = parseScalar(rest);
      continue;
    }
    // Empty rest: either a nested block follows, or the key is genuinely
    // empty — only consume following lines that are actually indented.
    const nested: Record<string, string | boolean> = {};
    while (i + 1 < frontmatterLines.length) {
      const nestedMatch = NESTED_KEY_LINE.exec(frontmatterLines[i + 1]!);
      if (!nestedMatch) break;
      i += 1;
      nested[nestedMatch[1]!] = parseScalar(nestedMatch[2] ?? '');
    }
    frontmatter[key!] = Object.keys(nested).length > 0 ? nested : '';
  }

  return { frontmatter, body: bodyLines.join('\n') };
}
