/** Unified diff view (see `diff.ts`'s header for the CodeMirror-merge-view wall/HANDOFF). */

import { diffLines, diffStat } from './diff.js';

export function DiffView({
  oldContent,
  newContent,
}: {
  oldContent: string;
  newContent: string;
}) {
  const lines = diffLines(oldContent, newContent);
  const stat = diffStat(lines);
  return (
    <div className="diff-view" data-testid="diff-view">
      <div className="diff-view__stat">
        <span className="diff-view__added">+{stat.added}</span>{' '}
        <span className="diff-view__removed">-{stat.removed}</span>
      </div>
      <pre className="diff-view__body">
        {lines.map((line, i) => {
          const prefix = line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' ';
          const lineNo =
            line.kind === 'add'
              ? line.newLine
              : line.kind === 'remove'
                ? line.oldLine
                : line.oldLine;
          return (
            <div key={i} className={`diff-view__line diff-view__line--${line.kind}`}>
              <span className="diff-view__gutter">{lineNo}</span>
              <span className="diff-view__prefix">{prefix}</span>
              <span className="diff-view__text">{line.text}</span>
            </div>
          );
        })}
      </pre>
    </div>
  );
}
