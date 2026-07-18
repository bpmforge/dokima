/**
 * Mermaid-*compatible-subset* parser (FR-C3, TECH_STACK.md pin `mermaid
 * 11.x`). The real `mermaid` package isn't installable from this ticket's
 * write_scope (`apps/web/package.json` isn't in it — same wall
 * `markdown.ts`/`diff.ts` document). This is a bounded, real parser+
 * renderer for the subset this repo's own docs actually use (grep-verified
 * across `docs/**`): `flowchart`/`graph` with direction, shaped nodes, one
 * level of `subgraph`, labeled/unlabeled edges, and `sequenceDiagram` with
 * participants/actors and arrow messages. Anything else (classDiagram,
 * stateDiagram, erDiagram, gantt, pie, …) is reported as unsupported so the
 * caller can fall back to showing raw source — never a silent wrong
 * render. One arrow per line only (every real diagram in `docs/**` is
 * written that way already) — chained edges on one line (`A --> B --> C`)
 * parse as a single mis-shapen node, not two edges; not worth widening the
 * grammar for a form nothing in this repo uses. HANDOFF: delete this whole
 * directory once `mermaid` is installable and swap in `mermaid.render()`
 * per TECH_STACK's `securityLevel: 'strict'` guidance.
 */

export type NodeShape = 'rect' | 'rounded' | 'circle' | 'diamond' | 'hexagon';

export interface FlowNode {
  id: string;
  label: string;
  shape: NodeShape;
  subgraphId: string | null;
}

export interface FlowEdge {
  from: string;
  to: string;
  label: string | null;
  style: 'solid' | 'dotted' | 'thick';
}

export interface FlowSubgraph {
  id: string;
  label: string;
}

export type FlowDirection = 'TB' | 'BT' | 'LR' | 'RL';

export interface FlowchartDiagram {
  kind: 'flowchart';
  direction: FlowDirection;
  nodes: FlowNode[];
  edges: FlowEdge[];
  subgraphs: FlowSubgraph[];
}

export interface SequenceParticipant {
  id: string;
  label: string;
}

export interface SequenceMessage {
  from: string;
  to: string;
  text: string;
  style: 'solid' | 'dashed';
}

export interface SequenceDiagram {
  kind: 'sequence';
  autonumber: boolean;
  participants: SequenceParticipant[];
  messages: SequenceMessage[];
}

export interface UnsupportedDiagram {
  kind: 'unsupported';
  diagramType: string;
  source: string;
}

export type MermaidDiagram = FlowchartDiagram | SequenceDiagram | UnsupportedDiagram;

function stripQuotes(text: string): string {
  const trimmed = text.trim();
  const unquoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1)
      : trimmed;
  return unquoted.replace(/<br\s*\/?>/gi, '\n');
}

const NODE_SHAPE_PATTERNS: Array<{ re: RegExp; shape: NodeShape }> = [
  { re: /^(\w[\w-]*)\{\{(.+)\}\}$/, shape: 'hexagon' },
  { re: /^(\w[\w-]*)\(\((.+)\)\)$/, shape: 'circle' },
  { re: /^(\w[\w-]*)\{(.+)\}$/, shape: 'diamond' },
  { re: /^(\w[\w-]*)\((.+)\)$/, shape: 'rounded' },
  { re: /^(\w[\w-]*)\[\((.+)\)\]$/, shape: 'rounded' },
  { re: /^(\w[\w-]*)\[(.+)\]$/, shape: 'rect' },
];

function parseNodeToken(token: string): {
  id: string;
  label: string | null;
  shape: NodeShape;
} {
  const trimmed = token.trim();
  for (const { re, shape } of NODE_SHAPE_PATTERNS) {
    const m = re.exec(trimmed);
    if (m) return { id: m[1]!, label: stripQuotes(m[2]!), shape };
  }
  return { id: trimmed, label: null, shape: 'rect' };
}

// Arrow token first (dashes/dots/equals + optional arrowhead), *then* an
// optional `|label|` — mermaid puts the pipe label after the full arrow
// (`A -->|label| B`), not between the dashes and the arrowhead.
const EDGE_RE =
  /^(.+?)\s*(-\.-+>|-\.-+|={2,3}>|={2,3}|-{2,3}>|-{2,3})(?:\|([^|]*)\|)?\s*(.+)$/;

function edgeStyleFor(arrow: string): FlowEdge['style'] {
  if (arrow.includes('.')) return 'dotted';
  if (arrow.includes('=')) return 'thick';
  return 'solid';
}

function isCommentOrBlank(line: string): boolean {
  return line.trim() === '' || line.trim().startsWith('%%');
}

