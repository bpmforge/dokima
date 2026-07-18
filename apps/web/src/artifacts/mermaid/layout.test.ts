import { describe, expect, it } from 'vitest';
import { parseMermaid, type FlowchartDiagram } from './parse.js';
import { layoutFlowchart } from './layout.js';

describe('layoutFlowchart', () => {
  it('places a downstream node further along the rank axis than its source (TB: greater y)', () => {
    const diagram = parseMermaid(
      'flowchart TB\n  A --> B\n  B --> C',
    ) as FlowchartDiagram;
    const layout = layoutFlowchart(diagram);
    const a = layout.nodes.find((n) => n.id === 'A')!;
    const b = layout.nodes.find((n) => n.id === 'B')!;
    const c = layout.nodes.find((n) => n.id === 'C')!;
    expect(a.y).toBeLessThan(b.y);
    expect(b.y).toBeLessThan(c.y);
  });

  it('BT direction inverts the rank axis relative to TB', () => {
    const tb = layoutFlowchart(
      parseMermaid('flowchart TB\n  A --> B') as FlowchartDiagram,
    );
    const bt = layoutFlowchart(
      parseMermaid('flowchart BT\n  A --> B') as FlowchartDiagram,
    );
    const tbA = tb.nodes.find((n) => n.id === 'A')!;
    const tbB = tb.nodes.find((n) => n.id === 'B')!;
    const btA = bt.nodes.find((n) => n.id === 'A')!;
    const btB = bt.nodes.find((n) => n.id === 'B')!;
    expect(tbA.y).toBeLessThan(tbB.y);
    expect(btA.y).toBeGreaterThan(btB.y);
  });

  it('LR direction lays ranks out along x, not y', () => {
    const diagram = parseMermaid('flowchart LR\n  A --> B') as FlowchartDiagram;
    const layout = layoutFlowchart(diagram);
    const a = layout.nodes.find((n) => n.id === 'A')!;
    const b = layout.nodes.find((n) => n.id === 'B')!;
    expect(a.x).toBeLessThan(b.x);
  });

  it('sibling nodes in the same rank get distinct lane positions', () => {
    const diagram = parseMermaid(
      'flowchart TB\n  A --> B\n  A --> C',
    ) as FlowchartDiagram;
    const layout = layoutFlowchart(diagram);
    const b = layout.nodes.find((n) => n.id === 'B')!;
    const c = layout.nodes.find((n) => n.id === 'C')!;
    expect(b.y).toBe(c.y);
    expect(b.x).not.toBe(c.x);
  });

  it('every node has a non-negative position and positive size', () => {
    const diagram = parseMermaid(
      'flowchart TB\n  A[Longer label here] --> B\n  B --> C\n  A --> C',
    ) as FlowchartDiagram;
    const layout = layoutFlowchart(diagram);
    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.width).toBeGreaterThan(0);
      expect(node.height).toBeGreaterThan(0);
    }
  });

  it('subgraph bounds enclose every member node', () => {
    const source = [
      'flowchart TB',
      '  subgraph Local["Local"]',
      '    A --> B',
      '  end',
      '  C',
    ].join('\n');
    const layout = layoutFlowchart(parseMermaid(source) as FlowchartDiagram);
    const bounds = layout.subgraphs.find((s) => s.id === 'Local')!;
    for (const id of ['A', 'B']) {
      const node = layout.nodes.find((n) => n.id === id)!;
      expect(node.x).toBeGreaterThanOrEqual(bounds.x);
      expect(node.y).toBeGreaterThanOrEqual(bounds.y);
      expect(node.x + node.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(node.y + node.height).toBeLessThanOrEqual(bounds.y + bounds.height);
    }
  });

  it('does not infinite-loop on a cyclic graph', () => {
    const diagram = parseMermaid(
      'flowchart TB\n  A --> B\n  B --> A',
    ) as FlowchartDiagram;
    const layout = layoutFlowchart(diagram);
    expect(layout.nodes).toHaveLength(2);
  });

  it('handles an empty diagram without throwing', () => {
    const layout = layoutFlowchart({
      kind: 'flowchart',
      direction: 'TB',
      nodes: [],
      edges: [],
      subgraphs: [],
    });
    expect(layout.nodes).toEqual([]);
    expect(layout.width).toBeGreaterThan(0);
  });
});
