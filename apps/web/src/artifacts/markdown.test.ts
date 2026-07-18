import { describe, expect, it } from 'vitest';
import { parseMarkdown } from './markdown.js';

describe('parseMarkdown', () => {
  it('parses headings at every level', () => {
    expect(parseMarkdown('# H1\n\n## H2')).toEqual([
      { kind: 'heading', level: 1, children: [{ kind: 'text', text: 'H1' }] },
      { kind: 'heading', level: 2, children: [{ kind: 'text', text: 'H2' }] },
    ]);
  });

  it('parses a paragraph with inline bold, italic, code, and a link', () => {
    const blocks = parseMarkdown(
      'Hello **bold** and *italic* and `code` and [link](https://x)',
    );
    expect(blocks).toEqual([
      {
        kind: 'paragraph',
        children: [
          { kind: 'text', text: 'Hello ' },
          { kind: 'bold', children: [{ kind: 'text', text: 'bold' }] },
          { kind: 'text', text: ' and ' },
          { kind: 'italic', children: [{ kind: 'text', text: 'italic' }] },
          { kind: 'text', text: ' and ' },
          { kind: 'code', text: 'code' },
          { kind: 'text', text: ' and ' },
          { kind: 'link', href: 'https://x', children: [{ kind: 'text', text: 'link' }] },
        ],
      },
    ]);
  });

  it('parses a fenced code block, tagging language', () => {
    const blocks = parseMarkdown('```ts\nconst x = 1;\n```');
    expect(blocks).toEqual([{ kind: 'code', lang: 'ts', content: 'const x = 1;' }]);
  });

  it('parses a ```mermaid fence as a distinct mermaid block', () => {
    const blocks = parseMarkdown('```mermaid\nflowchart TB\n  A --> B\n```');
    expect(blocks).toEqual([{ kind: 'mermaid', content: 'flowchart TB\n  A --> B' }]);
  });

  it('parses an unordered and an ordered list separately', () => {
    expect(parseMarkdown('- a\n- b')).toEqual([
      {
        kind: 'list',
        ordered: false,
        items: [[{ kind: 'text', text: 'a' }], [{ kind: 'text', text: 'b' }]],
      },
    ]);
    expect(parseMarkdown('1. a\n2. b')).toEqual([
      {
        kind: 'list',
        ordered: true,
        items: [[{ kind: 'text', text: 'a' }], [{ kind: 'text', text: 'b' }]],
      },
    ]);
  });

  it('parses a blockquote recursively', () => {
    expect(parseMarkdown('> quoted text')).toEqual([
      {
        kind: 'blockquote',
        children: [
          { kind: 'paragraph', children: [{ kind: 'text', text: 'quoted text' }] },
        ],
      },
    ]);
  });

  it('parses a horizontal rule', () => {
    expect(parseMarkdown('---')).toEqual([{ kind: 'hr' }]);
  });

  it('parses a pipe table with a header and rows', () => {
    const blocks = parseMarkdown('| A | B |\n|---|---|\n| 1 | 2 |');
    expect(blocks).toEqual([
      {
        kind: 'table',
        header: [[{ kind: 'text', text: 'A' }], [{ kind: 'text', text: 'B' }]],
        rows: [[[{ kind: 'text', text: '1' }], [{ kind: 'text', text: '2' }]]],
      },
    ]);
  });

  it('does not misparse a code fence containing pipe-looking lines as a table', () => {
    const blocks = parseMarkdown('```\n| not a table |\n```');
    expect(blocks).toEqual([{ kind: 'code', lang: '', content: '| not a table |' }]);
  });
});