function parseFlowchart(lines: string[], direction: FlowDirection): FlowchartDiagram {
  const nodes = new Map<string, FlowNode>();
  const edges: FlowEdge[] = [];
  const subgraphs: FlowSubgraph[] = [];
  const subgraphStack: string[] = [];

  function ensureNode(token: string): string {
    const { id, label, shape } = parseNodeToken(token);
    const existing = nodes.get(id);
    if (existing) {
      if (label !== null) existing.label = label;
      return id;
    }
    nodes.set(id, {
      id,
      label: label ?? id,
      shape,
      subgraphId: subgraphStack.at(-1) ?? null,
    });
    return id;
  }

  for (const raw of lines) {
    if (isCommentOrBlank(raw)) continue;
    const line = raw.trim();

    const subgraphMatch = /^subgraph\s+(.+)$/.exec(line);
    if (subgraphMatch) {
      const { id, label } = parseNodeToken(subgraphMatch[1]!);
      subgraphs.push({ id, label: label ?? id });
      subgraphStack.push(id);
      continue;
    }
    if (line === 'end') {
      subgraphStack.pop();
      continue;
    }

    const edgeMatch = EDGE_RE.exec(line);
    if (edgeMatch) {
      const [, fromPart, arrow, pipeLabel, toPart] = edgeMatch;
      const label = pipeLabel?.trim() || null;
      const froms = fromPart!.split('&').map((s) => ensureNode(s));
      const tos = toPart!.split('&').map((s) => ensureNode(s));
      for (const from of froms) {
        for (const to of tos) {
          edges.push({ from, to, label, style: edgeStyleFor(arrow!) });
        }
      }
      continue;
    }

    // Standalone node declaration (no edge on this line).
    ensureNode(line);
  }

  return {
    kind: 'flowchart',
    direction,
    nodes: Array.from(nodes.values()),
    edges,
    subgraphs,
  };
}

function parseSequence(lines: string[]): SequenceDiagram {
  const participants = new Map<string, SequenceParticipant>();
  const messages: SequenceMessage[] = [];
  let autonumber = false;

  function ensureParticipant(id: string, label?: string): string {
    const existing = participants.get(id);
    if (existing) {
      if (label) existing.label = label;
    } else {
      participants.set(id, { id, label: label ?? id });
    }
    return id;
  }

  // `\w+` ids (mermaid identifiers never contain `-`/`:`/space) sidestep the
  // backtracking ambiguity a greedy `\S+` has against the arrow's own dashes
  // (e.g. `PM-->>U:` could otherwise split as id `PM-` + arrow `->>`).
  const MESSAGE_RE = /^(\w+)\s*(-->>|->>|-->|->)\s*(\w+)\s*:\s*(.*)$/;
  const PARTICIPANT_RE = /^(?:participant|actor)\s+(\S+)(?:\s+as\s+(.+))?$/;

  for (const raw of lines) {
    if (isCommentOrBlank(raw)) continue;
    const line = raw.trim();
    if (line === 'autonumber') {
      autonumber = true;
      continue;
    }
    const participantMatch = PARTICIPANT_RE.exec(line);
    if (participantMatch) {
      ensureParticipant(participantMatch[1]!, participantMatch[2]?.trim());
      continue;
    }
    const messageMatch = MESSAGE_RE.exec(line);
    if (messageMatch) {
      const [, from, arrow, to, text] = messageMatch;
      ensureParticipant(from!);
      ensureParticipant(to!);
      messages.push({
        from: from!,
        to: to!,
        text: text!.trim(),
        style: arrow!.includes('--') ? 'dashed' : 'solid',
      });
    }
    // Note/activation/loop lines etc. are silently skipped (subset scope) —
    // never crash, never fabricate a message that wasn't in the source.
  }

  return {
    kind: 'sequence',
    autonumber,
    participants: Array.from(participants.values()),
    messages,
  };
}

export function parseMermaid(source: string): MermaidDiagram {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const firstLine = lines.find((l) => !isCommentOrBlank(l))?.trim() ?? '';

  const flowchartMatch = /^(flowchart|graph)\s+(TB|TD|BT|LR|RL)\b/.exec(firstLine);
  if (flowchartMatch) {
    const direction = (
      flowchartMatch[2] === 'TD' ? 'TB' : flowchartMatch[2]
    ) as FlowDirection;
    return parseFlowchart(lines.slice(1), direction);
  }

  if (/^sequenceDiagram\b/.test(firstLine)) {
    return parseSequence(lines.slice(1));
  }

  const diagramType = firstLine.split(/\s+/)[0] || 'unknown';
  return { kind: 'unsupported', diagramType, source };
}
