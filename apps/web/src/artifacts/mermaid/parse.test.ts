import { describe, expect, it } from 'vitest';
import { parseMermaid, type FlowchartDiagram, type SequenceDiagram } from './parse.js';

describe('parseMermaid — flowchart/graph subset', () => {
  it('parses a simple labeled flowchart with a plain edge', () => {
    const diagram = parseMermaid(
      'flowchart TB\n  A[Start] --> B[End]',
    ) as FlowchartDiagram;
    expect(diagram.kind).toBe('flowchart');
    expect(diagram.direction).toBe('TB');
    expect(diagram.nodes).toEqual([
      { id: 'A', label: 'Start', shape: 'rect', subgraphId: null },
      { id: 'B', label: 'End', shape: 'rect', subgraphId: null },
    ]);
    expect(diagram.edges).toEqual([{ from: 'A', to: 'B', label: null, style: 'solid' }]);
  });

  it('normalizes TD to TB (mermaid alias)', () => {
    const diagram = parseMermaid('flowchart TD\n  A --> B') as FlowchartDiagram;
    expect(diagram.direction).toBe('TB');
  });

  it('parses a dotted labeled edge (real doc syntax: -.->|label|)', () => {
    const diagram = parseMermaid(
      'graph BT\n  web[apps/web] -.->|REST + WS only| server[apps/server]',
    ) as FlowchartDiagram;
    expect(diagram.edges).toEqual([
      { from: 'web', to: 'server', label: 'REST + WS only', style: 'dotted' },
    ]);
    expect(diagram.nodes.find((n) => n.id === 'web')?.label).toBe('apps/web');
  });

  it('parses multi-target edges joined with &', () => {
    const diagram = parseMermaid(
      'graph BT\n  loop[loop] --> validators & gateway & memory & mcp',
    ) as FlowchartDiagram;
    expect(diagram.edges).toEqual([
      { from: 'loop', to: 'validators', label: null, style: 'solid' },
      { from: 'loop', to: 'gateway', label: null, style: 'solid' },
      { from: 'loop', to: 'memory', label: null, style: 'solid' },
      { from: 'loop', to: 'mcp', label: null, style: 'solid' },
    ]);
  });

  it('parses standalone node declarations without an edge', () => {
    const diagram = parseMermaid('graph BT\n  shared[shared]') as FlowchartDiagram;
    expect(diagram.nodes).toEqual([
      { id: 'shared', label: 'shared', shape: 'rect', subgraphId: null },
    ]);
  });

  it('parses subgraphs, assigning member nodes to the innermost subgraph id', () => {
    const source = [
      'flowchart TB',
      '  subgraph Local["User\'s machine"]',
      '    WEB["Canvas SPA"]',
      '    subgraph Core["Server"]',
      '      API["API Gateway"]',
      '    end',
      '    SBX["Sandbox"]',
      '  end',
    ].join('\n');
    const diagram = parseMermaid(source) as FlowchartDiagram;
    expect(diagram.subgraphs).toEqual([
      { id: 'Local', label: "User's machine" },
      { id: 'Core', label: 'Server' },
    ]);
    expect(diagram.nodes.find((n) => n.id === 'WEB')?.subgraphId).toBe('Local');
    expect(diagram.nodes.find((n) => n.id === 'API')?.subgraphId).toBe('Core');
    expect(diagram.nodes.find((n) => n.id === 'SBX')?.subgraphId).toBe('Local');
  });

  it('converts <br/> in labels to newlines', () => {
    const diagram = parseMermaid(
      'flowchart TB\n  A["line one<br/>line two"]',
    ) as FlowchartDiagram;
    expect(diagram.nodes[0]!.label).toBe('line one\nline two');
  });

  it('recognizes circle, diamond, and hexagon shapes', () => {
    const diagram = parseMermaid(
      'flowchart TB\n  A((circle))\n  B{diamond}\n  C{{hexagon}}',
    ) as FlowchartDiagram;
    expect(diagram.nodes.map((n) => n.shape)).toEqual(['circle', 'diamond', 'hexagon']);
  });

  it('parses a parenthesized (round) node shape', () => {
    const diagram = parseMermaid('flowchart TB\n  A(Rounded label)') as FlowchartDiagram;
    expect(diagram.nodes[0]).toMatchObject({ shape: 'rounded', label: 'Rounded label' });
  });

  it('ignores %% comments and blank lines', () => {
    const diagram = parseMermaid(
      'flowchart TB\n%% a comment\n\n  A --> B',
    ) as FlowchartDiagram;
    expect(diagram.edges).toHaveLength(1);
  });
});

describe('parseMermaid — sequenceDiagram subset', () => {
  it('parses participants and solid/dashed arrow messages', () => {
    const source = [
      'sequenceDiagram',
      '  participant U as User',
      '  participant PM as Shipwright PM',
      '  U->>PM: Idea (plain English)',
      '  PM-->>U: Discovery interview',
    ].join('\n');
    const diagram = parseMermaid(source) as SequenceDiagram;
    expect(diagram.kind).toBe('sequence');
    expect(diagram.participants).toEqual([
      { id: 'U', label: 'User' },
      { id: 'PM', label: 'Shipwright PM' },
    ]);
    expect(diagram.messages).toEqual([
      { from: 'U', to: 'PM', text: 'Idea (plain English)', style: 'solid' },
      { from: 'PM', to: 'U', text: 'Discovery interview', style: 'dashed' },
    ]);
  });

  it('recognizes autonumber and actor declarations', () => {
    const source = ['sequenceDiagram', '  autonumber', '  actor U', '  U->>U: self'].join(
      '\n',
    );
    const diagram = parseMermaid(source) as SequenceDiagram;
    expect(diagram.autonumber).toBe(true);
    expect(diagram.participants).toEqual([{ id: 'U', label: 'U' }]);
  });

  it('infers undeclared participants from a message line', () => {
    const diagram = parseMermaid('sequenceDiagram\n  A->>B: hi') as SequenceDiagram;
    expect(diagram.participants.map((p) => p.id)).toEqual(['A', 'B']);
  });
});

describe('parseMermaid — unsupported diagram types', () => {
  it('reports classDiagram as unsupported with the raw source preserved', () => {
    const source = 'classDiagram\n  Animal <|-- Dog';
    const diagram = parseMermaid(source);
    expect(diagram).toEqual({ kind: 'unsupported', diagramType: 'classDiagram', source });
  });

  it('reports an empty/unrecognized source as unsupported rather than throwing', () => {
    const diagram = parseMermaid('');
    expect(diagram.kind).toBe('unsupported');
  });
});
