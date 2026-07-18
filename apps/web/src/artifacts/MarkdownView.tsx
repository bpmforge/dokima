/** Renders `markdown.ts`'s AST to React elements — never `dangerouslySetInnerHTML`. */

import { Fragment } from 'react';
import type { Block, InlineNode } from './markdown.js';
import { parseMarkdown } from './markdown.js';
import { MermaidDiagram } from './mermaid/MermaidDiagram.js';

const SAFE_LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

/** Agent-authored doc content is untrusted (CLAUDE.md law #4) — reject any scheme but a known-safe one before it becomes a real anchor. */
export function isSafeHref(href: string): boolean {
  try {
    return SAFE_LINK_SCHEMES.has(new URL(href, 'https://placeholder.invalid/').protocol);
  } catch {
    return false;
  }
}

function InlineNodes({ nodes }: { nodes: InlineNode[] }) {
  return (
    <>
      {nodes.map((node, i) => {
        switch (node.kind) {
          case 'text':
            return <Fragment key={i}>{node.text}</Fragment>;
          case 'bold':
            return (
              <strong key={i}>
                <InlineNodes nodes={node.children} />
              </strong>
            );
          case 'italic':
            return (
              <em key={i}>
                <InlineNodes nodes={node.children} />
              </em>
            );
          case 'code':
            return <code key={i}>{node.text}</code>;
          case 'link':
            return isSafeHref(node.href) ? (
              <a key={i} href={node.href}>
                <InlineNodes nodes={node.children} />
              </a>
            ) : (
              <span key={i} data-testid="unsafe-link">
                <InlineNodes nodes={node.children} />
              </span>
            );
          default:
            return null;
        }
      })}
    </>
  );
}

const HEADING_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

function BlockNode({ block }: { block: Block }) {
  switch (block.kind) {
    case 'heading': {
      const Tag = HEADING_TAGS[block.level - 1]!;
      return (
        <Tag>
          <InlineNodes nodes={block.children} />
        </Tag>
      );
    }
    case 'paragraph':
      return (
        <p>
          <InlineNodes nodes={block.children} />
        </p>
      );
    case 'code':
      return (
        <pre>
          <code>{block.content}</code>
        </pre>
      );
    case 'mermaid':
      return (
        <div className="markdown-mermaid" data-testid="markdown-mermaid">
          <MermaidDiagram source={block.content} />
        </div>
      );
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag>
          {block.items.map((item, i) => (
            <li key={i}>
              <InlineNodes nodes={item} />
            </li>
          ))}
        </Tag>
      );
    }
    case 'blockquote':
      return (
        <blockquote>
          <Blocks blocks={block.children} />
        </blockquote>
      );
    case 'table':
      return (
        <table>
          <thead>
            <tr>
              {block.header.map((cell, i) => (
                <th key={i}>
                  <InlineNodes nodes={cell} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci}>
                    <InlineNodes nodes={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case 'hr':
      return <hr />;
    default:
      return null;
  }
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((block, i) => (
        <BlockNode key={i} block={block} />
      ))}
    </>
  );
}

export function MarkdownView({ content }: { content: string }) {
  const blocks = parseMarkdown(content);
  return (
    <div className="markdown-view">
      <Blocks blocks={blocks} />
    </div>
  );
}
