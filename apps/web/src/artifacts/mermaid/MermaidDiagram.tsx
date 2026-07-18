/**
 * Renders a `MermaidDiagram` (see `parse.ts`) as inline SVG — offline, no
 * CDN, no `unsafe-eval` (FR-C3 acceptance: "Mermaid DAG renders offline").
 * `.tsx` components in this package are render-only and verified via
 * Playwright e2e, not vitest (matches every other component here —
 * `apps/web/vitest.config.ts` has no DOM environment).
 */

import { layoutFlowchart, type PositionedNode } from './layout.js';
import { parseMermaid, type MermaidDiagram as MermaidDiagramModel } from './parse.js';

const SHAPE_RADIUS: Record<PositionedNode['shape'], number> = {
  rect: 4,
  rounded: 18,
  circle: 0,
  diamond: 0,
  hexagon: 0,
};

function NodeLabel({ node }: { node: PositionedNode }) {
  const lines = node.label.split('\n');
  const lineHeight = 16;
  const startY = node.y + node.height / 2 - ((lines.length - 1) * lineHeight) / 2;
  return (
    <text
      x={node.x + node.width / 2}
      y={startY}
      textAnchor="middle"
      dominantBaseline="middle"
      className="mermaid-node__label"
    >
      {lines.map((line, i) => (
        <tspan key={i} x={node.x + node.width / 2} dy={i === 0 ? 0 : lineHeight}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

function NodeShapeSvg({ node }: { node: PositionedNode }) {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  switch (node.shape) {
    case 'circle':
      return (
        <ellipse
          cx={cx}
          cy={cy}
          rx={node.width / 2}
          ry={node.height / 2}
          className="mermaid-node__shape"
        />
      );
    case 'diamond': {
      const points = [
        [cx, node.y],
        [node.x + node.width, cy],
        [cx, node.y + node.height],
        [node.x, cy],
      ]
        .map((p) => p.join(','))
        .join(' ');
      return <polygon points={points} className="mermaid-node__shape" />;
    }
    case 'hexagon': {
      const cut = node.width * 0.15;
      const points = [
        [node.x + cut, node.y],
        [node.x + node.width - cut, node.y],
        [node.x + node.width, cy],
        [node.x + node.width - cut, node.y + node.height],
        [node.x + cut, node.y + node.height],
        [node.x, cy],
      ]
        .map((p) => p.join(','))
        .join(' ');
      return <polygon points={points} className="mermaid-node__shape" />;
    }
    default:
      return (
        <rect
          x={node.x}
          y={node.y}
          width={node.width}
          height={node.height}
          rx={SHAPE_RADIUS[node.shape]}
          className="mermaid-node__shape"
        />
      );
  }
}

function FlowchartSvg({
  diagram,
}: {
  diagram: Extract<MermaidDiagramModel, { kind: 'flowchart' }>;
}) {
  const layout = layoutFlowchart(diagram);
  return (
    <svg
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="img"
      aria-label="Mermaid flowchart diagram"
      className="mermaid-diagram"
    >
      <defs>
        <marker
          id="mermaid-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" className="mermaid-arrowhead" />
        </marker>
      </defs>
      {layout.subgraphs.map((sg) => (
        <g key={sg.id}>
          <rect
            x={sg.x}
            y={sg.y}
            width={sg.width}
            height={sg.height}
            className="mermaid-subgraph"
          />
          <text x={sg.x + 8} y={sg.y + 16} className="mermaid-subgraph__label">
            {sg.label}
          </text>
        </g>
      ))}
      {layout.edges.map((edge, i) => {
        const x1 = edge.from.x + edge.from.width / 2;
        const y1 = edge.from.y + edge.from.height / 2;
        const x2 = edge.to.x + edge.to.width / 2;
        const y2 = edge.to.y + edge.to.height / 2;
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        return (
          <g key={i}>
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              markerEnd="url(#mermaid-arrow)"
              className={`mermaid-edge mermaid-edge--${edge.style}`}
            />
            {edge.label && (
              <text x={midX} y={midY} className="mermaid-edge__label">
                {edge.label}
              </text>
            )}
          </g>
        );
      })}
      {layout.nodes.map((node) => (
        <g key={node.id} data-testid={`mermaid-node-${node.id}`}>
          <NodeShapeSvg node={node} />
          <NodeLabel node={node} />
        </g>
      ))}
    </svg>
  );
}

const LIFELINE_GAP = 160;
const MESSAGE_GAP = 40;
const HEADER_HEIGHT = 40;

function SequenceSvg({
  diagram,
}: {
  diagram: Extract<MermaidDiagramModel, { kind: 'sequence' }>;
}) {
  const participants = diagram.participants;
  const xFor = (id: string) => {
    const idx = participants.findIndex((p) => p.id === id);
    return 60 + Math.max(idx, 0) * LIFELINE_GAP;
  };
  const width = 120 + participants.length * LIFELINE_GAP;
  const height = HEADER_HEIGHT + 20 + diagram.messages.length * MESSAGE_GAP + 20;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Mermaid sequence diagram"
      className="mermaid-diagram"
    >
      <defs>
        <marker
          id="mermaid-seq-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" className="mermaid-arrowhead" />
        </marker>
      </defs>
      {participants.map((p) => {
        const x = xFor(p.id);
        return (
          <g key={p.id} data-testid={`mermaid-participant-${p.id}`}>
            <rect
              x={x - 50}
              y={4}
              width={100}
              height={HEADER_HEIGHT - 8}
              rx={4}
              className="mermaid-node__shape"
            />
            <text
              x={x}
              y={HEADER_HEIGHT / 2 + 4}
              textAnchor="middle"
              className="mermaid-node__label"
            >
              {p.label}
            </text>
            <line
              x1={x}
              y1={HEADER_HEIGHT}
              x2={x}
              y2={height - 10}
              className="mermaid-lifeline"
            />
          </g>
        );
      })}
      {diagram.messages.map((msg, i) => {
        const x1 = xFor(msg.from);
        const x2 = xFor(msg.to);
        const y = HEADER_HEIGHT + 20 + i * MESSAGE_GAP;
        const label = diagram.autonumber ? `${i + 1}. ${msg.text}` : msg.text;
        return (
          <g key={i}>
            <line
              x1={x1}
              y1={y}
              x2={x2}
              y2={y}
              markerEnd="url(#mermaid-seq-arrow)"
              className={`mermaid-edge mermaid-edge--${msg.style === 'dashed' ? 'dotted' : 'solid'}`}
            />
            <text
              x={(x1 + x2) / 2}
              y={y - 6}
              textAnchor="middle"
              className="mermaid-edge__label"
            >
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function MermaidDiagram({ source }: { source: string }) {
  let diagram: MermaidDiagramModel;
  try {
    diagram = parseMermaid(source);
  } catch {
    diagram = { kind: 'unsupported', diagramType: 'parse-error', source };
  }

  if (diagram.kind === 'flowchart') return <FlowchartSvg diagram={diagram} />;
  if (diagram.kind === 'sequence') return <SequenceSvg diagram={diagram} />;
  return (
    <div className="mermaid-unsupported" data-testid="mermaid-unsupported">
      <p>
        Diagram type &ldquo;{diagram.diagramType}&rdquo; isn&rsquo;t rendered by the
        offline subset renderer yet — showing the source instead.
      </p>
      <pre>{diagram.source}</pre>
    </div>
  );
}
