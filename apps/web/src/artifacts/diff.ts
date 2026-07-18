/**
 * Line-based diff (Myers-style LCS), dependency-free. UX_SPEC §5 names
 * "CodeMirror merge view" for this; `@codemirror/*` isn't installable from
 * this ticket's write_scope (`apps/web/package.json` isn't in it — see
 * `markdown.ts`'s header for the identical wall). `DiffView.tsx` renders
 * this output with the same unified add/remove styling a merge view shows;
 * HANDOFF: swap in `@codemirror/merge` once the dependency wall lifts —
 * this module can be deleted wholesale then, `DiffLine[]` is its whole
 * public surface.
 */

export type DiffLine =
  | { kind: 'equal'; oldLine: number; newLine: number; text: string }
  | { kind: 'remove'; oldLine: number; text: string }
  | { kind: 'add'; newLine: number; text: string };

/** Longest-common-subsequence table over line arrays. All indices below are loop-bound-guaranteed in range. */
function lcsLengths(a: string[], b: string[]): number[][] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i]![j] =
        a[i] === b[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  return table;
}

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const table = lcsLengths(a, b);
  const out: DiffLine[] = [];

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'equal', oldLine: i + 1, newLine: j + 1, text: a[i]! });
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      out.push({ kind: 'remove', oldLine: i + 1, text: a[i]! });
      i += 1;
    } else {
      out.push({ kind: 'add', newLine: j + 1, text: b[j]! });
      j += 1;
    }
  }
  while (i < a.length) {
    out.push({ kind: 'remove', oldLine: i + 1, text: a[i]! });
    i += 1;
  }
  while (j < b.length) {
    out.push({ kind: 'add', newLine: j + 1, text: b[j]! });
    j += 1;
  }
  return out;
}

export interface DiffStat {
  added: number;
  removed: number;
}

export function diffStat(lines: DiffLine[]): DiffStat {
  return lines.reduce(
    (acc, line) => {
      if (line.kind === 'add') acc.added += 1;
      if (line.kind === 'remove') acc.removed += 1;
      return acc;
    },
    { added: 0, removed: 0 },
  );
}
