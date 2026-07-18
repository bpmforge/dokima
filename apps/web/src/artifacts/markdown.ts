/**
 * Minimal, dependency-free markdown parser (headings, paragraphs, lists,
 * blockquotes, fenced code incl. ` ```mermaid `, pipe tables, hr, inline
 * bold/italic/code/links). `@codemirror/*`/markdown-it-class libraries
 * aren't installable from this ticket's write_scope (`apps/web/package.json`
 * isn't in it — see `apps/server/src/api/server/artifacts-routes.ts`'s
 * header for the identical wall on the server side). Renders to a plain
 * AST that `MarkdownView.tsx` turns into React elements directly (never
 * `dangerouslySetInnerHTML` — no HTML string ever exists to sanitize).
 */

export type InlineNode =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; children: InlineNode[] }
  | { kind: 'italic'; children: InlineNode[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; children: InlineNode[] };

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: InlineNode[] }
  | { kind: 'paragraph'; children: InlineNode[] }
  | { kind: 'code'; lang: string; content: string }
  | { kind: 'mermaid'; content: string }
  | { kind: 'list'; ordered: boolean; items: InlineNode[][] }
  | { kind: 'blockquote'; children: Block[] }
  | { kind: 'table'; header: InlineNode[][]; rows: InlineNode[][][] }
  | { kind: 'hr' };

function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let i = 0;
  let buffer = '';

  function flush(): void {
    if (buffer) {
      nodes.push({ kind: 'text', text: buffer });
      buffer = '';
    }
  }

  while (i < text.length) {
    const rest = text.slice(i);

    const codeMatch = /^`([^`]+)`/.exec(rest);
    const boldMatch = /^\*\*([^*]+)\*\*/.exec(rest) ?? /^__([^_]+)__/.exec(rest);
    const italicMatch = /^\*([^*]+)\*/.exec(rest) ?? /^_([^_]+)_/.exec(rest);
    const linkMatch = /^\[([^\]]*)\]\(([^)]+)\)/.exec(rest);

    if (codeMatch) {
      flush();
      nodes.push({ kind: 'code', text: codeMatch[1]! });
      i += codeMatch[0].length;
    } else if (linkMatch) {
      flush();
      nodes.push({
        kind: 'link',
        href: linkMatch[2]!,
        children: parseInline(linkMatch[1]!),
      });
      i += linkMatch[0].length;
    } else if (boldMatch) {
      flush();
      nodes.push({ kind: 'bold', children: parseInline(boldMatch[1]!) });
      i += boldMatch[0].length;
    } else if (italicMatch) {
      flush();
      nodes.push({ kind: 'italic', children: parseInline(italicMatch[1]!) });
      i += italicMatch[0].length;
    } else {
      buffer += text[i];
      i += 1;
    }
  }
  flush();
  return nodes;
}

function isTableSeparatorRow(line: string): boolean {
  return /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line) && line.includes('-');
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      blocks.push({
        kind: 'heading',
        level: headingMatch[1]!.length as 1 | 2 | 3 | 4 | 5 | 6,
        children: parseInline(headingMatch[2]!.trim()),
      });
      i += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ kind: 'hr' });
      i += 1;
      continue;
    }

    const fenceMatch = /^```\s*(\S*)\s*$/.exec(line);
    if (fenceMatch) {
      const lang = fenceMatch[1] ?? '';
      const contentLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i]!)) {
        contentLines.push(lines[i]!);
        i += 1;
      }
      i += 1; // consume closing fence
      const content = contentLines.join('\n');
      blocks.push(
        lang.toLowerCase() === 'mermaid'
          ? { kind: 'mermaid', content }
          : { kind: 'code', lang, content },
      );
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i]!)) {
        quoteLines.push(lines[i]!.replace(/^\s*>\s?/, ''));
        i += 1;
      }
      blocks.push({ kind: 'blockquote', children: parseMarkdown(quoteLines.join('\n')) });
      continue;
    }

    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      isTableSeparatorRow(lines[i + 1]!)
    ) {
      const header = splitTableRow(line).map((cell) => parseInline(cell));
      i += 2;
      const rows: InlineNode[][][] = [];
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim() !== '') {
        rows.push(splitTableRow(lines[i]!).map((cell) => parseInline(cell)));
        i += 1;
      }
      blocks.push({ kind: 'table', header, rows });
      continue;
    }

    const listMatch = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (listMatch) {
      const ordered = /\d+\./.test(listMatch[1]!);
      const items: InlineNode[][] = [];
      while (i < lines.length) {
        const m = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(lines[i]!);
        if (!m || /\d+\./.test(m[1]!) !== ordered) break;
        items.push(parseInline(m[2]!));
        i += 1;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !/^(#{1,6})\s+/.test(lines[i]!) &&
      !/^```/.test(lines[i]!) &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[i]!) &&
      !/^\s*>\s?/.test(lines[i]!)
    ) {
      paraLines.push(lines[i]!);
      i += 1;
    }
    blocks.push({ kind: 'paragraph', children: parseInline(paraLines.join(' ')) });
  }

  return blocks;
}
